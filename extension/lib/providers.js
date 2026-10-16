// Market data providers. Prices are Rial, except tgju indicators flagged `usd` (USD).
// Quote: { price, change, changePct (fraction), at (ms, time the price is for), asOf, source, approx?, usd? }
import { TGJU_BY_KEY, NOBITEX, NOBITEX_BY_KEY } from './catalog.js';

const TIMEOUT = 15000;
let _fetch = (...a) => fetch(...a);
export function setFetch(f) { _fetch = f; }

export async function getJSON(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeout || TIMEOUT);
  try {
    const r = await _fetch(url, { cache: 'no-store', credentials: 'omit', ...init, signal: ctl.signal, headers: { Accept: 'application/json, text/plain, */*', ...(init.headers || {}) } });
    if (!r.ok) throw new Error(r.status === 403 ? 'دسترسی مسدود است (۴۰۳) — احتمالاً به خاطر VPN یا IP خارج از ایران' : `خطای سرور (${r.status})`);
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error('پاسخ نامعتبر از سرور'); }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('مهلت اتصال تمام شد');
    if (e instanceof TypeError) throw new Error('اتصال برقرار نشد');
    throw e;
  } finally { clearTimeout(t); }
}

const n = (s) => {
  if (s === null || s === undefined) return NaN;
  if (typeof s === 'number') return s;
  return parseFloat(String(s).replace(/<[^>]*>/g, '').replace(/[,٬\s%]/g, ''));
};
const arabicize = (s) => String(s).replace(/ی/g, 'ي').replace(/ک/g, 'ك');
export const persianize = (s) => String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').trim();

export const quoteId = (ref) => `${ref.provider}:${ref.key}${ref.field ? ':' + ref.field : ''}`;
export const isUsdRef = (ref) => !!ref && ref.provider === 'tgju' && !!TGJU_BY_KEY[ref.key]?.usd;

/** End of a Tehran calendar day ("2026/09/30" or "2026-09-30") in ms */
function tehranDayEnd(d) {
  const iso = String(d).replace(/\//g, '-').slice(0, 10);
  const t = new Date(iso + 'T23:59:00+03:30').getTime();
  return isNaN(t) ? undefined : Math.min(t, Date.now()); // no date: left out, so the fetch time stands in (never «now» by default)
}
/** The older of the times that are known (a price built from two is as old as the older); undefined when none is. */
const oldestAt = (...ts) => { const k = ts.filter((t) => t > 0); return k.length ? Math.min(...k) : undefined; };
function tehranTs(ts) {
  if (!ts) return undefined;
  const d = new Date(String(ts).replace(' ', 'T') + '+03:30');
  return isNaN(d) ? undefined : Math.min(d.getTime(), Date.now());
}

/* ------------------------------ tgju ------------------------------ */
// Live board: https://call1.tgju.org/ajax.json -> { current: { key: {p, d, dp, dt, ts} } }
// Daily table: https://api.tgju.org/v1/market/indicator/summary-table-data/{key}?length=N
//   -> { data: [[open, low, high, close, change, changePct, gDate, jDate], ...] } newest first
/** keys in `boardOnly` are taken from the live board when it has them, and otherwise skipped (no per-key request). */
export async function tgjuQuotes(keys, boardOnly = new Set()) {
  const out = {}; const errors = {};
  let board = null;
  try { board = (await getJSON('https://call1.tgju.org/ajax.json')).current || null; } catch (e) { errors._board = e.message; }
  const missing = [];
  for (const k of keys) {
    const it = board && board[k];
    if (it && n(it.p) > 0) {
      const sign = it.dt === 'low' ? -1 : 1;
      out[k] = { price: n(it.p), change: sign * Math.abs(n(it.d) || 0), changePct: sign * Math.abs(n(it.dp) || 0) / 100,
        at: tehranTs(it.ts), asOf: it.ts || '', source: 'tgju', usd: !!TGJU_BY_KEY[k]?.usd };
    } else if (!boardOnly.has(k)) missing.push(k);
  }
  await Promise.all(missing.map(async (k) => {
    try {
      const rows = await tgjuHistory(k, 2);
      if (!rows.length) throw new Error('داده‌ای برای این شاخص نیست');
      const last = rows[rows.length - 1];
      out[k] = { price: last.close, change: last.change, changePct: last.changePct, at: tehranDayEnd(last.date), asOf: last.date, source: 'tgju', daily: true, usd: !!TGJU_BY_KEY[k]?.usd || k.startsWith('crypto-') };
    } catch (e) { errors[k] = e.message; }
  }));
  return { quotes: out, errors };
}

/** Daily history ascending: [{date (ISO), close, change, changePct}] */
export async function tgjuHistory(key, limit = 60) {
  const j = await getJSON(`https://api.tgju.org/v1/market/indicator/summary-table-data/${encodeURIComponent(key)}?length=${limit}`);
  const rows = (j.data || []).map((r) => {
    const sign = /class=["']low["']/.test(String(r[4] ?? '')) ? -1 : 1;
    return { date: String(r[6] || '').replace(/\//g, '-'), close: n(r[3]), change: sign * Math.abs(n(r[4]) || 0), changePct: sign * Math.abs(n(r[5]) || 0) / 100 };
  }).filter((r) => r.close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows.slice(-limit);
}

/* ------------------------------ nobitex (+ tgju fallback) ------------------------------ */
// Docs: POST https://api.nobitex.ir/market/stats  srcCurrency=btc,usdt  dstCurrency=rls
function parseNobitex(j, keys) {
  const out = {}; const errors = {};
  const st = j?.stats || {};
  for (const k of keys) {
    const s = st[`${k}-rls`];
    const price = n(s?.latest);
    if (price > 0 && !s.isClosed) {
      const p = n(s.dayChange) / 100;
      out[k] = { price, changePct: isFinite(p) ? p : 0, change: isFinite(p) ? price - price / (1 + p) : 0, at: Date.now(), source: 'nobitex' };
    } else errors[k] = 'این رمزارز در نوبیتکس پیدا نشد';
  }
  return { quotes: out, errors };
}
export async function nobitexQuotes(keys) {
  if (!keys.length) return { quotes: {}, errors: {} };
  const qs = `srcCurrency=${keys.join(',')}&dstCurrency=rls`;
  let lastErr;
  for (const attempt of ['post', 'get']) {
    try {
      const j = attempt === 'post'
        ? await getJSON('https://api.nobitex.ir/market/stats', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs })
        : await getJSON(`https://api.nobitex.ir/market/stats?${qs}`);
      if (j?.status && j.status !== 'ok') throw new Error(j.message || 'پاسخ ناموفق از نوبیتکس');
      return parseNobitex(j, keys);
    } catch (e) { lastErr = e; }
  }
  const errors = {}; for (const k of keys) errors[k] = 'نوبیتکس: ' + lastErr.message;
  return { quotes: {}, errors };
}

const cryptoMeta = (r) => ({ tgju: r.tgju || NOBITEX_BY_KEY[r.key]?.tgju, cg: r.cg || NOBITEX_BY_KEY[r.key]?.cg });

/** Crypto via tgju: USD price × dollar rate (works outside Iran too). refs: [{key, tgju?}] */
export async function cryptoViaTgju(refs, usdQuote) {
  const out = {}; const errors = {};
  if (!usdQuote?.price) { for (const r of refs) errors[r.key] = 'نرخ دلار برای تبدیل در دسترس نیست'; return { quotes: out, errors }; }
  await Promise.all(refs.map(async (r) => {
    const slug = cryptoMeta(r).tgju;
    if (!slug) { errors[r.key] = 'منبع پشتیبان tgju برای این رمزارز نیست'; return; }
    try {
      const rows = await tgjuHistory(slug, 2);
      const last = rows[rows.length - 1];
      if (!last) throw new Error('داده‌ای نیست');
      const cp = (1 + last.changePct) * (1 + (usdQuote.changePct || 0)) - 1;
      const price = last.close * usdQuote.price;
      out[r.key] = { price, usdPrice: last.close, changePct: cp, change: price - price / (1 + cp), at: oldestAt(tehranDayEnd(last.date), usdQuote.at), asOf: last.date, source: 'tgju', approx: true };
    } catch (e) { errors[r.key] = e.message; }
  }));
  return { quotes: out, errors };
}

/* ------------------------------ CoinGecko (global fallback, any coin) ------------------------------ */
// Price:  /api/v3/simple/price?ids=a,b&vs_currencies=usd&include_24hr_change=true -> { id: { usd, usd_24h_change } }
// Search: /api/v3/search?query=q -> { coins: [{ id, name, symbol, market_cap_rank }] }
// Daily:  /api/v3/coins/{id}/market_chart?vs_currency=usd&days=N&interval=daily -> { prices: [[ms, usd]] }
const CG = 'https://api.coingecko.com/api/v3';
export async function cryptoViaCoingecko(refs, usdQuote) {
  const out = {}; const errors = {};
  if (!usdQuote?.price) { for (const r of refs) errors[r.key] = 'نرخ دلار برای تبدیل در دسترس نیست'; return { quotes: out, errors }; }
  const ids = [...new Set(refs.map((r) => cryptoMeta(r).cg).filter(Boolean))];
  for (const r of refs) if (!cryptoMeta(r).cg) errors[r.key] = 'این رمزارز منبع پشتیبان ندارد';
  if (!ids.length) return { quotes: out, errors };
  try {
    const j = await getJSON(`${CG}/simple/price?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=usd&include_24hr_change=true`);
    for (const r of refs) {
      const id = cryptoMeta(r).cg; if (!id) continue;
      const row = j?.[id]; const usd = n(row?.usd);
      if (!(usd > 0)) { errors[r.key] = 'در CoinGecko پیدا نشد'; continue; }
      const p = n(row.usd_24h_change) / 100;
      const cp = (1 + (isFinite(p) ? p : 0)) * (1 + (usdQuote.changePct || 0)) - 1;
      const price = usd * usdQuote.price;
      out[r.key] = { price, usdPrice: usd, changePct: cp, change: price - price / (1 + cp), at: oldestAt(Date.now(), usdQuote.at), source: 'coingecko', approx: true };
    }
  } catch (e) { for (const r of refs) if (cryptoMeta(r).cg) errors[r.key] = 'CoinGecko: ' + e.message; }
  return { quotes: out, errors };
}
export async function coingeckoHistory(id, days = 365) {
  const j = await getJSON(`${CG}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${Math.min(days, 365)}&interval=daily`);
  const byDay = new Map();
  for (const [ms, usd] of j?.prices || []) if (usd > 0) byDay.set(new Date(ms + 3.5 * 3600000).toISOString().slice(0, 10), usd);
  return [...byDay].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Coin search: catalog first (Persian names), then CoinGecko for everything else. */
export async function cryptoSearch(q) {
  const t = String(q || '').trim().toLowerCase();
  const local = NOBITEX.filter((c) => !t || c.key.includes(t) || c.sym.toLowerCase().includes(t) || c.name.includes(q.trim()) || (c.cg || '').includes(t))
    .map((c) => ({ key: c.key, sym: c.sym, name: c.name, cg: c.cg, tgju: c.tgju, catalog: true }));
  if (!t || /[\u0600-\u06FF]/.test(t)) return { items: local, error: null };
  let remote = []; let error = null;
  try {
    const j = await getJSON(`${CG}/search?query=${encodeURIComponent(t)}`);
    remote = (j?.coins || []).slice(0, 20).map((c) => ({ key: String(c.symbol || '').toLowerCase(), sym: String(c.symbol || '').toUpperCase(), name: c.name, cg: c.id, rank: c.market_cap_rank }))
      .filter((c) => c.key && !local.some((l) => l.cg === c.cg));
  } catch (e) { error = e.message; }
  return { items: [...local, ...remote], error };
}

/* ------------------------------ TSETMC ------------------------------ */
// Search:  /api/Instrument/GetInstrumentSearch/{q} -> { instrumentSearch: [...] }
// Price:   /api/ClosingPrice/GetClosingPriceInfo/{insCode} -> { closingPriceInfo: { pClosing, pDrCotVal, priceYesterday, dEven, hEven } }
// Daily:   /api/ClosingPrice/GetClosingPriceDailyList/{insCode}/{n} -> { closingPriceDaily: [{ pClosing, dEven, hEven }] }
// ETF NAV: /api/Fund/GetETFByInsCode/{insCode} -> { etf: { pRedTran, pSubTran } }
export async function tsetmcSearch(q) {
  const j = await getJSON(`https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/${encodeURIComponent(arabicize(q.trim()))}`);
  return (j.instrumentSearch || []).map((it) => ({
    insCode: String(it.insCode), symbol: persianize(it.lVal18AFC), name: persianize(it.lVal30),
    lastDate: it.lastDate || 0, market: persianize(it.flowTitle || ''), active: !!it.lastDate,
  })).sort((a, b) => (b.lastDate || 0) - (a.lastDate || 0));
}
const symKey = (s) => persianize(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\s+/g, '');
export async function tsetmcResolve(symbol) {
  const target = symKey(symbol);
  // Search with the symbol as typed; if nothing, retry with Persian digits (a ticker ending in 2 typed with Latin digits → Persian digits).
  for (const q of new Set([String(symbol), String(symbol).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])])) {
    const list = await tsetmcSearch(q);
    const hit = list.find((x) => symKey(x.symbol) === target && x.active) || list.find((x) => symKey(x.symbol) === target);
    if (hit) return hit;
  }
  return null;
}
function tseDate(dEven, hEven) {
  if (!dEven) return { at: undefined, asOf: '' };
  const s = String(dEven); const h = String(hEven || 0).padStart(6, '0');
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}+03:30`);
  return { at: isNaN(d) ? undefined : Math.min(d.getTime(), Date.now()), asOf: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` };
}
export async function tsetmcQuote(insCode, field = 'close') {
  if (field === 'nav') {
    const j = await getJSON(`https://cdn.tsetmc.com/api/Fund/GetETFByInsCode/${encodeURIComponent(insCode)}`);
    const e = j.etf || {};
    const price = n(e.pRedTran);
    if (!(price > 0)) throw new Error('NAV ابطال در دسترس نیست');
    return { price, change: 0, changePct: 0, ...tseDate(e.deven, e.hEven), source: 'tsetmc' };
  }
  const j = await getJSON(`https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/${encodeURIComponent(insCode)}`);
  const c = j.closingPriceInfo || {};
  const price = field === 'last' ? n(c.pDrCotVal) : n(c.pClosing);
  if (!(price > 0)) throw new Error('قیمتی برای این نماد ثبت نشده');
  const y = n(c.priceYesterday);
  return { price, change: y > 0 ? price - y : 0, changePct: y > 0 ? (price - y) / y : 0, ...tseDate(c.dEven, c.hEven), source: 'tsetmc' };
}
/**
 * Daily rows (newest first, as TSETMC sends them) → ascending [{date, close, raw, vol, val, py}] with closes ADJUSTED for
 * capital increases and dividends: on the day after such an event TSETMC's «priceYesterday» is the adjusted base, not the
 * previous close, so every earlier close is scaled by priceYesterday ÷ previous close. Without this a 100% capital
 * increase would look like a 50% fall. The latest close is never changed.
 */
export function adjustDaily(rows) {
  // Days without a single trade carry no price (and TSETMC fills days before a listing with a nominal 1000): drop them.
  // A halted stock's next traded day still has the right «priceYesterday», so an event during the halt is still caught.
  const noTrade = (r) => { const t = r.zTotTran ?? r.qTotTran5J; return t !== undefined && t !== null && !(+t > 0); };
  const list = (rows || []).filter((r) => !noTrade(r))
    .map((r) => ({ date: tseDate(r.dEven).asOf, raw: n(r.pClosing), py: n(r.priceYesterday), vol: n(r.qTotTran5J) || 0, val: n(r.qTotCap) || 0 }))
    .filter((r) => r.raw > 0 && r.date).sort((a, b) => b.date.localeCompare(a.date));
  let f = 1;
  for (let i = 0; i < list.length; i++) {
    list[i].close = list[i].raw * f;
    const older = list[i + 1];
    if (older && list[i].py > 0 && Math.abs(list[i].py / older.raw - 1) > 0.0005) f *= list[i].py / older.raw;
  }
  const out = list.reverse();
  // the newest day the list covers, traded or not: a stock is «checked through» that day even if it didn't trade
  out.through = (rows || []).reduce((m, r) => { const d = r?.dEven ? tseDate(r.dEven).asOf : ''; return d > m ? d : m; }, '') || null;
  return out;
}
export async function tsetmcDaily(insCode, limit = 400, { allowEmpty = false } = {}) {
  const j = await getJSON(`https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/${encodeURIComponent(insCode)}/${Math.max(1, Math.round(+limit) || 400)}`, { timeout: 20000 });
  if (!allowEmpty && (!Array.isArray(j?.closingPriceDaily) || !j.closingPriceDaily.length)) throw new Error('سابقهٔ قیمت این نماد خالی آمد');
  return adjustDaily(j.closingPriceDaily);
}
/** Real (unadjusted) closes of traded days — what a holding was actually worth; the radar uses tsetmcDaily's adjusted ones. */
export async function tsetmcHistory(insCode, limit = 400) {
  return (await tsetmcDaily(insCode, limit, { allowEmpty: true })).map((r) => ({ date: r.date, close: r.raw }));
}
/** The whole market in one request: stocks (1), the base market (2) and exchange-traded funds (8). Raw rows. */
export async function tsetmcMarketWatch(types = [1, 2, 8]) {
  const q = types.map((t, i) => `paperTypes%5B${i}%5D=${t}`).join('&');
  const j = await getJSON(`https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&${q}&showTraded=false&withBestLimits=false`, { timeout: 30000 });
  if (!Array.isArray(j?.marketwatch)) throw new Error('دیده‌بان بورس پاسخ نداد');
  return j.marketwatch;
}
/** The day of the latest trading session (from the main index's intraday list): 'YYYY-MM-DD' and the time of its last point. */
export async function tsetmcSessionDay() {
  const j = await getJSON('https://cdn.tsetmc.com/api/Index/GetIndexB1LastDay/32097828799138957');
  const l = (j?.indexB1 || []).filter((x) => x.dEven);
  if (!l.length) throw new Error('تاریخ آخرین جلسه بورس معلوم نشد');
  const last = l.reduce((a, b) => (b.dEven > a.dEven || (b.dEven === a.dEven && b.hEven > a.hEven) ? b : a));
  return { day: tseDate(last.dEven).asOf, hEven: last.hEven };
}
/** Instrument details: estimated EPS, the sector's P/E, 52-week range (unadjusted), shares, market name. */
export async function tsetmcInstrumentInfo(insCode) {
  const j = await getJSON(`https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/${encodeURIComponent(insCode)}`);
  const i = j?.instrumentInfo;
  if (!i) throw new Error('اطلاعات نماد پیدا نشد');
  return { insCode: String(i.insCode), symbol: persianize(i.lVal18AFC), name: persianize(i.lVal30), eps: n(i.eps?.estimatedEPS ?? i.eps?.epsValue),
    sectorPE: n(i.eps?.sectorPE), sector: persianize(i.sector?.lSecVal || ''), sectorCode: String(i.sector?.cSecVal || '').trim(),
    minYear: n(i.minYear), maxYear: n(i.maxYear), avgVol: n(i.qTotTran5JAvg), shares: n(i.zTitad), market: persianize(i.cgrValCotTitle || i.flowTitle || '') };
}
export async function tsetmcQuotes(refs) {
  const out = {}; const errors = {};
  await Promise.all(refs.map(async (r) => {
    const id = `${r.key}${r.field ? ':' + r.field : ''}`;
    try { out[id] = await tsetmcQuote(r.key, r.field); } catch (e) { errors[id] = e.message; }
  }));
  return { quotes: out, errors };
}

/* ------------------------------ Fipiran (mutual funds NAV) ------------------------------ */
// The old host (fund.fipiran.ir) is gone. The fund list now comes from a POST to www.fipiran.com/services
// (a GET answers 405). One registration number can cover several share classes of an umbrella fund, each
// with its own name and NAV, so a fund's key is its regNo when that is unique, else regNo + a hash of its name.
export const FIPIRAN_FUNDS_URL = 'https://www.fipiran.com/services/fund/fundcompare';
let fundCache = { at: 0, items: [] };
export const FUND_TYPES = {
  4: 'درآمد ثابت', 5: 'کالایی', 6: 'سهامی', 7: 'مختلط', 11: 'بازارگردانی', 12: 'جسورانه', 13: 'پروژه', 14: 'زمین و ساختمان',
  16: 'خصوصی', 17: 'صندوق در صندوق', 18: 'املاک و مستغلات', 21: 'بخشی', 22: 'اهرمی', 23: 'شاخصی', 24: 'تضمین اصل سرمایه', 25: 'بازنشستگی',
};
const fundName = (s) => persianize(String(s ?? '').replace(/<[^>]*>/g, '').replace(/^[>\s]+/, '')).replace(/\s+/g, ' ');
const squash = (s) => fundName(s).replace(/[\s\-–_()]/g, '');
function hash36(s) { let h = 5381; for (const ch of s) h = (Math.imul(h, 33) ^ ch.codePointAt(0)) >>> 0; return h.toString(36); }
export const fundKey = (regNo, name, shared) => (shared ? `${regNo}-${hash36(squash(name))}` : String(regNo));

/** Raw API items → [{key, regNo, name, type, cancelNav, issueNav, statisticalNav, date, annual, symbol, size}] */
export function parseFunds(raw) {
  const rows = (Array.isArray(raw) ? raw : raw?.items || []).filter((f) => f && f.regNo != null && f.name);
  const count = {};
  for (const f of rows) count[f.regNo] = (count[f.regNo] || 0) + 1;
  const byKey = new Map();
  for (const f of rows) {
    const name = fundName(f.name); const regNo = String(f.regNo);
    const it = { key: fundKey(regNo, name, count[f.regNo] > 1), regNo, name, type: FUND_TYPES[f.fundType] || '', fundType: f.fundType,
      cancelNav: n(f.cancelNav), issueNav: n(f.issueNav), statisticalNav: n(f.statisticalNav), date: f.date || '',
      annual: n(f.annualEfficiency), symbol: persianize(f.smallSymbolName || ''), size: n(f.netAsset) || n(f.fundSize) || 0,
      // returns are percent over each period (as Fipiran publishes them); insCode links an exchange-traded fund to TSETMC
      ret: { d1: n(f.dailyEfficiency), w1: n(f.weeklyEfficiency), m1: n(f.monthlyEfficiency), m3: n(f.quarterlyEfficiency), m6: n(f.sixMonthEfficiency), y1: n(f.annualEfficiency) },
      since: String(f.initiationDate || '').slice(0, 10), traded: f.typeOfInvest === 'Negotiable', insCode: f.insCode ? String(f.insCode) : '',
      mix: { stock: n(f.stock), bond: n(f.bond), deposit: n(f.deposit), cash: n(f.cash), other: n(f.other) }, manager: persianize(f.manager || '') };
    const prev = byKey.get(it.key); // the same fund listed twice: keep the newer NAV
    if (!prev || (!(prev.cancelNav > 0) && it.cancelNav > 0) || String(it.date) > String(prev.date)) byKey.set(it.key, it);
  }
  return [...byKey.values()];
}

/** maxAge: how old (ms) a cached list may be. NAVs change once a day, so a few minutes is plenty. */
export async function fipiranFunds(maxAge = 30 * 60 * 1000) {
  if (fundCache.items.length && Date.now() - fundCache.at < maxAge) return fundCache.items;
  const ask = (timeout) => getJSON(FIPIRAN_FUNDS_URL, { method: 'POST', timeout, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regNos: [], showMarketMakers: false }) });
  // Fipiran is sometimes slow for a while (the list is ~0.5 MB): one more, longer try before giving up
  let j;
  try { j = await ask(25000); } catch (e) { if (!/مهلت|اتصال/.test(e.message)) throw e; j = await ask(45000); }
  const items = parseFunds(j);
  if (!items.length) throw new Error('فهرست صندوق‌ها خالی برگشت');
  fundCache = { at: Date.now(), items };
  return items;
}

/** Fund search over name, symbol and registration number; spaces, half-spaces and Arabic letters don't matter. */
export function searchFunds(items, q) {
  const t = squash(q);
  const list = !t ? items : items.filter((f) => squash(f.name).includes(t) || (f.symbol && squash(f.symbol).includes(t)) || f.regNo === t);
  return list.slice().sort((a, b) => (b.cancelNav > 0) - (a.cancelNav > 0) || b.size - a.size).slice(0, t ? 60 : 30);
}
export async function fipiranSearch(q) { return searchFunds(await fipiranFunds(), q); }

/** The fund a saved ref points at. Older refs hold only the regNo; for an umbrella fund the saved name picks the class. */
export function findFund(items, ref) {
  const key = String(ref?.key ?? '');
  const exact = items.find((x) => x.key === key);
  if (exact) return exact;
  const same = items.filter((x) => x.regNo === key.split('-')[0]);
  if (same.length <= 1) return same[0] || null;
  const want = squash(ref.name || ref.label || '');
  if (!want) return null;
  return same.find((x) => squash(x.name) === want) || same.find((x) => { const s = squash(x.name); return s.includes(want) || want.includes(s); }) || null;
}

export async function fipiranQuotes(refs) {
  const out = {}; const errors = {};
  if (!refs.length) return { quotes: out, errors };
  const idOf = (r) => `${r.key}${r.field ? ':' + r.field : ''}`;
  try {
    const items = await fipiranFunds(10 * 60 * 1000);
    for (const r of refs) {
      const f = findFund(items, r);
      const price = f && f[r.field || 'cancelNav'];
      if (price > 0) {
        const day = String(f.date || '').slice(0, 10);
        out[idOf(r)] = { price, change: 0, changePct: 0, at: day ? tehranDayEnd(day) : undefined, asOf: day, source: 'fipiran' };
      } else if (f) errors[idOf(r)] = 'فیپیران برای این صندوق قیمتی اعلام نکرده';
      else errors[idOf(r)] = items.some((x) => x.regNo === String(r.key).split('-')[0])
        ? 'این شماره ثبت چند صندوق دارد؛ صندوق را یک بار دیگر از فهرست انتخاب کن'
        : 'صندوق در فهرست فیپیران پیدا نشد';
    }
  } catch (e) { for (const r of refs) errors[idOf(r)] = e.message; }
  return { quotes: out, errors };
}

/* ------------------------------ Orchestrator ------------------------------ */
/** Fetch all refs. Returns { quotes: {quoteId: quote}, errors: {quoteId: msg} } */
export async function fetchAll(refs, enabled = {}) {
  const groups = {}; const seen = new Set();
  for (const r of refs) {
    if (!r || !r.provider || !r.key) continue;
    const id = quoteId(r);
    if (seen.has(id)) continue; seen.add(id);
    if (enabled[r.provider] === false) continue;
    (groups[r.provider] ||= []).push(r);
  }
  // crypto fallback needs the dollar rate
  if (groups.nobitex && enabled.tgju !== false && !seen.has('tgju:price_dollar_rl')) (groups.tgju ||= []).push({ provider: 'tgju', key: 'price_dollar_rl' });
  const quotes = {}; const errors = {};
  const merge = (prov, res) => {
    for (const [k, v] of Object.entries(res.quotes)) { quotes[`${prov}:${k}`] = v; delete errors[`${prov}:${k}`]; }
    for (const [k, v] of Object.entries(res.errors)) if (k !== '_board' && !quotes[`${prov}:${k}`]) errors[`${prov}:${k}`] = v;
  };
  const jobs = [];
  if (groups.tgju) jobs.push(tgjuQuotes(groups.tgju.map((r) => r.key), new Set(groups.tgju.filter((r) => r.boardOnly).map((r) => r.key))).then((r) => merge('tgju', r)));
  if (groups.nobitex) {
    // Catalog coins in one request; coins added from search go separately so one unknown symbol can't fail the rest.
    const known = groups.nobitex.filter((r) => NOBITEX_BY_KEY[r.key]).map((r) => r.key);
    const extra = groups.nobitex.filter((r) => !NOBITEX_BY_KEY[r.key]).map((r) => r.key);
    if (known.length) jobs.push(nobitexQuotes(known).then((r) => merge('nobitex', r)));
    if (extra.length) jobs.push(nobitexQuotes(extra).then((r) => merge('nobitex', r)));
  }
  if (groups.tsetmc) jobs.push(tsetmcQuotes(groups.tsetmc).then((r) => merge('tsetmc', r)));
  if (groups.fipiran) jobs.push(fipiranQuotes(groups.fipiran).then((r) => merge('fipiran', r)));
  await Promise.allSettled(jobs);
  // Crypto fallback: anything Nobitex couldn't price → tgju USD × dollar → CoinGecko USD × dollar
  const usdQ = quotes['tgju:price_dollar_rl'];
  for (const via of [cryptoViaTgju, cryptoViaCoingecko]) {
    const failed = (groups.nobitex || []).filter((r) => !quotes[`nobitex:${r.key}`]);
    if (!failed.length || enabled.tgju === false) break;
    try {
      const res = await via(failed, usdQ);
      for (const [k, v] of Object.entries(res.quotes)) {
        quotes[`nobitex:${k}`] = { ...v, note: 'نوبیتکس در دسترس نبود؛ قیمت جهانی × نرخ دلار' };
        delete errors[`nobitex:${k}`];
      }
    } catch { /* next source */ }
  }
  return { quotes, errors };
}

/* ------------------------------ History (for charts & backfill) ------------------------------ */
/** The Tehran total index (TEDPIX, dividends included), daily, ascending: [{date, close}] for the last `days`. */
export async function tsetmcIndexHistory(days = 400) {
  const j = await getJSON('https://cdn.tsetmc.com/api/Index/GetIndexB2History/32097828799138957', { timeout: 30000 });
  const rows = (j?.indexB2 || []).map((x) => { const e = String(x.dEven); return { date: `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`, close: +x.xNivInuClMresIbs }; })
    .filter((r) => r.close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).sort((a, b) => a.date.localeCompare(b.date));
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= from);
}

/** [{date, close}] ascending; close in the ref's native unit (Rial, or USD for usd refs). */
export async function refHistory(ref, days = 400) {
  if (ref.provider === 'tgju') return tgjuHistory(ref.key, days);
  if (ref.provider === 'tsetmc' && ref.key === 'index') return tsetmcIndexHistory(days);
  if (ref.provider === 'tsetmc' && ref.key) return tsetmcHistory(ref.key, days);
  if (ref.provider === 'nobitex') {
    const { tgju: slug, cg } = cryptoMeta(ref);
    if (!slug && !cg) return [];
    let c = [];
    if (slug) { try { c = await tgjuHistory(slug, days); } catch { c = []; } }
    if (!c.length && cg) c = await coingeckoHistory(cg, days);
    const usd = await tgjuHistory('price_dollar_rl', days);
    const um = new Map(usd.map((r) => [r.date, r.close]));
    let lastUsd = null; const out = [];
    const all = [...new Set([...c.map((r) => r.date), ...usd.map((r) => r.date)])].sort();
    const cm = new Map(c.map((r) => [r.date, r.close]));
    let lastC = null;
    for (const d of all) { if (um.has(d)) lastUsd = um.get(d); if (cm.has(d)) lastC = cm.get(d); if (lastUsd && lastC && cm.has(d)) out.push({ date: d, close: lastC * lastUsd }); }
    return out;
  }
  return [];
}
