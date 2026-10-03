// Self-update for the unpacked install: when new files land in the extension folder,
// the manifest on disk carries a newer version than the one Chrome has loaded.
// Pages check on load (a refresh is enough); the worker checks every minute and
// reloads itself only when no Dara page is open, so nothing the user is typing is lost.
import { compareVersions } from './changelog.js';

export async function diskVersion() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const m = JSON.parse(await r.text());
    return typeof m.version === 'string' ? m.version : null;
  } catch { return null; }
}

/**
 * A newer version on disk than the one running, else null. Only an upgrade counts (copying an older folder in does
 * nothing), and the manifest must read the same twice a moment apart — files still being copied aren't loaded half-way.
 */
export async function pendingVersion({ settle = 1200 } = {}) {
  const disk = await diskVersion();
  const cur = chrome.runtime.getManifest().version;
  if (!disk || compareVersions(disk, cur) <= 0) return null;
  if (settle) { await new Promise((r) => setTimeout(r, settle)); if ((await diskVersion()) !== disk) return null; }
  return disk;
}

/** URLs of the Dara tabs that are open right now (they close when the extension reloads); null if Chrome can't tell. */
export async function openTabUrls() {
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    return ctx.map((c) => c.documentUrl).filter((u) => u && u.includes('/ui/app.html'));
  } catch { return null; }
}
/** Is the small popup open right now? (null if Chrome can't tell) */
export async function popupOpen() {
  try { return (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length > 0; } catch { return null; }
}

/** Remember which pages to bring back, then reload the extension with the new files. */
export async function applyUpdate(current) {
  const urls = (await openTabUrls()) || [];
  // One entry per open tab; the calling page's own entry is replaced by its live URL (current hash), opened last so it gets focus.
  if (current) { const i = urls.findIndex((u) => u === current); urls.splice(i >= 0 ? i : urls.length ? urls.length - 1 : 0, urls.length ? 1 : 0); urls.push(current); }
  await chrome.storage.local.set({ updateState: { reopen: urls, from: chrome.runtime.getManifest().version, at: Date.now() } });
  chrome.runtime.reload();
}

/** Called by a page when it loads: true if an update was found and is being applied. */
export async function checkOnLoad() {
  const v = await pendingVersion();
  if (!v) return false;
  const here = location.pathname.endsWith('/app.html') ? location.href : null;
  // another Dara tab may hold unsaved typing or a running job: then the page shows «نسخه تازه آماده است» instead
  const urls = await openTabUrls();
  if (urls === null || urls.length > (here ? 1 : 0)) return false;
  await applyUpdate(here);
  return true;
}
