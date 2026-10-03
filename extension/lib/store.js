// Storage layer over chrome.storage.local. Each top-level key is stored separately
// so the background worker and UI pages don't overwrite each other's unrelated data.

import { normalizeConnection } from './ai.js';
import { valueOf } from './engine.js';
import { todayIso } from './jalali.js';

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

const LISTS = new Set(['assets', 'flows', 'events', 'alerts', 'reports']);
const MODES = new Set(['units', 'balance', 'rate', 'loan']);
/** Drop rows that would break every page (null, wrong type, no id) — e.g. from a damaged or hand-edited backup. */
export function cleanList(key, v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && (key !== 'assets' || (x.id && MODES.has(x.mode) && typeof x.category === 'string'
    // a deposit or loan without its terms can't be valued (and would break the pages that show it)
    && (x.mode !== 'rate' || (x.rate && typeof x.rate === 'object')) && (x.mode !== 'loan' || (x.loan && typeof x.loan === 'object')))) && (key !== 'flows' || (x.id && /^\d{4}-\d\d-\d\d$/.test(x.start || ''))));
}

function withDefaults(key, value) {
  const d = DEFAULTS[key];
  if (value === undefined || value === null) return structuredClone(d);
  if (LISTS.has(key)) return cleanList(key, value);
  if ((key === 'quotes' || key === 'snapshots' || key === 'history') && (typeof value !== 'object' || Array.isArray(value))) return structuredClone(d);
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

/**
 * One lock shared by every extension page and the service worker (Web Locks are per origin), so a read-modify-write
 * in one place can never interleave with another and silently drop its changes. Never nest: inside a locked
 * function use the state you were given, not update()/mutate().
 */
export function locked(fn) {
  const L = typeof navigator !== 'undefined' && navigator.locks;
  return L ? L.request('dara-db', fn) : fn();
}

/** Read-modify-write a single key with the freshest stored value. */
export async function update(key, fn) {
  return locked(async () => {
    const cur = (await load(key))[key];
    const next = await fn(structuredClone(cur));
    await backend.set({ [key]: next });
    return next;
  });
}

/**
 * Atomic read-modify-write over several keys: fn(state) mutates the given state object in place (or returns a partial);
 * every listed key is written in one storage call. Returns fn's return value (or the state).
 */
export async function mutate(keys, fn) {
  return locked(async () => {
    const st = await load(...keys);
    const ret = await fn(st);
    const out = {}; for (const k of keys) out[k] = st[k];
    await backend.set(out);
    return ret === undefined ? st : ret;
  });
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

/** Check a backup before using it: right app, known schema, usable lists. Returns { ok, error, dropped }. */
export function checkBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'dara' || !obj.data || typeof obj.data !== 'object') return { ok: false, error: 'این فایل پشتیبان دارا نیست' };
  if (+obj.schema > SCHEMA_VERSION) return { ok: false, error: 'این فایل با نسخه جدیدتری از دارا ساخته شده؛ اول دارا را به‌روز کن' };
  let dropped = 0;
  for (const k of LISTS) if (k in obj.data) { const v = obj.data[k]; dropped += Array.isArray(v) ? v.length - cleanList(k, v).length : 1; }
  return { ok: true, dropped, assets: cleanList('assets', obj.data.assets).length };
}

/** Copy of the current data kept just before an import replaces it, so the import can be undone. */
export async function snapshotBeforeImport() {
  const all = await loadAll(); delete all.history; delete all.chat;
  await backend.set({ preImport: { at: Date.now(), data: all } });
}
export async function undoImport() {
  const { preImport } = await backend.get(['preImport']);
  if (!preImport?.data) throw new Error('نسخه قبل از ورود اطلاعات پیدا نشد');
  const toSave = {}; for (const k of KEYS) if (k in preImport.data && !['ai', 'chat', 'history'].includes(k)) toSave[k] = preImport.data[k];
  await locked(() => backend.set(toSave));
}

export async function importBackup(obj, { merge = false } = {}) {
  const chk = checkBackup(obj);
  if (!chk.ok) throw new Error(chk.error);
  const d = { ...obj.data };
  for (const k of LISTS) if (k in d) d[k] = cleanList(k, d[k]);
  await snapshotBeforeImport();
  if (merge) {
    let added = 0;
    // inside the lock: a background run or another tab can't write in between and get overwritten
    await mutate(['assets', 'flows', 'meta', 'events', 'quotes'], (cur) => {
      const ids = new Set(cur.assets.map((a) => a.id));
      // codes stay unique: an incoming code that is already taken gets the next free one
      const used = new Set(cur.assets.map((a) => a.code));
      let n = Math.max(+cur.meta?.lastCode || 0, ...cur.assets.map((x) => +(/^A-(\d+)$/.exec(x.code || '') || [])[1] || 0));
      const rows = (d.assets || []).filter((a) => !ids.has(a.id));
      // a new code must clash neither with what's stored nor with a code a later incoming row already carries
      const later = new Set(rows.map((a) => a.code).filter(Boolean));
      const next = () => { let c; do c = 'A-' + String(++n).padStart(3, '0'); while (used.has(c) || later.has(c)); return c; };
      const incoming = rows.map((a) => { if (!a.code || used.has(a.code)) a = { ...a, code: next() }; used.add(a.code); return a; });
      cur.assets = cur.assets.concat(incoming); added = incoming.length;
      const fids = new Set(cur.flows.map((a) => a.id));
      cur.flows = cur.flows.concat((d.flows || []).filter((a) => !fids.has(a.id)));
      cur.meta = { ...cur.meta, lastCode: n };
      if (incoming.length) {
        // what came in is recorded as added (money brought in), so «today» doesn't show it as a market gain
        const quotes = { ...(d.quotes || {}), ...(cur.quotes || {}) };
        const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const changes = incoming.map((a) => ({ assetId: a.id, field: 'add', delta: 0, value: valueOf(a, quotes, {}).signedValue || 0 }));
        const back = new Set(incoming.map((a) => a.id));
        // a deleted asset that came back: its deletion counts as undone (no «removed» money, no undo button left)
        cur.events = (cur.events || []).map((e) => (e.restore && back.has(e.restore.id) && !e.undone ? { ...e, undone: true, undoneBy: id } : e));
        cur.events = [{ id, kind: 'edit', date: todayIso(), at: Date.now(), title: `ورود ${incoming.length} دارایی از فایل پشتیبان`, amount: 0, noUndo: true, changes }, ...cur.events];
      }
    });
    return { ...chk, added };
  }
  const toSave = {};
  for (const k of KEYS) if (k in d && !['meta', 'ai', 'chat', 'history'].includes(k)) toSave[k] = d[k];
  if (toSave.settings) toSave.settings = withDefaults('settings', toSave.settings);
  await locked(() => save(toSave));
  return chk;
}
