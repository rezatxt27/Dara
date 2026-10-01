// Storage layer over chrome.storage.local. Each top-level key is stored separately
// so the background worker and UI pages don't overwrite each other's unrelated data.

import { normalizeConnection } from './ai.js';

export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  currency: 'toman',        // display unit: toman | rial
  digits: 'fa',             // fa | en
  compact: true,            // compact headline numbers
  theme: 'auto',            // auto | light | dark
  privacy: false,           // blur amounts
  refreshMinutes: 30,
  badge: 'change',          // change | gold | usd | none
  notify: { interest: true, flows: true, alerts: true, stale: true },
  remindDays: { price: 7, balance: 30 },
  providers: { tgju: true, tsetmc: true, fipiran: true, nobitex: true },
  targets: {},              // categoryId -> target share (0..1)
  denom: 'money',           // money | usd | gold | coin
  onboarded: false,
  watch: [],                // market watchlist refs (price only, not holdings)
  depositPct: null,
  updateUrl: '',            // optional public JSON {version, url} announcing the latest release
  lastUpdateCheck: 0,         // deposit rate used for comparisons (null → from your fixed-income assets, else 25)
};

export const DEFAULTS = {
  settings: DEFAULT_SETTINGS,
  assets: [],
  flows: [],
  quotes: {},
  snapshots: {},
  events: [],
  alerts: [],
  history: {},  // quoteId -> {at, points:[[iso, price]]}
  ai: { connections: [], activeId: null, privacy: 'full', fallback: true, weekly: true, trustedSites: [] },
  chat: { messages: [] },
  reports: [],  // weekly narratives [{id, weekOf, createdAt, facts, text, by, model}]
  critique: null, // last AI portfolio review {at, points:[{title, detail, check, level}], by}
  meta: { lastRun: 0, lastOk: 0, running: false, errors: {}, schema: SCHEMA_VERSION, lastStaleNotice: 0 },
};
export const KEYS = Object.keys(DEFAULTS);

const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

// In-memory fallback (for tests / non-extension preview)
const mem = {};
const backend = hasChrome ? chrome.storage.local : {
  async get(keys) { const o = {}; (keys || Object.keys(mem)).forEach((k) => { if (k in mem) o[k] = structuredClone(mem[k]); }); return o; },
  async set(obj) { Object.assign(mem, structuredClone(obj)); },
  async clear() { Object.keys(mem).forEach((k) => delete mem[k]); },
};

function withDefaults(key, value) {
  const d = DEFAULTS[key];
  if (value === undefined || value === null) return structuredClone(d);
  if (key === 'settings') {
    return { ...structuredClone(DEFAULT_SETTINGS), ...value,
      notify: { ...DEFAULT_SETTINGS.notify, ...(value.notify || {}) },
      remindDays: { ...DEFAULT_SETTINGS.remindDays, ...(value.remindDays || {}) },
      providers: { ...DEFAULT_SETTINGS.providers, ...(value.providers || {}) },
      targets: { ...(value.targets || {}) } };
  }
  if (key === 'meta') return { ...structuredClone(DEFAULTS.meta), ...value };
  if (key === 'ai') { const v = { ...structuredClone(DEFAULTS.ai), ...value }; v.connections = (v.connections || []).map(normalizeConnection); return v; }
  return value;
}

export async function loadAll() {
  const raw = await backend.get(KEYS);
  const out = {};
  for (const k of KEYS) out[k] = withDefaults(k, raw[k]);
  return out;
}

export async function load(...keys) {
  const raw = await backend.get(keys);
  const out = {};
  for (const k of keys) out[k] = withDefaults(k, raw[k]);
  return out;
}

export async function save(partial) {
  await backend.set(partial);
}

/** Read-modify-write a single key with the freshest stored value. */
export async function update(key, fn) {
  const cur = (await load(key))[key];
  const next = await fn(structuredClone(cur));
  await backend.set({ [key]: next });
  return next;
}

export async function clearAll() { await backend.clear(); }

export function onChanged(cb) {
  if (!hasChrome) return () => {};
  const h = (changes, area) => { if (area === 'local') cb(changes); };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}

/** Full backup object */
export async function exportBackup() {
  const all = await loadAll();
  delete all.history; delete all.chat;
  // API keys never leave the device in a backup
  all.ai = { ...all.ai, connections: (all.ai.connections || []).map(({ apiKey, ...c }) => ({ ...c, apiKey: '' })) };
  return { app: 'dara', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: all };
}

export async function importBackup(obj, { merge = false } = {}) {
  if (!obj || obj.app !== 'dara' || !obj.data) throw new Error('فایل پشتیبان معتبر نیست');
  const d = obj.data;
  if (merge) {
    const cur = await loadAll();
    const ids = new Set(cur.assets.map((a) => a.id));
    const assets = cur.assets.concat((d.assets || []).filter((a) => !ids.has(a.id)));
    const fids = new Set(cur.flows.map((a) => a.id));
    const flows = cur.flows.concat((d.flows || []).filter((a) => !fids.has(a.id)));
    await save({ assets, flows });
    return;
  }
  const toSave = {};
  for (const k of KEYS) if (k in d && !['meta', 'ai', 'chat', 'history'].includes(k)) toSave[k] = d[k];
  if (toSave.settings) toSave.settings = withDefaults('settings', toSave.settings);
  await save(toSave);
}
