// «مقایسه دو گزینه»: the same money, two ways, over the same months. Pure; money is Rial.
// Only arithmetic on the owner's own numbers and stated assumptions (costs, deposit rate, price changes) — never a verdict.
import * as E from './engine.js';
import * as BB from './bubble.js';
import { CAT } from './catalog.js';
import { depositGrowth } from './insights.js';
import { todayIso, addDaysIso } from './jalali.js';

/** What the money can go into. cost = assumed round-trip cost (buy + sell spread, commission), percent; editable. */
export const CHOICES = [
  { id: 'keep', kind: 'keep', name: 'بماند همان‌جا' },
  { id: 'deposit', kind: 'deposit', name: 'سپرده بانکی' },
  { id: 'geram18', kind: 'market', name: 'طلای ۱۸ عیار (آب‌شده)', ref: { provider: 'tgju', key: 'geram18' }, unit: 'گرم', category: 'gold_online', cost: 1.5 },
  { id: 'sekee', kind: 'market', name: 'سکه امامی', ref: { provider: 'tgju', key: 'sekee' }, unit: 'سکه', category: 'gold', cost: 2 },
  { id: 'sekeb', kind: 'market', name: 'سکه بهار آزادی', ref: { provider: 'tgju', key: 'sekeb' }, unit: 'سکه', category: 'gold', cost: 2 },
  { id: 'nim', kind: 'market', name: 'نیم سکه', ref: { provider: 'tgju', key: 'nim' }, unit: 'سکه', category: 'gold', cost: 2.5 },
  { id: 'rob', kind: 'market', name: 'ربع سکه', ref: { provider: 'tgju', key: 'rob' }, unit: 'سکه', category: 'gold', cost: 3 },
  { id: 'retail_gerami', kind: 'market', name: 'سکه گرمی', ref: { provider: 'tgju', key: 'retail_gerami' }, unit: 'سکه', category: 'gold', cost: 6 },
  { id: 'usd', kind: 'market', name: 'دلار', ref: { provider: 'tgju', key: 'price_dollar_rl' }, unit: 'دلار', category: 'fx', cost: 2 },
  { id: 'eur', kind: 'market', name: 'یورو', ref: { provider: 'tgju', key: 'price_eur' }, unit: 'یورو', category: 'fx', cost: 2.5 },
  { id: 'usdt', kind: 'market', name: 'تتر', ref: { provider: 'nobitex', key: 'usdt' }, unit: 'تتر', category: 'crypto', cost: 1 },
  { id: 'btc', kind: 'market', name: 'بیت‌کوین', ref: { provider: 'nobitex', key: 'btc' }, unit: 'بیت‌کوین', category: 'crypto', cost: 1 },
  { id: 'silver', kind: 'market', name: 'نقره ۹۹۹', ref: { provider: 'tgju', key: 'silver_999' }, unit: 'گرم', category: 'metal', cost: 4 },
];
export const choiceById = (id) => CHOICES.find((c) => c.id === id) || null;
const DAY = 86400000;

/** Where the money can come from: an account or deposit of the owner's (not a debt, not archived), or new money. */
export function sources(assets = [], pf = null) {
  const val = Object.fromEntries((pf?.rows || []).map((r) => [r.asset.id, r.value]));
  return assets.filter((a) => !a.archived && !E.isLiability(a) && (a.mode === 'balance' || a.mode === 'rate') && ['bank', 'fixed', 'other'].includes(a.category))
    .map((a) => ({ id: a.id, name: a.name, value: val[a.id] ?? 0, rate: sourceRate(a), asset: a }))
    .sort((x, y) => y.value - x.value);
}

/** The yearly rate money earns where it is now (0 when it earns nothing, or a deposit that has already matured). */
export function sourceRate(a, today = todayIso()) {
  if (!a) return 0;
  if (a.mode === 'rate') return a.rate?.maturity && a.rate.maturity < today ? 0 : +a.rate?.annualPct || 0;
  if (a.mode === 'balance' && a.interest?.on) return +a.interest.annualPct || 0;
  return 0;
}

/** exposure / liquidity the money would have in a choice */
function shape(choice) {
  if (choice.kind === 'market') {
    const cat = CAT[choice.category];
    const exposure = E.exposureOf({ category: choice.category, price: { ref: choice.ref } });
    return { exposure, liq: cat?.liquidity || 'mid' };
  }
  return { exposure: 'rial', liq: 'high' };
}

/** inflation shield, money available in days, and the largest exposure, over positive asset rows */
function shares(rows) {
  const g = rows.reduce((t, r) => t + r.value, 0);
  if (!(g > 0)) return null;
  const by = {}; let rial = 0, days = 0;
  for (const r of rows) { by[r.exposure] = (by[r.exposure] || 0) + r.value; if (r.exposure === 'rial') rial += r.value; if (r.liq === 'high') days += r.value; }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  return { protected: 1 - rial / g, liquidDays: days / g, top: { exposure: top[0], share: top[1] / g }, by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v / g])) };
}

/**
 * Compare two choices for `amount` (Rial) taken from `sourceId` ('new' = money not in Dara yet) over `months`.
 * a, b: { id, costPct?, ratePct? }. opts.bubbleAvg: { coinKey: average bubble } (3 months), when known.
 * Each option: final value if its price doesn't change, value at a price change g (market only), costs, lost interest,
 * coin bubble, and what the portfolio would look like after.
 */
export function compareOptions(st, pf, { amount, sourceId = 'new', a, b, months = 12, depositPct = 25, bubbleAvg = {}, today = todayIso(), now = Date.now() } = {}) {
  const P = +amount || 0;
  const m = Number.isFinite(+months) && months !== null && months !== '' ? Math.max(1, Math.min(120, Math.round(+months))) : 12;
  if (!(P > 0)) return null;
  const quotes = st.quotes || {};
  // only an account or deposit of the owner's can be the source (not a debt, not an archived or priced asset)
  const src = sourceId === 'new' ? null : sources(st.assets, pf).find((x) => x.id === sourceId)?.asset || null;
  if (sourceId !== 'new' && !src) return null;
  const srcRow = src ? pf.rows.find((r) => r.asset.id === src.id) : null;
  const srcValue = srcRow?.value ?? 0;
  const srcRate = src ? sourceRate(src, today) : 0;
  const end = addDaysIso(today, Math.round(m * 30.44));
  const source = {
    id: src?.id || 'new', name: src ? src.name : 'پول تازه', rate: srcRate, value: src ? srcValue : null,
    exceeds: !!src && P > srcValue + 0.5,
    // money taken out of a deposit before its maturity may lose part of its interest (bank rules differ)
    early: !!src && src.mode === 'rate' && !!src.rate?.maturity && src.rate.maturity > today,
    // a deposit that ends before the horizon: assumed renewed at the same rate
    renewed: !!src && src.mode === 'rate' && !!src.rate?.maturity && src.rate.maturity > today && src.rate.maturity < end,
  };

  // the portfolio before, with new money counted as cash so both sides start from the same total
  const base = pf.rows.filter((r) => !r.cat.liability && r.value > 0).map((r) => ({ id: r.asset.id, value: r.value, exposure: r.exposure, liq: r.asset.liquidity || r.cat.liquidity }));
  if (!src) base.push({ id: '__new', value: P, exposure: 'rial', liq: 'high' });
  const before = shares(base);

  const one = (spec) => {
    const choice = choiceById(spec?.id);
    if (!choice) return null;
    const o = { id: choice.id, kind: choice.kind, name: choice.name, unit: choice.unit || null, notes: [] };
    if (choice.kind === 'keep') {
      o.rate = srcRate; o.name = src ? `بماند در ${src.name}` : 'نقد بماند';
      if (!src || !srcRate) o.notes.push(src ? 'این پول همان‌جا سودی نمی‌گیرد' : 'پول نقد بدون سود');
      if (source.renewed) o.notes.push('سپرده پیش از پایان مدت سررسید می‌شود؛ فرض شد با همین نرخ تمدید شود');
    } else if (choice.kind === 'deposit') {
      o.rate = spec.ratePct > 0 ? Math.min(200, +spec.ratePct) : depositPct; o.name = 'سپرده بانکی';
    }
    if (choice.kind !== 'market') {
      o.cost = 0; o.costAmount = 0;
      o.final = P * depositGrowth(o.rate, m);
      o.valueAt = () => o.final;
    } else {
      const q = quotes[E.quoteId(choice.ref)];
      o.price = q?.price > 0 ? q.price : null;
      o.stale = !o.price || !!q?.error || now - (q?.at || q?.fetchedAt || 0) > 3 * DAY;
      o.cost = Math.max(0, Math.min(50, spec.costPct ?? choice.cost)) / 100;
      o.costAmount = P * o.cost;
      o.final = P * (1 - o.cost);                            // price unchanged: only the round-trip cost is lost
      o.valueAt = (g) => P * (1 - o.cost) * (1 + g);
      o.units = o.price ? P * (1 - o.cost / 2) / o.price : null; // bought at about half the spread above the quote
      if (BB.isCoinRef(choice.ref)) {
        const cb = BB.coinBubble(choice.ref.key, quotes, now);
        if (cb && !cb.stale) {
          o.bubble = cb.bubble;
          const avg = bubbleAvg?.[choice.ref.key];
          if (isFinite(avg) && avg > -1) o.bubbleRevert = (1 + avg) / (1 + cb.bubble) - 1; // gold unchanged, bubble back to its average
        }
      }
      if (o.stale) o.notes.push('قیمت این گزینه به‌روز نیست؛ عددها تقریبی‌اند');
    }
    // giving up what the money earns where it is now
    o.lost = choice.kind === 'keep' || !srcRate ? 0 : P * (depositGrowth(srcRate, m) - 1);
    // the portfolio right after the move (keeping changes nothing)
    let after = before;
    if (choice.kind !== 'keep') {
      const sh = shape(choice);
      const rows = base.map((r) => ({ ...r }));
      const from = rows.find((r) => r.id === (src ? src.id : '__new'));
      if (from) from.value = Math.max(0, from.value - P);
      rows.push({ id: '__to', value: choice.kind === 'market' ? P * (1 - o.cost / 2) : P, exposure: sh.exposure, liq: sh.liq });
      after = shares(rows.filter((r) => r.value > 0));
    }
    o.after = after;
    return o;
  };
  const A = one(a), B = one(b);
  if (!A || !B) return null;

  // how far a market choice's price must move for it to end level with a fixed one (deposit or keeping it)
  const level = (x, y) => (x.kind === 'market' && y.kind !== 'market' ? y.final / (P * (1 - x.cost)) - 1 : null);
  A.breakEven = level(A, B); B.breakEven = level(B, A);
  for (const o of [A, B]) if (o.breakEven !== null) o.breakEvenAnnual = Math.pow(1 + o.breakEven, 12 / m) - 1;
  return { amount: P, months: m, source, before, a: A, b: B, depositPct };
}

/** Value of each option at given price changes (market options move, fixed ones don't); gA/gB as fractions. */
export function outcome(r, gA = 0, gB = 0) {
  const va = r.a.valueAt(gA), vb = r.b.valueAt(gB);
  return { a: va, b: vb, diff: va - vb };
}
