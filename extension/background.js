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

const PROVIDER_HOSTS = ['call1.tgju.org', 'api.tgju.org', 'cdn.tsetmc.com', 'www.fipiran.com', 'api.nobitex.ir'];
const REFERERS = {
  'call1.tgju.org': 'https://www.tgju.org/', 'api.tgju.org': 'https://www.tgju.org/',
  'cdn.tsetmc.com': 'https://www.tsetmc.com/', 'www.fipiran.com': 'https://www.fipiran.com/', 'api.nobitex.ir': 'https://nobitex.ir/',
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
  if (tabs && !tabs.length && popup === false) { await U.applyUpdate(null); return { pending: v, applied: true }; }
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

let running = null;
async function runCycle({ force = false, reason = 'alarm' } = {}) {
  if (running) return running;
  const done = keepAlive();
  running = (async () => {
    const t0 = Date.now();
    const st = await store.loadAll();
    const { settings } = st;
    await store.update('meta', (m) => ({ ...m, running: true, runStartedAt: t0 }));

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
    const refs = E.collectRefs(assets, st.alerts, [...CORE_REFS, ...TGJU.map((t) => ({ provider: 'tgju', key: t.key })), ...(settings.watch || [])]);
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
      autos = E.applyAutomations(cur.assets, cur.flows, quotes, todayIso());
      E.rememberLastPrices(autos.assets, quotes);
      events = autos.events.slice().reverse().concat(cur.events).slice(0, E.EVENTS_MAX);
      E.settlePending(autos.assets, events, quotes);
      pf = E.portfolio(autos.assets, quotes, cur.settings);
      snapshots = E.pruneSnapshots({ ...cur.snapshots, [todayIso()]: E.makeSnapshot(pf, quotes) });
      fired = E.checkAlerts(cur.alerts, quotes);
      meta = { ...cur.meta, running: false, lastRun: Date.now(), lastOk: okCount ? Date.now() : cur.meta.lastOk,
        errors: relErrors, okCount, errCount: Object.keys(relErrors).length, duration: Date.now() - t0, reason, fatal: undefined };
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
      const p = mm ? mm.pct : pf.dayChangePct;
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
    await chrome.action.setTitle({ title: settings.privacy ? 'دارا' : `دارا — ارزش خالص: ${money(pf.net, settings, { compact: true })}${mm && Math.abs(mm.pct) >= 0.00005 ? ' (' + pct(mm.pct) + ' امروز)' : ''}` });
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
    return { items: [] };
  },
  async history({ ref, days = 60 }) {
    const { settings } = await store.load('settings');
    if (ref?.provider && settings?.providers?.[ref.provider] === false) return { points: [], error: 'این منبع قیمت در تنظیمات خاموش است' };
    const id = P.quoteId(ref) + ':' + days;
    const { history } = await store.load('history');
    const h = history[id];
    if (h && Date.now() - h.at < 3 * 3600000) return { points: h.points };
    const rows = await rialHistory(ref, days);
    const points = rows.map((r) => [r.date, r.close]);
    // a small cache: the 40 most recent series
    await store.update('history', (h) => Object.fromEntries(Object.entries({ ...h, [id]: { at: Date.now(), points } }).sort((a, b) => b[1].at - a[1].at).slice(0, 40)));
    return { points };
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
  async weekly({ force = true, days = 7 }) { return generateWeekly({ force, days }); },
  async capture({ tabId }) { return captureTab(tabId); },
  async checkUpdate() { return checkSelfUpdate(); },
  async badge() {
    const st = await store.loadAll();
    const pf = E.portfolio(st.assets, st.quotes, st.settings);
    await updateBadge(pf, st);
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
