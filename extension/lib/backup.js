// Automatic backups: when one is due, whether anything changed, which old files to remove, and the optional password.
// Files go to the Downloads folder (Dara-Backups/), so they outlive the browser's own storage. Nothing here touches the
// network; the password never leaves this computer and is never inside a backup.
import { isoToJ, isoFromDate } from './jalali.js';

export const FOLDER = 'Dara-Backups';
export const DEFAULT_BACKUP = { freq: 'weekly', keep: 'all', last: 8 };
const DAY = 86400000;
export const PERIOD = { daily: DAY, weekly: 7 * DAY };

export const backupSettings = (settings) => ({ ...DEFAULT_BACKUP, ...(settings?.backup || {}) });

/** Is a backup due? Never when off; at once when none was made yet; otherwise a period after the last (an hour early is fine). */
export function isDue(cfg, meta, now = Date.now()) {
  const p = PERIOD[cfg?.freq];
  if (!p) return false;
  const last = Math.max(+meta?.lastAt || 0, +meta?.checkedAt || 0);
  return !last || now - last >= p - 3600000;
}

/** A fingerprint of what the owner entered (not prices or the daily history, which change on their own). */
export function coreHash(st) {
  // display preferences and the backup's own settings are not data; nor is the last price a refresh remembers
  const s = { ...(st.settings || {}) };
  for (const k of ['lastUpdateCheck', 'theme', 'privacy', 'backup', 'compact', 'digits']) delete s[k];
  const assets = (st.assets || []).map((a) => (a?.price?.last ? { ...a, price: { ...a.price, last: undefined } } : a));
  const text = JSON.stringify([assets, st.flows || [], st.events || [], st.alerts || [], s, (st.reports || []).length]);
  let h = 2166136261; // FNV-1a, 32-bit — enough to notice a change, not a security measure
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + text.length.toString(36);
}

/** «dara-backup-1405-07-16.json» (or «…-locked.json» when encrypted), inside the backup folder. */
export function fileName(now = Date.now(), { locked = false } = {}) {
  const j = isoToJ(isoFromDate(new Date(now)));
  const p = (n) => String(n).padStart(2, '0');
  return `${FOLDER}/dara-backup-${j.jy}-${p(j.jm)}-${p(j.jd)}${locked ? '-locked' : ''}.json`;
}

/**
 * Which kept files to remove. files: [{ id, at }]. keep:
 *  'all'   — none, ever
 *  'smart' — every file of the last 4 weeks; one per (Jalali) month for the past year; one per year before that
 *  'last'  — only the newest `last`
 * The newest file is never removed.
 */
export function toRemove(files, keep, { now = Date.now(), last = 8 } = {}) {
  const list = [...(files || [])].filter((f) => f && f.id != null && +f.at > 0 && !f.pending).sort((a, b) => b.at - a.at);
  if (keep === 'last') return list.slice(Math.max(1, +last || 8)).map((f) => f.id);
  if (keep !== 'smart') return [];
  const out = []; const seen = new Set();
  list.forEach((f, i) => {
    if (i === 0) return;
    const age = now - f.at;
    if (age <= 28 * DAY) return;
    const j = isoToJ(isoFromDate(new Date(f.at)));
    const bucket = age <= 365 * DAY ? `m${j.jy}-${j.jm}` : `y${j.jy}`;
    if (seen.has(bucket)) out.push(f.id); else seen.add(bucket); // the newest in each month or year stays
  });
  return out;
}

/* ------------------------------------------------ encryption ------------------------------------------------ */
// AES-GCM 256 with a key from the password (PBKDF2-SHA256). The key is kept on this computer (chrome.storage, never in a
// backup) so backups can be made while you're away; what the password protects is a copy that leaves this computer —
// a synced cloud folder, a USB stick, an email.
const ITER = 600000; // OWASP's figure for PBKDF2-SHA256; older files carry their own count
const subtle = () => globalThis.crypto.subtle;
export const toB64 = (bytes) => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** { salt, key } (both base64) from a password; the key is what the background keeps to encrypt later backups. */
export async function makeKey(password, saltB64 = null, iterations = ITER) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const base = await subtle().importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return { salt: toB64(salt), key: toB64(await subtle().exportKey('raw', key)), iterations };
}
export const PASSWORD_MIN = 8;

async function gzip(text) {
  const out = await new Response(new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return new Uint8Array(out);
}
export async function gunzip(bytes) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return new TextDecoder().decode(out);
}
export const isGzip = (b) => b && b[0] === 0x1f && b[1] === 0x8b;

/** The backup object, locked: a small JSON envelope around the compressed, encrypted backup. */
export async function encrypt(backupObj, vault) {
  const key = await subtle().importKey('raw', fromB64(vault.key), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, await gzip(JSON.stringify(backupObj)));
  return { app: 'dara', kind: 'locked-backup', v: 1, exportedAt: backupObj.exportedAt, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: +vault.iterations || 250000, salt: vault.salt }, iv: toB64(iv), data: toB64(data) };
}
export const isLocked = (obj) => !!obj && obj.app === 'dara' && obj.kind === 'locked-backup' && typeof obj.data === 'string';

/** Open a locked backup with its password; throws a plain Persian message when the password is wrong. */
export async function decrypt(envelope, password) {
  if (!isLocked(envelope)) throw new Error('این فایل پشتیبان رمزدار دارا نیست');
  const iter = Math.round(+envelope.kdf?.iterations);
  if (!(iter >= 1000 && iter <= 10_000_000)) throw new Error('این فایل پشتیبان خراب است');
  const { key } = await makeKey(password, envelope.kdf?.salt, iter);
  const k = await subtle().importKey('raw', fromB64(key), 'AES-GCM', false, ['decrypt']);
  let plain;
  try { plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, k, fromB64(envelope.data)); }
  catch { throw new Error('رمز درست نیست'); }
  return JSON.parse(await gunzip(new Uint8Array(plain)));
}

/**
 * The text and type of the file to write: plain JSON when small enough for a data: URL (Chrome caps URLs near 2 MB),
 * else gzip-compressed (restoring reads both). Locked backups are always a small JSON envelope.
 */
export async function filePayload(backupObj, vault = null) {
  if (vault?.key) {
    const env = JSON.stringify(await encrypt(backupObj, vault));
    return { url: 'data:application/json;base64,' + toB64(new TextEncoder().encode(env)), ext: '', bytes: env.length, locked: true };
  }
  const text = JSON.stringify(backupObj);
  const raw = new TextEncoder().encode(text);
  if (raw.length < 1_300_000) return { url: 'data:application/json;base64,' + toB64(raw), ext: '', bytes: raw.length, locked: false };
  const gz = await gzip(text);
  return { url: 'data:application/gzip;base64,' + toB64(gz), ext: '.gz', bytes: gz.length, locked: false };
}
