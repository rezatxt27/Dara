// Self-update for the unpacked install: when new files land in the extension folder,
// the manifest on disk carries a newer version than the one Chrome has loaded.
// Pages check on load (a refresh is enough); the worker checks every minute and
// reloads itself only when no Dara page is open, so nothing the user is typing is lost.

export async function diskVersion() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const m = JSON.parse(await r.text());
    return typeof m.version === 'string' ? m.version : null;
  } catch { return null; }
}

/** Newer version string if the files on disk differ from the running version, else null. */
export async function pendingVersion() {
  const disk = await diskVersion();
  const cur = chrome.runtime.getManifest().version;
  return disk && disk !== cur ? disk : null;
}

/** URLs of the Dara tabs that are open right now (they close when the extension reloads). */
export async function openTabUrls() {
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    return ctx.map((c) => c.documentUrl).filter((u) => u && u.includes('/ui/app.html'));
  } catch { return []; }
}

/** Remember which pages to bring back, then reload the extension with the new files. */
export async function applyUpdate(current) {
  const urls = await openTabUrls();
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
  await applyUpdate(here);
  return true;
}
