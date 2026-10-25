// «رادار فرصت‌ها»: once a day, after the market closes, the whole stock market (TSETMC market watch) and every fund
// (Fipiran) are scanned with fixed, explained rules. What comes out is a list of «worth a look» cards — each says why it
// showed up and what to check before deciding. Never «buy» or «sell».
//
// Pure: no network, no storage. The background fetches and saves; this file keeps the price series, computes the
// numbers and builds the cards. Prices are Rial. Returns are fractions (0.25 = 25%).
//
// Price series are ADJUSTED for capital increases and dividends (see providers.adjustDaily): each stock keeps one
// close per trading day for about 13 months; when a new session's «priceYesterday» differs from the last stored close,
// an event happened and every earlier close is scaled by that ratio, so returns never show a capital increase as a fall.
import { persianize } from './providers.js';
import { GOLD_ETFS } from './catalog.js';

export const VERSION = 1;
export const KEEP_DAYS = 400;          // calendar days of closes kept per stock
export const FULL_ROWS = 270;          // trading days fetched to build a stock's year from scratch
export const LIQ = 1e10;               // average daily value (Rial) below which a stock is too thin to rank
export const MIN_SECTOR = 5;           // stocks with a positive P/E a sector needs before its median means anything
export const FINAL_AFTER = 13 * 60 + 30; // Tehran minutes after which a session's closing prices are final

/* ---------------------------------------- days ---------------------------------------- */
export const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
export const isoOf = (dn) => new Date(dn * 864e5).toISOString().slice(0, 10);
/** Today's date and minutes in Tehran (UTC+3:30, no daylight saving since 2022). */
export function tehranNow(now = Date.now()) {
  const t = new Date(now + 3.5 * 3600000);
  return { day: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
/** A session's prices are final once the day is over in Tehran or it is past 13:30 there. */
export const sessionFinal = (day, now = Date.now()) => { const t = tehranNow(now); return day < t.day || t.minutes >= FINAL_AFTER; };

/* --------------------------------------- the store --------------------------------------- */
export const empty = () => ({ v: VERSION, day: null, at: 0, stocks: {}, etf: {}, funds: [], fundsAt: 0, results: null, ruleHits: {}, sectors: {}, error: null });

const num = (x) => { const v = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/,/g, '')); return isFinite(v) ? v : NaN; };
/** Stocks only: the main and secondary boards of the stock exchange and Farabourse, and the base market. */
export const isStockIsin = (isin) => /^IRO[1357]/.test(String(isin || ''));
export const isEtfIsin = (isin) => /^IRT/.test(String(isin || ''));
const marketOf = (isin) => ({ IRO1: 'بورس', IRO3: 'فرابورس', IRO5: 'فرابورس', IRO7: 'بازار پایه' }[String(isin).slice(0, 4)] || '');

/** One market-watch row → the fields we use. */
export function mwRow(r) {
  return {
    ins: String(r.insCode), isin: String(r.insID || ''), sym: persianize(r.lva), name: persianize(r.lvc), sector: String(r.csv || '').trim(),
    close: num(r.pcl), last: num(r.pdv), py: num(r.py), eps: num(r.eps), pe: r.pe === null || r.pe === undefined || r.pe === '' ? NaN : num(r.pe),
    vol: Math.max(num(r.qtj) || 0, num(r.qTotTran5J) || 0), val: Math.max(num(r.qtc) || 0, num(r.qTotCap) || 0),
    cap: (num(r.ztd) || 0) * (num(r.pcl) || 0),
  };
}

/**
 * Can this market-watch snapshot be taken as the finished session `day`? refs: a few of the largest stocks, each
 * { close, py } from the market watch plus `rows` — its own daily list (ascending, from providers.adjustDaily).
 *  'live' — the snapshot is that session: closes, «priceYesterday» and volumes can be used as they are.
 *  'list' — closes are that session's but the rest is not: before the next session opens TSETMC resets the market watch
 *           (volumes 0, «priceYesterday» = the last close). Prices come from each stock's own daily list instead.
 *  'wait' — the daily lists don't have the session yet (or disagree): try again later.
 */
export function snapshotMode(rows, refs, day) {
  let agree = 0, pyOk = 0;
  for (const r of refs) {
    const last = r.rows?.[r.rows.length - 1];
    if (!last || last.date !== day) continue;  // didn't trade that day: says nothing
    if (!(Math.abs(last.raw / r.close - 1) < 1e-6)) return 'wait';
    agree++;
    if (Math.abs(last.py / r.py - 1) < 1e-6) pyOk++;
  }
  if (agree < 2) return 'wait';
  const st = rows.map(mwRow).filter((r) => isStockIsin(r.isin) && r.close > 0);
  const traded = st.filter((r) => r.vol > 0).length;
  return pyOk === agree && traded >= st.length * 0.2 ? 'live' : 'list';
}
/** The largest stocks of a market watch (by market value) — the references for snapshotMode and missed sessions. */
export const largest = (rows, n = 4) => rows.map(mwRow).filter((r) => isStockIsin(r.isin) && r.close > 0).sort((a, b) => b.cap - a.cap).slice(0, n);

/** Sessions we have not seen between `lastDay` and `day`, from a list of known session days. null = can't tell. */
export function missed(sessions, lastDay, day) {
  if (!lastDay) return null;
  if (lastDay >= day) return 0;
  const s = [...new Set(sessions)].sort();
  if (!s.length || s[0] > lastDay) return null; // the list doesn't reach back far enough
  return s.filter((d) => d > lastDay && d < day).length;
}

/**
 * Apply one finished session's market watch to the store (mutates). sessions: recent session days (from a few busy
 * stocks' daily lists) — they tell whether a session was missed while the browser was closed. Stocks whose series
 * can't simply take today's close get `need` = how many daily rows to fetch. mode (see snapshotMode): in 'list' mode
 * only names, sectors and EPS are taken; every stock's close comes from its own daily list. 'prev': the market watch is
 * already a LATER session (today's, unfinished or not yet in the daily lists) and `day` is the last session the lists
 * have — used so a first scan doesn't wait for hours; no price at all is taken from the market watch.
 */
export function applySession(radar, rows, day, sessions = [], mode = 'live') {
  const live = mode === 'live', prev = mode === 'prev';
  const D = dayNum(day);
  // recent session days (liquidity is averaged over the last 20 of them, days without a trade counting as zero)
  radar.sess = [...new Set([...(radar.sess || []), ...sessions.filter((x) => x <= day), day])].sort().slice(-40);
  const seen = new Set();
  for (const raw of rows) {
    const r = mwRow(raw);
    if (isEtfIsin(r.isin)) {
      if (prev) continue; // its price is a later session's: the bubble waits for a finished one
      // a few days of closes: Fipiran's NAV is usually a day behind, and a bubble needs the price of the NAV's own day
      // (a reset market watch still shows the session's close; only its value traded is gone — keep the last known)
      const old = radar.etf[r.ins];
      const hist = { ...(old?.hist || {}), [day]: r.close };
      const keep = Object.keys(hist).sort().slice(-7);
      radar.etf[r.ins] = { sym: r.sym, name: r.name, close: r.close, val: live ? r.val : old?.val ?? null, day, hist: Object.fromEntries(keep.map((k) => [k, hist[k]])) };
      continue;
    }
    if (!isStockIsin(r.isin) || !(r.close > 0)) continue;
    seen.add(r.ins);
    const rec = radar.stocks[r.ins] ||= { sym: r.sym, name: r.name, d: [], p: [], h: [], need: FULL_ROWS };
    const lastD = rec.d[rec.d.length - 1];
    const sameDay = rec.today?.day === day;
    Object.assign(rec, { sym: r.sym, name: r.name, sector: r.sector, isin: r.isin, eps: r.eps, pe: r.pe, cap: r.cap });
    if (live) rec.today = { day, close: r.close, py: r.py, vol: r.vol, val: r.val };
    else if (!sameDay) rec.today = { day, close: prev ? null : r.close, py: null, vol: 0, val: 0 }; // filled in from its daily list
    // sessions since this stock was last brought up to date (a halted stock's list has no rows for its idle days, so
    // its last close can be old while it is in fact current: `upTo` is the last session its list was checked through)
    const upTo = Math.max(lastD || 0, rec.upTo || 0);
    const gap = upTo ? missed(sessions, isoOf(upTo), day) : null;
    const short = gap === null || gap > 60 ? FULL_ROWS : gap + 6;
    if (rec.need > 0) { rec.need = Math.max(rec.need, short); continue; } // its history comes from a fetch
    if (lastD === D) { if (live) { rec.p[rec.p.length - 1] = r.close; setVol(rec, D, r.vol, r.val); } continue; } // same session again
    if (!live || gap !== 0 || lastD > D) { rec.need = short; continue; }  // a reset snapshot, or missed sessions: refetch
    // never traded yet: no price to keep (the market watch shows a nominal base); its first trade comes from its list
    if (!rec.d.length) { if (r.vol > 0) rec.need = short; else rec.upTo = D; continue; }
    // idle since its last close: a «priceYesterday» that isn't that close means something happened meanwhile — fetch
    if (lastD < (rec.upTo || 0) && !(Math.abs(r.py / rec.p[rec.p.length - 1] - 1) <= 0.0005)) { rec.need = short; continue; }
    appendClose(rec, D, r.close, r.py);
    rec.upTo = D;
    setVol(rec, D, r.vol, r.val);
  }
  // delisted or not in today's list: keep (a halted stock stays halted) but drop after its last close is a year old
  for (const [ins, rec] of Object.entries(radar.stocks)) {
    if (seen.has(ins)) continue;
    const lastD = rec.d[rec.d.length - 1];
    if (!lastD || D - lastD > 365) delete radar.stocks[ins];
  }
  radar.day = day;
  return radar;
}

/** Add a close; when «priceYesterday» isn't the last close, a capital increase or dividend happened: scale the past. */
export function appendClose(rec, D, close, py) {
  const n = rec.p.length;
  const base = n ? rec.p[n - 1] : 0;
  if (n && py > 0 && base > 0 && Math.abs(py / base - 1) > 0.0005) {
    const f = py / base;
    for (let i = 0; i < n; i++) rec.p[i] *= f;
  }
  rec.d.push(D); rec.p.push(close);
  trim(rec, D);
}
function setVol(rec, D, vol, val) {
  const h = rec.h || (rec.h = []);
  if (h.length && h[h.length - 1][0] === D) h[h.length - 1] = [D, vol, val];
  else if (vol > 0) h.push([D, vol, val]);  // only days it traded count toward its average
  if (h.length > 30) h.splice(0, h.length - 30);
}
function trim(rec, D) {
  let i = 0;
  while (i < rec.d.length && rec.d[i] < D - KEEP_DAYS) i++;
  if (i) { rec.d.splice(0, i); rec.p.splice(0, i); }
}

/**
 * Merge fetched daily rows (ascending, adjusted, from providers.adjustDaily) into a stock (mutates). A full fetch
 * replaces the series; a short one is joined on the first day both have, scaling the older closes onto the new basis.
 */
export function mergeDaily(rec, rows, D) {
  // nothing past the session being scanned (a fetch during the next session would bring its unfinished prices)
  const ok = (rows || []).filter((r) => r.close > 0 && (!D || dayNum(r.date) <= D));
  // checked through: the newest day its list reached (a lagging list doesn't vouch for the session being scanned)
  const thr = rows?.through ? dayNum(rows.through) : ok.length ? dayNum(ok[ok.length - 1].date) : 0;
  const checked = thr ? (D ? Math.min(D, thr) : thr) : 0;
  const last = ok[ok.length - 1];
  // a later (cut) row with an event scaled these closes: put the basis back on the last kept day's real close
  const base = last && last.raw > 0 ? last.raw / last.close : 1;
  const pts = ok.map((r) => ({ d: dayNum(r.date), c: r.close * base, vol: r.vol || 0, val: r.val || 0 }));
  if (last && D && dayNum(last.date) === D && rec.today?.day === last.date) Object.assign(rec.today, { close: last.raw ?? last.close, py: last.py ?? rec.today.py, vol: last.vol || 0, val: last.val || 0 });
  if (!pts.length) { rec.need = 0; if (checked) rec.upTo = Math.max(rec.upTo || 0, checked); return rec; }
  const k = rec.d.indexOf(pts[0].d);
  // a short fetch that doesn't reach back to a day we have can't be joined: fetch the whole year next time instead
  if (rec.need < FULL_ROWS && rec.d.length && k < 0) { rec.need = FULL_ROWS; return rec; }
  if (rec.need >= FULL_ROWS || !rec.d.length) {
    rec.d = pts.map((x) => x.d); rec.p = pts.map((x) => x.c);
  } else {
    const f = pts[0].c / rec.p[k];
    rec.d = rec.d.slice(0, k).concat(pts.map((x) => x.d));
    rec.p = rec.p.slice(0, k).map((v) => v * f).concat(pts.map((x) => x.c));
  }
  const keep = new Map((rec.h || []).filter((x) => x[0] < pts[0].d).map((x) => [x[0], x]));
  for (const x of pts) if (x.vol > 0) keep.set(x.d, [x.d, x.vol, x.val]);
  rec.h = [...keep.values()].sort((a, b) => a[0] - b[0]).slice(-30);
  rec.need = 0;
  if (checked) rec.upTo = Math.max(rec.upTo || 0, checked);
  trim(rec, D || rec.d[rec.d.length - 1]);
  return rec;
}

/* ------------------------------------ money flow (حقیقی / حقوقی) ------------------------------------ */
export const FLOW_KEEP = 30; // sessions of individual (حقیقی) money flow kept per stock
/**
 * One finished session's buy/sell by individuals and institutions (TSETMC «ClientTypeAll», volumes only) → each stock's
 * flow list (mutates): rec.fl = [[day number, net individual money (Rial: (buy − sell) × close), buyer power]], the last
 * FLOW_KEEP sessions. Buyer power = average individual buy ÷ average individual sell (per trader). A row whose volumes don't
 * add up to the session's volume (a list already reset for the next session, or from another day) is skipped.
 */
export function applyFlows(radar, rows, day) {
  const D = dayNum(day); let n = 0;
  for (const x of rows || []) {
    const rec = radar.stocks?.[String(x.insCode)];
    if (!rec || rec.today?.day !== day || !(rec.today.close > 0) || !(rec.today.vol > 0)) continue;
    const bI = +x.buy_I_Volume || 0, bN = +x.buy_N_Volume || 0, sI = +x.sell_I_Volume || 0, sN = +x.sell_N_Volume || 0;
    const tot = bI + bN;
    if (!(tot > 0) || Math.abs(tot / rec.today.vol - 1) > 0.02 || Math.abs((sI + sN) / rec.today.vol - 1) > 0.02) continue;
    const net = Math.round((bI - sI) * rec.today.close);
    const cb = +x.buy_CountI || 0, cs = +x.sell_CountI || 0;
    const power = cb > 0 && cs > 0 && bI > 0 && sI > 0 ? Math.round(((bI / cb) / (sI / cs)) * 100) / 100 : null;
    const fl = rec.fl || (rec.fl = []);
    if (fl.length && fl[fl.length - 1][0] === D) fl[fl.length - 1] = [D, net, power];
    else if (!fl.length || fl[fl.length - 1][0] < D) fl.push([D, net, power]);
    if (fl.length > FLOW_KEEP) fl.splice(0, fl.length - FLOW_KEEP);
    n++;
  }
  if (n) radar.flowDays = [...new Set([...(radar.flowDays || []), day])].sort().slice(-FLOW_KEEP);
  return n;
}
/**
 * The last n sessions up to day D, as day numbers: from the session list when it is long enough, else the calendar
 * (Iran's market trades five days a week: n sessions ≈ n × 7/5 days). Returns { has(day), from }.
 */
export function lastSessions(sess, D, n) {
  const l = (sess || []).map(dayNum).filter((d) => d <= D).slice(-n);
  if (l.length >= n) { const set = new Set(l); return { has: (d) => set.has(d), from: l[0] }; }
  const from = D - Math.ceil((n * 7) / 5) + 1;
  return { has: (d) => d >= from && d <= D, from };
}
/**
 * A stock's individual money flow over the last 5 sessions (and 20) up to day D — sessions of the market, so a week the
 * browser was off doesn't stretch «5 sessions» back a month. flowN: how many of the last 5 sessions are known. The share
 * counts only sessions whose value traded is known too.
 */
function flowMetrics(rec, D, sess) {
  const s5 = lastSessions(sess, D, 5), s20 = lastSessions(sess, D, 20);
  const fl = (rec.fl || []).filter((x) => x[0] <= D);
  const l5 = fl.filter((x) => s5.has(x[0])), l20 = fl.filter((x) => s20.has(x[0]));
  if (!l5.length) return { flowN: 0, flow5: null, flow20: l20.length ? l20.reduce((a, x) => a + x[1], 0) : null, flowShare5: null, flowPos5: null, power: null, flowToday: null };
  const val = new Map((rec.h || []).map((x) => [x[0], x[2]]));
  const sum = (l) => l.reduce((a, x) => a + x[1], 0);
  const both = l5.filter((x) => val.get(x[0]) > 0);
  const v5 = both.reduce((a, x) => a + val.get(x[0]), 0);
  const last = fl[fl.length - 1];
  return { flowN: l5.length, flow5: sum(l5), flow20: sum(l20), flowShare5: v5 > 0 ? sum(both) / v5 : null, flowPos5: l5.filter((x) => x[1] > 0).length,
    flowToday: last[0] === D ? last[1] : null, power: last[0] === D ? last[2] : null };
}

/* --------------------------------------- numbers --------------------------------------- */
const median = (a) => { const s = a.filter(isFinite).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Close on or before day number `t` (null if the series starts later). */
function closeOn(rec, t) {
  let lo = 0, hi = rec.d.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rec.d[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? rec.p[ans] : null;
}
/** Everything a card or a rule needs about one stock, on session day D (day number). */
export function stockMetrics(rec, D, sectorPE = {}, sess = null) {
  const n = rec.d.length;
  const close = n ? rec.p[n - 1] : rec.today?.close || NaN;
  const first = n ? rec.d[0] : Infinity;
  const ret = (days) => { if (first > D - days + 3) return null; const c0 = closeOn(rec, D - days); return c0 > 0 ? close / c0 - 1 : null; };
  const yr = []; for (let i = 0; i < n; i++) if (rec.d[i] >= D - 365) yr.push(rec.p[i]);
  const fullYear = first <= D - 360;
  const hi = yr.length ? Math.max(...yr) : NaN, lo = yr.length ? Math.min(...yr) : NaN;
  const h = rec.h || [];
  const lastH = h[h.length - 1];
  const prev = h.filter((x) => x[0] < D).slice(-20);
  const volToday = lastH && lastH[0] === D ? lastH[1] : 0;
  const avgVol = median(prev.map((x) => x[1]));
  // average value traded per session over the last 20 sessions — a session without a trade counts as zero, so a stock
  // that trades twice a month doesn't look liquid. (Without the session list: the last 28 days ≈ 20 sessions.)
  const sd = (sess || []).map(dayNum).filter((x) => x <= D).slice(-20);
  const from = sd.length >= 10 ? sd[0] : D - 27, per = sd.length >= 10 ? sd.length : 20;
  const avgVal = h.length ? h.filter((x) => x[0] >= from && x[0] <= D).reduce((a, x) => a + x[2], 0) / per : (rec.today?.val || 0) / per;
  const mPE = sectorPE[rec.sector];
  // risk: the worst fall from a previous peak within the year, and how much it usually moves in a day (last ~120 sessions)
  let peak = 0, dd = 0; for (const v of yr) { if (v > peak) peak = v; else if (peak > 0) dd = Math.min(dd, v / peak - 1); }
  const rr = []; for (let i = Math.max(1, n - 120); i < n; i++) if (rec.d[i] >= D - 200 && rec.p[i - 1] > 0 && rec.p[i] !== rec.p[i - 1]) rr.push(Math.log(rec.p[i] / rec.p[i - 1]));
  const mu = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;
  const dvol = rr.length >= 30 ? Math.sqrt(rr.reduce((a, b) => a + (b - mu) ** 2, 0) / (rr.length - 1)) : null;
  return {
    close, ret7: ret(7), ret30: ret(30), ret91: ret(91), ret182: ret(182), ret365: ret(365),
    hi52: hi, lo52: lo, fullYear, fromHigh: hi > 0 ? close / hi - 1 : null, fromLow: lo > 0 ? close / lo - 1 : null,
    volToday, volRatio: volToday > 0 && avgVol > 0 && prev.length >= 10 ? volToday / avgVol : null, avgVal, liquid: avgVal >= LIQ,
    traded: !!lastH && lastH[0] >= D - 7, eps: rec.eps, pe: isFinite(rec.pe) ? rec.pe : null, sectorPE: isFinite(mPE) ? mPE : null,
    peRel: isFinite(rec.pe) && rec.pe > 0 && mPE > 0 ? rec.pe / mPE : null, dayChange: rec.today?.py > 0 ? rec.today.close / rec.today.py - 1 : null,
    dd1y: fullYear && yr.length > 20 ? dd : null, dvol, ey: isFinite(rec.pe) && rec.pe > 0 && rec.eps > 0 ? 1 / rec.pe : null,
    ...flowMetrics(rec, D, sess),
  };
}
/** Median P/E of each sector over its stocks with a positive, sane P/E (a sector needs MIN_SECTOR of them). */
export function sectorMedians(stocks) {
  const by = {};
  for (const r of Object.values(stocks)) if (r.pe > 0 && r.pe < 300 && r.sector) (by[r.sector] ||= []).push(r.pe);
  const out = {};
  for (const [k, l] of Object.entries(by)) if (l.length >= MIN_SECTOR) out[k] = median(l);
  return out;
}

/* ------------------------------------- benchmarks ------------------------------------- */
/** radar.bench: { index: {d, p}, usd: {d, p} } — the total index and the dollar, daily, as day numbers and values. */
function benchAt(b, t) { if (!b?.d?.length) return null; let lo = 0, hi = b.d.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b.d[m] <= t) { a = m; lo = m + 1; } else hi = m - 1; } return a >= 0 ? b.p[a] : null; }
/** The index's and the dollar's change over the `days` before the radar's session: { index, usd } (fractions or null). */
export function benchRet(radar, days, D = radar?.day ? dayNum(radar.day) : null) {
  const out = { index: null, usd: null };
  if (!D) return out;
  for (const k of ['index', 'usd']) {
    const b = radar.bench?.[k]; if (!b?.d?.length || b.d[0] > D - days + 5 || b.d[b.d.length - 1] < D - 7) continue;
    const a = benchAt(b, D - days), z = benchAt(b, D);
    if (a > 0 && z > 0) out[k] = z / a - 1;
  }
  return out;
}
/** «در همین ۱۲ ماه: شاخص کل +۶۰٪، دلار +۴۰٪» — or '' when neither is known. */
export function benchLine(radar, days, label) {
  const b = benchRet(radar, days);
  const parts = [b.index !== null && `شاخص کل ${fa(P(b.index))}`, b.usd !== null && `دلار ${fa(P(b.usd))}`].filter(Boolean);
  return parts.length ? `در همین ${label}: ${parts.join('، ')}` : '';
}
/** Fold a raw daily series ([{date, close}]) into the compact {d, p} form, keeping about 13 months. */
export function benchSeries(rows, D) {
  const l = (rows || []).filter((r) => r.close > 0 && r.date).map((r) => [dayNum(r.date), r.close]).filter(([d]) => !D || d >= D - 420).sort((a, b) => a[0] - b[0]);
  return { d: l.map((x) => x[0]), p: l.map((x) => x[1]) };
}

/* ---------------------------------------- funds ---------------------------------------- */
export const FUND_KIND = { 4: 'درآمد ثابت', 5: 'کالایی', 6: 'سهامی', 7: 'مختلط', 21: 'بخشی', 22: 'اهرمی', 23: 'شاخصی' };
const isGoldFund = (f) => f.fundType === 5 && (/طلا|سکه/.test(f.name) || GOLD_ETFS.some((g) => (f.symbol || '').startsWith(g)));
/** A fund's numbers: returns as fractions, its age, and (exchange-traded, same day only) the bubble against its NAV. */
export function fundMetrics(f, radar, D) {
  const r = f.ret || {};
  const frac = (v) => (isFinite(v) ? v / 100 : null);
  const ageDays = f.since ? D - dayNum(f.since) : null;
  const etf = f.insCode ? radar.etf?.[f.insCode] : null;
  const navDay = String(f.date || '').slice(0, 10);
  // the market price and the NAV must be for the same day, or a day's move would read as a bubble
  const px = etf && navDay ? etf.hist?.[navDay] ?? (navDay === etf.day ? etf.close : null) : null;
  const bubble = px > 0 && f.cancelNav > 0 ? px / f.cancelNav - 1 : null;
  // traded enough to matter: its value traded when known (a reset market watch has none), else a large fund
  const etfVal = etf ? etf.val ?? null : 0;
  const tradable = etfVal !== null ? etfVal >= 1e9 : (f.size || 0) >= 5e12;
  return { y1: frac(r.y1), m6: frac(r.m6), m3: frac(r.m3), m1: frac(r.m1), w1: frac(r.w1), ageDays, size: f.size || 0, bubble, etfVal, tradable, navDay, marketPrice: etf?.close || null, gold: isGoldFund(f) };
}

/* ---------------------------------- the combined score ---------------------------------- */
// How much each part counts, by the risk the owner accepts (profile): a cautious owner weighs a calm stock more.
export const SCORE_W = {
  low: { trend: 20, value: 25, flow: 20, attention: 5, safety: 30 },
  mid: { trend: 25, value: 20, flow: 25, attention: 10, safety: 20 },
  high: { trend: 30, value: 15, flow: 30, attention: 15, safety: 10 },
};
export const SCORE_PARTS = { trend: 'روند', value: 'ارزش', flow: 'پول حقیقی', attention: 'توجه بازار', safety: 'ریسک کم' };
export const TOP_MIN = 65; // a stock's score must reach this to be among «برترین‌های امروز»
export const TOP_N = 10;
export const TOP_PARTS = 4; // a stock needs at least this many parts known (and its risk) to be among the highest — a score from two parts says little
/** Percentile (0…1) of each item's value among the items that have one; ties share their middle place. */
function ranks(list, get) {
  const v = []; for (const x of list) { const y = get(x); if (y !== null && y !== undefined && isFinite(y)) v.push([x, y]); }
  const out = new Map();
  if (v.length < 2) { for (const [x] of v) out.set(x, 0.5); return out; }
  const sorted = v.map((o) => o[1]).sort((a, b) => a - b); const n = sorted.length;
  const lo = (y) => { let a = 0, b = n; while (a < b) { const m = (a + b) >> 1; if (sorted[m] < y) a = m + 1; else b = m; } return a; };
  const hi = (y) => { let a = 0, b = n; while (a < b) { const m = (a + b) >> 1; if (sorted[m] <= y) a = m + 1; else b = m; } return a; };
  for (const [x, y] of v) out.set(x, ((lo(y) + hi(y) - 1) / 2) / (n - 1));
  return out;
}
/**
 * One score (0…100) per liquid, traded stock: where it stands among the others on trend (12- and 3-month return), value
 * (P/E against its sector; a loss-making company gets nothing), individual money (the last 5 sessions, once 3 are known),
 * attention (today's volume against its usual) and calm (daily swing and the year's worst fall, inverted). A part that
 * can't be known for a stock is left out and the others share its weight. list: [{ ins, m }]. Returns Map ins → { score, parts }.
 */
export function scoreStocks(list, level = 'mid') {
  const w = SCORE_W[level] || SCORE_W.mid;
  const r365 = ranks(list, (s) => s.m.ret365), r91 = ranks(list, (s) => s.m.ret91);
  const rVal = ranks(list.filter((s) => s.m.eps > 0 && s.m.pe > 0), (s) => (s.m.peRel === null ? null : -s.m.peRel));
  const rFlow = ranks(list.filter((s) => s.m.flowN >= 3), (s) => s.m.flowShare5);
  const rAtt = ranks(list, (s) => (s.m.volRatio === null ? null : Math.min(s.m.volRatio, 10)));
  const rSwing = ranks(list, (s) => s.m.dvol), rFall = ranks(list, (s) => s.m.dd1y);
  const mean = (a) => { const l = a.filter((x) => x !== undefined && x !== null); return l.length ? l.reduce((t, x) => t + x, 0) / l.length : undefined; };
  const out = new Map();
  for (const s of list) {
    const trend = mean([r365.get(s), r91.get(s)]);
    if (trend === undefined) continue; // no return to stand on: no score
    const swing = rSwing.get(s), fall = rFall.get(s);
    const parts = {
      trend,
      value: s.m.eps > 0 && s.m.pe > 0 ? rVal.get(s) : (isFinite(s.m.eps) && s.m.eps !== null && s.m.eps <= 0) || s.m.pe < 0 ? 0 : undefined, // loss-making: nothing; unknown: left out
      flow: rFlow.get(s),
      attention: rAtt.get(s),
      safety: mean([swing === undefined ? undefined : 1 - swing, fall]),
    };
    let tw = 0, tv = 0;
    for (const [k, v] of Object.entries(parts)) if (v !== undefined) { tw += w[k]; tv += w[k] * v; }
    out.set(s.ins, { score: Math.round((tv / tw) * 100), parts: Object.fromEntries(Object.entries(parts).filter(([, v]) => v !== undefined)) });
  }
  return out;
}

/* ---------------------------------------- the market today ---------------------------------------- */
/**
 * «نبض بازار»: the session at a glance — the index today and over a month, how many stocks rose and fell, individual
 * money in or out (today and the last 5 sessions), the market's middle P/E as an earnings yield against the deposit,
 * and the dollar over a month. Each part is null when unknown. tone: −2…+2 from breadth and money.
 */
export function pulse(radar, { depositPct = 25 } = {}) {
  if (!radar?.day) return null;
  const D = dayNum(radar.day);
  const ix = radar.bench?.index;
  let indexDay = null;
  if (ix?.d?.length) { let i = ix.d.length - 1; while (i > 0 && ix.d[i] > D) i--; if (ix.d[i] === D && i > 0 && ix.p[i - 1] > 0) indexDay = ix.p[i] / ix.p[i - 1] - 1; }
  const m1 = benchRet(radar, 30, D);
  // while some stocks still wait for their own lists, breadth and money would cover only part of the market: not shown
  const pending = Object.values(radar.stocks || {}).filter((r) => r.need > 0).length;
  let up = 0, down = 0, flat = 0; const pes = [];
  for (const rec of Object.values(radar.stocks || {})) {
    const t = rec.today;
    if (t?.day === radar.day && t.close > 0 && t.py > 0 && t.vol > 0) { const c = t.close / t.py - 1; if (c > 0.001) up++; else if (c < -0.001) down++; else flat++; }
    if (rec.pe > 0 && rec.pe < 100 && rec.eps > 0 && !rec.need) pes.push(rec.pe);
  }
  const s5 = lastSessions(radar.sess, D, 5);
  const days = (radar.flowDays || []).map(dayNum).filter((d) => d <= D && s5.has(d));
  const last5 = new Set(days);
  let flowToday = null, flow5 = null;
  if (days.length && !pending) {
    flow5 = 0; if (days[days.length - 1] === D) flowToday = 0;
    for (const rec of Object.values(radar.stocks || {})) for (const [d, net] of rec.fl || []) { if (last5.has(d)) flow5 += net; if (d === D && flowToday !== null) flowToday += net; }
  }
  const pe = pes.length >= 20 ? median(pes) : null;
  const ey = pe ? 1 / pe : null;
  let tone = 0;
  if (pending) up = down = flat = 0;
  if (up + down >= 20) { if (up > down * 1.3) tone++; else if (down > up * 1.3) tone--; }
  if (flowToday !== null) { if (flowToday > 0) tone++; else if (flowToday < 0) tone--; }
  return { day: radar.day, indexDay, index1m: m1.index, usd1m: m1.usd, up, down, flat, flowToday, flow5, flowSessions: pending ? 0 : days.length, pending, pe, ey,
    depositPct, eyVsDeposit: ey !== null ? ey - depositPct / 100 : null, tone };
}

/**
 * Exchange-traded funds whose NAV (from Fipiran, usually a day behind) is for a day the radar has no market close of —
 * missed while the browser was off, or before the radar's first scan. Their closes come from each one's daily list
 * (fillEtf). Gold funds first, then the largest; each NAV day is tried once. Returns [insCode].
 */
export function etfGaps(radar, max = 40) {
  if (!radar?.day) return [];
  const D = dayNum(radar.day);
  return (radar.funds || []).filter((f) => {
    const e = f.insCode && radar.etf?.[f.insCode]; const nd = String(f.date || '').slice(0, 10);
    return e && nd && nd <= radar.day && dayNum(nd) >= D - 10 && !(nd in (e.hist || {})) && e.tried !== nd;
  }).sort((a, b) => isGoldFund(b) - isGoldFund(a) || (b.size || 0) - (a.size || 0)).slice(0, max).map((f) => f.insCode);
}
/** Merge a fund's real daily closes (providers.tsetmcDaily rows) into its few kept days; mark its NAV day as tried. */
export function fillEtf(radar, ins, rows, navDay, failed = false) {
  const e = radar.etf?.[ins]; if (!e) return;
  // a list that didn't come is tried again on the next runs, three times at most for the same NAV day
  if (failed) { e.fails = e.failFor === navDay ? (e.fails || 0) + 1 : 1; e.failFor = navDay; if (e.fails >= 3) e.tried = navDay; return; }
  const hist = { ...(e.hist || {}) };
  for (const r of rows || []) if (r.date && r.date <= radar.day && (r.raw ?? r.close) > 0) hist[r.date] = r.raw ?? r.close;
  const keep = Object.keys(hist).sort().slice(-7);
  e.hist = Object.fromEntries(keep.map((k) => [k, hist[k]]));
  if (navDay) e.tried = navDay;
}

/** Gold funds that trade, with today's bubble (price against the same day's NAV), lowest first — for «ارزان‌ترین راه طلا». */
export function goldFunds(radar) {
  if (!radar?.day) return [];
  const D = dayNum(radar.day);
  return (radar.funds || []).map((f) => ({ f, m: fundMetrics(f, radar, D) })).filter((x) => x.m.gold && x.m.tradable && x.m.bubble !== null)
    .sort((a, b) => a.m.bubble - b.m.bubble).map((x) => ({ key: x.f.key, name: x.f.name, sym: x.f.symbol || '', bubble: x.m.bubble, navDay: x.m.navDay, ref: fundRef(x.f),
      nav: x.f.cancelNav, price: x.f.cancelNav * (1 + x.m.bubble), m1: x.m.m1, m3: x.m.m3, y1: x.m.y1, val: x.m.etfVal, size: x.m.size }));
}

/* ---------------------------------------- cards ---------------------------------------- */
const P = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}٪`);
const P0 = (x, d = 0) => (x === null || !isFinite(x) ? '—' : `${Math.abs(x * 100).toFixed(d)}٪`);
const N = (x, d = 1) => (x === null || !isFinite(x) ? '—' : (+x.toFixed(d)).toString());
const fa = (s) => String(s).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c]).replace(/\./g, '٫');

export const SIGNALS = {
  top: { t: 'بالاترین امتیاز ترکیبی امروز', kind: 'stock' },
  inflow: { t: 'ورود پول حقیقی', kind: 'stock' },
  momentum12: { t: 'روند قوی، ۱۲ ماه', kind: 'stock' },
  momentum3: { t: 'روند قوی، ۳ ماه', kind: 'stock' },
  volume: { t: 'حجم غیرعادی', kind: 'stock' },
  cheap: { t: 'ارزان نسبت به گروه', kind: 'stock' },
  nearLow: { t: 'نزدیک کف سالانه، سودده', kind: 'stock' },
  negBubble: { t: 'صندوق زیر NAV', kind: 'fund' },
  goldBubble: { t: 'کم‌حباب‌ترین صندوق‌های طلا', kind: 'fund' },
  fixedBeat: { t: 'درآمد ثابت بهتر از سپرده', kind: 'fund' },
  topFund: { t: 'پربازده‌ترین صندوق‌ها', kind: 'fund' },
};

/** What to check about a stock, whatever brought it up: the other side of the coin, in plain words. */
function stockChecks(m, money, { depositPct = null, volMed = null } = {}) {
  const c = [];
  if (m.pe === null || m.eps <= 0) c.push('سودده نیست یا P/E ندارد؛ ارزش‌گذاری‌اش به آینده بستگی دارد');
  else if (m.sectorPE) c.push(`P/E ${fa(N(m.pe))} در برابر میانهٔ گروه ${fa(N(m.sectorPE))}${m.peRel > 1.3 ? '؛ گران‌تر از هم‌گروه‌ها' : m.peRel < 0.8 ? '؛ ارزان‌تر از هم‌گروه‌ها' : ''}`);
  else c.push(`P/E ${fa(N(m.pe))}`);
  // the P/E in plain words: what a year of the company's profit is, as a share of the price — against a deposit
  if (m.ey !== null && depositPct) c.push(`سود برآوردی سالانهٔ هر سهم معادل ${fa(P0(m.ey, m.ey < 0.1 ? 1 : 0))} قیمت آن است (همه‌اش نقدی پرداخت نمی‌شود)؛ سود سپرده ${fa(depositPct)}٪`);
  // risk, plainly: how far it fell at worst this year, and how much it moves in a day against the market's middle
  const risk = [];
  if (m.dd1y !== null && m.dd1y <= -0.05) risk.push(`در بدترین مقطع سال گذشته ${fa(P0(m.dd1y))} از اوج قبلی‌اش پایین آمد`);
  if (m.dvol !== null && m.dvol >= 0.001) {
    const r = volMed > 0 ? m.dvol / volMed : null;
    risk.push(`نوسان روزانه حدود ${fa(P0(m.dvol, 1))}${r !== null && (r >= 1.3 || r <= 0.75) ? `؛ ${r >= 1.3 ? `${fa(N(r))} برابر` : 'کمتر از'} میانهٔ بازار` : ''}`);
  }
  if (risk.length) c.push(risk.join('؛ '));
  if (m.fromHigh !== null && m.fullYear) c.push(m.fromHigh > -0.03 ? 'نزدیک بالاترین قیمت سال است' : `${fa(P0(m.fromHigh))} پایین‌تر از بالاترین قیمت سال`);
  if (m.ret365 !== null && m.ret365 > 1) c.push('رشد زیادی کرده؛ بخشی از خبرهای خوب ممکن است در قیمت لحاظ شده باشد');
  if (!m.liquid) c.push(`معاملاتش کم است (میانگین روزانه ${money(m.avgVal)})؛ خرید و فروش ممکن است سخت باشد`);
  return c;
}
function fundChecks(f, m, money) {
  const c = [];
  if (m.ageDays !== null && m.ageDays < 365) c.push('کمتر از یک سال سابقه دارد');
  c.push(`اندازهٔ صندوق ${money(m.size)}`);
  const mix = f.mix || {};
  if (f.fundType !== 4 && isFinite(mix.stock)) c.push(`ترکیب: ${fa(N(mix.stock, 0))}٪ سهام، ${fa(N((mix.bond || 0) + (mix.deposit || 0), 0))}٪ اوراق و سپرده`);
  if (m.bubble !== null) c.push(`حباب ${fa(P(m.bubble, 1))} (قیمت پایانی در برابر NAV ابطال ${fa(m.navDay.slice(5).replace('-', '/'))})`);
  c.push('بازدهی گذشته است و تضمینی برای آینده نیست');
  return c;
}
const stockRef = (ins, rec) => ({ provider: 'tsetmc', key: ins, symbol: rec.sym, field: 'close', label: rec.sym });
const fundRef = (f) => (f.traded && f.insCode ? { provider: 'tsetmc', key: f.insCode, symbol: f.symbol, field: 'close', label: f.symbol || f.name }
  : { provider: 'fipiran', key: f.key, name: f.name, field: 'cancelNav', label: f.name });

/**
 * Build today's cards. opts: { depositPct, money(rial) → text, max per signal }. Returns { day, cards, counts, ready }.
 * Every card: { id, sig, kind, sym, name, sub, ref, why: [text], check: [text], m }.
 */
export const SHOW = 6; // cards shown per signal before «همه را ببین»
export function buildCards(radar, { depositPct = 25, money = (v) => String(Math.round(v)), max = Infinity, level = 'mid' } = {}) {
  const day = radar.day; if (!day) return { day: null, cards: [], ready: 0, total: 0 };
  const D = dayNum(day);
  const sectors = sectorMedians(radar.stocks);
  const stocks = Object.entries(radar.stocks).map(([ins, rec]) => ({ ins, rec, m: stockMetrics(rec, D, sectors, radar.sess) }));
  const ready = stocks.filter((s) => !s.rec.need).length;
  const cards = [];
  const sname = (rec) => radar.sectors?.[rec.sector] || '';
  const live = stocks.filter((s) => !s.rec.need && s.m.traded);
  const volMed = median(live.filter((s) => s.m.liquid && s.m.dvol !== null).map((s) => s.m.dvol));
  const scores = scoreStocks(live.filter((s) => s.m.liquid), level);
  // every card knows its place in its signal's list (rank 0 = first): the page shows SHOW of them, then «همه را ببین»
  const nth = {}; const at = (sig) => (nth[sig] = (nth[sig] ?? -1) + 1);
  const push = (sig, s, why) => cards.push({ id: `s:${s.ins}`, sig, rank: at(sig), kind: 'stock', sym: s.rec.sym, name: s.rec.name, sub: [marketOf(s.rec.isin), sname(s.rec)].filter(Boolean).join('، '),
    ref: stockRef(s.ins, s.rec), why: why.filter(Boolean), check: stockChecks(s.m, money, { depositPct, volMed }), m: s.m, ins: s.ins,
    volRel: volMed > 0 && s.m.dvol !== null ? s.m.dvol / volMed : null });
  const b12 = benchLine(radar, 365, '۱۲ ماه'), b3 = benchLine(radar, 91, '۳ ماه');
  // 0) the combined score: the highest few (with enough of it known), whatever brought them up
  const ranked = live.filter((s) => scores.get(s.ins)?.score >= TOP_MIN && Object.keys(scores.get(s.ins).parts).length >= TOP_PARTS && scores.get(s.ins).parts.safety !== undefined).sort((a, b) => scores.get(b.ins).score - scores.get(a.ins).score || a.ins.localeCompare(b.ins));
  ranked.slice(0, Math.min(TOP_N, max)).forEach((s, i) => { const sc = scores.get(s.ins); push('top', s, [`امتیاز ${fa(sc.score)} از ۱۰۰؛ ${i === 0 ? 'بالاترین' : `رتبهٔ ${fa(i + 1)}`} بین ${fa(scores.size)} نماد پرمعامله`,
    `قوی‌ترین بخش‌ها: ${Object.entries(sc.parts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => SCORE_PARTS[k]).join(' و ')}`]); });
  // 1) momentum: the top tenth of liquid stocks by 12- and 3-month return (positive), best first
  const top = (key) => {
    const l = live.filter((s) => s.m.liquid && s.m[key] !== null);
    if (l.length < 20) return [];
    const sorted = l.slice().sort((a, b) => b.m[key] - a.m[key]);
    return sorted.slice(0, Math.max(1, Math.floor(l.length / 10))).filter((s) => s.m[key] > 0).map((s) => ({ s, rank: sorted.indexOf(s) + 1, of: l.length }));
  };
  const used = new Set();
  // (a stock among the first 12-month cards isn't repeated among the first 3-month ones)
  top('ret365').slice(0, max).forEach(({ s, rank, of }, i) => { if (i < SHOW) used.add(s.ins); push('momentum12', s, [`بازدهی ۱۲ ماه ${fa(P(s.m.ret365))}؛ رتبهٔ ${fa(rank)} از ${fa(of)} نماد پرمعامله`, b12]); });
  for (const { s, rank, of } of top('ret91').filter((x) => !used.has(x.s.ins)).slice(0, max)) push('momentum3', s, [`بازدهی ۳ ماه ${fa(P(s.m.ret91))}؛ رتبهٔ ${fa(rank)} از ${fa(of)} نماد پرمعامله`, b3]);
  // 2) unusual volume today (at least 3× its usual, and real money)
  live.filter((s) => s.m.volRatio >= 3 && s.rec.today?.val >= LIQ).sort((a, b) => b.m.volRatio - a.m.volRatio).slice(0, max)
    .forEach((s) => push('volume', s, [`حجم امروز ${fa(N(s.m.volRatio))} برابر حجم معمول (میانهٔ ۲۰ روز معاملهٔ قبلی)`, `ارزش معاملات امروز ${money(s.rec.today.val)}؛ تغییر قیمت امروز ${fa(P(s.m.dayChange, 1))}`]));
  // 2b) individual money coming in: most of the last sessions positive and a real share of what was traded
  live.filter((s) => s.m.liquid && s.m.flowN >= 3 && s.m.flow5 > 0 && s.m.flowShare5 >= 0.08 && s.m.flowPos5 >= Math.ceil(Math.min(5, s.m.flowN) * 0.6))
    .sort((a, b) => b.m.flowShare5 - a.m.flowShare5).slice(0, max)
    .forEach((s) => push('inflow', s, [`ورود پول حقیقی ${money(s.m.flow5)} در ${fa(Math.min(5, s.m.flowN))} جلسهٔ اخیر؛ ${fa(P0(s.m.flowShare5))} ارزش معاملات`,
      `${fa(s.m.flowPos5)} جلسه از ${fa(Math.min(5, s.m.flowN))} جلسه ورود${s.m.power ? `؛ امروز هر خریدار حقیقی به‌طور میانگین ${fa(N(s.m.power))} برابر هر فروشنده خرید کرد` : ''}`]));
  // 3) cheap against its sector: P/E at most 60% of the sector's median (liquid, profitable)
  live.filter((s) => s.m.peRel !== null && s.m.peRel <= 0.6 && s.m.eps > 0 && s.m.liquid)
    .sort((a, b) => a.m.peRel - b.m.peRel).slice(0, max)
    .forEach((s) => push('cheap', s, [`P/E ${fa(N(s.m.pe))} در برابر میانهٔ گروه ${fa(N(s.m.sectorPE))}${sname(s.rec) ? ` (${sname(s.rec)})` : ''}`, `${fa(P0(1 - s.m.peRel))} ارزان‌تر از هم‌گروه‌های سودده`]));
  // 4) within 10% of its 52-week low, still profitable
  // (and well below its high: a stock that barely moved all year is near its low and its high at once)
  live.filter((s) => s.m.fullYear && s.m.fromLow !== null && s.m.fromLow <= 0.1 && s.m.fromHigh <= -0.15 && s.m.eps > 0 && s.m.pe > 0 && s.m.liquid)
    .sort((a, b) => a.m.fromLow - b.m.fromLow).slice(0, max)
    .forEach((s) => push('nearLow', s, [`${s.m.fromLow < 0.005 ? 'روی کمترین قیمت سال' : `${fa(P0(s.m.fromLow))} بالاتر از کمترین قیمت سال`}`, `EPS مثبت (${fa(Math.round(s.m.eps))} ریال)، P/E ${fa(N(s.m.pe))}${s.m.ret365 !== null ? `؛ بازدهی ۱۲ ماه ${fa(P(s.m.ret365))}` : ''}`]));

  // funds
  const funds = (radar.funds || []).map((f) => ({ f, m: fundMetrics(f, radar, D) }));
  const fpush = (sig, x, why) => cards.push({ id: `f:${x.f.key}`, sig, rank: at(sig), kind: 'fund', sym: x.f.symbol || '', name: x.f.name, sub: [FUND_KIND[x.f.fundType] || x.f.type, x.f.traded ? 'قابل معامله' : 'صدور و ابطالی'].filter(Boolean).join('، '),
    ref: fundRef(x.f), why: why.filter(Boolean), check: fundChecks(x.f, x.m, money), m: x.m, key: x.f.key });
  funds.filter((x) => x.m.bubble !== null && x.m.bubble <= -0.01 && x.m.tradable).sort((a, b) => a.m.bubble - b.m.bubble).slice(0, max)
    .forEach((x) => { fpush('negBubble', x, [`قیمت پایانی ${fa(P0(x.m.bubble, 1))} کمتر از NAV ابطال همان روز (${fa(x.m.navDay.slice(5).replace('-', '/'))})`, 'یعنی آن روز هر واحد ارزان‌تر از ارزش دارایی‌هایش معامله شد؛ قیمت امروز را خودت ببین']);
      // a deep discount is usually a lasting one (block or thinly traded holdings, units that can't be redeemed at NAV): said on the card
      if (x.m.bubble <= -BIG_DISCOUNT) cards[cards.length - 1].check.unshift(`فاصلهٔ ${fa(P0(x.m.bubble))} زیر NAV بزرگ است؛ چنین فاصله‌ای معمولاً ماندگار است (مثلاً صندوقی که سهام بلوکی یا کم‌معامله دارد) و لزوماً بسته نمی‌شود. سابقهٔ قیمت و NAV این صندوق را در چند ماه اخیر ببین`); });
  const gold = funds.filter((x) => x.m.gold && x.m.bubble !== null && x.m.tradable).sort((a, b) => a.m.bubble - b.m.bubble);
  // the three smallest bubbles (those under NAV already have their own card above)
  if (gold.length >= 3) gold.slice(0, 3).forEach((x, i) => { if (!(x.m.bubble <= -0.01)) fpush('goldBubble', x, [`حباب ${fa(P(x.m.bubble, 1))}؛ ${i === 0 ? 'کمترین' : `رتبهٔ ${fa(i + 1)}`} از ${fa(gold.length)} صندوق طلای پرمعامله`, 'بیشتر دارایی این صندوق‌ها طلا و گواهی سکه است؛ حباب کمتر یعنی بهای کمتری بالای ارزش دارایی‌ها']); });
  const depEff = Math.pow(1 + depositPct / 100 / 12, 12) - 1;
  funds.filter((x) => x.f.fundType === 4 && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 2e12 && x.m.y1 > depEff).sort((a, b) => b.m.y1 - a.m.y1).slice(0, max)
    .forEach((x) => fpush('fixedBeat', x, [`بازدهی ۱۲ ماه ${fa(P(x.m.y1, 1))} در برابر ${fa(P(depEff, 1))} سپرده ${fa(depositPct)}٪ با سود ماهانه`, b12]));
  for (const t of [6, 7, 5, 23, 21, 22]) {
    funds.filter((x) => x.f.fundType === t && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 1e12).sort((a, b) => b.m.y1 - a.m.y1).slice(0, 2)
      .forEach((x, i) => fpush('topFund', x, [`${i === 0 ? 'بیشترین' : 'دومین'} بازدهی ۱۲ ماه در صندوق‌های ${FUND_KIND[t]}: ${fa(P(x.m.y1))}`, b12]));
  }
  // every stock card carries its score and the other signals it is in
  const sigsOf = {}; for (const c of cards) if (c.kind === 'stock' && c.sig !== 'top') (sigsOf[c.id] ||= new Set()).add(c.sig);
  for (const c of cards) if (c.kind === 'stock') { const sc = scores.get(c.ins); if (sc) { c.score = sc.score; c.parts = sc.parts; } c.lit = [...(sigsOf[c.id] || [])]; }
  const count = {}; for (const c of cards) count[c.sig] = (count[c.sig] || 0) + 1;
  return { day, cards, count, ready, total: stocks.length, funds: funds.length, scored: scores.size, level: SCORE_W[level] ? level : 'mid' };
}
// short lists by design (three gold funds; two per fund type) are never folded
const NOCAP = new Set(['topFund', 'goldBubble']);
export const BIG_DISCOUNT = 0.1; // a fund this far under its NAV: the gap is most likely a lasting one
/** Shown before «همه را ببین»: the first SHOW of each signal. */
export const isFirst = (c) => NOCAP.has(c.sig) || !(c.rank >= SHOW);
export const shown = (cards) => cards.filter(isFirst);

/* ---------------------------------------- rules ---------------------------------------- */
// The owner's own filters: up to a few conditions, all must hold. Percent fields are entered and stored as percent.
export const FIELDS = {
  stock: {
    pe: { t: 'P/E', pct: false }, peRel: { t: 'P/E نسبت به میانهٔ گروه', pct: false }, ret30: { t: 'بازدهی ۱ ماه', pct: true }, ret91: { t: 'بازدهی ۳ ماه', pct: true },
    ret365: { t: 'بازدهی ۱۲ ماه', pct: true }, fromHigh: { t: 'فاصله از بالاترین سال', pct: true }, fromLow: { t: 'فاصله از کمترین سال', pct: true },
    volRatio: { t: 'حجم امروز ÷ میانگین', pct: false },
    score: { t: 'امتیاز ترکیبی (۰ تا ۱۰۰)', pct: false }, flowShare5: { t: 'ورود پول حقیقی ۵ جلسه (٪ ارزش معاملات)', pct: true },
    power: { t: 'قدرت خریدار حقیقی امروز', pct: false },
  },
  fund: {
    y1: { t: 'بازدهی ۱۲ ماه', pct: true }, m3: { t: 'بازدهی ۳ ماه', pct: true }, m1: { t: 'بازدهی ۱ ماه', pct: true }, bubble: { t: 'حباب (قابل معامله)', pct: true },
  },
};
const okCond = (kind, c) => FIELDS[kind]?.[c?.f] && (c.op === '<=' || c.op === '>=') && c.v !== '' && c.v !== null && c.v !== undefined && isFinite(+c.v);
export const validRule = (r) => !!r && (r.kind === 'stock' || r.kind === 'fund') && Array.isArray(r.conds) && r.conds.length > 0 && r.conds.length <= 4 && r.conds.every((c) => okCond(r.kind, c));
function test(kind, m, conds) {
  return conds.every((c) => {
    const v = m[c.f];
    if (v === null || v === undefined || !isFinite(v)) return false;
    const want = FIELDS[kind][c.f].pct ? +c.v / 100 : +c.v;
    return c.op === '<=' ? v <= want : v >= want;
  });
}
// a year's high and low mean nothing for a stock with a few months of history
const ruleView = (m) => (m.fullYear ? m : { ...m, fromHigh: null, fromLow: null });
// best first by the rule's first condition: «≥» → largest first, «≤» → smallest first
const byFirst = (rule) => { const c = rule.conds[0]; const s = c.op === '>=' ? -1 : 1; return (a, b) => s * (a.m[c.f] - b.m[c.f]); };
/** All matches of one rule, best first: [{ id, sym, name, ref, m }] — liquid stocks only (a thin stock's numbers mislead). */
export function runRule(radar, rule, { level = 'mid' } = {}) {
  if (!validRule(rule) || !radar.day) return [];
  const D = dayNum(radar.day);
  if (rule.kind === 'stock') {
    const sectors = sectorMedians(radar.stocks);
    const all = Object.entries(radar.stocks).filter(([, r]) => !r.need).map(([ins, rec]) => ({ ins, rec, m: ruleView(stockMetrics(rec, D, sectors, radar.sess)) }));
    // the score is measured among all liquid stocks (as on the cards), whatever the rule's sector
    const sc = rule.conds.some((c) => c.f === 'score') ? scoreStocks(all.filter((s) => s.m.liquid && s.m.traded), level) : null;
    if (sc) for (const s of all) s.m = { ...s.m, score: sc.get(s.ins)?.score ?? null };
    return all.filter((s) => !rule.sector || s.rec.sector === rule.sector).filter((s) => s.m.liquid && s.m.traded && test('stock', s.m, rule.conds))
      .sort(byFirst(rule)).map((s) => ({ id: `s:${s.ins}`, sym: s.rec.sym, name: s.rec.name, ref: stockRef(s.ins, s.rec), m: s.m }));
  }
  return (radar.funds || []).filter((f) => !rule.ftype || f.fundType === +rule.ftype).map((f) => ({ f, m: fundMetrics(f, radar, D) }))
    .filter((x) => test('fund', x.m, rule.conds)).sort(byFirst(rule)).map((x) => ({ id: `f:${x.f.key}`, sym: x.f.symbol || '', name: x.f.name, ref: fundRef(x.f), m: x.m }));
}
/** Rule matches that weren't there last time (for a notification); also returns the new hit list to store. */
export function newHits(prevIds, matches) {
  const before = new Set(prevIds || []);
  return { fresh: matches.filter((x) => !before.has(x.id)), ids: matches.map((x) => x.id) };
}

/* -------------------------------------- one symbol -------------------------------------- */
/** Today's price of a radar id (for «پیگیری»): a stock's last close, or a fund's market close / cancel NAV. */
export function priceOf(radar, id) {
  if (!radar || !id) return null;
  if (id.startsWith('s:')) { const r = radar.stocks?.[id.slice(2)]; return r ? (r.p.length ? r.p[r.p.length - 1] : r.today?.close) || null : null; }
  const f = (radar.funds || []).find((x) => `f:${x.key}` === id);
  if (!f) return null;
  return (f.insCode && radar.etf?.[f.insCode]?.close) || f.cancelNav || null;
}
/** Change since a day it was marked: a stock's adjusted series (a capital increase since then isn't a fall), else the price then. */
export function changeSince(radar, id, day, priceThen) {
  const now = priceOf(radar, id);
  if (!(now > 0)) return null;
  const rec = id.startsWith('s:') ? radar.stocks?.[id.slice(2)] : null;
  if (rec && day && rec.d.length && rec.d[0] <= dayNum(day)) { const c0 = closeOn(rec, dayNum(day)); if (c0 > 0) return now / c0 - 1; }
  return priceThen > 0 ? now / priceThen - 1 : null;
}
const benches = (radar) => ({ m1: benchRet(radar, 30), m3: benchRet(radar, 91), m6: benchRet(radar, 182), y1: benchRet(radar, 365) });
/** A stock's or fund's report card from the radar store, by TSETMC insCode or fund key. */
export function report(radar, { ins = null, fundKey = null, fundName = '' } = {}) {
  if (!radar?.day) return null;
  const D = dayNum(radar.day);
  if (ins && radar.stocks?.[ins]) {
    const rec = radar.stocks[ins]; const m = stockMetrics(rec, D, sectorMedians(radar.stocks), radar.sess);
    return { kind: 'stock', day: radar.day, sym: rec.sym, name: rec.name, sector: radar.sectors?.[rec.sector] || '', market: marketOf(rec.isin), m, partial: !!rec.need, bench: benches(radar) };
  }
  const f = (fundKey && fundOf(radar, fundKey, fundName)) || (ins && (radar.funds || []).find((x) => x.insCode === ins)) || null;
  if (!f) return null;
  const m = fundMetrics(f, radar, D);
  const peers = (radar.funds || []).filter((x) => x.fundType === f.fundType && isFinite(x.ret?.y1) && x.since && D - dayNum(x.since) >= 365);
  const better = peers.filter((x) => x.ret.y1 > (f.ret?.y1 ?? -Infinity)).length;
  return { kind: 'fund', day: radar.day, sym: f.symbol, name: f.name, type: FUND_KIND[f.fundType] || f.type, m, mix: f.mix, nav: f.cancelNav, navDay: m.navDay, size: f.size,
    rank: isFinite(f.ret?.y1) && peers.length && m.ageDays >= 365 ? { pos: better + 1, of: peers.length } : null, bench: benches(radar) };
}
/** The fund a saved key points at. Older refs to one class of an umbrella fund hold only its registration number: then
 *  the saved name picks the class (as providers.findFund does for prices). */
export function fundOf(radar, key, name = '') {
  const fs = radar?.funds || []; const k = String(key ?? '');
  if (!k) return null;
  const exact = fs.find((x) => x.key === k);
  if (exact) return exact;
  const same = fs.filter((x) => String(x.key).split('-')[0] === k.split('-')[0]);
  if (same.length <= 1) return same[0] || null;
  const want = squash(name);
  return want ? same.find((x) => squash(x.name) === want) || same.find((x) => squash(x.name).includes(want) || want.includes(squash(x.name))) || null : null;
}
/** A card's identity for «تازه»: the same stock under another signal is news too. */
export const cardKey = (c) => `${c.sig}|${c.id}`;
/** Find a stock or fund by its symbol or name (the assistant's lookup). */
export function find(radar, q) {
  const t = persianize(q).replace(/\s+/g, '');
  if (!t || !radar) return null;
  const st = Object.entries(radar.stocks || {}).find(([, r]) => persianize(r.sym).replace(/\s+/g, '') === t);
  if (st) return { ins: st[0] };
  const f = (radar.funds || []).find((x) => persianize(x.symbol || '').replace(/\s+/g, '') === t);
  if (f) return { fundKey: f.key, ins: f.insCode || null };
  const nm = (x) => persianize(x || '').replace(/\s+/g, '');
  // a whole name, then a part of a name only when exactly one fund or company has it («طلا» alone is not an answer)
  const fe = (radar.funds || []).find((x) => nm(x.name) === t);
  if (fe) return { fundKey: fe.key, ins: fe.insCode || null };
  const se = Object.entries(radar.stocks || {}).find(([, r]) => nm(r.name) === t);
  if (se) return { ins: se[0] };
  const hits = [...(radar.funds || []).filter((x) => nm(x.name).includes(t)).map((x) => ({ fundKey: x.key, ins: x.insCode || null })),
    ...Object.entries(radar.stocks || {}).filter(([, r]) => nm(r.name).includes(t)).map(([ins]) => ({ ins }))];
  return hits.length === 1 ? hits[0] : null;
}
/** Fund fields worth keeping from Fipiran (the list is re-fetched daily). */
export const slimFund = (f) => ({ key: f.key, name: f.name, symbol: f.symbol, fundType: f.fundType, type: f.type, cancelNav: f.cancelNav, date: f.date, size: f.size,
  ret: f.ret, since: f.since, traded: f.traded, insCode: f.insCode, mix: f.mix });
/** Which stocks to fetch next: the largest first (they matter most), about `n` full-year fetches' worth. */
export function nextToFetch(radar, n = 40) {
  // largest first (a reset market watch has no value traded to sort by). n counts full-year fetches; a few-day fetch
  // is a quarter of one, so the daily catch-up of every stock goes four times as fast.
  const all = Object.entries(radar.stocks).filter(([, r]) => r.need > 0).sort((a, b) => (b[1].cap || 0) - (a[1].cap || 0));
  const out = []; let used = 0;
  for (const [ins, r] of all) {
    const cost = r.need >= 60 ? 1 : 0.25;
    if (used + cost > n) break;
    used += cost; out.push({ ins, need: r.need });
  }
  return out;
}

/* ------------------------------------ before a purchase ------------------------------------ */
/**
 * The «پیش از خرید ببین» facts for a new stock or fund purchase. value: what is being bought (Rial); funded: paid from an
 * account already in Dara (the total doesn't grow); held: { gross, sameRef, sameSector } — the owner's current totals
 * (Rial). bubble: today's same-day bubble when known. Returns lines { k, t, warn } — facts, never a verdict.
 */
export function preBuy({ value, funded = false, held = {}, rep = null, bubble = null, depositPct = 25, fee = 1.5, kind = 'stock' }) {
  if (!(value > 0)) return [];
  const out = [];
  const gross = (held.gross || 0) + (funded ? 0 : value);
  if (gross > 0) {
    const share = ((held.sameRef || 0) + value) / gross;
    out.push({ k: 'share', v: share, t: `بعد از این خرید، ${P0(share, share < 0.1 ? 1 : 0)} دارایی‌هایت در همین ${kind === 'fund' ? 'صندوق' : 'نماد'} است`, warn: share > 0.25 });
    if (held.sameSector > 0 && rep?.sector) {
      const sec = (held.sameSector + value) / gross;
      out.push({ k: 'sector', v: sec, t: `و ${P0(sec, 0)} در گروه «${rep.sector}»`, warn: sec > 0.4 });
    }
  }
  if (bubble !== null && isFinite(bubble)) out.push({ k: 'bubble', v: bubble, t: `حباب ${P(bubble, 1)} (آخرین قیمت در برابر آخرین NAV)${bubble > 0.02 ? '؛ بالاتر از ارزش دارایی‌های صندوق' : bubble < -0.01 ? '؛ پایین‌تر از ارزش دارایی‌های صندوق' : ''}`, warn: bubble > 0.03 });
  const m = rep?.m;
  if (rep?.kind === 'stock' && m) {
    if (m.fromHigh !== null && m.fullYear) out.push({ k: 'high', v: m.fromHigh, t: m.fromHigh > -0.03 ? 'قیمت نزدیک بالاترین سطح یک سال اخیر است' : `قیمت ${P0(m.fromHigh)} پایین‌تر از بالاترین سطح یک سال اخیر است`, warn: m.fromHigh > -0.03 });
    if (!(m.eps > 0) || !(m.pe > 0)) out.push({ k: 'pe', v: null, t: 'شرکت سودده نیست یا P/E ندارد', warn: true });
    else if (m.sectorPE) out.push({ k: 'pe', v: m.peRel, t: `P/E ${fa(N(m.pe))} در برابر میانهٔ گروه ${fa(N(m.sectorPE))}`, warn: m.peRel > 1.5 });
    if (m.avgVal > 0) { const r = value / m.avgVal; out.push({ k: 'liq', v: r, t: r >= 0.1 ? `این خرید ${P0(r, 0)} معاملات یک روز معمول این نماد است؛ فروش یک‌جا ممکن است چند روز طول بکشد` : 'نقدشوندگی برای این مبلغ کافی است', warn: r >= 0.1 }); }
  }
  // how much it must rise in 12 months to beat a deposit, after the cost of buying and selling
  const dg = Math.pow(1 + depositPct / 100 / 12, 12);
  const keep = 1 - Math.min(0.9, Math.max(0, fee / 100));
  const need = dg / keep - 1;
  out.push({ k: 'deposit', v: need, t: `برای جلو زدن از سپردهٔ ${fa(depositPct)}٪ در ۱۲ ماه، باید ${P0(need, 0)} بالا برود${fee ? ` (با ${fa(fee)}٪ هزینهٔ خرید و فروش)` : ''}` });
  return out;
}

/* ------------------------------------- pictures of a price ------------------------------------- */
/** Up to `n` closes of the last year (oldest first), evenly picked, always ending on the latest close. */
export function spark(rec, D, n = 48) {
  if (!rec?.d?.length) return [];
  let i0 = 0; while (i0 < rec.d.length && rec.d[i0] < D - 365) i0++;
  const p = rec.p.slice(i0);
  if (p.length <= n) return p;
  const out = []; const step = (p.length - 1) / (n - 1);
  for (let k = 0; k < n; k++) out.push(p[Math.round(k * step)]);
  return out;
}
/** Where today's close sits in its year: 0 = the year's low, 1 = its high (null without a full year or a range). */
export const yearPos = (m) => (m?.fullYear && m.hi52 > m.lo52 && m.close > 0 ? Math.min(1, Math.max(0, (m.close - m.lo52) / (m.hi52 - m.lo52))) : null);

/* ----------------------------------------- search ----------------------------------------- */
const squash = (s) => persianize(String(s || '')).replace(/[\s‌]+/g, '').toLowerCase();
/**
 * Quick search over every stock and fund in the radar: symbol first (exact, then prefix), then name. Larger first among
 * equals. Returns [{ id, kind, sym, name, sub, ref, ins, key }].
 */
export function search(radar, q, n = 12) {
  const t = squash(q);
  if (!t || !radar) return [];
  const hits = [];
  const rank = (sym, name) => { const s = squash(sym), nm = squash(name); return s === t ? 0 : s.startsWith(t) ? 1 : nm.startsWith(t) ? 2 : s.includes(t) ? 3 : nm.includes(t) ? 4 : -1; };
  for (const [ins, r] of Object.entries(radar.stocks || {})) {
    const k = rank(r.sym, r.name); if (k < 0) continue;
    hits.push({ k, size: r.cap || 0, id: `s:${ins}`, kind: 'stock', sym: r.sym, name: r.name, sub: [marketOf(r.isin), radar.sectors?.[r.sector] || ''].filter(Boolean).join('، '), ref: stockRef(ins, r), ins });
  }
  for (const f of radar.funds || []) {
    const k = rank(f.symbol, f.name); if (k < 0) continue;
    hits.push({ k, size: f.size || 0, id: `f:${f.key}`, kind: 'fund', sym: f.symbol || '', name: f.name, sub: [FUND_KIND[f.fundType] || f.type, f.traded ? 'قابل معامله' : 'صدور و ابطالی'].filter(Boolean).join('، '), ref: fundRef(f), key: f.key, ins: f.insCode || null });
  }
  return hits.sort((a, b) => a.k - b.k || b.size - a.size).slice(0, n).map(({ k, size, ...x }) => x);
}

/* ------------------------------------- the owner's holdings ------------------------------------- */
/** Stocks and funds the owner holds at market price, one entry per symbol: [{ provider, key }]. isLiab(asset) skips debts. */
export function holdRefs(assets = [], isLiab = () => false) {
  const seen = new Map();
  for (const a of assets) {
    const r = a?.price?.ref;
    if (a.archived || a.mode !== 'units' || a.price?.source !== 'market' || !(+a.quantity > 0) || isLiab(a)) continue;
    if (!r?.key || (r.provider !== 'tsetmc' && r.provider !== 'fipiran')) continue;
    const id = `${r.provider}:${r.key}`;
    if (!seen.has(id)) seen.set(id, { provider: r.provider, key: String(r.key), label: r.symbol || r.label || r.name || a.name, assets: [] });
    seen.get(id).assets.push(a.id);
  }
  return [...seen.values()];
}
/**
 * The owner's holdings as the radar sees them: today's numbers, the cards they appear in, and plain facts worth a look —
 * `warn` marks the ones that are bad news for a holder. Never a verdict. Returns
 * [{ id, kind, sym, name, ref, hold, m, rep, sigs:[sig], flags:[{ k, t, warn }] }], warnings first.
 */
export function mine(radar, refs = [], { depositPct = 25, cards = null } = {}) {
  if (!radar?.day || !refs.length) return [];
  const D = dayNum(radar.day);
  const list = cards || buildCards(radar, { depositPct }).cards;
  const out = []; const byId = new Map();
  // radar coverage is complete when no stock is still waiting for its prices and the fund list is in
  const settled = radar.funds?.length > 0 && !Object.values(radar.stocks || {}).some((r) => r.need > 0);
  for (const h of refs) {
    let rep = null, id = null, ref = null;
    if (h.provider === 'tsetmc' && radar.stocks?.[h.key]) { rep = report(radar, { ins: h.key }); id = `s:${h.key}`; ref = stockRef(h.key, radar.stocks[h.key]); }
    else {
      const f = h.provider === 'fipiran' ? fundOf(radar, h.key, h.label) : (radar.funds || []).find((x) => x.insCode === h.key);
      if (f) { rep = report(radar, { fundKey: f.key }); id = `f:${f.key}`; ref = fundRef(f); }
    }
    if (!rep) {
      out.push({ id: `x:${h.provider}:${h.key}`, kind: h.provider === 'fipiran' ? 'fund' : 'stock', sym: h.label, name: '', ref: { provider: h.provider, key: h.key, label: h.label }, hold: h, m: null, rep: null, sigs: [], flags: [], missing: true,
        note: settled ? 'رادار این را پوشش نمی‌دهد (فقط سهام بورس و فرابورس و صندوق‌ها)' : 'هنوز در داده‌های رادار نیست' });
      continue;
    }
    // the same fund held both by its TSETMC code and its Fipiran key: one row
    if (byId.has(id)) { const o = byId.get(id); o.hold = { ...o.hold, assets: [...o.hold.assets, ...h.assets] }; continue; }
    const m = rep.m;
    const flags = [];
    const add = (k, t, warn = false) => flags.push({ k, t, warn });
    const sigs = [...new Set(list.filter((c) => c.id === id).map((c) => c.sig))];
    if (rep.kind === 'stock' && rep.partial) add('partial', 'قیمت‌های یک سالش هنوز کامل جمع نشده؛ نکته‌هایش بعد از آن می‌آید');
    else if (rep.kind === 'stock') {
      if (m.dayChange !== null && Math.abs(m.dayChange) >= 0.04) add('day', `امروز ${P(m.dayChange, 1)}`, m.dayChange < 0);
      if (m.ret7 !== null && m.ret7 <= -0.1) add('fall', `${P(m.ret7)} در یک هفته`, true);
      else if (m.ret30 !== null && m.ret30 <= -0.15) add('fall', `${P(m.ret30)} در یک ماه`, true);
      if (m.fullYear && m.fromHigh !== null && m.fromHigh <= -0.3) add('high', `${P0(m.fromHigh)} پایین‌تر از سقف سال`, !sigs.includes('nearLow'));
      // near its low (and not already counted as far under its high); when it's also a «near its low» card, said plainly
      else if (m.fullYear && m.fromLow !== null && m.fromLow <= 0.05 && m.fromHigh <= -0.15) add('low', 'نزدیک کمترین قیمت سال', !sigs.includes('nearLow'));
      if (m.fullYear && m.fromHigh !== null && m.fromHigh > -0.03) add('top', 'نزدیک بالاترین قیمت سال');
      if (m.volRatio >= 3) add('vol', `حجم امروز ${fa(N(m.volRatio))} برابر حجم معمول`);
      if (m.flowN >= 3 && m.flowShare5 !== null && m.flowShare5 <= -0.08 && m.flowPos5 <= 1) add('outflow', `خروج پول حقیقی: ${fa(P0(-m.flowShare5))} ارزش معاملات ${fa(Math.min(5, m.flowN))} جلسهٔ اخیر`, true);
      else if (m.flowN >= 3 && m.flowShare5 >= 0.08 && m.flowPos5 >= 3) add('inflow', 'ورود پول حقیقی در جلسه‌های اخیر');
      if (!(m.eps > 0)) add('eps', 'سودده نیست یا P/E ندارد', true);
      else if (m.peRel !== null && m.peRel >= 1.5) add('pe', `P/E ${fa(N(m.peRel))} برابر میانهٔ گروه`, true);
      if (!m.traded) add('idle', 'بیش از یک هفته معامله نشده', true);
      else if (!m.liquid) add('thin', 'معاملاتش کم است؛ فروش یک‌جا ممکن است سخت باشد', true);
    } else {
      const f = (radar.funds || []).find((x) => `f:${x.key}` === id);
      if (m.bubble !== null && m.bubble >= 0.03) add('bubble', `حباب ${P(m.bubble, 1)} بالای NAV`, true);
      else if (m.bubble !== null && m.bubble <= -0.01) add('under', `${P0(m.bubble, 1)} زیر NAV`);
      if (m.m1 !== null && m.m1 <= -0.08) add('fall', `${P(m.m1)} در یک ماه`, true);
      if (rep.rank && rep.rank.of >= 8) {
        const kind = rep.type ? `صندوق‌های ${rep.type}` : 'صندوق‌های هم‌نوع';
        if (rep.rank.pos > rep.rank.of * 0.75) add('rank', `رتبهٔ ${fa(rep.rank.pos)} از ${fa(rep.rank.of)} در ${kind} (بازدهی ۱۲ ماه)`, true);
        else if (rep.rank.pos <= Math.max(1, Math.ceil(rep.rank.of * 0.1))) add('top', `رتبهٔ ${fa(rep.rank.pos)} از ${fa(rep.rank.of)} در ${kind}`);
      }
      const depEff = Math.pow(1 + depositPct / 100 / 12, 12) - 1;
      if (f?.fundType === 4 && m.y1 !== null && m.ageDays >= 365 && m.y1 < depEff) add('dep', `بازدهی ۱۲ ماه ${P(m.y1, 1)}، کمتر از سپردهٔ ${fa(depositPct)}٪`, true);
    }
    const item = { id, kind: rep.kind, sym: rep.sym || '', name: rep.name, ref, hold: h, m, rep, sigs, flags };
    byId.set(id, item); out.push(item);
  }
  return out.sort((a, b) => b.flags.filter((x) => x.warn).length - a.flags.filter((x) => x.warn).length || !!a.missing - !!b.missing);
}
/**
 * Warnings about holdings worth a notification: [{ key, sym, t }]. prev: { seen: { key: last day number }, ids: [held ids] }
 * from the last complete scan (null on the first: that one only remembers). Today's move («day») is never notified; a
 * warning that went away and came back within COOL_DAYS doesn't notify again; a holding new since last time only
 * remembers its warnings (it was just bought with them).
 */
export const COOL_DAYS = 7;
export function newWarnings(prev, items, D) {
  const seen = { ...(prev?.seen || {}) }; const ids = new Set(prev?.ids || []); const last = new Set(prev?.last || []);
  const all = items.filter((x) => !x.missing).flatMap((x) => x.flags.filter((f) => f.warn && f.k !== 'day' && f.k !== 'partial').map((f) => ({ key: `${x.id}|${f.k}`, id: x.id, sym: x.sym || x.name, t: f.t })));
  // still there since the last scan (however long ago that was) isn't news
  const fresh = !prev ? [] : all.filter((w) => ids.has(w.id) && !last.has(w.key) && !(seen[w.key] >= D - COOL_DAYS));
  for (const w of all) seen[w.key] = D;
  for (const k of Object.keys(seen)) if (seen[k] < D - 60) delete seen[k];
  return { fresh, state: { seen, last: all.map((w) => w.key), ids: items.filter((x) => !x.missing).map((x) => x.id) } };
}

/* ------------------------------- alerts on followed items ------------------------------- */
/**
 * «پیگیری» alerts, checked against the session's closing prices: a mark may carry alert { above, below, fall } — prices
 * in Rial, `fall` in percent from the price when it was marked — and `fired` { above|below|fall: day } once each went
 * off (an alert fires once; editing it re-arms it). Returns { fired: [{ id, sym, t }], marks } (marks updated).
 */
export function checkMarkAlerts(radar, marks = []) {
  const fired = [];
  if (!radar?.day) return { fired, marks };
  const out = marks.map((m) => {
    let a = m.alert; if (!a) return m;
    if (m.id.startsWith('s:') && radar.stocks?.[m.id.slice(2)]?.need > 0) return m; // its prices are still being gathered
    const now = priceOf(radar, m.id); if (!(now > 0)) return m;
    const f = { ...(m.fired || {}) }; const sym = m.sym || m.name;
    // a stock's levels were typed against its price then; a capital increase or dividend since moved the whole price
    // scale — move the levels with it (the adjusted close of the mark day ÷ the price recorded then)
    const rec = m.id.startsWith('s:') ? radar.stocks?.[m.id.slice(2)] : null;
    let k = 1;
    if (rec && m.day && m.price > 0 && rec.d.length && rec.d[0] <= dayNum(m.day)) { const c0 = closeOn(rec, dayNum(m.day)); if (c0 > 0) k = c0 / m.price; }
    a = { ...a, above: a.above > 0 ? a.above * k : a.above, below: a.below > 0 ? a.below * k : a.below };
    if (a.above > 0 && !f.above && now >= a.above) { f.above = radar.day; fired.push({ id: m.id, sym, k: 'above', now }); }
    if (a.below > 0 && !f.below && now <= a.below) { f.below = radar.day; fired.push({ id: m.id, sym, k: 'below', now }); }
    if (a.fall > 0 && !f.fall) { const ch = changeSince(radar, m.id, m.day, m.price); if (ch !== null && ch <= -a.fall / 100) { f.fall = radar.day; fired.push({ id: m.id, sym, k: 'fall', ch }); } }
    return Object.keys(f).length !== Object.keys(m.fired || {}).length ? { ...m, fired: f } : m;
  });
  return { fired, marks: out };
}

/* ------------------------------- the radar's own track record ------------------------------- */
// Each complete scan's first cards per signal are kept with their price, so the radar can later say plainly how what it
// showed actually did a month on — against the index over the same month.
export const TRACK_DAYS = 400;
export function recordTrack(radar, cards) {
  if (!radar?.day) return radar;
  const t = radar.track ||= {};
  if (t[radar.day]) return radar;
  const day = {};
  for (const c of shown(cards)) { const p = priceOf(radar, c.id); if (p > 0) (day[c.sig] ||= []).push([c.id, +p.toPrecision(8)]); }
  t[radar.day] = day;
  const D = dayNum(radar.day);
  for (const k of Object.keys(t)) if (dayNum(k) < D - TRACK_DAYS) delete t[k];
  return radar;
}
/** How a signal's stock cards did over the following 30 days, on average, against the index: { since, n, avg, index }. */
export function trackStats(radar, sig, horizon = 30) {
  const t = radar?.track || {}; const days = Object.keys(t).sort();
  const out = { since: days[0] || null, n: 0, avg: null, index: null };
  if (!radar?.day) return out;
  const D = dayNum(radar.day); const r = [], ix = []; const last = {}; const ids = new Set();
  for (const day of days) {
    const d0 = dayNum(day); if (d0 > D - horizon) break;
    const bi = benchAt(radar.bench?.index, d0), bz = benchAt(radar.bench?.index, d0 + horizon);
    for (const [id] of t[day][sig] || []) {
      if (!id.startsWith('s:')) continue;
      const rec = radar.stocks?.[id.slice(2)]; if (!rec?.d?.length || rec.d[0] > d0) continue;
      // a stock that stays on the list counts once per window (its first day there), not once per session
      if (last[id] !== undefined && d0 - last[id] < horizon) continue;
      const a = closeOn(rec, d0), z = closeOn(rec, d0 + horizon);
      if (a > 0 && z > 0) { last[id] = d0; ids.add(id); r.push(z / a - 1); if (bi > 0 && bz > 0) ix.push(bz / bi - 1); }
    }
  }
  if (r.length < 20 || ids.size < 8) return { ...out, n: r.length, stocks: ids.size };
  const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length;
  return { ...out, n: r.length, stocks: ids.size, avg: mean(r), index: ix.length ? mean(ix) : null };
}
