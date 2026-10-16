// «سبدساز»: a sum of money (alone, or added to what the owner holds) tried in a few mixes against the real past of
// Iran's markets — deposits, 18k gold, the dollar, the Tehran total index and bitcoin, in Rial, month by month — with
// the worst falls, a range of outcomes for the owner's horizon, two stress tests and a plan of what to buy.
// Pure. Money in Rial. Nothing here says what to buy: it shows how each mix behaved and leaves the choice.
import * as RD from './radar.js';
import * as BB from './bubble.js';
import { CAT } from './catalog.js';
import { MIX, mixFor, riskLevel, isSet, RISK } from './profile.js';

/** The building blocks: what each stands for in the past, and a round-trip cost of buying in (and later out). */
export const CLASSES = [
  { id: 'deposit', name: 'سپرده و درآمد ثابت', short: 'سپرده', color: CAT.fixed.color, cost: 0 },
  { id: 'gold', name: 'طلا', short: 'طلا', color: CAT.gold.color, cost: 1.5 },
  { id: 'usd', name: 'دلار', short: 'دلار', color: CAT.fx.color, cost: 2 },
  { id: 'bourse', name: 'بورس', short: 'بورس', color: CAT.stock.color, cost: 1 },
  { id: 'btc', name: 'رمزارز', short: 'رمزارز', color: CAT.crypto.color, cost: 1 },
];
export const CLASS = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
const IDS = CLASSES.map((c) => c.id);
/** Dara's categories and exposures → the block that stands for them (the rest — property, private shares, metals… — isn't modelled). */
export const CAT_CLASS = { bank: 'deposit', fixed: 'deposit', receivable: 'deposit', gold: 'gold', gold_online: 'gold', fx: 'usd', stock: 'bourse', crypto: 'btc' };
const EXP_CLASS = { rial: 'deposit', gold: 'gold', fx: 'usd', equity: 'bourse', crypto: 'btc' };

/* ------------------------------------------------------------ the past ------------------------------------------------------------ */
/** Daily [[iso, price]] → { 'YYYY-MM': the month's last price }. */
export function monthly(points) {
  const m = {};
  for (const [d, p] of points || []) if (d && p > 0) m[String(d).slice(0, 7)] = +p;
  return m;
}

/**
 * Monthly returns of each block over the months gold, the dollar and the index all have. Bitcoin from its first month
 * (null before). The deposit earns `depositPct` a year, paid monthly — today's rate, carried back (an assumption).
 * series: { gold, usd, index, btc } as month maps (Rial; the index in points).
 */
export function returnsFrom(series, depositPct = 25) {
  const { gold = {}, usd = {}, index = {}, btc = {} } = series || {};
  const months = Object.keys(gold).filter((m) => usd[m] > 0 && index[m] > 0).sort();
  const r = Object.fromEntries(IDS.map((k) => [k, []]));
  const dm = depositPct / 1200;
  for (let i = 1; i < months.length; i++) {
    const a = months[i - 1], b = months[i];
    r.deposit.push(dm);
    r.gold.push(gold[b] / gold[a] - 1);
    r.usd.push(usd[b] / usd[a] - 1);
    r.bourse.push(index[b] / index[a] - 1);
    r.btc.push(btc[a] > 0 && btc[b] > 0 ? btc[b] / btc[a] - 1 : null);
  }
  return { months: months.slice(1), r, depositPct };
}

/** The last `n` months (or fewer when the past is shorter). */
export function lastMonths(R, n) {
  const k = Math.max(0, R.months.length - n);
  return { months: R.months.slice(k), r: Object.fromEntries(IDS.map((c) => [c, R.r[c].slice(k)])), depositPct: R.depositPct };
}

/** Weights whose blocks all have data in this window; a block without it gives its share to deposits (noted). */
export function usable(w, R) {
  const out = { ...w }; const moved = [];
  for (const c of IDS) if ((out[c] || 0) > 0 && R.r[c].some((x) => x === null || x === undefined)) { out.deposit = (out.deposit || 0) + out[c]; moved.push(c); out[c] = 0; }
  return { w: out, moved };
}

/** Month-by-month value (start 1) of a mix, put back to its weights once a year. */
export function path(w, R, { rebalance = 12 } = {}) {
  let h = Object.fromEntries(IDS.map((c) => [c, w[c] || 0]));
  const n = R.months.length; const out = [1];
  for (let t = 0; t < n; t++) {
    for (const c of IDS) if (h[c]) h[c] *= 1 + (R.r[c][t] || 0);
    const v = IDS.reduce((s, c) => s + h[c], 0);
    out.push(v);
    if (rebalance && (t + 1) % rebalance === 0) h = Object.fromEntries(IDS.map((c) => [c, (w[c] || 0) * v]));
  }
  return out;
}

/** What the path says: yearly return, the worst fall and how long it stayed under its peak, the worst 12 months, the
 *  yearly swing, and in what share of the `horizon`-month stretches it ended ahead of the deposit. */
export function metrics(p, { depositPct = 25, horizon = 12 } = {}) {
  const n = p.length - 1;
  if (n < 2) return null;
  const cagr = Math.pow(p[n] / p[0], 12 / n) - 1;
  let peak = p[0], maxDD = 0, under = 0, longest = 0;
  for (const v of p) {
    if (v >= peak) { peak = v; under = 0; } else { under++; longest = Math.max(longest, under); maxDD = Math.min(maxDD, v / peak - 1); }
  }
  let worst12 = null;
  for (let t = 0; t + 12 <= n; t++) { const x = p[t + 12] / p[t] - 1; if (worst12 === null || x < worst12) worst12 = x; }
  const rets = []; for (let t = 1; t <= n; t++) rets.push(p[t] / p[t - 1] - 1);
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(12);
  const H = Math.max(1, Math.min(horizon, n)); const dep = Math.pow(1 + depositPct / 1200, H);
  let ahead = 0, all = 0;
  for (let t = 0; t + H <= n; t++) { all++; if (p[t + H] / p[t] > dep * (1 + 1e-9)) ahead++; }
  return { cagr, maxDD, under: longest, worst12, vol, beat: all ? ahead / all : null, months: n };
}

/** A small, repeatable random source (the same answer every time for the same inputs). */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * A range for `horizon` months ahead: whole stretches of past months (all blocks together, so they move as they did)
 * are drawn again and again; the 10th, 50th and 90th percent of the outcomes, as multiples of today's value.
 */
export function range(w, R, horizon = 12, { runs = 1500, block = 6, seed = 7 } = {}) {
  const n = R.months.length; if (n < 12) return null;
  const starts = Math.max(1, n - block + 1); // blocks never wrap from the last month back to the first
  const rand = rng(seed + horizon * 31 + Math.round((w.gold || 0) * 1000) + Math.round((w.bourse || 0) * 977));
  const out = []; const outUsd = [];
  for (let k = 0; k < runs; k++) {
    let h = Object.fromEntries(IDS.map((c) => [c, w[c] || 0])); let t = 0; let u = 1;
    while (t < horizon) {
      const s = Math.floor(rand() * starts);
      for (let j = 0; j < block && t < horizon; j++, t++) {
        const m = Math.min(n - 1, s + j);
        u *= 1 + (R.r.usd[m] || 0);
        for (const c of IDS) if (h[c]) h[c] *= 1 + (R.r[c][m] || 0);
        if (t % 12 === 11) { const v = IDS.reduce((a, c) => a + h[c], 0); h = Object.fromEntries(IDS.map((c) => [c, (w[c] || 0) * v])); }
      }
    }
    const v = IDS.reduce((a, c) => a + h[c], 0);
    out.push(v); outUsd.push(v / u);
  }
  out.sort((a, b) => a - b); outUsd.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  // the middle outcome in dollars too: in rial almost everything grows when the rial falls
  return { bad: q(out, 0.1), mid: q(out, 0.5), good: q(out, 0.9), midUsd: q(outUsd, 0.5) };
}

/** Two shocks: the dollar up 50% (domestic gold and coins rise with it, the ounce held still; bitcoin is priced in
 *  dollars) and the total index down 30%. The index's own reaction to a dollar jump is left out on purpose. */
export function stress(w) {
  return { usdUp: 0.5 * ((w.gold || 0) + (w.usd || 0) + (w.btc || 0)), bourseDown: -0.3 * (w.bourse || 0) };
}

/* ------------------------------------------------------------ the mixes ------------------------------------------------------------ */
/** New money toward class targets without selling: first the gaps (target × total after − held), then the rest by
 *  target. The same rule as «پول تازه», but by block, so online gold and gold funds count as the gold they are. */
export function allocClasses(cur, T, amount) {
  const ids = IDS.filter((c) => (T[c] || 0) > 0);
  const add = Object.fromEntries(IDS.map((c) => [c, 0]));
  if (!ids.length || !(amount > 0)) return add;
  const G1 = IDS.reduce((a, c) => a + (cur[c] || 0), 0) + amount;
  const gaps = Object.fromEntries(ids.map((c) => [c, Math.max(0, T[c] * G1 - (cur[c] || 0))]));
  const gs = ids.reduce((a, c) => a + gaps[c], 0);
  if (gs >= amount) for (const c of ids) add[c] = amount * gaps[c] / gs;
  else for (const c of ids) add[c] = gaps[c] + (amount - gs) * T[c];
  return add;
}
/** A mix by category (percent) → weights by block. */
export const mixWeights = (byCat) => norm(toClasses(byCat || {}));
const toClasses = (byCat) => { const w = {}; for (const [k, v] of Object.entries(byCat)) { const c = CAT_CLASS[k]; if (c) w[c] = (w[c] || 0) + v; } return w; };
const norm = (w) => { const s = IDS.reduce((a, c) => a + Math.max(0, w[c] || 0), 0); return s > 0 ? Object.fromEntries(IDS.map((c) => [c, Math.max(0, w[c] || 0) / s])) : null; };

/** What the owner holds, by block (Rial), and the part no block stands for. */
export function holdings(pf) {
  const cur = Object.fromEntries(IDS.map((c) => [c, 0]));
  let other = 0;
  for (const [e, v] of Object.entries(pf?.byExposure || {})) { const c = EXP_CLASS[e]; if (c) cur[c] += Math.max(0, v); else other += Math.max(0, v); }
  return { cur, other, modelled: IDS.reduce((a, c) => a + cur[c], 0) };
}

/**
 * The comparison. mode 'with': the amount is added to what the owner holds — the current mix gets it in its own
 * proportions; each risk mix spreads it toward its targets (without selling anything) as «پول تازه» does; and all of
 * it is measured together. mode 'alone': just the amount, in each mix.
 * R: returnsFrom(); years: 5 or 10; horizon: months ahead.
 */
// prefs: what the owner said in a sentence ({ risk, noCrypto }); it wins over the profile for this run only
export function build({ R, pf = null, profile = null, targets = null, amount, horizon = 12, mode = 'with', years = 5, prefs = null } = {}) {
  if (!R?.months?.length || !(amount > 0)) return null;
  const W = lastMonths(R, years * 12);
  if (W.months.length < 24) return { error: 'تاریخچهٔ کافی نیست' };
  const level = RISK[prefs?.risk] ? prefs.risk : riskLevel(profile);
  const levelFrom = RISK[prefs?.risk] ? 'sentence' : level ? 'profile' : null;
  const noCrypto = typeof prefs?.noCrypto === 'boolean' ? prefs.noCrypto : !!profile?.noCrypto;
  const usdIdx = [1]; for (const x of W.r.usd) usdIdx.push(usdIdx[usdIdx.length - 1] * (1 + x));
  const h = holdings(pf);
  const withMode = mode === 'with' && h.modelled > 0;
  const mixes = [];
  if (h.modelled > 0) mixes.push({ id: 'current', name: 'ترکیب فعلی تو', w: norm(h.cur) });
  // the owner's own target mix, when one is set (percent by category)
  const tg = Object.fromEntries(Object.entries(targets || {}).filter(([k, v]) => +v > 0 && CAT_CLASS[k]).map(([k, v]) => [k, +v]));
  if (Object.keys(tg).length) mixes.push({ id: 'targets', name: 'ترکیب هدف تو', byCat: tg, w: norm(toClasses(tg)) });
  for (const lv of ['low', 'mid', 'high']) mixes.push({ id: lv, name: `ریسک ${RISK[lv]}`, level: lv, byCat: mixFor(lv, noCrypto), w: norm(toClasses(mixFor(lv, noCrypto))) });
  const cands = mixes.map((m) => {
    let adds, total;
    if (withMode) {
      if (m.id === 'current') adds = Object.fromEntries(IDS.map((c) => [c, amount * m.w[c]]));
      else adds = allocClasses(h.cur, m.w, amount);
      total = Object.fromEntries(IDS.map((c) => [c, h.cur[c] + adds[c]]));
    } else {
      adds = Object.fromEntries(IDS.map((c) => [c, amount * (m.w[c] || 0)]));
      total = adds;
    }
    const value0 = IDS.reduce((a, c) => a + total[c], 0);
    const cost = IDS.reduce((a, c) => a + adds[c] * CLASS[c].cost / 100, 0);
    const u = usable(norm(total), W);
    // the cost of buying in comes off at the start, so every figure below is after it
    const cf = value0 > 0 ? IDS.reduce((a, c) => a + adds[c] * CLASS[c].cost / 100, 0) / value0 : 0;
    const p = path(u.w, W).map((v) => v * (1 - cf));
    const mt = metrics(p, { depositPct: R.depositPct, horizon });
    // the same path in dollars: how much of the gain was only the rial losing value
    if (mt) mt.usdCagr = Math.pow(p[p.length - 1] / usdIdx[usdIdx.length - 1], 12 / (p.length - 1)) - 1;
    const rg = range(u.w, W, horizon);
    const net = value0 - cost;
    return { id: m.id, name: m.name, level: m.level || null, fits: !!level && m.level === level, byCat: m.byCat || null,
      weights: u.w, moved: u.moved, adds, value0, cost, metrics: mt,
      range: rg && { bad: net * rg.bad, mid: net * rg.mid, good: net * rg.good, badPct: (net * rg.bad) / value0 - 1, midPct: (net * rg.mid) / value0 - 1, goodPct: (net * rg.good) / value0 - 1, midUsdPct: (net * rg.midUsd) / value0 - 1 },
      stress: stress(u.w), path: p };
  });
  // what each block did on its own in the same window
  const each = CLASSES.map((c) => { const has = !W.r[c.id].some((x) => x === null || x === undefined); const m = has ? metrics(path({ [c.id]: 1 }, W), { depositPct: R.depositPct, horizon }) : null; return { id: c.id, name: c.short, cagr: m?.cagr ?? null, maxDD: m?.maxDD ?? null }; });
  return { mode: withMode ? 'with' : 'alone', askedWith: mode === 'with', amount, horizon, years, from: W.months[0], to: W.months[W.months.length - 1], months: W.months.length,
    depositPct: R.depositPct, depositGain: Math.pow(1 + R.depositPct / 1200, horizon) - 1, level, levelFrom, noCrypto, profileSet: isSet(profile), other: withMode ? h.other : 0, cands, each };
}

/* ------------------------------------------------------------ what to buy ------------------------------------------------------------ */
/** Ways in for each block, with their facts (lists of funds pass fixed filters; nothing is ranked as «the» pick). */
export function vehicles(classId, { radar = null, quotes = {}, depositPct = 25 } = {}) {
  const out = [];
  const D = radar?.day ? RD.dayNum(radar.day) : null;
  const funds = D ? (radar.funds || []).map((f) => ({ f, m: RD.fundMetrics(f, radar, D) })) : [];
  const fund = (x, extra = {}) => ({ kind: 'fund', name: x.f.name, sym: x.f.symbol || '', y1: x.m.y1, size: x.m.size, bubble: x.m.bubble, traded: !!x.f.traded, ...extra });
  const depEff = Math.pow(1 + depositPct / 1200, 12) - 1;
  if (classId === 'deposit') {
    out.push({ kind: 'note', name: 'سپردهٔ بانکی', note: `سود حدود ${depositPct}٪ در سال؛ شکستن پیش از سررسید هزینه دارد` });
    funds.filter((x) => x.f.fundType === 4 && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 2e12 && x.m.y1 > depEff).sort((a, b) => b.m.y1 - a.m.y1).slice(0, 3).forEach((x) => out.push(fund(x)));
  } else if (classId === 'gold') {
    for (const k of ['sekee', 'nim', 'rob']) { const b = BB.coinBubble(k, quotes); if (b && !b.stale) out.push({ kind: 'coin', name: b.name, bubble: b.bubble, note: 'هزینهٔ خرید و فروش حدود ۲ تا ۳٪' }); }
    funds.filter((x) => x.m.gold && x.m.bubble !== null && x.m.tradable).sort((a, b) => a.m.bubble - b.m.bubble).slice(0, 3).forEach((x) => out.push(fund(x)));
    out.push({ kind: 'note', name: 'طلای آب‌شده یا آنلاین', note: 'بدون حباب سکه؛ فاصلهٔ خرید و فروش حدود ۱ تا ۲٪' });
  } else if (classId === 'bourse') {
    funds.filter((x) => (x.f.fundType === 6 || x.f.fundType === 23) && x.m.y1 !== null && x.m.ageDays >= 365 && x.m.size >= 1e12).sort((a, b) => b.m.y1 - a.m.y1).slice(0, 4).forEach((x) => out.push(fund(x)));
    out.push({ kind: 'note', name: 'سهم تکی', note: 'از «رادار فرصت‌ها» و کارنامهٔ نماد بررسی کن؛ سقف یک دارایی را رعایت کن' });
  } else if (classId === 'usd') {
    out.push({ kind: 'note', name: 'دلار نقد یا حساب ارزی', note: 'فاصلهٔ خرید و فروش صرافی حدود ۲٪؛ نگهداری امن را در نظر بگیر' });
  } else if (classId === 'btc') {
    out.push({ kind: 'note', name: 'تتر یا بیت‌کوین در صرافی داخلی', note: 'نوسان بسیار زیاد؛ کارمزد حدود ۰٫۳ تا ۱٪' });
  }
  return out;
}

/** A saved plan, valued today from the latest prices: { now, pct, deposit } (deposit: the same money in a deposit). */
export function planToday(plan, latest, now = Date.now()) {
  if (!plan?.start || !latest || !(plan.at > 0)) return null;
  const days = Math.max(0, (now - plan.at) / 864e5);
  const dep = (x) => Math.pow(1 + (plan.depositPct || 0) / 1200, x * 12 / 365) - 1; // monthly compounding, as in the test of the past
  let v = 0, v0 = 0; const missing = [];
  for (const c of IDS) {
    const a = plan.adds?.[c] || 0; if (!a) continue;
    v0 += a;
    if (c === 'deposit') v += a * (1 + dep(days));
    else if (plan.start[c] > 0 && latest[c] > 0) v += a * latest[c] / plan.start[c];
    else { v += a; missing.push(c); }
  }
  if (!(v0 > 0)) return null;
  return { value: v, pct: v / v0 - 1, deposit: dep(days), days: Math.floor(days), missing };
}

/** The latest price of each block from the history points (for saving a plan and valuing it later). */
export function latestOf(data) {
  const last = (pts) => (pts?.length ? pts[pts.length - 1][1] : null);
  return { gold: last(data?.gold), usd: last(data?.usd), bourse: last(data?.index), btc: last(data?.btc) };
}

/** Month maps from the worker's daily points. */
export const seriesOf = (data) => ({ gold: monthly(data?.gold), usd: monthly(data?.usd), index: monthly(data?.index), btc: monthly(data?.btc) });

export { MIX };
