// «سبد مدل»: one diversified model portfolio at the top of the radar, for each risk level — a core of broad, cheap
// instruments (a fixed-income fund, a low-premium gold fund, an equity fund, dollar and bitcoin where the level allows)
// and a satellite of a few radar candidates from different sectors, with a cap on each.
//
// Rules, not an optimiser: the split between parts is the risk level's mix (profile.MIX), and each instrument is picked
// by a stated rule. Picks are kept until clearly worse (under the price that undoes them, a severe red flag, no longer
// eligible), so the model doesn't churn. Each scan's model is logged with prices, to report what it really did.
// It is a model, not advice: the page says so, and the choice stays with the owner.
import * as RD from './radar.js';
import * as PR from './profile.js';
import * as PB from './builder.js';
import { pct } from './format.js';

export const LEVELS = ['low', 'mid', 'high'];
export const SAT = { low: 0.25, mid: 0.4, high: 0.5 }; // share of the stock-market part in single stocks
export const MAX_STOCK = 0.08, MAX_STOCKS = 3;
export const SPLIT_AT = 0.2;                           // a part this large is split between two instruments
export const LOG_EVERY_DAYS = 7;
export const PROVEN_DAYS = 60;                        // «آزمایشی» until its own record is this long
export const ROLE = { deposit: 'ستون ثابت', gold: 'محافظ تورم', bourse: 'سهم بازار', usd: 'محافظ ارزی', btc: 'بخش پرریسک', sat: 'موتور رشد' };
// rough round-trip costs of getting in (percent of the money), for the «هزینهٔ خرید» line
const COST = { stock: 0.6, etf: 0.3, fund: 0, fx: 1.5, crypto: 0.5, deposit: 0, coin: 2.5 };
const P = (x, d = 0) => pct(x, { digits: d });
const P0 = (x, d = 0) => pct(x, { sign: false, digits: d });

/** The money split between the parts for a level: { deposit, gold, usd, bourse, btc } summing to 1. */
export function blockWeights(level, noCrypto = false) { return PB.mixWeights(PR.mixFor(level, noCrypto)); }

/** Funds that qualify for each part, best first (by the rule each part states). */
function fundLists(radar, depositPct) {
  const D = RD.dayNum(radar.day);
  const all = (radar.funds || []).map((f) => ({ f, m: RD.fundMetrics(f, radar, D) }));
  const depEff = Math.pow(1 + depositPct / 1200, 12) - 1;
  return {
    // fixed income: a year old at least, large, and ahead of a deposit over 12 months
    fixed: all.filter((x) => x.f.fundType === 4 && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 2e12 && x.m.y1 > depEff).sort((a, b) => b.m.y1 - a.m.y1),
    // gold: traded, with today's premium over its NAV known — the lowest first
    gold: all.filter((x) => x.m.gold && x.m.bubble !== null && x.m.tradable).sort((a, b) => a.m.bubble - b.m.bubble),
    // equity: index or stock funds a year old and large; traded ones (a market price, cash in a day) first
    equity: all.filter((x) => (x.f.fundType === 6 || x.f.fundType === 23) && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 1e12)
      .sort((a, b) => (b.f.traded ? 1 : 0) - (a.f.traded ? 1 : 0) || b.m.y1 - a.m.y1),
    depEff,
  };
}
const fundItem = (x, block, w, role, why, kept) => ({ id: `f:${x.f.key}`, kind: x.f.traded ? 'etf' : 'fund', block, role, w, kept,
  name: x.f.name, sym: x.f.symbol || '', manager: x.f.manager || '', ref: x.f.insCode ? { provider: 'tsetmc', key: x.f.insCode, symbol: x.f.symbol, label: x.f.symbol || x.f.name } : { provider: 'fipiran', key: x.f.key, label: x.f.name },
  facts: { y1: x.m.y1, bubble: x.m.bubble, size: x.m.size }, why, flags: [], liq: x.f.traded ? 'یک روز کاری' : 'چند روز کاری (ابطال)' });

/** Up to n from a list, keeping last time's picks while they are still eligible and near the top; distinct by key(). */
function pick(list, prevIds, n, idOf, key = () => null, near = n + 2) {
  const out = []; const used = new Set();
  const ok = (x) => { const k = key(x); return k === null || !used.has(k); };
  const add = (x, kept) => { out.push({ x, kept }); const k = key(x); if (k !== null) used.add(k); };
  for (const x of list.slice(0, near)) if (out.length < n && prevIds.has(idOf(x)) && ok(x)) add(x, true);
  for (const x of list) { if (out.length >= n) break; if (!out.some((o) => o.x === x) && ok(x)) add(x, false); }
  return out;
}

/**
 * The model for one level. built: RD.buildCards() of the same scan (its candidates). prev: the last model for this level
 * ({ day, items }) — its picks are kept while they hold. quotes: for the dollar and bitcoin lines. Returns { level, day,
 * items, blocks, notes, changes } or null when the radar has no scan.
 */
export function buildModel(radar, built, level = 'mid', { prev = null, depositPct = 25, noCrypto = false } = {}) {
  if (!radar?.day || !LEVELS.includes(level)) return null;
  const D = RD.dayNum(radar.day);
  const bw = blockWeights(level, noCrypto);
  const L = fundLists(radar, depositPct);
  const prevIds = new Set((prev?.items || []).map((i) => i.id));
  const items = []; const notes = [];
  const split = (w) => (w >= SPLIT_AT ? 2 : 1);
  // 1) the fixed part: fixed-income funds from different managers, else a bank deposit
  if (bw.deposit > 0) {
    const got = pick(L.fixed, prevIds, split(bw.deposit), (x) => `f:${x.f.key}`, (x) => x.f.manager || x.f.key);
    if (got.length) for (const { x, kept } of got) items.push(fundItem(x, 'deposit', bw.deposit / got.length, ROLE.deposit,
      [`بازده ۱۲ ماه ${P(x.m.y1)}، بیشتر از سپرده (${P0(L.depEff)})`, x.f.traded ? 'در بورس معامله می‌شود' : 'صدور و ابطالی'], kept));
    else items.push({ id: 'dep:bank', kind: 'deposit', block: 'deposit', role: ROLE.deposit, w: bw.deposit, name: 'سپردهٔ بانکی', sym: '', why: [`سود حدود ${depositPct}٪`], flags: [], liq: 'شکستن پیش از سررسید هزینه دارد', facts: {} });
  }
  // 2) gold: the lowest-premium traded gold funds
  if (bw.gold > 0) {
    const got = pick(L.gold, prevIds, split(bw.gold), (x) => `f:${x.f.key}`, (x) => x.f.key, 4);
    if (got.length) for (const { x, kept } of got) items.push(fundItem(x, 'gold', bw.gold / got.length, ROLE.gold, [`حباب ${P(x.m.bubble, 1)} نسبت به NAV`, 'کمترین حباب بین صندوق‌های طلای پرمعامله'], kept));
    else { items.push({ id: 'gold:coin', kind: 'coin', block: 'gold', role: ROLE.gold, w: bw.gold, name: 'طلا (سکه یا طلای آب‌شده)', sym: '', why: ['صندوق طلای پرمعامله با حباب معلوم پیدا نشد'], flags: [], liq: 'یک روز', facts: {} }); }
  }
  // 3) the stock market: a satellite of up to 3 candidates (different sectors, 8% each at most), the rest an equity fund
  if (bw.bourse > 0) {
    const sec = (rec) => rec?.sector || null;
    const cands = built ? built.cards.filter((c) => c.sig === 'cand') : [];
    const pool = [];
    // last time's stocks stay while they hold: still liquid and traded, nothing severe, not under the price that undoes them
    for (const it of prev?.items || []) {
      if (!it.id.startsWith('s:')) continue;
      const ins = it.id.slice(2); const rec = radar.stocks?.[ins]; if (!rec) continue;
      const m = RD.stockMetrics(rec, D, radar.sectors || {}, radar.sess);
      const fl = RD.stockFlags(m);
      const close = rec.p[rec.p.length - 1];
      if (m.liquid && m.traded && !fl.some((f) => f.severe) && !(it.stop > 0 && close < it.stop)) pool.push({ ins, rec, m, fl, kept: true, stop: it.stop, why: it.why });
    }
    for (const c of cands) if (!pool.some((p) => p.ins === c.ins)) pool.push({ ins: c.ins, rec: radar.stocks[c.ins], m: c.m, fl: c.flags || [], kept: false, stop: c.stop?.price || null, why: c.why });
    const chosen = []; const secs = new Set();
    for (const p of pool) { if (chosen.length >= MAX_STOCKS) break; const s = sec(p.rec); if (s && secs.has(s)) continue; chosen.push(p); if (s) secs.add(s); }
    const satW = Math.min(bw.bourse * SAT[level], chosen.length * MAX_STOCK);
    const per = chosen.length ? satW / chosen.length : 0;
    for (const p of chosen) items.push({ id: `s:${p.ins}`, kind: 'stock', block: 'bourse', role: ROLE.sat, w: per, kept: p.kept, name: p.rec.name || p.rec.sym, sym: p.rec.sym, sector: radar.sectors?.[p.rec.sector] || p.rec.sector || '',
      ref: { provider: 'tsetmc', key: p.ins, symbol: p.rec.sym, label: p.rec.sym }, stop: p.stop, why: p.why || [], flags: p.fl.filter((f) => !f.severe).map((f) => f.t), liq: 'یک روز کاری', facts: { pe: p.m.pe, y1: p.m.ret365 ?? null } });
    if (!chosen.length) notes.push('امروز کاندیدای رشدی نبود؛ کل سهم بورس در صندوق رفت.');
    else if (satW < bw.bourse * SAT[level] - 1e-9) notes.push(`با سقف ${P0(MAX_STOCK)} برای هر سهم، بخشی از سهم سهم‌های تکی به صندوق رفت.`);
    const core = bw.bourse - satW;
    if (core > 1e-9) {
      const got = pick(L.equity, prevIds, split(core), (x) => `f:${x.f.key}`, (x) => x.f.manager || x.f.key);
      if (got.length) for (const { x, kept } of got) items.push(fundItem(x, 'bourse', core / got.length, ROLE.bourse, [`بازده ۱۲ ماه ${P(x.m.y1)}`, x.f.fundType === 23 ? 'صندوق شاخصی' : 'صندوق سهامی؛ مدیر حرفه‌ای و سبد متنوع'], kept));
      else items.push({ id: 'idx:market', kind: 'note', block: 'bourse', role: ROLE.bourse, w: core, name: 'صندوق سهامی یا شاخصی', sym: '', why: ['صندوق واجد شرایطی در داده نبود'], flags: [], liq: '', facts: {} });
    }
  }
  if (bw.usd > 0) items.push({ id: 'fx:usd', kind: 'fx', block: 'usd', role: ROLE.usd, w: bw.usd, name: 'دلار یا تتر', sym: '', why: ['پوشش در برابر جهش ارز'], flags: [], liq: 'یک روز', facts: {} });
  if (bw.btc > 0) items.push({ id: 'crypto:btc', kind: 'crypto', block: 'btc', role: ROLE.btc, w: bw.btc, name: 'بیت‌کوین', sym: 'BTC', why: ['سهم کوچک، با پذیرش نوسان زیاد'], flags: ['نوسان بسیار زیاد'], liq: 'چند ساعت', facts: {} });
  // what changed since the last model, and why
  const now = new Set(items.map((i) => i.id));
  const changes = prev?.items ? {
    since: prev.day,
    added: items.filter((i) => !prevIds.has(i.id)).map((i) => i.sym || i.name),
    removed: prev.items.filter((i) => !now.has(i.id)).map((i) => ({ name: i.sym || i.name, why: whyOut(i, radar, D) })),
  } : null;
  return { level, day: radar.day, items, blocks: bw, notes, changes };
}
function whyOut(it, radar, D) {
  if (it.id.startsWith('s:')) {
    const rec = radar.stocks?.[it.id.slice(2)]; if (!rec) return 'دیگر در داده نیست';
    const m = RD.stockMetrics(rec, D, radar.sectors || {}, radar.sess);
    const sev = RD.stockFlags(m).find((f) => f.severe); if (sev) return `پرچم قرمز: ${sev.t}`;
    if (it.stop > 0 && rec.p[rec.p.length - 1] < it.stop) return 'زیر قیمتی رفت که دلیل انتخابش را باطل می‌کرد';
    return 'جای بهتری برایش پیدا شد';
  }
  if (it.id.startsWith('f:')) return 'دیگر شرط‌های این بخش را ندارد یا گزینهٔ بهتری آمد';
  return 'ترکیب سطح ریسک عوض شد';
}

/* ------------------------------------------ the log ------------------------------------------ */
/** The price of an item now, for the log: a stock's close, a fund's NAV, the dollar and bitcoin from the quotes. */
export function pxOf(id, radar, quotes = {}) {
  if (id.startsWith('s:')) { const r = radar.stocks?.[id.slice(2)]; return r?.p?.length ? r.p[r.p.length - 1] : null; }
  if (id.startsWith('f:')) { const f = (radar.funds || []).find((x) => `f:${x.key}` === id); return f?.cancelNav > 0 ? f.cancelNav : null; }
  if (id === 'fx:usd') return quotes['tgju:price_dollar_rl']?.price || quotes['nobitex:usdt']?.price || null;
  if (id === 'crypto:btc') return quotes['nobitex:btc']?.price || null;
  return null; // a deposit grows by its rate; a coin or a plain note isn't priced
}
/**
 * Log today's model for each level (on a complete scan): a new entry when the picks changed or a week passed, with the
 * prices of its items; the previous entry gets its «exit» prices, so the record chains entry to entry.
 * radar.model = { day, levels: { low|mid|high: model }, log: { low|mid|high: [{ day, items: [[id, w, px]], exit }] } }
 */
export function updateModels(radar, built, { quotes = {}, depositPct = 25, noCrypto = false } = {}) {
  const old = radar.model || {}; const log = { ...(old.log || {}) }; const levels = {};
  for (const lv of LEVELS) {
    // the model to keep picks from: yesterday's on a new day; on a second scan of the same day, the one before it
    const cur = old.levels?.[lv];
    const strip = (x) => ({ day: x.day, items: x.items.map(({ id, w, name, sym, stop, why }) => ({ id, w, name, sym, stop, why })) });
    const prev = !cur ? null : old.day === radar.day ? cur.prev || null : strip(cur);
    const m = buildModel(radar, built, lv, { prev, depositPct, noCrypto });
    if (!m) continue;
    m.prev = prev;
    levels[lv] = m;
    const L = (log[lv] || []).slice();
    const last = L[L.length - 1];
    const ids = m.items.map((i) => `${i.id}:${i.w.toFixed(4)}`).join('|');
    const lastIds = last ? last.items.map(([id, w]) => `${id}:${(+w).toFixed(4)}`).join('|') : '';
    const due = !last || (ids !== lastIds && last.day !== radar.day) || RD.dayNum(radar.day) - RD.dayNum(last.day) >= LOG_EVERY_DAYS;
    if (due && (!last || last.day !== radar.day)) {
      if (last) L[L.length - 1] = { ...last, exit: Object.fromEntries(last.items.map(([id]) => [id, pxOf(id, radar, quotes)])), exitDay: radar.day };
      L.push({ day: radar.day, depositPct, items: m.items.map((i) => [i.id, +i.w.toFixed(5), pxOf(i.id, radar, quotes)]) });
    }
    log[lv] = L.slice(-120);
  }
  radar.model = { day: radar.day, levels, log };
  return radar.model;
}
/**
 * What the logged model did since it started: chained entry by entry (each held from its day to the next), the last
 * one up to now. Items without a price at either end count as flat (said in `unpriced`). null with fewer than 2 days.
 */
export function modelRecord(radar, level, quotes = {}) {
  const L = radar?.model?.log?.[level] || []; if (!L.length || !radar.day) return null;
  let v = 1; let unpriced = 0;
  for (let i = 0; i < L.length; i++) {
    const e = L[i]; const last = i === L.length - 1;
    const endDay = last ? radar.day : e.exitDay;
    const days = Math.max(0, RD.dayNum(endDay) - RD.dayNum(e.day));
    let g = 0;
    for (const [id, w, px] of e.items) {
      const z = last ? pxOf(id, radar, quotes) : e.exit?.[id];
      if (id === 'dep:bank' || (id.startsWith('f:') && !(px > 0))) g += w * (id === 'dep:bank' ? Math.pow(1 + (e.depositPct || 25) / 1200, days * 12 / 365) : 1);
      else if (px > 0 && z > 0) g += w * z / px;
      else { g += w; unpriced += w; }
    }
    v *= g;
  }
  const since = L[0].day; const days = RD.dayNum(radar.day) - RD.dayNum(since);
  if (days < 1) return { since, days, pct: null };
  return { since, days, pct: v - 1, unpriced: unpriced > 0 };
}

/* ------------------------------------------ the numbers ------------------------------------------ */
const monthsBack = (n) => Array.from({ length: n + 1 }, (_, k) => n - k); // n … 0
/**
 * The model's numbers, honest about where each comes from: its 12 months (each item's own 12 months, weighted — a test
 * of today's picks on the past, so flattering), its worst month and yearly swing (from monthly moves: a stock's own
 * closes, the index for an equity fund, gold / dollar / bitcoin from the market's past R, a deposit's rate for fixed
 * income), how much its parts move together, the markets over the same 12 months, its share protected from inflation,
 * sectors and the cost of getting in.
 */
export function modelStats(model, radar, { R = null, depositPct = 25 } = {}) {
  if (!model) return null;
  const D = RD.dayNum(radar.day);
  const ix = radar.bench?.index;
  const depM = Math.pow(1 + depositPct / 1200, 1) - 1, depY = Math.pow(1 + depositPct / 1200, 12) - 1;
  // monthly closes of the past from R (builder.returnsFrom: R.months with R.r[c] monthly returns), the last 12
  const rMonths = (c) => { const l = R?.r?.[c]?.slice(-12); return l?.length === 12 && l.every((x) => x !== null && isFinite(x)) ? l : null; };
  const stockMonthly = (rec) => { const p = monthsBack(12).map((k) => RD.closeOn(rec, D - 30 * k)); return p.some((x) => !(x > 0)) ? null : p.slice(1).map((x, i) => x / p[i] - 1); };
  const ixMonthly = () => { if (!ix) return null; const p = monthsBack(12).map((k) => RD.benchAt(ix, D - 30 * k)); return p.some((x) => !(x > 0)) ? null : p.slice(1).map((x, i) => x / p[i] - 1); };
  const yr = (ser) => (ser ? ser.reduce((a, r) => a * (1 + r), 1) - 1 : null);
  const series = model.items.map((it) => {
    let mser = null, y1 = null, approx = false;
    if (it.kind === 'stock') { const rec = radar.stocks?.[it.id.slice(2)]; mser = rec ? stockMonthly(rec) : null; y1 = yr(mser); }
    else if (it.block === 'deposit') { mser = Array(12).fill(depM); y1 = it.facts?.y1 ?? depY; }
    else if (it.block === 'bourse') { mser = ixMonthly(); y1 = it.facts?.y1 ?? yr(mser); approx = true; }
    else if (it.block === 'gold') { mser = rMonths('gold'); y1 = it.facts?.y1 ?? yr(mser); approx = true; }
    else if (it.block === 'usd') { mser = rMonths('usd'); y1 = yr(mser); }
    else if (it.block === 'btc') { mser = rMonths('btc'); y1 = yr(mser); }
    return { it, mser, y1, approx };
  });
  const known = series.filter((s) => s.y1 !== null && isFinite(s.y1));
  const wKnown = known.reduce((t, s) => t + s.it.w, 0);
  const y1 = wKnown > 0.5 ? known.reduce((t, s) => t + s.it.w * s.y1, 0) / wKnown : null;
  // the basket's months (from the parts that have them, reweighted)
  const withM = series.filter((s) => s.mser?.length === 12);
  const wM = withM.reduce((t, s) => t + s.it.w, 0);
  // (only when most of the money has its months — else a few calm parts would pass for the whole)
  const basketM = wM >= 0.8 ? Array.from({ length: 12 }, (_, k) => withM.reduce((t, s) => t + s.it.w * s.mser[k], 0) / wM) : null;
  const worst = basketM ? Math.min(...basketM) : null;
  const mean = basketM ? basketM.reduce((a, b) => a + b, 0) / 12 : null;
  const vol = basketM ? Math.sqrt(basketM.reduce((t, r) => t + (r - mean) ** 2, 0) / 11) * Math.sqrt(12) : null;
  // how much the moving parts move together: the average correlation of their months (a deposit doesn't move)
  const moving = withM.filter((s) => s.it.block !== 'deposit');
  const corr = (a, b) => { const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length; let sab = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sa > 0 && sb > 0 ? sab / Math.sqrt(sa * sb) : null; };
  const cs = []; for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) { const c = corr(moving[i].mser, moving[j].mser); if (c !== null) cs.push(c); }
  const avgCorr = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
  const markets = { index: yr(ixMonthly()), gold: yr(rMonths('gold')), usd: yr(rMonths('usd')), deposit: depY };
  const blocks = Object.entries(model.blocks).filter(([, w]) => w > 0).length;
  const sectors = new Set(model.items.filter((i) => i.kind === 'stock' && i.sector).map((i) => i.sector)).size;
  const cost = model.items.reduce((t, i) => t + i.w * (COST[i.kind] ?? 0) / 100, 0);
  return { y1, y1Coverage: wKnown, worst, vol, avgCorr, markets, protectedShare: 1 - (model.blocks.deposit || 0), blocks, sectors,
    stocks: model.items.filter((i) => i.kind === 'stock').length, cost, approx: series.some((s) => s.approx), monthsFrom: wM };
}
