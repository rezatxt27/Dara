// Dara service worker: scheduled price refresh, automations (interest payouts, recurring flows),
// daily snapshots, price alerts, badge and notifications.
import * as store from './lib/store.js';
import * as P from './lib/providers.js';
import * as E from './lib/engine.js';
import * as AI from './lib/ai.js';
import * as A from './lib/assistant.js';
import { CORE_REFS, TGJU, TGJU_BY_KEY, NOBITEX_BY_KEY } from './lib/catalog.js';
import { todayIso, addDaysIso, isoFromDate } from './lib/jalali.js';
import { money, pct, uid } from './lib/format.js';
import * as U from './lib/update.js';

const PROVIDER_HOSTS = ['call1.tgju.org', 'api.tgju.org', 'cdn.tsetmc.com', 'fund.fipiran.ir', 'api.nobitex.ir'];
const REFERERS = {
  'call1.tgju.org': 'https://www.tgju.org/', 'api.tgju.org': 'https://www.tgju.org/',
  'cdn.tsetmc.com': 'https://www.tsetmc.com/', 'fund.fipiran.ir': 'https://fund.fipiran.ir/', 'api.nobitex.ir': 'https://nobitex.ir/',
};

// Requests made by the extension itself (tabId -1) get a site Referer and no extension Origin,
// so the public price endpoints treat them like their own web pages.
async function installNetRules() {
  const mk = (base, headers) => PROVIDER_HOSTS.map((host, i) => ({
    id: base + i, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: headers(host) },
    condition: { requestDomains: [host], tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] },
  }));
  // Installed as two independent sets so one rejected header can't block the other.
  for (const rules of [mk(100, (h) => [{ header: 'referer', operation: 'set', value: REFERERS[h] }]), mk(200, () => [{ header: 'origin', operation: 'remove' }])]) {
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
  if (!(await chrome.alarms.get('selfupdate'))) await chrome.alarms.create('selfupdate', { periodInMinutes: 1, delayInMinutes: 1 });
}

/* ------------------------------ self-update ------------------------------ */
// New files copied into the install folder → reload. With a Dara page open, the page
// shows a banner instead (its own refresh applies the update) so no typing is lost.
async function checkSelfUpdate() {
  const v = await U.pendingVersion();
  if (!v) return { pending: null };
  const tabs = await U.openTabUrls();
  if (!tabs.length) { await U.applyUpdate(null); return { pending: v, applied: true }; }
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
    const open = await U.openTabUrls();
    for (const [i, url] of fresh.entries()) if (!open.includes(url)) chrome.tabs.create({ url, active: i === fresh.length - 1 });
  } else if (prev && prev !== cur) {
    chrome.notifications?.create('dara-update', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'دارا به‌روز شد', message: `نسخه ${cur} نصب شد؛ داده‌هایت سر جایشان است.`, priority: 0 });
  }
}

let running = null;
async function runCycle({ force = false, reason = 'alarm' } = {}) {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now();
    const st = await store.loadAll();
    const { settings } = st;
    await store.save({ meta: { ...st.meta, running: true, runStartedAt: t0 } });

    // 1) Resolve tickers that were entered by symbol only (e.g. a gold ETF imported from a spreadsheet)
    let assets = st.assets;
    const resolved = {};
    for (const a of assets) {
      const ref = a.mode === 'units' && a.price?.source === 'market' ? a.price.ref : null;
      if (ref?.provider === 'tsetmc' && !ref.key && ref.symbol && settings.providers.tsetmc !== false) {
        try {
          const hit = resolved[ref.symbol] ?? (resolved[ref.symbol] = await P.tsetmcResolve(ref.symbol));
          if (hit) { ref.key = hit.insCode; ref.label = hit.symbol; ref.name = hit.name; }
        } catch (e) { /* stays pending */ }
      }
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
    const refs = E.collectRefs(assets, st.alerts, [...CORE_REFS, ...TGJU.map((t) => ({ provider: 'tgju', key: t.key })), ...(settings.watch || [])]);
    const { quotes: fresh, errors } = await P.fetchAll(refs, settings.providers);
    const okCount = Object.keys(fresh).length;
    // Only errors on prices you actually use count as problems (the rest of the board is optional)
    const relevant = new Set(E.collectRefs(assets, st.alerts, CORE_REFS).map((r) => P.quoteId(r)));
    const relErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => relevant.has(k)));

    // 3) Automations on the freshest state (quick read-modify-write after the slow network step)
    const cur = await store.load('assets', 'flows', 'events', 'alerts', 'snapshots', 'meta', 'quotes', 'settings');
    const quotes = E.mergeQuotes(cur.quotes, fresh, errors);
    const autos = E.applyAutomations(cur.assets, cur.flows, quotes, todayIso());
    E.rememberLastPrices(autos.assets, quotes);
    const events = autos.events.concat(cur.events).slice(0, 500);

    // 4) Snapshot for today
    const pf = E.portfolio(autos.assets, quotes, cur.settings);
    const snapshots = E.pruneSnapshots({ ...cur.snapshots, [todayIso()]: E.makeSnapshot(pf, quotes) });

    // 5) Alerts
    const alerts = cur.alerts;
    const fired = E.checkAlerts(alerts, quotes);

    const meta = { ...cur.meta, running: false, lastRun: Date.now(), lastOk: okCount ? Date.now() : cur.meta.lastOk,
      errors: relErrors, okCount, errCount: Object.keys(relErrors).length, duration: Date.now() - t0, reason };
    await store.save({ assets: autos.assets, flows: autos.flows, events, quotes, snapshots, alerts, meta });

    // 6) Notifications + badge
    await notifyAutomations(autos.events, autos.assets, settings);
    await notifyAlerts(fired, settings);
    await maybeStaleNotice(pf, meta, settings);
    await updateBadge(pf, snapshots, quotes, settings);
    return { ok: okCount, errors: meta.errCount, events: autos.events.length };
  })().catch(async (e) => {
    console.error('[dara] cycle failed', e);
    const { meta } = await store.load('meta');
    await store.save({ meta: { ...meta, running: false, lastRun: Date.now(), fatal: String(e?.message || e) } });
    return { ok: 0, errors: 1, fatal: String(e?.message || e) };
  }).finally(() => { running = null; });
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
  const interest = events.filter((e) => e.kind === 'interest');
  const flows = events.filter((e) => e.kind === 'flow');
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
  const { meta: m } = await store.load('meta');
  await store.save({ meta: { ...m, lastStaleNotice: Date.now() } });
}

async function updateBadge(pf, snaps, quotes, settings) {
  try {
    let text = '', color = '#7A5AF8';
    if (settings.badge === 'change') {
      const ch = E.changeSince(snaps, 1, pf.net);
      const p = ch ? ch.pct : pf.dayChangePct;
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
    await chrome.action.setTitle({ title: settings.privacy ? 'دارا' : `دارا — ارزش خالص: ${money(pf.net, settings, { compact: true })}${pf.dayChange ? ' (' + pct(pf.dayChangePct) + ' امروز)' : ''}` });
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
  backfilling = (async () => {
    const setProg = async (p) => { const { meta } = await store.load('meta'); await store.save({ meta: { ...meta, backfill: p } }); };
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
      const cur = await store.load('assets', 'events', 'quotes', 'settings', 'snapshots');
      const rebuilt = E.reconstructHistory(cur.assets, cur.events, hist, cur.quotes, cur.settings, days);
      const snapshots = { ...cur.snapshots };
      let added = 0;
      for (const [d, snap] of Object.entries(rebuilt)) if (!snapshots[d] || snapshots[d].est) { snapshots[d] = snap; added++; }
      await store.save({ snapshots: E.pruneSnapshots(snapshots) });
      const res = { state: 'done', added, days, failed: failed.map((r) => P.quoteId(r)), at: Date.now() };
      await setProg(res);
      return { ok: true, ...res };
    } catch (e) {
      const res = { state: 'error', error: String(e.message || e), at: Date.now() };
      await setProg(res);
      return { ok: false, ...res };
    }
  })().finally(() => { backfilling = null; });
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
async function generateWeekly({ force = false, days = 7 } = {}) {
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
const handlers = {
  async refresh() { return runCycle({ force: true, reason: 'manual' }); },
  async automate() {
    const st = await store.loadAll();
    const autos = E.applyAutomations(st.assets, st.flows, st.quotes, todayIso());
    if (autos.events.length) {
      await store.save({ assets: autos.assets, flows: autos.flows, events: autos.events.concat(st.events).slice(0, 500) });
      await notifyAutomations(autos.events, autos.assets, st.settings);
    }
    return { events: autos.events.length };
  },
  async quote({ ref }) {
    const { quotes, errors } = await P.fetchAll([ref], {});
    const id = P.quoteId(ref);
    if (quotes[id]) {
      const { quotes: stored } = await store.load('quotes');
      await store.save({ quotes: E.mergeQuotes(stored, { [id]: quotes[id] }, {}) });
    }
    return { quote: quotes[id] || null, error: errors[id] || null };
  },
  async search({ provider, q }) {
    if (provider === 'tsetmc') return { items: (await P.tsetmcSearch(q)).slice(0, 25) };
    if (provider === 'fipiran') return { items: await P.fipiranSearch(q) };
    if (provider === 'crypto') return P.cryptoSearch(q);
    return { items: [] };
  },
  async history({ ref, days = 60 }) {
    const id = P.quoteId(ref) + ':' + days;
    const { history } = await store.load('history');
    const h = history[id];
    if (h && Date.now() - h.at < 3 * 3600000) return { points: h.points };
    const rows = await rialHistory(ref, days);
    const points = rows.map((r) => [r.date, r.close]);
    await store.save({ history: { ...history, [id]: { at: Date.now(), points } } });
    return { points };
  },
  async backfill({ days = 365 }) { return backfill(days); },
  async weekly({ force = true, days = 7 }) { return generateWeekly({ force, days }); },
  async capture({ tabId }) { return captureTab(tabId); },
  async checkUpdate() { return checkSelfUpdate(); },
  async badge() {
    const st = await store.loadAll();
    const pf = E.portfolio(st.assets, st.quotes, st.settings);
    await updateBadge(pf, st.snapshots, st.quotes, st.settings);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg).then((r) => sendResponse({ ok: true, ...r }), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'refresh' || a.name === 'daily') runCycle({ reason: a.name });
  if (a.name === 'selfupdate') checkSelfUpdate().catch(() => {});
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
  const hash = id.startsWith('dara-alert') ? '#/market' : id.startsWith('dara-stale') ? '#/assets?f=attention' : id.startsWith('dara-weekly') ? '#/assistant' : '#/automation';
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html' + hash) });
  chrome.notifications.clear(id);
});

chrome.storage.onChanged.addListener((changes, area) => {
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
