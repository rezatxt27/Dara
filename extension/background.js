// Dara service worker: scheduled price refresh, automations (interest payouts, recurring flows),
// daily snapshots, price alerts, badge and notifications.
import * as store from './lib/store.js';
import * as P from './lib/providers.js';
import * as E from './lib/engine.js';
import * as AI from './lib/ai.js';
import * as A from './lib/assistant.js';
import * as I from './lib/insights.js';
import { CORE_REFS, TGJU, TGJU_BY_KEY, NOBITEX_BY_KEY } from './lib/catalog.js';
import { todayIso, addDaysIso, isoFromDate } from './lib/jalali.js';
import { money, pct, uid } from './lib/format.js';
import * as U from './lib/update.js';
import * as BB from './lib/bubble.js';
import * as BK from './lib/backup.js';
import * as RD from './lib/radar.js';
import { riskLevel } from './lib/profile.js';

const PROVIDER_HOSTS = ['call1.tgju.org', 'api.tgju.org', 'cdn.tsetmc.com', 'www.fipiran.com', 'api.nobitex.ir', 'api.bitpin.ir'];
const REFERERS = {
  'call1.tgju.org': 'https://www.tgju.org/', 'api.tgju.org': 'https://www.tgju.org/',
  'cdn.tsetmc.com': 'https://www.tsetmc.com/', 'www.fipiran.com': 'https://www.fipiran.com/', 'api.nobitex.ir': 'https://nobitex.ir/',
  'api.bitpin.ir': 'https://bitpin.ir/',
};
// Fipiran's fund list is a POST; it is sent with the site's own Origin, exactly like its fund-compare page.
const ORIGINS = { 'www.fipiran.com': 'https://www.fipiran.com' };

// Requests made by the extension itself (tabId -1) get a site Referer and no extension Origin,
// so the public price endpoints treat them like their own web pages.
async function installNetRules() {
  const mk = (base, headers) => PROVIDER_HOSTS.map((host, i) => ({
    id: base + i, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: headers(host) },
    condition: { requestDomains: [host], tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] },
  }));
  // Installed as two independent sets so one rejected header can't block the other.
  const origin = (h) => (ORIGINS[h] ? [{ header: 'origin', operation: 'set', value: ORIGINS[h] }] : [{ header: 'origin', operation: 'remove' }]);
  for (const rules of [mk(100, (h) => [{ header: 'referer', operation: 'set', value: REFERERS[h] }]), mk(200, origin)]) {
    try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id), addRules: rules }); }
    catch (e) { console.warn('[dara] net rules', e?.message || e); }
  }
}

async function schedule() {
  const { settings } = await store.load('settings');
  const period = Math.max(5, +settings.refreshMinutes || 30);
  const cur = await chrome.alarms.get('refresh');
  if (!cur || cur.periodInMinutes !== period) await chrome.alarms.create('refresh', { periodInMinutes: period, delayInMinutes: 0.1 });
  if (!(await chrome.alarms.get('daily'))) await chrome.alarms.create('daily', { periodInMinutes: 60 * 6, delayInMinutes: 1 });
  if (!(await chrome.alarms.get('weekly'))) await chrome.alarms.create('weekly', { periodInMinutes: 60 * 2, delayInMinutes: 3 });
  if (!(await chrome.alarms.get('backup'))) await chrome.alarms.create('backup', { periodInMinutes: 60 * 3, delayInMinutes: 2 });
  if (!(await chrome.alarms.get('radar'))) await chrome.alarms.create('radar', { periodInMinutes: 15, delayInMinutes: 4 });
  // only a folder install («Load unpacked») updates by copying files; a packed install never needs the 1-minute check
  let dev = true; try { dev = (await chrome.management.getSelf()).installType === 'development'; } catch (e) { /* unknown: keep checking */ }
  if (dev && !(await chrome.alarms.get('selfupdate'))) await chrome.alarms.create('selfupdate', { periodInMinutes: 1, delayInMinutes: 1 });
  if (!dev) await chrome.alarms.clear('selfupdate');
}

/* ------------------------------ self-update ------------------------------ */
// New files copied into the install folder → reload. With a Dara page open, the page
// shows a banner instead (its own refresh applies the update) so no typing is lost.
async function checkSelfUpdate() {
  const v = await U.pendingVersion();
  if (!v) return { pending: null };
  const tabs = await U.openTabUrls(); const popup = await U.popupOpen();
  // nothing open (and Chrome could tell): reload now; otherwise the open page or popup applies it on its next load
  // never in the middle of a refresh, a backup or rebuilding the chart: the next check (minutes later) applies it
  const busy = running || backingUp || backfilling;
  if (tabs && !tabs.length && popup === false && !busy) { await U.applyUpdate(null); return { pending: v, applied: true }; }
  chrome.runtime.sendMessage({ type: 'update-available', version: v }).catch(() => {});
  return { pending: v };
}
async function afterUpdate(prev) {
  const { updateState } = await chrome.storage.local.get('updateState');
  const cur = chrome.runtime.getManifest().version;
  await chrome.storage.local.set({ updateState: { reopen: [], from: prev || updateState?.from || '', to: cur, at: Date.now(), done: true } });
  const fresh = updateState && Date.now() - updateState.at < 5 * 60000 ? updateState.reopen || [] : [];
  if (fresh.length) {
    // Reloading closes our pages; bring them back where they were.
    const open = (await U.openTabUrls()) || [];
    for (const [i, url] of fresh.entries()) if (!open.includes(url)) chrome.tabs.create({ url, active: i === fresh.length - 1 });
  } else if (prev && prev !== cur) {
    chrome.notifications?.create('dara-update', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'دارا به‌روز شد', message: `نسخه ${cur} نصب شد؛ داده‌هایت سر جایشان است.`, priority: 0 });
  }
}

/**
 * Chrome stops an idle MV3 worker after ~30 s without extension API calls, even mid-fetch. Long jobs (price cycle,
 * history rebuild, AI weekly report) ping a cheap API so they can finish and save their result.
 */
function keepAlive() {
  const t = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => {}); } catch (e) { /* ignore */ } }, 20000);
  return () => clearInterval(t);
}

/* ------------------------------ automatic backups ------------------------------ */
// A file in Downloads/Dara-Backups when one is due and something the owner entered has changed. The file outlives the
// browser's own storage (cleared site data, a removed extension, a new computer). Old files are removed only when the
// owner chose «smart» or «last few», and only files Dara made that are still where it put them.
const setBackupMeta = (patch) => store.update('meta', (m) => ({ ...m, backup: { ...(m.backup || {}), ...patch } }));
function waitDownload(id, ms = 60000) {
  return new Promise((resolve) => {
    const done = (state, error) => { clearTimeout(t); chrome.downloads.onChanged.removeListener(on); resolve({ state, error }); };
    const on = (d) => { if (d.id !== id || !d.state) return; if (d.state.current === 'complete') done('complete'); else if (d.state.current === 'interrupted') done('interrupted', d.error?.current); };
    const t = setTimeout(() => done('timeout'), ms);
    chrome.downloads.onChanged.addListener(on);
    chrome.downloads.search({ id }).then(([d]) => { if (d?.state === 'complete') done('complete'); else if (d?.state === 'interrupted') done('interrupted', d.error); }).catch(() => {});
  });
}
let backingUp = null;
/** A file Dara itself downloaded, still at the path it was saved to (never someone else's download that reused an id). */
async function ownBackup(f) {
  try { const [d] = await chrome.downloads.search({ id: f.id }); return d && d.byExtensionId === chrome.runtime.id && (!f.path || d.filename === f.path) && d.exists !== false ? d : null; } catch { return null; }
}
async function removeBackupFiles(list) {
  for (const f of list) {
    if (!(await ownBackup(f))) continue; // moved, renamed or deleted by the owner, or the history was cleared: leave it
    try { await chrome.downloads.removeFile(f.id); } catch (e) { /* ignore */ }
    try { await chrome.downloads.erase({ id: f.id }); } catch (e) { /* ignore */ }
  }
}
const CANCELLED = 'ذخیره پشتیبان لغو شد. اگر کروم برای هر دانلود می‌پرسد «کجا ذخیره شود»، پشتیبان خودکار هر بار همین پنجره را باز می‌کند؛ آن گزینه را در تنظیمات دانلود کروم خاموش کن، یا پشتیبان خودکار را خاموش کن.';
async function runBackup({ force = false } = {}) {
  if (backingUp) { if (!force) return backingUp; await backingUp.catch(() => null); } // «همین الان» waits for a check in progress, then runs
  if (backingUp) return backingUp;
  const alive = keepAlive();
  backingUp = (async () => {
    // only what deciding needs (the daily history is large); the rest is read once a backup is actually due
    let st = await store.load('settings', 'meta', 'assets');
    const cfg = BK.backupSettings(st.settings);
    const meta = st.meta.backup || {};
    // a file still waiting in a «Save as» dialog from an earlier run: settle it first
    let files = [...(meta.files || [])];
    const waiting = files.filter((x) => x.pending);
    for (const f of waiting) {
      const [d] = await chrome.downloads.search({ id: f.id }).catch(() => []);
      if (d?.state === 'complete') Object.assign(f, { pending: false, path: d.filename, name: d.filename.split(/[\\/]/).pop() });
      else if (!d || d.state === 'interrupted') { files = files.filter((x) => x !== f); await setBackupMeta({ files, error: d?.error === 'USER_CANCELED' ? CANCELLED : 'ذخیره فایل پشتیبان ممکن نشد', errorAt: Date.now() }); }
    }
    if (waiting.length) await setBackupMeta({ files });
    if (!force && (!BK.isDue(cfg, meta) || !st.assets.length)) return { skipped: true };
    if (!chrome.downloads?.download) throw new Error('این مرورگر اجازه ذخیره فایل به افزونه نمی‌دهد');
    st = { ...st, ...(await store.load('flows', 'events', 'alerts', 'reports', 'radarUser')) };
    const hash = BK.coreHash(st);
    if (!force && meta.lastAt && meta.lastHash === hash) { await setBackupMeta({ checkedAt: Date.now(), error: null }); return { unchanged: true }; }
    const now = Date.now();
    const { vault } = await chrome.storage.local.get('vault');
    const pay = await BK.filePayload(await store.exportBackup(), vault?.key ? vault : null);
    const id = await chrome.downloads.download({ url: pay.url, filename: BK.fileName(now, { locked: pay.locked }) + pay.ext, conflictAction: 'uniquify', saveAs: false });
    const r = await waitDownload(id);
    const entry = { id, at: now, bytes: pay.bytes, locked: pay.locked };
    if (r.state === 'interrupted') throw new Error(r.error === 'USER_CANCELED' ? CANCELLED : `ذخیره فایل پشتیبان ممکن نشد${r.error ? ` (${r.error})` : ''}`);
    if (r.state === 'timeout') entry.pending = true; // most likely Chrome's «Save as» dialog, waiting for the owner
    else { const [d] = await chrome.downloads.search({ id }); entry.path = d?.filename || ''; entry.name = (d?.filename || '').split(/[\\/]/).pop() || BK.fileName(now); }
    files.push(entry);
    const gone = new Set(BK.toRemove(files, cfg.keep, { now, last: cfg.last }));
    await removeBackupFiles(files.filter((f) => gone.has(f.id)));
    // only the newest few hundred are tracked (enough for any thinning; older files simply stay where they are)
    files = files.filter((f) => !gone.has(f.id)).slice(-400);
    await setBackupMeta({ lastAt: now, checkedAt: now, lastHash: hash, files, error: null, errorAt: null });
    if (!meta.lastAt && !force) notify('dara-backup-first', 'اولین پشتیبان خودکار دارا ذخیره شد', 'در پوشه دانلود، داخل Dara-Backups. اگر این پوشه با فضای ابری همگام است، از تنظیمات برایش رمز بگذار.');
    return entry.pending ? { pending: true } : { saved: entry.name, locked: entry.locked };
  })().catch(async (e) => { await setBackupMeta({ error: String(e?.message || e), errorAt: Date.now() }); throw e; })
    .finally(() => { backingUp = null; alive(); });
  return backingUp;
}
/** After a password is set: remove the earlier, unlocked backups Dara made (only on the owner's request). */
async function purgePlainBackups() {
  const { meta } = await store.load('meta');
  const files = meta.backup?.files || [];
  const plain = files.filter((f) => !f.locked && !f.pending);
  await removeBackupFiles(plain);
  const left = [];
  for (const f of plain) if (await ownBackup(f)) left.push(f); // could not be removed: still there
  await setBackupMeta({ files: files.filter((f) => f.locked || f.pending || left.includes(f)) });
  return { removed: plain.length - left.length, left: left.length };
}

let running = null;
async function runCycle({ force = false, reason = 'alarm' } = {}) {
  if (running) return running;
  const done = keepAlive();
  running = (async () => {
    const t0 = Date.now();
    const st = await store.loadAll();
    const { settings } = st;
    await store.update('meta', (m) => ({ ...m, running: true, runStartedAt: t0 }));
    store.dropOldPreImport().catch(() => {});

    // 1) Resolve tickers that were entered by symbol only (e.g. a gold ETF imported from a spreadsheet).
    //    In parallel, a few per cycle, and a symbol that failed is retried only after a few hours.
    let assets = st.assets;
    const resolved = {};
    const failedAt = st.meta.symFail || {};
    const pending = [...new Set(assets.map((a) => (a.mode === 'units' && a.price?.source === 'market' ? a.price.ref : null))
      .filter((ref) => ref?.provider === 'tsetmc' && !ref.key && ref.symbol && !(Date.now() - (failedAt[ref.symbol] || 0) < 6 * 3600000))
      .map((ref) => ref.symbol))].slice(0, 8);
    if (pending.length && settings.providers.tsetmc !== false) {
      const hits = await Promise.allSettled(pending.map((sym) => P.tsetmcResolve(sym)));
      const fails = {};
      pending.forEach((sym, i) => { const h = hits[i].status === 'fulfilled' ? hits[i].value : null; if (h) resolved[sym] = h; else fails[sym] = Date.now(); });
      for (const a of assets) { const ref = a.price?.ref; const h = ref && !ref.key && resolved[ref.symbol]; if (h) { ref.key = h.insCode; ref.label = h.symbol; ref.name = h.name; } }
      if (Object.keys(fails).length) await store.update('meta', (m) => ({ ...m, symFail: { ...(m.symFail || {}), ...fails } }));
    }
    if (Object.keys(resolved).length) {
      // persist resolved keys on the freshest asset list
      assets = await store.update('assets', (list) => list.map((x) => {
        const m = assets.find((y) => y.id === x.id);
        if (m?.price?.ref?.key && x.price?.ref && !x.price.ref.key) x.price.ref = { ...x.price.ref, ...m.price.ref };
        return x;
      }));
    }

    // 2) Fetch quotes
    // the extra currencies ride along on the price board (one request for all); fetched one by one only when used
    const refs = [...E.collectRefs(assets, st.alerts, [...CORE_REFS, ...TGJU.filter((t) => !t.more).map((t) => ({ provider: 'tgju', key: t.key })), ...(settings.watch || [])]),
      ...TGJU.filter((t) => t.more).map((t) => ({ provider: 'tgju', key: t.key, boardOnly: true }))];
    // NAVs of exchange-traded funds, for their bubble. Optional: a symbol with no NAV (a plain share) is noted and
    // skipped for a week; its error is never shown or stored.
    const navs = E.navRefs(assets, settings.watch || [], st.alerts, st.meta.navMiss || {});
    const { quotes: fresh, errors } = await P.fetchAll([...refs, ...navs.filter((r) => !refs.some((x) => P.quoteId(x) === P.quoteId(r)))], settings.providers);
    // auxiliary NAV errors are never stored or shown; «this symbol has no NAV» is remembered for a week, a hit clears it
    const nav = E.sortNavResults(navs, refs, fresh, errors);
    if (Object.keys(nav.miss).length || nav.hit.some((k) => st.meta.navMiss?.[k])) {
      await store.update('meta', (m) => { const nm = { ...(m.navMiss || {}), ...nav.miss }; for (const k of nav.hit) delete nm[k]; return { ...m, navMiss: nm }; });
    }
    const okCount = Object.keys(fresh).filter((k) => !nav.aux.has(k)).length;
    // Only errors on prices you actually use count as problems (the rest of the board is optional)
    const relevant = new Set(E.collectRefs(assets, st.alerts, CORE_REFS).map((r) => P.quoteId(r)));
    const relErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => relevant.has(k)));

    // 3–5) Automations, today's snapshot and alerts on the freshest state, under the shared lock: a page saving at the
    //      same moment waits instead of being overwritten (or overwriting an installment that was just applied).
    let autos, pf, snapshots, quotes, fired, meta, events;
    await store.mutate(['assets', 'flows', 'events', 'alerts', 'snapshots', 'meta', 'quotes', 'settings'], (cur) => {
      quotes = E.mergeQuotes(cur.quotes, fresh, errors);
      // a price that failed this time but came in within the last few hours isn't counted as missing
      for (const k of Object.keys(relErrors)) if (quotes[k]?.price > 0 && Date.now() - (quotes[k].fetchedAt || 0) < 3 * 3600000) delete relErrors[k];
      // a damaged row must not stop prices, the snapshot and alerts: automations run on a copy, and if they fail the
      // stored assets stay as they were (the error is shown) while everything else still saves
      let autoError;
      try { autos = E.applyAutomations(structuredClone(cur.assets), structuredClone(cur.flows), quotes, todayIso()); }
      catch (e) { console.error('[dara] automations failed', e); autoError = String(e?.message || e); autos = { assets: cur.assets, flows: cur.flows, events: [] }; }
      E.rememberLastPrices(autos.assets, quotes);
      events = autos.events.slice().reverse().concat(cur.events).slice(0, E.EVENTS_MAX);
      E.settlePending(autos.assets, events, quotes);
      pf = E.portfolio(autos.assets, quotes, cur.settings);
      snapshots = E.pruneSnapshots({ ...cur.snapshots, [todayIso()]: E.makeSnapshot(pf, quotes) });
      fired = E.checkAlerts(cur.alerts, quotes);
      meta = { ...cur.meta, running: false, lastRun: Date.now(), lastOk: okCount ? Date.now() : cur.meta.lastOk,
        errors: relErrors, okCount, errCount: Object.keys(relErrors).length, duration: Date.now() - t0, reason, fatal: undefined, autoError };
      Object.assign(cur, { assets: autos.assets, flows: autos.flows, events, quotes, snapshots, meta });
    });

    // 6) Notifications + badge
    await notifyAutomations(autos.events, autos.assets, settings);
    await notifyAlerts(fired, settings);
    await maybeStaleNotice(pf, meta, settings);
    await updateBadge(pf, { assets: autos.assets, quotes, settings, snapshots, events });
    return { ok: okCount, errors: meta.errCount, events: autos.events.length };
  })().catch(async (e) => {
    console.error('[dara] cycle failed', e);
    await store.update('meta', (m) => ({ ...m, running: false, lastRun: Date.now(), fatal: String(e?.message || e) }));
    return { ok: 0, errors: 1, fatal: String(e?.message || e) };
  }).finally(() => { running = null; done(); });
  return running;
}

function notify(id, title, message) {
  try {
    chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 0 });
  } catch (e) { /* ignore */ }
}

async function notifyAutomations(events, assets, settings) {
  if (!events.length) return;
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  // interest added to a debt is a cost, not interest received
  const interest = events.filter((e) => e.kind === 'interest' && !e.owed && !E.isLiability(byId[e.fromId] || {}));
  const flows = events.filter((e) => e.kind === 'flow' || e.kind === 'loan');
  const priv = settings.privacy;
  if (interest.length && settings.notify.interest) {
    const sum = interest.reduce((s, e) => s + e.amount, 0);
    const to = byId[interest[0].toId]?.name || '';
    notify('dara-interest-' + Date.now(), 'سود درآمد ثابت واریز شد',
      interest.length === 1 ? `${interest[0].title}${priv ? '' : ' — ' + money(sum, settings)}${to ? ' به ' + to : ''}` : `${interest.length} واریز سود ثبت شد${priv ? '' : ' — جمعاً ' + money(sum, settings)}`);
  }
  if (flows.length && settings.notify.flows) {
    notify('dara-flow-' + Date.now(), 'جریان‌های خودکار اعمال شد',
      flows.length === 1 ? `${flows[0].title}${priv ? '' : ' — ' + money(flows[0].amount, settings)}` : `${flows.length} مورد (${[...new Set(flows.map((f) => f.title))].slice(0, 3).join('، ')})`);
  }
}

function refName(ref) {
  if (ref.provider === 'tgju') return TGJU_BY_KEY[ref.key]?.name || ref.key;
  if (ref.provider === 'nobitex') return NOBITEX_BY_KEY[ref.key]?.name || ref.name || String(ref.sym || ref.key).toUpperCase();
  return ref.label || ref.symbol || ref.name || ref.key;
}

async function notifyAlerts(fired, settings) {
  if (!settings.notify.alerts) return;
  for (const a of fired) {
    if (a.kind === 'bubble') {
      notify('dara-alert-' + a.id, `هشدار حباب: ${refName(a.ref)}`, `حباب ${a.op === 'gt' ? 'به بالای' : 'به زیر'} ${pct(a.value, { sign: false })} رسید — حباب فعلی ${pct(a.price, { sign: false })}`);
      continue;
    }
    const usd = a.ref.provider === 'tgju' && TGJU_BY_KEY[a.ref.key]?.usd;
    const price = usd ? `$${a.price.toLocaleString('en-US')}` : money(a.price, settings);
    notify('dara-alert-' + a.id, `هشدار قیمت: ${refName(a.ref)}`, `${a.op === 'gt' ? 'به بالای' : 'به زیر'} سطح تعیین‌شده رسید — قیمت فعلی ${price}`);
  }
}

async function maybeStaleNotice(pf, meta, settings) {
  if (!settings.notify.stale) return;
  const stale = pf.attention.filter((r) => r.status === 'stale');
  if (!stale.length) return;
  if (Date.now() - (meta.lastStaleNotice || 0) < 3 * 86400000) return;
  notify('dara-stale', 'یادآوری به‌روزرسانی دارایی‌ها', `${stale.length} دارایی دستی مدتی است به‌روز نشده: ${stale.slice(0, 3).map((r) => r.asset.name).join('، ')}`);
  await store.update('meta', (m) => ({ ...m, lastStaleNotice: Date.now() }));
}

async function updateBadge(pf, st) {
  const { quotes, settings } = st;
  // «امروز» here is the same number the dashboard and popup show: the market's effect, without money moved or added
  const mm = (() => { try { return I.marketMove(st, pf, 1); } catch { return null; } })();
  try {
    let text = '', color = '#7A5AF8';
    if (settings.badge === 'change') {
      const p = mm && !mm.stale ? mm.pct : pf.dayChangePct; // a badge always means today
      if (p !== null && isFinite(p) && pf.net) {
        const v = Math.abs(p * 100);
        text = (p >= 0 ? '+' : '-') + (v >= 10 ? Math.round(v) : v.toFixed(1));
        color = p >= 0 ? '#16A34A' : '#E11D48';
      }
    } else if (settings.badge === 'gold') {
      const g = quotes['tgju:geram18']?.price;
      if (g) text = String(Math.round(g / 1e7)); // million toman
      color = '#C98A0B';
    } else if (settings.badge === 'usd') {
      const u = quotes['tgju:price_dollar_rl']?.price;
      if (u) text = String(Math.round(u / 1e4)); // thousand toman
      color = '#16A34A';
    }
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    await chrome.action.setTitle({ title: settings.privacy ? 'دارا' : `دارا — ارزش خالص: ${money(pf.net, settings, { compact: true })}${mm && !mm.stale && Math.abs(mm.pct) >= 0.00005 ? ' (' + pct(mm.pct) + ' امروز)' : ''}` });
  } catch (e) { /* ignore */ }
}

/* ------------------------------- history & backfill ------------------------------- */
let dollarHistCache = null;
async function rialHistory(ref, days) {
  const rows = await P.refHistory(ref, days);
  if (!P.isUsdRef(ref)) return rows;
  if (!dollarHistCache || Date.now() - dollarHistCache.at > 3600000 || dollarHistCache.days < days) dollarHistCache = { at: Date.now(), days, rows: await P.tgjuHistory('price_dollar_rl', days) };
  const usd = dollarHistCache.rows; let j = 0, last = null; const out = [];
  for (const r of rows) { while (j < usd.length && usd[j].date <= r.date) last = usd[j++].close; if (last) out.push({ date: r.date, close: r.close * last }); }
  return out;
}

let backfilling = null;
async function backfill(days) {
  if (backfilling) return backfilling;
  const done = keepAlive();
  backfilling = (async () => {
    const setProg = (p) => store.update('meta', (m) => ({ ...m, backfill: p }));
    try {
      const st = await store.loadAll();
      const refs = E.collectRefs(st.assets, [], [{ provider: 'tgju', key: 'price_dollar_rl' }, { provider: 'tgju', key: 'geram18' }, { provider: 'tgju', key: 'sekee' }]);
      const uniq = [...new Map(refs.map((r) => [P.quoteId(r), r])).values()];
      const hist = {}; let done = 0; const failed = [];
      await setProg({ state: 'running', done: 0, total: uniq.length, at: Date.now() });
      for (const r of uniq) {
        try { const h = await P.refHistory(r, days + 10); if (h.length) hist[P.quoteId(r)] = h; else failed.push(r); } catch { failed.push(r); }
        done++; await setProg({ state: 'running', done, total: uniq.length, at: Date.now() });
      }
      if (!hist['tgju:price_dollar_rl']) throw new Error('تاریخچه نرخ دلار دریافت نشد؛ اتصال به tgju را بررسی کن');
      let added = 0;
      await store.mutate(['assets', 'events', 'quotes', 'settings', 'snapshots'], (cur) => {
        const rebuilt = E.reconstructHistory(cur.assets, cur.events, hist, cur.quotes, cur.settings, days);
        const snapshots = { ...cur.snapshots };
        for (const [d, snap] of Object.entries(rebuilt)) if (!snapshots[d] || snapshots[d].est) { snapshots[d] = snap; added++; }
        cur.snapshots = E.pruneSnapshots(snapshots);
      });
      const res = { state: 'done', added, days, failed: failed.map((r) => P.quoteId(r)), at: Date.now() };
      await setProg(res);
      return { ok: true, ...res };
    } catch (e) {
      const res = { state: 'error', error: String(e.message || e), at: Date.now() };
      await setProg(res);
      return { ok: false, ...res };
    }
  })().finally(() => { backfilling = null; done(); });
  return backfilling;
}

/* ------------------------------- weekly report ------------------------------- */
function weekKey(now = new Date()) {
  // Persian week: Saturday → Friday. Report for a week is due from Friday 18:00.
  const d = new Date(now); const dow = d.getDay(); // 0 Sun … 5 Fri, 6 Sat
  const sinceFri = (dow + 2) % 7; // days since last Friday
  const fri = new Date(d); fri.setDate(d.getDate() - sinceFri); fri.setHours(18, 0, 0, 0);
  if (fri > now) fri.setDate(fri.getDate() - 7);
  return isoFromDate(fri);
}
async function generateWeekly(opts = {}) {
  const done = keepAlive();
  try { return await weeklyInner(opts); } finally { done(); }
}
async function weeklyInner({ force = false, days = 7 } = {}) {
  const st = await store.loadAll();
  const key = force ? todayIso() : weekKey();
  if (!force && (st.reports || []).some((r) => r.weekOf === key)) return { ok: true, skipped: true };
  if (!st.assets.length) return { ok: false, error: 'هنوز دارایی‌ای ثبت نشده' };
  const facts = E.weeklyFacts(st, todayIso(), days);
  if (!force && !facts.change) return { ok: true, skipped: true };
  let text = A.templateNarrative(facts, st.settings), by = 'template', model = null, aiError = null;
  if (AI.orderedConnections(st.ai).length) {
    try {
      const r = await AI.runAgent({ ai: st.ai, system: 'تو دستیار مالی «دارا» هستی و گزارش‌های کوتاه، دقیق و بی‌طرف به فارسی می‌نویسی. هیچ عددی خارج از داده‌ها نساز.',
        messages: [{ role: 'user', content: A.weeklyPrompt(facts, st.settings, st.ai.privacy) }], tools: [], maxTokens: 900 });
      if (r.text && r.text.length > 40) { text = r.text; by = 'ai'; model = r.model; }
    } catch (e) { aiError = e.message; }
  }
  const report = { id: uid('r'), weekOf: key, createdAt: Date.now(), days, facts, text, by, model, aiError };
  await store.update('reports', (l) => [report, ...l.filter((x) => x.weekOf !== key)].slice(0, 60));
  if (!force && st.settings.notify?.weekly !== false) notify('dara-weekly-' + report.id, 'گزارش هفتگی دارایی آماده است', facts.change ? `ارزش خالص ${pct(facts.change.pct)} در هفته گذشته` : 'برای مشاهده کلیک کن');
  return { ok: true, report };
}

/* ------------------------------- page capture ------------------------------- */
function grabPage() {
  const sel = String(getSelection ? getSelection() : '');
  const text = (document.body && document.body.innerText) || '';
  return { title: document.title, url: location.href, text: text.replace(/\n{3,}/g, '\n\n').slice(0, 30000), selection: sel.slice(0, 3000) };
}
async function captureTab(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: grabPage });
    const page = res?.result;
    if (!page?.text) throw new Error('متنی در این صفحه پیدا نشد');
    await chrome.storage.session.set({ capture: { ...page, at: Date.now() } });
    await chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html#/capture') });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: /Cannot access|cannot be scripted|chrome:\/\//i.test(String(e.message)) ? 'این صفحه قابل خواندن نیست (صفحات داخلی مرورگر یا فروشگاه افزونه‌ها)' : String(e.message || e) };
  }
}

/* ------------------------------- messaging ------------------------------- */
/* ------------------------------------ radar ------------------------------------ */
// Once a session is over: one market-watch request for the whole stock market, the Fipiran fund list, and — a batch at
// a time, busiest stocks first — each stock's daily closes for the year (needed once; after that the market watch
// keeps them going). Then the owner's rules run and a new match can raise a notification.
let radarRun = null;
async function loadRadar() { const o = await chrome.storage.local.get('radar'); return o.radar?.v === RD.VERSION ? o.radar : RD.empty(); }
async function runRadar({ force = false, batch = 40 } = {}) {
  if (radarRun) return radarRun;
  const done = keepAlive();
  radarRun = (async () => {
    const { settings, assets, radarUser } = await store.load('settings', 'assets', 'radarUser');
    if (settings.radar === false && !force) return { off: true };
    const tse = settings.providers?.tsetmc !== false, fip = settings.providers?.fipiran !== false;
    if (!tse && !fip) return { error: 'منبع‌های «بورس تهران» و «فیپیران» در تنظیمات خاموش‌اند' };
    const radar = await loadRadar();
    const prevError = radar.error ?? null;
    let changed = false; radar.error = tse ? null : 'منبع «بورس تهران» در تنظیمات خاموش است؛ فقط صندوق‌ها بررسی می‌شوند';
    // 1) the latest session, once its closing prices are final (never an older one than we already have)
    if (tse) try {
      const s = await P.tsetmcSessionDay();
      const final = RD.sessionFinal(s.day);
      const newer = !radar.day || s.day > radar.day || (force && s.day === radar.day);
      // while the latest session can't be used yet (unfinished, or not yet in the daily lists), the last session the lists
      // do have is used instead — once per session day, so a first scan doesn't stay empty for hours
      if (newer && (final || radar.prevFor !== s.day || force)) {
        const rows = await P.tsetmcMarketWatch();
        // the largest stocks' own daily lists: is the market watch really that session (or already reset for the next
        // one), and which sessions happened lately — was one missed while the browser was off?
        const refs = RD.largest(rows, 4);
        await Promise.all(refs.map(async (r) => { try { r.rows = await P.tsetmcDaily(r.ins, 60); } catch { r.rows = []; } }));
        const sessions = [...new Set(refs.flatMap((r) => r.rows.map((x) => x.date)))].sort();
        const mode = final ? RD.snapshotMode(rows, refs, s.day) : 'wait';
        if (mode !== 'wait') {
          RD.applySession(radar, rows, s.day, sessions, mode);
          radar.waitFor = null; changed = true;
        } else {
          radar.prevFor = s.day; radar.waitFor = s.day; changed = true;
          const last = sessions.filter((d) => d < s.day).pop();
          if (last && (!radar.day || last > radar.day)) RD.applySession(radar, rows, last, sessions.filter((d) => d <= last), 'prev');
        }
      } else if (!newer && radar.waitFor) { radar.waitFor = null; changed = true; }
      if (!radar.sectorsAt || Date.now() - radar.sectorsAt > 30 * 864e5) {
        try {
          const j = await P.getJSON('https://cdn.tsetmc.com/api/StaticData/GetStaticData');
          radar.sectors = Object.fromEntries((j.staticData || []).filter((x) => x.type === 'IndustrialGroup').map((x) => [String(x.code).padStart(2, '0'), P.persianize(x.name)]));
          radar.sectorsAt = Date.now(); changed = true;
        } catch { /* names are optional */ }
      }
    } catch (e) { radar.error = e.message; }
    // the total index and the dollar over the year, once a session — to say how a return compares
    const ixLast = radar.bench?.index?.d?.[radar.bench.index.d.length - 1] || 0;
    const ixLag = radar.day && ixLast < RD.dayNum(radar.day) && Date.now() - (radar.benchAt || 0) > 2 * 3600e3;
    const benchDue = force || Date.now() - (radar.benchAt || 0) > 2 * 3600e3; // never more often than every 2 hours
    if (radar.day && benchDue && (radar.benchFor !== radar.day || ixLag || force)) {
      let gotIndex = false;
      const D = RD.dayNum(radar.day); const bench = { ...(radar.bench || {}) };
      if (tse) try {
        const j = await P.getJSON('https://cdn.tsetmc.com/api/Index/GetIndexB2History/32097828799138957', { timeout: 30000 });
        const rows = (j?.indexB2 || []).map((x) => { const e = String(x.dEven); return { date: `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`, close: +x.xNivInuClMresIbs }; });
        if (rows.length) { bench.index = RD.benchSeries(rows, D); gotIndex = true; }
      } catch { /* comparisons are optional */ }
      if (settings.providers?.tgju !== false) try { bench.usd = RD.benchSeries(await P.tgjuHistory('price_dollar_rl', 400), D); } catch { /* optional */ }
      radar.benchAt = Date.now();
      if (bench.index?.d?.length || bench.usd?.d?.length) { radar.bench = bench; changed = true; }
      // tried again later when the index (the main comparison) didn't come
      if (gotIndex || !tse) radar.benchFor = radar.day;
    }
    // 2) funds: a few times a day (Fipiran publishes NAVs once a day, usually a day behind)
    if (fip && (force || Date.now() - (radar.fundsAt || 0) > 3 * 3600e3)) {
      try { radar.funds = (await P.fipiranFunds(10 * 60e3)).map(RD.slimFund); radar.fundsAt = Date.now(); changed = true; }
      catch (e) { radar.error = radar.error || `صندوق‌ها: فیپیران فعلاً جواب نداد (${e.message})؛ چند دقیقهٔ دیگر خودکار دوباره امتحان می‌شود. سهام جدا بررسی می‌شوند.`; }
    }
    // 2b) exchange-traded funds whose NAV is for a day the radar has no close of (Fipiran is usually a day behind): their
    // own short daily lists, so the bubble (price ÷ NAV of the same day) can be told — gold funds first
    if (tse && radar.day) {
      const gaps = RD.etfGaps(radar, 40);
      const navOf = new Map((radar.funds || []).map((f) => [f.insCode, String(f.date || '').slice(0, 10)]));
      for (let i = 0; i < gaps.length; i += 4) {
        await Promise.all(gaps.slice(i, i + 4).map(async (ins) => {
          try { RD.fillEtf(radar, ins, await P.tsetmcDaily(ins, 8, { allowEmpty: true }), navOf.get(ins)); } catch { RD.fillEtf(radar, ins, null, navOf.get(ins), true); }
        }));
        changed = true;
      }
    }
    // 3) a batch of stock histories (a stock whose list keeps failing is left as it is after 3 tries, till the next session)
    const todo = tse && radar.day ? RD.nextToFetch(radar, batch) : [];
    let fails = 0;
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(async ({ ins, need }) => {
        const rec = radar.stocks[ins];
        try { RD.mergeDaily(rec, await P.tsetmcDaily(ins, need), RD.dayNum(radar.day)); rec.fails = 0; }
        catch { fails++; rec.fails = (rec.fails || 0) + 1; if (rec.fails >= 3) { rec.need = 0; rec.fails = 0; } }
        changed = true;
      }));
      if (fails >= 8) { radar.error = radar.error || 'دریافت سابقهٔ قیمت نمادها با خطا روبه‌رو شد؛ بعداً ادامه می‌دهد'; break; }
    }
    // 4) which cards are new today (per signal), and the owner's rules
    const pending = Object.values(radar.stocks).filter((r) => r.need > 0).length;
    // individual (حقیقی) money in and out of each stock for the session just scanned. TSETMC lists only the latest session,
    // and a stock's row is matched against that session's volume — known only once its own list has come — so it is
    // gathered again (every few minutes while stocks are still waiting) until every stock is in — or until the next session
    // has begun (the list is then that session's, see waitFor); then done for the session.
    if (tse && radar.day && !radar.waitFor && radar.flowFor !== radar.day && Date.now() - (radar.flowAt || 0) > (pending ? 3 : 20) * 60e3) {
      radar.flowAt = Date.now();
      try {
        const n = RD.applyFlows(radar, await P.tsetmcClientTypes(), radar.day);
        if (n) changed = true;
        if (n >= 50 && !pending) radar.flowFor = radar.day;
      } catch { /* the money flow is optional */ }
    }
    let cards = null;
    const year = Object.values(radar.stocks).filter((r) => r.need >= 60).length; // still gathering a whole year
    if (changed && radar.day) {
      const depositPct = I.defaultDepositPct({ settings, assets });
      cards = RD.buildCards(radar, { depositPct, level: riskLevel(settings.profile) || 'mid' }).cards;
      const ids = [...new Set(cards.map(RD.cardKey))];
      // the radar's own track record: what it showed on each complete scan, to say later how it did
      if (!pending) RD.recordTrack(radar, cards);
      const prev = radar.results || {};
      // «تازه» compares with the last COMPLETE day (a day whose prices were still being gathered lacks most stocks)
      const before = prev.day === radar.day ? prev.before || [] : prev.complete !== false ? prev.ids || [] : prev.before || [];
      radar.results = { day: radar.day, at: Date.now(), ids, before, complete: !pending };
      const notes = []; let mineNote = null;
      for (const rule of radarUser.rules || []) {
        // a stock rule waits until every stock is up to date: half-gathered data would make old matches look new
        if (rule.kind === 'stock' && pending) continue;
        const hits = RD.runRule(radar, rule, { level: riskLevel(settings.profile) || 'mid' });
        const { fresh, ids: hitIds } = RD.newHits(radar.ruleHits[rule.id], hits);
        if (rule.notify && radar.ruleHits[rule.id] && fresh.length) notes.push(`«${rule.name}»: ${fresh.slice(0, 4).map((x) => x.sym || x.name).join('، ')}${fresh.length > 4 ? ' و …' : ''}`);
        radar.ruleHits[rule.id] = hitIds;
      }
      // the owner's own stocks and funds: a new warning (a sharp fall, far under its high, a fund below the deposit…) is
      // worth a notification — only on a complete scan, and never on the first one (that only sets what is known)
      if (!pending) {
        const items = RD.mine(radar, RD.holdRefs(assets, E.isLiability), { depositPct, cards });
        const { fresh, state } = RD.newWarnings(radar.mineWarn?.seen ? radar.mineWarn : null, items, RD.dayNum(radar.day));
        radar.mineWarn = state;
        if (fresh.length && settings.notify?.radarMine !== false) {
          // with amounts hidden (privacy), the lock screen doesn't name what the owner holds either
          mineNote = settings.privacy ? 'یکی از دارایی‌هایت در رادار نکتهٔ تازه‌ای دارد؛ بخش «دارایی‌های تو» را ببین.'
            : `${fresh.slice(0, 3).map((w) => `«${w.sym}» ${w.t}`).join('؛ ')}${fresh.length > 3 ? ' و …' : ''}`;
        }
      }
      if (notes.length && settings.notify?.radar !== false) notify('dara-radar', 'رادار فرصت‌ها: مورد تازه', notes.join('\n'));
      if (mineNote) notify('dara-radar-mine', 'رادار: دربارهٔ دارایی‌های تو', mineNote);
      // alerts the owner set on followed items (closing prices of the session)
      const { fired, marks } = RD.checkMarkAlerts(radar, radarUser.marks || []);
      if (fired.length) {
        // only the alerts that went off, and only if the owner hasn't changed them since this run read them
        const was = new Map((radarUser.marks || []).map((m) => [m.id, JSON.stringify(m.alert || null)]));
        await store.update('radarUser', (u) => ({ ...u, marks: u.marks.map((m) => {
          const hit = fired.filter((f) => f.id === m.id);
          if (!hit.length || JSON.stringify(m.alert || null) !== was.get(m.id)) return m;
          const f = { ...(m.fired || {}) }; for (const h of hit) f[h.k] = radar.day;
          return { ...m, fired: f };
        }) }));
        if (settings.notify?.alerts !== false) {
          const txt = fired.slice(0, 4).map((f) => `«${f.sym}» ${f.k === 'above' ? `به ${money(f.now, settings)} رسید (بالاتر از حدی که گذاشتی)` : f.k === 'below' ? `به ${money(f.now, settings)} رسید (پایین‌تر از حدی که گذاشتی)` : `${pct(f.ch)} از روزی که نشانش زدی`}`).join('\n');
          notify('dara-radar-alert', 'رادار: هشدار پیگیری', txt);
        }
      }
    }
    // a small summary for the menu badge (the scan itself is too large to load on every page)
    const res = radar.results || {};
    // the menu's count: new among the cards shown first (not the long «همه را ببین» lists)
    const firstIds = new Set(RD.shown(cards || RD.buildCards(radar, { depositPct: I.defaultDepositPct({ settings, assets }), level: riskLevel(settings.profile) || 'mid' }).cards).map(RD.cardKey));
    const newCount = res.before?.length ? new Set((res.ids || []).filter((x) => firstIds.has(x) && !res.before.includes(x)).map((x) => x.split('|')[1])).size : 0;
    await store.update('meta', (m) => ({ ...m, radar: { day: radar.day, newCount, pending, at: Date.now() } }));
    // the store is several MB: written only when something changed (closes kept to 8 significant digits)
    if (changed || radar.error !== prevError) {
      for (const r of Object.values(radar.stocks)) r.p = r.p.map((v) => +v.toPrecision(8));
      radar.at = Date.now();
      await chrome.storage.local.set({ radar });
    }
    return { day: radar.day, pending, year, total: Object.keys(radar.stocks).length, funds: radar.funds.length, error: radar.error };
  })().finally(() => { radarRun = null; done(); });
  return radarRun;
}
/** A stock's details for its report card (P/E of its sector, 52-week range), fetched when the radar doesn't have it. */
async function symbolInfo(insCode) { return P.tsetmcInstrumentInfo(insCode); }

const handlers = {
  async refresh() { return runCycle({ force: true, reason: 'manual' }); },
  async automate() {
    let autos, settings;
    await store.mutate(['assets', 'flows', 'events', 'quotes', 'settings'], (st) => {
      autos = E.applyAutomations(st.assets, st.flows, st.quotes, todayIso()); settings = st.settings;
      if (autos.events.length) Object.assign(st, { assets: autos.assets, flows: autos.flows, events: autos.events.slice().reverse().concat(st.events).slice(0, E.EVENTS_MAX) });
    });
    if (autos.events.length) await notifyAutomations(autos.events, autos.assets, settings);
    return { events: autos.events.length };
  },
  async quote({ ref }) {
    // a provider the owner turned off in settings is never contacted, not even for a preview
    const { settings } = await store.load('settings');
    if (ref?.provider && settings?.providers?.[ref.provider] === false) return { quote: null, error: 'این منبع قیمت در تنظیمات خاموش است' };
    const { quotes, errors } = await P.fetchAll([ref], settings?.providers || {});
    const id = P.quoteId(ref);
    if (quotes[id]) await store.update('quotes', (stored) => E.mergeQuotes(stored, { [id]: quotes[id] }, {}));
    return { quote: quotes[id] || null, error: errors[id] || null };
  },
  async search({ provider, q }) {
    if (provider === 'tsetmc') return { items: (await P.tsetmcSearch(q)).slice(0, 25) };
    if (provider === 'fipiran') return { items: await P.fipiranSearch(q) };
    if (provider === 'crypto') return P.cryptoSearch(q);
    if (provider === 'bitpinCoins') { try { return { items: await P.bitpinCoins() }; } catch (e) { return { items: [], error: e.message }; } }
    return { items: [] };
  },
  async history({ ref, days = 60 }) {
    const id = P.quoteId(ref) + ':' + days;
    const { history } = await store.load('history');
    const h = history[id];
    if (h && Date.now() - h.at < 3 * 3600000) return { points: h.points };
    // (a fresh copy already fetched is shown even with its source switched off; nothing new is fetched)
    const { settings } = await store.load('settings');
    if (ref?.provider && settings?.providers?.[ref.provider] === false) return { points: h?.points || [], error: 'این منبع قیمت در تنظیمات خاموش است' };
    const rows = await rialHistory(ref, days);
    const points = rows.map((r) => [r.date, r.close]);
    // a small cache: the 40 most recent series
    await store.update('history', (h) => Object.fromEntries(Object.entries({ ...h, [id]: { at: Date.now(), points } }).sort((a, b) => b[1].at - a[1].at).slice(0, 40)));
    return { points };
  },
  /** «سبدساز»: about ten years of 18k gold, the dollar, bitcoin (in Rial) and the total index, daily. Cached like charts. */
  async pbData({ days = 3700 } = {}) {
    const get = async (ref) => { try { return (await handlers.history({ ref, days })).points || []; } catch { return []; } };
    const [gold, usd, btc, index] = await Promise.all([get({ provider: 'tgju', key: 'geram18' }), get({ provider: 'tgju', key: 'price_dollar_rl' }),
      get({ provider: 'nobitex', key: 'btc' }), get({ provider: 'tsetmc', key: 'index' })]);
    if (!gold.length || !usd.length || !index.length) return { error: !index.length ? 'تاریخچهٔ شاخص بورس دریافت نشد (سایت TSETMC گاهی با VPN جواب نمی‌دهد)' : 'تاریخچهٔ طلا و دلار دریافت نشد', gold, usd, btc, index };
    return { gold, usd, btc, index };
  },
  /** Daily coin bubbles over `days` (coin close ÷ gold inside it at ounce × dollar), with average and today's level. */
  async bubbleStats({ keys = BB.COIN_KEYS, days = 90 } = {}) {
    const ons = await handlers.history({ ref: { provider: 'tgju', key: 'ons' }, days });
    if (!ons.points?.length) return { stats: {}, error: ons.error || 'تاریخچه انس دریافت نشد' };
    const { quotes } = await store.load('quotes');
    const stats = {};
    for (const key of keys.filter((k) => BB.COINS[k])) {
      try {
        const c = await handlers.history({ ref: { provider: 'tgju', key }, days });
        const series = BB.coinBubbleSeries(key, c.points || [], ons.points);
        const now = BB.coinBubble(key, quotes);
        stats[key] = { series, ...(BB.bubbleStats(series, now && !now.stale ? now.bubble : null) || {}) };
      } catch (e) { stats[key] = { series: [], error: String(e.message || e) }; }
    }
    return { stats };
  },
  async backfill({ days = 365 }) { return backfill(days); },
  async backupNow() { return runBackup({ force: true }); },
  async backupCheck() { return runBackup({ force: false }); },
  async backupPurgePlain() { return purgePlainBackups(); },
  async weekly({ force = true, days = 7 }) { return generateWeekly({ force, days }); },
  async capture({ tabId }) { return captureTab(tabId); },
  async checkUpdate() { return checkSelfUpdate(); },
  async radar({ force = false, batch = 40 } = {}) { return runRadar({ force, batch }); },
  async symbolInfo({ ins }) { return { info: await symbolInfo(ins) }; },
  async badge() {
    const st = await store.load('assets', 'quotes', 'settings', 'snapshots', 'events');
    const pf = E.portfolio(st.assets, st.quotes, st.settings);
    await updateBadge(pf, st);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // own keys only: «toString» or «constructor» from a stray message is not a handler
  const h = typeof msg?.type === 'string' && Object.hasOwn(handlers, msg.type) ? handlers[msg.type] : null;
  if (!h) return false;
  h(msg).then((r) => sendResponse({ ok: true, ...r }), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'refresh' || a.name === 'daily') runCycle({ reason: a.name });
  if (a.name === 'selfupdate') checkSelfUpdate().catch(() => {});
  if (a.name === 'backup') runBackup().catch(() => {});
  if (a.name === 'radar') runRadar().catch(() => {});
  if (a.name === 'weekly') { const { ai } = await store.load('ai'); if (ai.weekly !== false) generateWeekly({ force: false }).catch(() => {}); }
});

chrome.contextMenus?.onClicked.addListener((info, tab) => { if (info.menuItemId === 'dara-capture' && tab?.id) captureTab(tab.id); });
function installMenus() {
  try {
    chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'dara-capture', title: 'ثبت موجودی از این صفحه در «دارا»', contexts: ['page', 'selection'] }));
  } catch (e) { /* ignore */ }
}

chrome.notifications?.onClicked.addListener((id) => {
  if (id === 'dara-update') { chrome.notifications.clear(id); return; }
  const hash = id.startsWith('dara-alert') ? '#/market' : id.startsWith('dara-stale') ? '#/assets?f=attention' : id.startsWith('dara-weekly') ? '#/assistant' : id.startsWith('dara-backup') ? '#/settings' : '#/automation';
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html' + hash) });
  chrome.notifications.clear(id);
});

// any change to what the badge shows (an inline edit, a transfer, an undo — from any page) refreshes it, once things settle
let badgeTimer = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.assets || changes.events)) { clearTimeout(badgeTimer); badgeTimer = setTimeout(() => handlers.badge().catch(() => null), 1500); }
  if (area !== 'local' || !changes.settings) return;
  const a = changes.settings.oldValue || {}, b = changes.settings.newValue || {};
  if (a.refreshMinutes !== b.refreshMinutes) schedule();
  if (a.badge !== b.badge || a.privacy !== b.privacy || a.currency !== b.currency) handlers.badge();
});

chrome.runtime.onInstalled.addListener(async (d) => {
  await installNetRules();
  await schedule();
  installMenus();
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html#/welcome') });
  if (d.reason === 'update') await afterUpdate(d.previousVersion);
  runCycle({ reason: 'install' });
});
chrome.runtime.onStartup.addListener(async () => {
  await installNetRules();
  await schedule();
  runCycle({ reason: 'startup' });
});
// Session rules don't survive a worker restart after browser restarts; reinstall defensively.
installNetRules();
