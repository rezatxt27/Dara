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
 * only names, sectors and EPS are taken; every stock's close comes from its own daily list.
 */
export function applySession(radar, rows, day, sessions = [], mode = 'live') {
  const live = mode === 'live';
  const D = dayNum(day);
  // recent session days (liquidity is averaged over the last 20 of them, days without a trade counting as zero)
  radar.sess = [...new Set([...(radar.sess || []), ...sessions.filter((x) => x <= day), day])].sort().slice(-40);
  const seen = new Set();
  for (const raw of rows) {
    const r = mwRow(raw);
    if (isEtfIsin(r.isin)) {
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
    else if (!sameDay) rec.today = { day, close: r.close, py: null, vol: 0, val: 0 }; // filled in from its daily list
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
  return {
    close, ret7: ret(7), ret30: ret(30), ret91: ret(91), ret365: ret(365),
    hi52: hi, lo52: lo, fullYear, fromHigh: hi > 0 ? close / hi - 1 : null, fromLow: lo > 0 ? close / lo - 1 : null,
    volToday, volRatio: volToday > 0 && avgVol > 0 && prev.length >= 10 ? volToday / avgVol : null, avgVal, liquid: avgVal >= LIQ,
    traded: !!lastH && lastH[0] >= D - 7, eps: rec.eps, pe: isFinite(rec.pe) ? rec.pe : null, sectorPE: isFinite(mPE) ? mPE : null,
    peRel: isFinite(rec.pe) && rec.pe > 0 && mPE > 0 ? rec.pe / mPE : null, dayChange: rec.today?.py > 0 ? rec.today.close / rec.today.py - 1 : null,
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

/* ---------------------------------------- cards ---------------------------------------- */
const P = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}٪`);
const P0 = (x, d = 0) => (x === null || !isFinite(x) ? '—' : `${Math.abs(x * 100).toFixed(d)}٪`);
const N = (x, d = 1) => (x === null || !isFinite(x) ? '—' : (+x.toFixed(d)).toString());
const fa = (s) => String(s).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c]).replace(/\./g, '٫');

export const SIGNALS = {
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
function stockChecks(m, money) {
  const c = [];
  if (m.pe === null || m.eps <= 0) c.push('سودده نیست یا P/E ندارد؛ ارزش‌گذاری‌اش به آینده بستگی دارد');
  else if (m.sectorPE) c.push(`P/E ${fa(N(m.pe))} در برابر میانهٔ گروه ${fa(N(m.sectorPE))}${m.peRel > 1.3 ? '؛ گران‌تر از هم‌گروه‌ها' : m.peRel < 0.8 ? '؛ ارزان‌تر از هم‌گروه‌ها' : ''}`);
  else c.push(`P/E ${fa(N(m.pe))}`);
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
export function buildCards(radar, { depositPct = 25, money = (v) => String(Math.round(v)), max = 6 } = {}) {
  const day = radar.day; if (!day) return { day: null, cards: [], ready: 0, total: 0 };
  const D = dayNum(day);
  const sectors = sectorMedians(radar.stocks);
  const stocks = Object.entries(radar.stocks).map(([ins, rec]) => ({ ins, rec, m: stockMetrics(rec, D, sectors, radar.sess) }));
  const ready = stocks.filter((s) => !s.rec.need).length;
  const cards = [];
  const sname = (rec) => radar.sectors?.[rec.sector] || '';
  const push = (sig, s, why) => cards.push({ id: `s:${s.ins}`, sig, kind: 'stock', sym: s.rec.sym, name: s.rec.name, sub: [marketOf(s.rec.isin), sname(s.rec)].filter(Boolean).join('، '),
    ref: stockRef(s.ins, s.rec), why, check: stockChecks(s.m, money), m: s.m, ins: s.ins });
  const live = stocks.filter((s) => !s.rec.need && s.m.traded);
  // 1) momentum: the top tenth of liquid stocks by 12- and 3-month return (positive), best first
  const top = (key) => {
    const l = live.filter((s) => s.m.liquid && s.m[key] !== null);
    if (l.length < 20) return [];
    const sorted = l.slice().sort((a, b) => b.m[key] - a.m[key]);
    return sorted.slice(0, Math.max(1, Math.floor(l.length / 10))).filter((s) => s.m[key] > 0).map((s) => ({ s, rank: sorted.indexOf(s) + 1, of: l.length }));
  };
  const used = new Set();
  for (const { s, rank, of } of top('ret365').slice(0, max)) { used.add(s.ins); push('momentum12', s, [`بازدهی ۱۲ ماه ${fa(P(s.m.ret365))}؛ رتبهٔ ${fa(rank)} از ${fa(of)} نماد پرمعامله`, `۳ ماه ${fa(P(s.m.ret91))}، ۱ ماه ${fa(P(s.m.ret30))}`]); }
  for (const { s, rank, of } of top('ret91').filter((x) => !used.has(x.s.ins)).slice(0, max)) { used.add(s.ins); push('momentum3', s, [`بازدهی ۳ ماه ${fa(P(s.m.ret91))}؛ رتبهٔ ${fa(rank)} از ${fa(of)} نماد پرمعامله`, `۱ ماه ${fa(P(s.m.ret30))}${s.m.ret365 !== null ? `، ۱۲ ماه ${fa(P(s.m.ret365))}` : ''}`]); }
  // 2) unusual volume today (at least 3× its usual, and real money)
  live.filter((s) => s.m.volRatio >= 3 && s.rec.today?.val >= LIQ).sort((a, b) => b.m.volRatio - a.m.volRatio).slice(0, max)
    .forEach((s) => push('volume', s, [`حجم امروز ${fa(N(s.m.volRatio))} برابر حجم معمول (میانهٔ ۲۰ روز معاملهٔ قبلی)`, `ارزش معاملات امروز ${money(s.rec.today.val)}؛ تغییر قیمت امروز ${fa(P(s.m.dayChange, 1))}`]));
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
  const fpush = (sig, x, why) => cards.push({ id: `f:${x.f.key}`, sig, kind: 'fund', sym: x.f.symbol || '', name: x.f.name, sub: [FUND_KIND[x.f.fundType] || x.f.type, x.f.traded ? 'قابل معامله' : 'صدور و ابطالی'].filter(Boolean).join('، '),
    ref: fundRef(x.f), why, check: fundChecks(x.f, x.m, money), m: x.m, key: x.f.key });
  funds.filter((x) => x.m.bubble !== null && x.m.bubble <= -0.01 && x.m.tradable).sort((a, b) => a.m.bubble - b.m.bubble).slice(0, max)
    .forEach((x) => fpush('negBubble', x, [`قیمت پایانی ${fa(P0(x.m.bubble, 1))} کمتر از NAV ابطال همان روز (${fa(x.m.navDay.slice(5).replace('-', '/'))})`, 'یعنی آن روز هر واحد ارزان‌تر از ارزش دارایی‌هایش معامله شد؛ قیمت امروز را خودت ببین']));
  const gold = funds.filter((x) => x.m.gold && x.m.bubble !== null && x.m.tradable).sort((a, b) => a.m.bubble - b.m.bubble);
  // the three smallest bubbles (those under NAV already have their own card above)
  if (gold.length >= 3) gold.slice(0, 3).forEach((x, i) => { if (!(x.m.bubble <= -0.01)) fpush('goldBubble', x, [`حباب ${fa(P(x.m.bubble, 1))}؛ ${i === 0 ? 'کمترین' : `رتبهٔ ${fa(i + 1)}`} از ${fa(gold.length)} صندوق طلای پرمعامله`, 'بیشتر دارایی این صندوق‌ها طلا و گواهی سکه است؛ حباب کمتر یعنی بهای کمتری بالای ارزش دارایی‌ها']); });
  const depEff = Math.pow(1 + depositPct / 100 / 12, 12) - 1;
  funds.filter((x) => x.f.fundType === 4 && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 2e12 && x.m.y1 > depEff).sort((a, b) => b.m.y1 - a.m.y1).slice(0, max)
    .forEach((x) => fpush('fixedBeat', x, [`بازدهی ۱۲ ماه ${fa(P(x.m.y1, 1))} در برابر ${fa(P(depEff, 1))} سپرده ${fa(depositPct)}٪ با سود ماهانه`, `۳ ماه ${fa(P(x.m.m3, 1))}، ۱ ماه ${fa(P(x.m.m1, 1))}`]));
  for (const t of [6, 7, 5, 23, 21, 22]) {
    funds.filter((x) => x.f.fundType === t && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 1e12).sort((a, b) => b.m.y1 - a.m.y1).slice(0, 2)
      .forEach((x, i) => fpush('topFund', x, [`${i === 0 ? 'بیشترین' : 'دومین'} بازدهی ۱۲ ماه در صندوق‌های ${FUND_KIND[t]}: ${fa(P(x.m.y1))}`, `۳ ماه ${fa(P(x.m.m3))}، ۱ ماه ${fa(P(x.m.m1))}`]));
  }
  return { day, cards, ready, total: stocks.length, funds: funds.length };
}

/* ---------------------------------------- rules ---------------------------------------- */
// The owner's own filters: up to a few conditions, all must hold. Percent fields are entered and stored as percent.
export const FIELDS = {
  stock: {
    pe: { t: 'P/E', pct: false }, peRel: { t: 'P/E نسبت به میانهٔ گروه', pct: false }, ret30: { t: 'بازدهی ۱ ماه', pct: true }, ret91: { t: 'بازدهی ۳ ماه', pct: true },
    ret365: { t: 'بازدهی ۱۲ ماه', pct: true }, fromHigh: { t: 'فاصله از بالاترین سال', pct: true }, fromLow: { t: 'فاصله از کمترین سال', pct: true },
    volRatio: { t: 'حجم امروز ÷ میانگین', pct: false },
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
export function runRule(radar, rule) {
  if (!validRule(rule) || !radar.day) return [];
  const D = dayNum(radar.day);
  if (rule.kind === 'stock') {
    const sectors = sectorMedians(radar.stocks);
    return Object.entries(radar.stocks).filter(([, r]) => !r.need && (!rule.sector || r.sector === rule.sector))
      .map(([ins, rec]) => ({ ins, rec, m: ruleView(stockMetrics(rec, D, sectors, radar.sess)) })).filter((s) => s.m.liquid && s.m.traded && test('stock', s.m, rule.conds))
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
/** A stock's or fund's report card from the radar store, by TSETMC insCode or fund key. */
export function report(radar, { ins = null, fundKey = null } = {}) {
  if (!radar?.day) return null;
  const D = dayNum(radar.day);
  if (ins && radar.stocks?.[ins]) {
    const rec = radar.stocks[ins]; const m = stockMetrics(rec, D, sectorMedians(radar.stocks), radar.sess);
    return { kind: 'stock', day: radar.day, sym: rec.sym, name: rec.name, sector: radar.sectors?.[rec.sector] || '', market: marketOf(rec.isin), m, partial: !!rec.need };
  }
  const f = (radar.funds || []).find((x) => (fundKey && x.key === fundKey) || (ins && x.insCode === ins));
  if (!f) return null;
  const m = fundMetrics(f, radar, D);
  const peers = (radar.funds || []).filter((x) => x.fundType === f.fundType && isFinite(x.ret?.y1) && x.since && D - dayNum(x.since) >= 365);
  const better = peers.filter((x) => x.ret.y1 > (f.ret?.y1 ?? -Infinity)).length;
  return { kind: 'fund', day: radar.day, sym: f.symbol, name: f.name, type: FUND_KIND[f.fundType] || f.type, m, mix: f.mix, nav: f.cancelNav, navDay: m.navDay, size: f.size,
    rank: isFinite(f.ret?.y1) && peers.length && m.ageDays >= 365 ? { pos: better + 1, of: peers.length } : null };
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
