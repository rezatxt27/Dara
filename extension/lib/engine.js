// Valuation + automation + analytics engine. Pure functions shared by the service worker and the UI.
// All money is Rial. Dates are ISO 'YYYY-MM-DD' (local calendar day); Jalali is used for schedules.
import { CAT, CATEGORIES, EXPOSURES, GOLD_ETFS, TGJU_BY_KEY } from './catalog.js';
import { quoteId, isUsdRef } from './providers.js';
import { todayIso, daysBetween, addDaysIso, addJMonthsIso, isoToJ, jToIso, monthLength, isLeapJ, isoFromDate } from './jalali.js';
import { uid, num } from './format.js';

export { quoteId, isUsdRef, addDaysIso };
const DAY = 86400000;

export const isLiability = (a) => !!CAT[a.category]?.liability;
/** How many events the log keeps (newest first). Each is small; history rebuilds and "all time" returns read them. */
export const EVENTS_MAX = 8000;

/** Exposure of an asset: explicit override → gold ETFs are gold → category default */
export function exposureOf(a) {
  if (a.exposure && EXPOSURES[a.exposure]) return a.exposure;
  const c = CAT[a.category] || CAT.other;
  const key = a.price?.ref?.provider === 'nobitex' ? a.price.ref.key : null;
  if (key === 'usdt') return 'fx';                    // stablecoin ≈ dollar
  if (key === 'paxg' || key === 'xaut') return 'gold'; // gold-backed tokens
  if (a.category === 'stock') {
    const sym = a.price?.ref?.symbol || a.price?.ref?.label || '';
    // Gold ETFs and gold-coin certificates (گواهی سکه، نمادهای «عسکه…») move with gold, not stocks.
    if (GOLD_ETFS.includes(sym) || /^عسکه|^سکه/.test(sym) || /صندوق طلا|طلای «|گواهی سکه/.test(a.name || '')) return 'gold';
  }
  return c.exposure;
}

/* ============================ day-count interest (روزشمار) ============================ */
/** Days in the interest year for a given day. basis: 365 | 366 | 360 | 'actual' (Jalali year length) */
export function yearDays(iso, basis = 365) {
  if (basis === 'actual') return isLeapJ(isoToJ(iso).jy) ? 366 : 365;
  return +basis || 365;
}
/** Σ 1/yearDays over each day in [fromIso, toIso) — multiply by P×rate for simple interest. */
export function dayFactor(fromIso, toIso, basis = 365) {
  const days = daysBetween(fromIso, toIso);
  if (days <= 0) return 0;
  if (basis !== 'actual') return days / (+basis || 365);
  let f = 0, d = fromIso;
  for (let i = 0; i < days; i++) { f += 1 / yearDays(d, 'actual'); d = addDaysIso(d, 1); }
  return f;
}
function fracOfDay(ms) { const d = new Date(ms); return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; }

/** Last monthly anniversary (Jalali day of start) on or before `iso` (and not before start) */
export function prevMonthlyOnOrBefore(startIso, iso) {
  if (iso <= startIso) return startIso;
  const anchor = isoToJ(startIso).jd;
  const s = isoToJ(startIso), l = isoToJ(iso);
  let k = (l.jy - s.jy) * 12 + (l.jm - s.jm) + 1;
  let c = addJMonthsIso(startIso, k, anchor);
  while (c > iso && k > 0) { k--; c = addJMonthsIso(startIso, k, anchor); }
  return k <= 0 ? startIso : c;
}

/**
 * Value of a fixed-income position on day `nowIso` (live fraction of today when nowMs given).
 * modes: payout (روزشمار، سود ماهانه) | compound (روزشمار مرکب) | simple (روزشمار ساده)
 */
export function rateValue(r, nowIso = todayIso(), nowMs = null) {
  if (!r) return 0;
  const P = +r.principal || 0;
  const a = (+r.annualPct || 0) / 100;
  if (!r.start || !P || !a || nowIso < r.start) return P;
  let end = nowIso;
  if (r.maturity && r.maturity < end) end = r.maturity;
  const live = end === nowIso && nowMs ? fracOfDay(nowMs) : 0;
  const basis = r.basis || 365;
  if (r.mode === 'compound') {
    const years = (daysBetween(r.start, end) + live) / 365;
    return P * Math.pow(1 + a, Math.max(0, years));
  }
  if (r.mode === 'simple') {
    return P * (1 + a * (dayFactor(r.start, end, basis) + live / yearDays(end, basis))) + (+r.offset || 0);
  }
  // payout: principal + interest accrued since the last payout (computed from the schedule, not stored state)
  const since = payoutSince(r, end);
  return P + P * a * (dayFactor(since, end, basis) + live / yearDays(end, basis)) + (r.offset && r.offsetFrom === since ? +r.offset : 0);
}
/** Start of the current payout period (last payout, or the last monthly anniversary on/before `end`). */
function payoutSince(r, end) {
  let since = r.lastPayout && r.lastPayout <= end ? r.lastPayout : r.start;
  const prev = prevMonthlyOnOrBefore(r.start, end);
  return prev > since ? prev : since;
}

export function rateDaily(r, value, iso = todayIso()) {
  const a = (+r?.annualPct || 0) / 100;
  if (!a) return 0;
  if (r.maturity && r.maturity < iso) return 0;
  if (r.mode === 'compound') return value * (Math.pow(1 + a, 1 / 365) - 1);
  return (+r.principal || 0) * a / yearDays(iso, r.basis || 365);
}
export function rateMonthly(r, value) {
  const a = (+r?.annualPct || 0) / 100;
  if (!a) return 0;
  if (r.mode === 'compound') return value * (Math.pow(1 + a, 1 / 12) - 1);
  return (+r.principal || 0) * a / 12;
}

/** Next monthly payout date strictly after `afterIso`, anchored on the Jalali day of `startIso`. */
export function nextMonthlyAfter(startIso, afterIso, anchorDay) {
  const s = isoToJ(startIso); const l = isoToJ(afterIso < startIso ? startIso : afterIso);
  const anchor = anchorDay || s.jd;
  let k = Math.max(0, (l.jy - s.jy) * 12 + (l.jm - s.jm));
  let c = addJMonthsIso(startIso, k, anchor);
  let guard = 0;
  while ((c <= afterIso || c <= startIso) && guard++ < 36) { k++; c = addJMonthsIso(startIso, k, anchor); }
  return c;
}

/** Is `iso` the monthly pay day (Jalali day `payDay`, clamped to month length; 0 = last day)? */
export function isPayDay(iso, payDay) {
  const j = isoToJ(iso); const ml = monthLength(j.jy, j.jm);
  const target = !payDay ? ml : Math.min(payDay, ml);
  return j.jd === target;
}

/** Live accrued (unpaid) day-count interest on a bank balance */
export function balanceInterestLive(a, nowIso = todayIso(), nowMs = null) {
  const it = a.interest;
  if (!it?.on || !(+it.annualPct)) return { accrued: 0, daily: 0 };
  const daily = (+a.balance || 0) * (+it.annualPct / 100) / yearDays(nowIso, it.basis || 365);
  const pending = +it.accrued || 0;
  // days not yet processed by the automation (e.g. the extension was closed)
  const from = it.lastAccrual ? addDaysIso(it.lastAccrual, 1) : (it.since || nowIso);
  const missed = from < nowIso ? (+a.balance || 0) * (+it.annualPct / 100) * dayFactor(from, nowIso, it.basis || 365) : 0;
  return { accrued: pending + missed + (nowMs ? daily * fracOfDay(nowMs) : 0), daily };
}

/* ============================ installment loans (وام قسطی) ============================ */
/**
 * Bank-style amortizing loan (debt) or installment receivable. Terms only — the state on any day is computed:
 *  { amount, annualPct, months, firstDue, start?, installment?, anchor?, account?, lastRun?, settledAt? }
 * Monthly rate = yearly ÷ 12. Installment = P·r ÷ (1 − (1+r)^−n) unless given; the last one settles the rest.
 * The first period runs from `start` (disbursement; default one month before the first due) and may be shorter or longer.
 */
export function loanPlan(L) {
  const P = +L?.amount || 0, n = Math.max(1, Math.min(600, Math.round(+L?.months || 0) || 1)), r = (+L?.annualPct || 0) / 1200;
  const due0 = L?.firstDue || todayIso();
  const anchor = +L?.anchor || isoToJ(due0).jd;
  const A = +L?.installment > 0 ? +L.installment : r ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
  const monthBefore = addJMonthsIso(due0, -1, anchor);
  const start = L?.start && L.start < due0 ? L.start : monthBefore;
  const full = daysBetween(monthBefore, due0) || 30;
  const f0 = daysBetween(start, due0) / full;
  const rows = []; let B = P;
  for (let k = 0; k < n && B > 0.5; k++) {
    const date = addJMonthsIso(due0, k, anchor);
    const interest = B * r * (k === 0 ? f0 : 1);
    const pay = k === n - 1 ? B + interest : Math.min(A, B + interest);
    B = Math.max(0, B - (pay - interest));
    rows.push({ k, date, payment: pay, interest, principal: pay - interest, balance: B });
  }
  return { P, n: rows.length, r, A, start, anchor, rows, totalInterest: rows.reduce((t, x) => t + x.interest, 0) };
}

/** Where a loan stands on `iso` (installments due on or before it count as paid). value = principal left + interest accrued. */
export function loanState(L, iso = todayIso(), nowMs = null) {
  const plan = loanPlan(L);
  if (L?.settledAt && iso >= L.settledAt) return { ...plan, paid: plan.rows.filter((x) => x.date < L.settledAt).length, owed: 0, accrued: 0, value: 0, daily: 0, next: null, done: true, settled: true };
  let i = 0; while (i < plan.rows.length && plan.rows[i].date <= iso) i++;
  const owed = i ? plan.rows[i - 1].balance : plan.P;
  if (i >= plan.rows.length || owed <= 0.5) return { ...plan, paid: i, owed: 0, accrued: 0, value: 0, daily: 0, next: null, done: true };
  const next = plan.rows[i];
  const prev = i ? plan.rows[i - 1].date : plan.start;
  if (iso < prev) return { ...plan, paid: 0, owed, accrued: 0, value: owed, daily: 0, next, prev };
  const span = Math.max(1, daysBetween(prev, next.date));
  const el = Math.min(span, daysBetween(prev, iso) + (nowMs ? fracOfDay(nowMs) : 0));
  const accrued = next.interest * el / span;
  return { ...plan, paid: i, owed, accrued, value: owed + accrued, daily: next.interest / span, next, prev };
}

/** The last installment date on or before `iso` (null if none) — installments before tracking started aren't replayed. */
export function loanLastDue(L, iso = todayIso()) {
  const rows = loanPlan(L).rows.filter((x) => x.date <= iso);
  return rows.length ? rows[rows.length - 1].date : null;
}

/**
 * Change what is owed today (extra payment, settlement, more borrowed, or a correction from the bank's page) by re-basing
 * the terms: same rate and installment, starting today, as many installments as it takes. Returns undo records.
 */
export function loanRebase(asset, newOwed, iso = todayIso(), nowMs = Date.now()) {
  const L = asset.loan; const prevLoan = structuredClone(L);
  const st = loanState(L, iso, nowMs);
  // a few rials left over (interest ticking between screen and click) means it's paid off
  if (!(newOwed > Math.max(10, st.value * 1e-5))) {
    asset.loan = { ...L, settledAt: iso };
  } else {
    const A = st.A > 0 ? st.A : newOwed;
    const firstDue = st.next?.date || addJMonthsIso(iso, 1, st.anchor);
    const nl = { ...L, amount: newOwed, start: iso, firstDue, installment: A, anchor: st.anchor, months: 600 };
    delete nl.settledAt;
    // value is linear in the amount: scale so that the value right now equals what is owed (live part of today included)
    const v1 = loanState(nl, iso, nowMs).value;
    if (v1 > 0) nl.amount = newOwed * newOwed / v1;
    // as many installments as the same payment needs (the last one closes it)
    nl.months = Math.max(1, loanPlan(nl).rows.length);
    asset.loan = nl;
  }
  asset.updatedAt = Date.now();
  return [{ assetId: asset.id, field: 'loan', delta: 0, prevLoan }];
}

/* ============================ valuation ============================ */
export function usdRate(quotes) { return quotes['tgju:price_dollar_rl']?.price || quotes['nobitex:usdt']?.price || null; }

export function unitPriceOf(asset, quotes) {
  const p = asset.price || {};
  if (p.source === 'market' && p.ref) {
    const q = quotes[quoteId(p.ref)];
    const adj = (1 + (+p.adjustPct || 0) / 100) * (+p.factor || 1);
    const usd = isUsdRef(p.ref);
    const fx = usd ? usdRate(quotes) : 1;
    if (q && q.price > 0 && fx) return { price: q.price * fx * adj, q, adj, usd };
    if (p.last?.price) return { price: p.last.price, q: q || null, adj, fallback: true, usd };
    return { price: +p.value || 0, q: q || null, adj, fallback: true, usd };
  }
  return { price: +p.value || 0, q: null, adj: 1 };
}

/** Categories whose value is an estimate the owner re-appraises (a house, a car, private shares) — not cash. */
export const APPRAISED = new Set(['property', 'private', 'other']);
/** Statuses that need the owner's attention (shown in «نیاز به توجه»). */
export const ATTENTION = ['stale', 'error', 'delayed', 'matured'];
export const needsAttention = (status) => ATTENTION.includes(status);

export function remindDaysFor(asset, settings) {
  if (asset.remindDays === 0) return 0;
  if (asset.remindDays) return asset.remindDays;
  const d = asset.mode === 'balance' ? settings?.remindDays?.balance ?? 30 : settings?.remindDays?.price ?? 7;
  // A house or private shares aren't re-priced weekly: ask every 3 months unless the owner chose otherwise.
  return APPRAISED.has(asset.category) ? Math.max(d, 90) : d;
}

/**
 * Value a single asset.
 * status: live | delayed (old/approx price) | manual | stale (needs update) | auto | error (no price at all)
 * opts.asOf: value on a past day (history reconstruction) — disables live fractions & staleness.
 */
export function valueOf(asset, quotes = {}, settings = {}, now = Date.now(), opts = {}) {
  const asOf = opts.asOf || null;
  const nowIso = asOf || todayIso();
  const liveMs = asOf ? null : now;
  const liab = isLiability(asset);
  let value = 0, unitPrice = null, at = null, status = 'manual', dayChange = 0, error = null, source = 'manual', q = null, accrued = 0, note = null;
  if (asset.mode === 'units') {
    const u = unitPriceOf(asset, quotes);
    unitPrice = u.price; q = u.q;
    value = (+asset.quantity || 0) * unitPrice;
    if (asset.price?.source === 'market') {
      source = asset.price.ref?.provider || 'market';
      const raw = quotes[quoteId(asset.price.ref || {})];
      if (q && q.price > 0 && !u.fallback) {
        at = q.at || q.fetchedAt;
        const age = now - (q.at || now);
        status = q.error ? 'delayed' : age > 3 * DAY ? 'delayed' : 'live';
        error = q.error || null;
        note = q.note || (q.approx ? 'قیمت تقریبی' : null);
        // today's move: the quote's own change (and, for dollar-priced metals, the dollar's), only if it is today's
        let cp = age > 2 * DAY ? 0 : q.changePct || 0;
        if (u.usd && cp > -1) { const uq = quotes['tgju:price_dollar_rl'] || quotes['nobitex:usdt']; const cu = uq && now - (uq.at || now) <= 2 * DAY ? +uq.changePct || 0 : 0; cp = (1 + cp) * (1 + cu) - 1; }
        dayChange = cp && !asOf ? value * cp / (1 + cp) : 0;
      } else if (u.fallback && (asset.price?.last?.price)) {
        status = 'delayed'; at = asset.price.last.at || null;
        error = raw?.error || (u.usd && !usdRate(quotes) ? 'نرخ دلار برای تبدیل در دسترس نیست' : 'قیمت آنلاین در دسترس نیست؛ آخرین قیمت معتبر استفاده شد');
      } else {
        status = 'error'; at = null;
        error = raw?.error || (asset.price?.ref?.provider === 'tsetmc' && !asset.price.ref.key ? 'نماد هنوز شناسایی نشده' : 'قیمت آنلاین هنوز دریافت نشده');
      }
    } else {
      at = asset.price?.updatedAt || asset.updatedAt;
    }
  } else if (asset.mode === 'loan') {
    const ls = loanState(asset.loan, nowIso, liveMs);
    value = ls.value; source = 'loan'; at = now; status = 'auto';
    dayChange = asOf ? 0 : ls.daily;
    if (ls.done) { status = 'settled'; at = null; dayChange = 0; }
  } else if (asset.mode === 'rate') {
    value = rateValue(asset.rate, nowIso, liveMs);
    status = 'auto'; source = 'rate'; at = now;
    dayChange = asOf ? 0 : rateDaily(asset.rate, value, nowIso);
    if (!asOf && asset.rate?.maturity && asset.rate.maturity < nowIso) {
      // Past maturity it stops growing; the owner should move it to an account or set a new maturity.
      status = 'matured'; at = null;
      error = 'سررسید شده و دیگر سود نمی‌گیرد؛ آن را به حساب منتقل کن یا تاریخ سررسید جدید بگذار';
    }
  } else {
    value = +asset.balance || 0;
    at = asset.balanceAt || asset.updatedAt;
    if (asset.interest?.on && !asOf && !liab) {
      const bi = balanceInterestLive(asset, nowIso, liveMs);
      accrued = bi.accrued; value += accrued; dayChange = bi.daily;
    }
  }
  if (status === 'manual' && !asOf) {
    const rd = remindDaysFor(asset, settings);
    if (rd && at && now - at > rd * DAY) status = 'stale';
  }
  const signedValue = liab ? -value : value;
  const cost = +asset.costBasis || 0;
  const pnl = !liab && cost > 0 ? value - cost : null;
  return { value, signedValue, unitPrice, at, status, error, note, source, accrued, dayChange: liab ? -dayChange : dayChange, pnl, ret: pnl !== null ? pnl / cost : null, quote: q };
}

/** Whole-portfolio analytics */
export function portfolio(assets = [], quotes = {}, settings = {}, now = Date.now(), opts = {}) {
  const rows = [];
  let gross = 0, debt = 0, dayChange = 0, cost = 0, costValue = 0;
  const byCat = {}, byExposure = {}, byLiquidity = { high: 0, mid: 0, low: 0 }, byCustodian = {};
  const attention = [];
  for (const a of assets) {
    if (a.archived) continue;
    if (opts.asOf && a.since && a.since > opts.asOf) continue;
    // a deposit or loan didn't exist before it started
    if (opts.asOf && a.mode === 'rate' && a.rate?.start && a.rate.start > opts.asOf) continue;
    if (opts.asOf && a.mode === 'loan' && a.loan?.firstDue && loanPlan(a.loan).start > opts.asOf) continue;
    const v = valueOf(a, quotes, settings, now, opts);
    const cat = CAT[a.category] || CAT.other;
    const exposure = exposureOf(a);
    rows.push({ asset: a, cat, exposure, ...v });
    if (cat.liability) debt += v.value;
    else {
      gross += v.value;
      byExposure[exposure] = (byExposure[exposure] || 0) + v.value;
      const lq = a.liquidity || cat.liquidity;
      byLiquidity[lq] = (byLiquidity[lq] || 0) + v.value;
      const cust = (a.custodian || a.name || 'نامشخص').trim();
      byCustodian[cust] = (byCustodian[cust] || 0) + v.value;
      if (v.pnl !== null) { cost += +a.costBasis; costValue += v.value; }
    }
    byCat[cat.id] = (byCat[cat.id] || 0) + v.value;
    dayChange += v.dayChange || 0;
    if (needsAttention(v.status)) attention.push({ asset: a, ...v });
  }
  const net = gross - debt;
  const cats = CATEGORIES.filter((c) => byCat[c.id]).map((c) => ({ ...c, value: byCat[c.id], share: gross ? byCat[c.id] / gross : 0 }))
    .sort((x, y) => (x.liability - y.liability) || y.value - x.value);
  const base = net - dayChange;
  return { rows, gross, debt, net, dayChange, dayChangePct: base ? dayChange / Math.abs(base) : 0, cats, byExposure, byLiquidity, byCustodian, attention,
    pnl: cost ? costValue - cost : null, pnlPct: cost ? (costValue - cost) / cost : null };
}

/* ============================ denominations ============================ */
export function denomRates(quotes) {
  return { usd: usdRate(quotes), gold: quotes['tgju:geram18']?.price || null, coin: quotes['tgju:sekee']?.price || null };
}
export const DENOMS = {
  money: { name: 'تومان' },
  usd: { name: 'دلار', unit: 'دلار' },
  gold: { name: 'گرم طلا', unit: 'گرم طلای ۱۸' },
  coin: { name: 'سکه', unit: 'سکه امامی' },
};

/* ============================ deltas, events & automations ============================ */
/**
 * Money flowing INTO an asset (negative = out) on day `iso` (default today). Returns change records for undo.
 * Each change's effect on the asset's value equals the money moved (a deposit's new money earns from that day on).
 */
export function applyDelta(asset, delta, quotes = {}, iso = todayIso()) {
  const liab = isLiability(asset);
  const changes = [];
  const nowMs = iso === todayIso() ? Date.now() : null;
  const rec = (field, d, extra) => { if (d) changes.push({ assetId: asset.id, field, delta: d, ...(extra || {}) }); };
  if (asset.mode === 'loan') {
    // paying a debt lowers what is owed; for a receivable, money taken out of it does
    const st = loanState(asset.loan, iso, nowMs);
    changes.push(...loanRebase(asset, Math.max(0, st.value + (liab ? -delta : delta)), iso, nowMs));
  } else if (asset.mode === 'rate') {
    const d = liab ? -delta : delta;
    const r = asset.rate; const a = (+r.annualPct || 0) / 100;
    const started = a && r.start && r.start < iso;
    // after maturity the deposit stops growing: interest counts only up to maturity
    const end = r.maturity && r.maturity < iso ? r.maturity : iso;
    const live = end === iso && nowMs ? fracOfDay(nowMs) : 0;
    if (started && r.mode === 'compound') {
      // same value now, grows only from now on (the value is proportional to the principal)
      const v = rateValue(r, iso, nowMs);
      const dp = +r.principal > 0 && v > 0 ? d * (+r.principal) / v : d / Math.pow(1 + a, (daysBetween(r.start, end) + live) / 365);
      r.principal = (+r.principal || 0) + dp; rec('rate.principal', dp, { value: delta });
    } else {
      r.principal = (+r.principal || 0) + d; rec('rate.principal', d);
      if (started) {
        // simple: interest on d for [start, end) never existed; payout: same, until the next payout
        const since = r.mode === 'payout' ? payoutSince(r, end) : r.start;
        const off = -d * a * (dayFactor(since, end, r.basis || 365) + live / yearDays(end, r.basis || 365));
        if (r.mode === 'payout' && r.offsetFrom !== since) { if (r.offset) rec('rate.offset', -r.offset); r.offset = 0; r.offsetFrom = since; }
        if (off) { r.offset = (+r.offset || 0) + off; rec('rate.offset', off); }
      }
    }
  } else if (asset.mode === 'units') {
    const { price } = unitPriceOf(asset, quotes);
    if (price > 0) {
      const q0 = +asset.quantity || 0;
      const dq = delta / price;
      asset.quantity = q0 + dq; rec('quantity', dq);
      const cb = +asset.costBasis || 0;
      if (delta > 0) { asset.costBasis = cb + delta; rec('costBasis', delta); }
      else if (cb && q0 > 0) { const dc = cb * (dq / q0); asset.costBasis = cb + dc; rec('costBasis', dc); }
    }
  } else {
    const d = liab ? -delta : delta;
    asset.balance = (+asset.balance || 0) + d; rec('balance', d);
    asset.balanceAt = Date.now();
  }
  asset.updatedAt = Date.now();
  return changes;
}

function getField(a, f) {
  if (f === 'rate.principal') return +a.rate?.principal || 0;
  if (f === 'interest.accrued') return +a.interest?.accrued || 0;
  if (f === 'rate.offset') return +a.rate?.offset || 0;
  return +a[f] || 0;
}
function setField(a, f, v) {
  if (f === 'rate.principal') a.rate.principal = v;
  else if (f === 'interest.accrued') { if (a.interest) a.interest.accrued = v; }
  else if (f === 'rate.offset') { if (a.rate) a.rate.offset = v; }
  else a[f] = v;
}

/** Step the asset list back past one event (history rebuild): bring back a removed asset, the record before a
 *  change of valuation method, then reverse the numeric changes. Mutates `state`. */
export function revertEvent(state, ev) {
  if (ev.restore && !state.some((a) => a.id === ev.restore.id)) state.push(structuredClone(ev.restore));
  if (ev.fund) {
    // bought (or borrowed) that day with an account's money: before it, only the account held that money
    const id = ev.changes?.find((c) => c.field === 'add')?.assetId;
    const i = state.findIndex((a) => a.id === id); if (i >= 0) state.splice(i, 1);
  }
  if (ev.prev) {
    const i = state.findIndex((a) => a.id === ev.prev.id);
    if (i >= 0) state[i] = structuredClone(ev.prev);
    return undoEvent(state, { ...ev, changes: (ev.changes || []).filter((c) => c.assetId !== ev.prev.id) });
  }
  return undoEvent(state, ev);
}
const UNDOABLE = new Set(['quantity', 'balance', 'costBasis', 'rate.principal', 'rate.offset', 'interest.accrued']);
export function undoEvent(assets, ev) {
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  for (const c of [...(ev.changes || [])].reverse()) {
    const a = byId[c.assetId];
    // earlier terms come back, but installments already applied stay applied (never paid twice)
    if (a && c.field === 'loan' && c.prevLoan) { a.loan = { ...structuredClone(c.prevLoan), lastRun: a.loan?.lastRun ?? c.prevLoan.lastRun }; a.updatedAt = Date.now(); continue; }
    if (!a || typeof c.delta !== 'number' || !UNDOABLE.has(c.field)) continue;
    setField(a, c.field, getField(a, c.field) - c.delta);
    a.updatedAt = Date.now();
  }
  return assets;
}

/** Occurrence dates of a recurring flow in (afterIso, untilIso] */
export function flowOccurrences(flow, afterIso, untilIso, limit = 400) {
  const out = [];
  if (!flow.start) return out;
  const end = flow.end && flow.end < untilIso ? flow.end : untilIso;
  let k = 0, d, guard = 0;
  const startJ = isoToJ(flow.start);
  const anchor = flow.day || startJ.jd;
  const base = flow.freq === 'monthly' || flow.freq === 'yearly'
    ? jToIso(startJ.jy, startJ.jm, Math.min(anchor, monthLength(startJ.jy, startJ.jm)))
    : flow.start;
  if (base < flow.start) k = 1;
  const step = flow.freq === 'yearly' ? 12 : 1;
  let done = +flow.done || 0;
  while (guard++ < 5000 && out.length < limit) {
    if (flow.freq === 'weekly') d = addDaysIso(flow.start, 7 * k);
    else if (flow.freq === 'daily') d = addDaysIso(flow.start, k);
    else d = addJMonthsIso(base, step * k, anchor);
    k++;
    if (d > end) break;
    if (d <= afterIso) continue;
    if (flow.count && done >= flow.count) break;
    out.push(d); done++;
  }
  return out;
}

export function flowMonthly(flow) {
  const a = +flow.amount || 0;
  return flow.freq === 'weekly' ? a * 52 / 12 : flow.freq === 'yearly' ? a / 12 : flow.freq === 'daily' ? a * 365 / 12 : a;
}

/**
 * Apply everything due up to today — deposit payouts, installment loans, recurring flows and day-count interest on
 * bank balances — in date order, day by day. So catching up after the browser was closed for weeks gives exactly the
 * numbers a daily run would have (a salary that landed mid-gap earns interest from its own day, etc.).
 * Each day: the bank's monthly interest payout (for days before), then that day's moves, then (for finished days)
 * interest on the end-of-day balance. Mutates; returns { assets, flows, events }.
 */
export function applyAutomations(assets, flows, quotes = {}, today = todayIso()) {
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const ok = (id) => id && byId[id] && !byId[id].archived ? byId[id] : null;
  const events = [];
  const at = Date.now();
  // what is pending, by day
  const due = new Map(); const push = (d, job) => { if (!due.has(d)) due.set(d, []); due.get(d).push(job); };
  let first = today;
  // deposits with a monthly payout (the next payout depends on the last one, so they are scheduled lazily)
  const payers = assets.filter((a) => !a.archived && a.mode === 'rate' && a.rate?.mode === 'payout' && a.rate.start && +a.rate.annualPct);
  const nextPayout = (r) => { const n = nextMonthlyAfter(r.start, r.lastPayout || r.start); return r.maturity && n > r.maturity ? null : n; };
  for (const a of payers) { const n = nextPayout(a.rate); if (n && n < first) first = n; }
  // installment loans
  for (const a of assets) {
    if (a.archived || a.mode !== 'loan' || !a.loan?.firstDue) continue;
    const L = a.loan; const plan = loanPlan(L);
    for (const row of plan.rows) {
      if (row.date > today || (L.settledAt && row.date >= L.settledAt)) break;
      if (L.lastRun && row.date <= L.lastRun) continue;
      push(row.date, { kind: 'loan', a, row, n: plan.n }); if (row.date < first) first = row.date;
    }
  }
  // recurring flows (an account that no longer exists pauses the flow instead of moving money to nowhere)
  for (const f of flows) {
    if (!f.active || !(+f.amount)) continue;
    if ((f.fromId && !byId[f.fromId]) || (f.toId && !byId[f.toId])) { f.active = false; f.paused = 'missing'; continue; }
    for (const d of flowOccurrences(f, f.lastRun || addDaysIso(f.start, -1), today, 60)) { push(d, { kind: 'flow', f }); if (d < first) first = d; }
  }
  // bank accounts with day-count interest
  const banks = assets.filter((a) => !a.archived && a.mode === 'balance' && a.interest?.on && +a.interest.annualPct && !isLiability(a));
  const bankFrom = (it) => (it.lastAccrual ? addDaysIso(it.lastAccrual, 1) : it.since || today);
  for (const a of banks) { const d = bankFrom(a.interest); if (d < first) first = d; }
  const floor = addDaysIso(today, -1500);
  if (first < floor) first = floor;

  let guard = 0;
  for (let d = first; d <= today && guard++ < 1600; d = addDaysIso(d, 1)) {
    // a) monthly payout of the bank interest accrued on the days before
    for (const a of banks) {
      const it = a.interest;
      if (d < bankFrom(it) || (it.lastPaid && it.lastPaid >= d)) continue;
      if (isPayDay(d, it.payDay) && (+it.accrued || 0) >= 1 && (!it.since || d > it.since)) {
        const amt = Math.floor(it.accrued);
        it.accrued -= amt; it.lastPaid = d;
        const changes = applyDelta(a, amt, quotes, d);
        changes.push({ assetId: a.id, field: 'interest.accrued', delta: -amt });
        events.push({ id: uid('e'), kind: 'interest', date: d, at, title: `سود روزشمار «${a.name}»`, amount: amt, fromId: a.id, toId: a.id, changes });
      }
    }
    // b) deposit payouts falling on this day
    for (const a of payers) {
      const r = a.rate; const n = nextPayout(r);
      if (n !== d) continue;
      const last = r.lastPayout || r.start;
      let interest = Math.round((+r.principal || 0) * (+r.annualPct / 100) * dayFactor(last, n, r.basis || 365));
      // money added mid-period earned only from the day it came in
      const off = r.offset && r.offsetFrom === last ? +r.offset : 0;
      if (off) { interest = Math.round(interest + off); r.offset = 0; }
      // a debt's interest adds to the debt itself; an asset's goes to the chosen account (or stays in it)
      const target = !isLiability(a) && r.payoutTo && r.payoutTo !== 'self' ? ok(r.payoutTo) : null;
      let changes;
      if (target) changes = applyDelta(target, interest, quotes, d);
      else { r.principal = (+r.principal || 0) + interest; changes = [{ assetId: a.id, field: 'rate.principal', delta: interest }]; }
      if (off) changes.push({ assetId: a.id, field: 'rate.offset', delta: -off });
      r.lastPayout = n;
      events.push({ id: uid('e'), kind: 'interest', date: n, at, title: `${isLiability(a) ? 'سود اضافه‌شده به' : 'واریز سود'} «${a.name}»`, amount: interest,
        fromId: a.id, toId: target ? target.id : a.id, changes });
    }
    // c) installments and recurring flows of this day
    for (const job of due.get(d) || []) {
      if (job.kind === 'loan') {
        const { a, row } = job; const L = a.loan; const liab = isLiability(a);
        const amt = Math.round(row.payment);
        const acc = ok(L.account);
        const changes = acc ? applyDelta(acc, liab ? -amt : amt, quotes, d) : [];
        L.lastRun = row.date;
        events.push({ id: uid('e'), kind: 'loan', date: row.date, at, title: `${liab ? 'قسط' : 'دریافت قسط'} «${a.name}» (${num(row.k + 1)} از ${num(job.n)})`, amount: amt,
          fromId: liab ? acc?.id || null : a.id, toId: liab ? a.id : acc?.id || null, changes, noUndo: true });
      } else {
        const { f } = job; const changes = [];
        if (f.fromId) changes.push(...applyDelta(byId[f.fromId], -f.amount, quotes, d));
        if (f.toId) changes.push(...applyDelta(byId[f.toId], +f.amount, quotes, d));
        f.lastRun = d; f.done = (+f.done || 0) + 1;
        events.push({ id: uid('e'), kind: 'flow', flowId: f.id, date: d, at, title: f.title, amount: +f.amount, fromId: f.fromId || null, toId: f.toId || null, changes });
      }
    }
    // d) a finished day earns interest on its end-of-day balance
    if (d < today) for (const a of banks) {
      const it = a.interest;
      if (d < bankFrom(it)) continue;
      it.accrued = (+it.accrued || 0) + (+a.balance || 0) * (+it.annualPct / 100) / yearDays(d, it.basis || 365);
      it.lastAccrual = d;
    }
  }
  return { assets, flows, events };
}

/** Upcoming scheduled events within the next `days` days */
export function upcoming(assets, flows, days = 30, today = todayIso()) {
  const until = addDaysIso(today, days);
  const list = [];
  for (const a of assets) {
    if (a.archived) continue;
    if (a.mode === 'rate' && a.rate?.start && +a.rate.annualPct) {
      const r = a.rate;
      if (r.mode === 'payout') {
        let last = prevMonthlyOnOrBefore(r.start, today); let g = 0;
        if (r.lastPayout && r.lastPayout > last) last = r.lastPayout;
        const liab = isLiability(a);
        while (g++ < 6) {
          const next = nextMonthlyAfter(r.start, last);
          if (next > until || (r.maturity && next > r.maturity)) break;
          const off = r.offset && r.offsetFrom === last ? +r.offset : 0; // money added mid-period earns from its own day
          list.push({ date: next, kind: 'interest', title: `${liab ? 'سود اضافه‌شده به' : 'سود'} «${a.name}»`, amount: Math.round(r.principal * r.annualPct / 100 * dayFactor(last, next, r.basis || 365) + off), assetId: a.id,
            toId: !liab && r.payoutTo && r.payoutTo !== 'self' ? r.payoutTo : a.id });
          last = next;
        }
      }
      if (r.maturity && r.maturity >= today && r.maturity <= until) list.push({ date: r.maturity, kind: 'maturity', title: `سررسید «${a.name}»`, amount: rateValue(r, r.maturity), assetId: a.id });
    }
    if (a.mode === 'balance' && a.interest?.on && +a.interest.annualPct && !isLiability(a)) {
      let d = addDaysIso(today, 1), g = 0;
      while (d <= until && g++ < 70) {
        if (isPayDay(d, a.interest.payDay)) {
          const est = (+a.balance || 0) * (+a.interest.annualPct / 100) * 30 / yearDays(d, a.interest.basis || 365);
          list.push({ date: d, kind: 'interest', title: `سود روزشمار «${a.name}»`, amount: Math.round(est), assetId: a.id, toId: a.id, estimate: true });
          break;
        }
        d = addDaysIso(d, 1);
      }
    }
  }
  for (const a of assets) {
    if (a.archived || a.mode !== 'loan' || !a.loan?.firstDue) continue;
    const st = loanState(a.loan, today);
    if (st.done) continue;
    const liab = isLiability(a);
    for (const row of st.rows.slice(st.paid)) {
      if (row.date > until) break;
      list.push({ date: row.date, kind: 'loan', title: `${liab ? 'قسط' : 'دریافت قسط'} «${a.name}»`, amount: Math.round(row.payment), assetId: a.id,
        fromId: liab ? a.loan.account || null : a.id, toId: liab ? a.id : a.loan.account || null });
    }
  }
  for (const f of flows) {
    if (!f.active) continue;
    const yesterday = addDaysIso(today, -1);
    const after = f.lastRun && f.lastRun > yesterday ? f.lastRun : yesterday;
    for (const d of flowOccurrences(f, after, until, 10)) list.push({ date: d, kind: 'flow', title: f.title, amount: f.amount, flowId: f.id, fromId: f.fromId, toId: f.toId });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A typical month, automatically: interest earned (deposits, day-count accounts, the interest part of installments
 * you receive), money in and out (recurring flows; a flow that pays a debt counts as money out), installments paid or
 * received, and interest owed on debts. net = what the month adds to (or takes from) your cash and wealth.
 */
export function monthlyAuto(assets, flows, today = todayIso()) {
  let interest = 0, inflow = 0, outflow = 0, loanPay = 0, loanGet = 0, loanInterest = 0, debtInterest = 0;
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  for (const a of assets) {
    if (a.archived || a.mode !== 'loan') continue;
    const st = loanState(a.loan, today);
    if (st.done) continue;
    if (isLiability(a)) { loanPay += st.next.payment; loanInterest += st.next.interest; }
    else { loanGet += st.next.payment; interest += st.next.interest; }
  }
  for (const a of assets) {
    if (a.archived || a.mode === 'loan') continue;
    if (a.mode === 'rate' && !(a.rate?.maturity && a.rate.maturity < today)) {
      const m = rateMonthly(a.rate, rateValue(a.rate, today));
      if (isLiability(a)) debtInterest += m; else interest += m;
    }
    if (a.mode === 'balance' && a.interest?.on && !isLiability(a)) interest += (+a.balance || 0) * (+a.interest.annualPct || 0) / 100 / 12;
  }
  const liabId = (id) => !!(id && byId[id] && isLiability(byId[id]));
  for (const f of flows) {
    if (!f.active) continue;
    const m = flowMonthly(f);
    if (f.toId && !f.fromId) inflow += m;
    else if (f.fromId && !f.toId) outflow += m;
    else if (f.fromId && liabId(f.toId)) outflow += m; // paying a debt from an account
  }
  // installments leave (or reach) the accounts every month; their interest part is the real cost (or income)
  return { interest, inflow, outflow, loanPay, loanGet, loanInterest, debtInterest,
    net: interest + inflow - outflow - loanPay + loanGet - debtInterest };
}

/* ============================ snapshots & series ============================ */
export function makeSnapshot(pf, quotes, extra = {}) {
  const cats = {}; for (const c of pf.cats) cats[c.id] = Math.round(c.value);
  // an asset whose price hasn't arrived yet is left out, so its first real value counts as its start, not as a gain
  const v = {}; for (const r of pf.rows) if (!(r.status === 'error' && !r.value)) v[r.asset.id] = Math.round(r.signedValue);
  const d = denomRates(quotes);
  return { t: Math.round(pf.net), g: Math.round(pf.gross), l: Math.round(pf.debt), usd: d.usd, gold: d.gold, coin: d.coin, cats, v, at: Date.now(), ...extra };
}
export function pruneSnapshots(snaps, keepDays = 1500) {
  const keys = Object.keys(snaps).sort();
  if (keys.length <= keepDays) return snaps;
  const out = {}; keys.slice(-keepDays).forEach((k) => (out[k] = snaps[k]));
  return out;
}
export function seriesFrom(snaps, denom = 'money', days = 90, today = todayIso()) {
  const from = days ? addDaysIso(today, -days) : '0000';
  return Object.keys(snaps).sort().filter((k) => k >= from).map((k) => {
    const s = snaps[k];
    let v = s.t;
    if (denom === 'usd') v = s.usd ? s.t / s.usd : null;
    if (denom === 'gold') v = s.gold ? s.t / s.gold : null;
    if (denom === 'coin') v = s.coin ? s.t / s.coin : null;
    return { date: k, value: v, est: !!s.est };
  }).filter((p) => p.value !== null && isFinite(p.value));
}
/** Snapshot on/before `days` ago (strictly before today for days ≥ 1) */
export function snapshotBefore(snaps, days, today = todayIso()) {
  const target = addDaysIso(today, -days);
  const keys = Object.keys(snaps).sort().filter((k) => k <= target);
  const k = keys[keys.length - 1];
  return k ? { date: k, snap: snaps[k] } : null;
}
export function changeSince(snaps, days, currentNet, today = todayIso()) {
  const s = snapshotBefore(snaps, days, today);
  if (!s) return null;
  const base = s.snap.t;
  return { base, date: s.date, abs: currentNet - base, pct: base ? (currentNet - base) / Math.abs(base) : 0, est: !!s.snap.est };
}

/**
 * Money moved since snapshot `s` ({date, snap}), from the event log.
 * flow: per-asset money in/out (transfers, deposits, buys…); edit: per-asset manual corrections, captures, additions, removals;
 * external: net money that entered (+) or left (−) the portfolio; dated: [{date, amount}] of external money and edits;
 * byAsset: {assetId: [{date, at, amount}]} every flow/edit increment per asset.
 * A change record may carry `value` (signed Rial value at the time); otherwise quantity changes are valued at today's price.
 */
export function eventEffects(events, s, byId, nowById = {}) {
  const flow = {}; const edit = {}; let external = 0; const dated = []; const byAsset = {};
  let cur = null;
  const add = (m, id, v, removal = false) => { if (id) { m[id] = (m[id] || 0) + v; (byAsset[id] ||= []).push({ date: cur.date, at: cur.at || 0, amount: v, kind: m === flow ? 'flow' : 'edit', ...(removal ? { removal: true } : {}) }); } };
  for (const e of events || []) {
    if (e.undone || !e.date) continue;
    // Real snapshots: count events applied after the snapshot was taken. Rebuilt snapshots: by event date.
    const after = s.snap.est || !s.snap.at ? e.date > s.date : (e.at || 0) > s.snap.at;
    if (!after) continue;
    const amt = +e.amount || 0;
    cur = e;
    if (e.kind === 'edit' || e.kind === 'capture') {
      let sum = 0;
      for (const c of e.changes || []) {
        const a = byId[c.assetId];
        let v = null;
        if (typeof c.value === 'number') v = c.value; // signed value recorded when it happened (additions, removals)
        else if (a && typeof c.delta === 'number') {
          const liab = isLiability(a);
          let x = 0;
          if (c.field === 'balance' || c.field === 'rate.principal') x = c.delta;
          else if (c.field === 'quantity') x = c.delta * (nowById[a.id]?.unitPrice || 0);
          v = liab ? -x : x;
        }
        if (c.reval) continue; // the owner re-appraised it (house, car, private shares): a market move, not money
        // registering something the starting point already counts (e.g. a rebuilt history) isn't money brought in
        if (c.field === 'add' && !e.fund && s.snap.v?.[c.assetId] !== undefined) continue;
        if (c.field === 'remove') { add(edit, c.assetId, v || 0, true); sum += v || 0; continue; }
        if (v === null || !v) continue;
        add(edit, c.assetId, v); sum += v;
      }
      if (sum) dated.push({ date: e.date, amount: sum, kind: 'edit' });
      continue;
    }
    if (e.kind === 'interest' && e.fromId === e.toId) continue; // bank day-count interest = return, not a flow
    if (e.toId) add(flow, e.toId, amt);
    if (e.fromId) add(flow, e.fromId, -amt);
    if (e.toId && !e.fromId) { external += amt; dated.push({ date: e.date, amount: amt, kind: 'in' }); }
    if (e.fromId && !e.toId) { external -= amt; dated.push({ date: e.date, amount: -amt, kind: 'out' }); }
  }
  return { flow, edit, external, dated, byAsset };
}

/* ============================ “why did it change?” attribution ============================ */
/**
 * Split the change of each asset since `days` ago into market effect vs money moved in/out.
 * flow semantics: contribution to the asset's signed value from events (transfers, deposits, buys…).
 * Each row also carries `moves`: the dated non-market amounts (Σ moves = flow + edit), used by performance().
 */
export function attribution(assets, quotes, settings, snaps, events, days = 1, today = todayIso(), pf = null) {
  const s = snapshotBefore(snaps, days, today);
  if (!s) return null;
  pf = pf || portfolio(assets, quotes, settings);
  const nowById = Object.fromEntries(pf.rows.map((r) => [r.asset.id, r]));
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const { flow, edit, external, byAsset } = eventEffects(events, s, byId, nowById);
  const keys = Object.keys(snaps).sort().filter((k) => k > s.date);
  const sum = (list) => list.reduce((x, m) => x + m.amount, 0);
  const ids = new Set([...Object.keys(s.snap.v || {}), ...pf.rows.map((r) => r.asset.id), ...Object.keys(byAsset)]);
  const rows = [];
  let added = 0;
  for (const id of ids) {
    const now = nowById[id]?.signedValue ?? 0;
    const then = s.snap.v?.[id];
    const a = byId[id] || nowById[id]?.asset;
    const moves = byAsset[id] || [];
    const fl = flow[id] || 0, ed = edit[id] || 0;
    if (then === undefined) {
      // Added during the period. If a later snapshot already holds it, that value is its starting point
      // (an addition on that day) and only later money counts; otherwise use its own events.
      const k1 = keys.find((k) => snaps[k]?.v?.[id] !== undefined);
      const sn = k1 ? snaps[k1] : null;
      const later = sn ? moves.filter((m) => (sn.est || !sn.at ? m.date > k1 : m.at > sn.at)) : [];
      // the later snapshot is its starting point only if nothing was recorded for it before (else its own events tell)
      if (k1 && later.length === moves.length) {
        const v1 = sn.v[id];
        const mv = [{ date: k1, amount: v1, kind: 'edit' }, ...later];
        if (!now && !v1 && !later.length) continue;
        const f1 = sum(later.filter((m) => m.kind === 'flow')); const e1 = v1 + sum(later.filter((m) => m.kind !== 'flow'));
        added += v1;
        rows.push({ id, asset: a, then: 0, now, delta: now, flow: f1, edit: e1, market: now - f1 - e1, isNew: true, moves: mv });
        continue;
      }
      if (moves.length) { rows.push({ id, asset: a, then: 0, now, delta: now, flow: fl, edit: ed, market: now - fl - ed, isNew: true, moves }); added += ed; continue; }
      if (now) { added += now; rows.push({ id, asset: a, then: 0, now, delta: now, flow: 0, edit: now, market: 0, isNew: true, moves: [{ date: a?.createdAt ? isoFromDate(new Date(a.createdAt)) : today, amount: now }] }); }
      continue;
    }
    const delta = now - then;
    if (!a || a.archived) {
      // Removed or archived. With a recorded removal (value at that moment) the market effect up to then is kept;
      // without one (older data) the whole change is treated as bookkeeping, dated after its last snapshot.
      if (moves.some((m) => m.removal) || ed) { rows.push({ id, asset: a, then, now, delta, flow: fl, edit: ed, market: delta - fl - ed, removed: true, moves }); continue; }
      const last = [...keys].reverse().find((k) => snaps[k]?.v?.[id] !== undefined);
      const when = last ? addDaysIso(last, 1) : today;
      rows.push({ id, asset: a, then, now, delta, flow: fl, edit: delta - fl, market: 0, removed: true, moves: [...moves, { date: when > today ? today : when, amount: delta - fl - ed, kind: 'edit' }] });
      continue;
    }
    rows.push({ id, asset: a, then, now, delta, flow: fl, edit: ed, market: delta - fl - ed, moves });
  }
  const total = pf.net - s.snap.t;
  const editsTotal = rows.reduce((x, r) => x + r.edit, 0);
  const marketTotal = rows.reduce((x, r) => x + r.market, 0);
  // Category roll-up of market effect
  const catMap = {};
  for (const r of rows) {
    const cat = CAT[r.asset?.category] || CAT.other;
    const k = r.asset ? (exposureOf(r.asset) === 'gold' && cat.id === 'stock' ? 'gold_etf' : cat.id) : 'other';
    const c = catMap[k] ||= { id: k, name: k === 'gold_etf' ? 'صندوق‌های طلا' : cat.short, color: k === 'gold_etf' ? '#E0A800' : cat.color, market: 0, flow: 0, edit: 0, delta: 0 };
    c.market += r.market; c.flow += r.flow; c.edit += r.edit; c.delta += r.delta;
  }
  const cats = Object.values(catMap).filter((c) => Math.abs(c.market) >= 1 || Math.abs(c.flow) >= 1 || Math.abs(c.edit) >= 1)
    .sort((a, b) => Math.abs(b.market) - Math.abs(a.market));
  return { from: s.date, est: !!s.snap.est, base: s.snap.t, now: pf.net, total, pct: s.snap.t ? total / Math.abs(s.snap.t) : 0,
    market: marketTotal, external, edits: editsTotal, internal: rows.reduce((x, r) => x + r.flow, 0) - external, rows: rows.sort((a, b) => Math.abs(b.market) - Math.abs(a.market)), cats, added, byAsset, snap: s.snap };
}

/* ============================ scenario simulator ============================ */
/**
 * shocks (fractions): usd (rial/dollar), gold (ounce in USD), crypto (USD), metals (USD), equity (TSE), private, real.
 * Gold in Iran ≈ ounce × dollar, so a dollar jump lifts gold, crypto and metals too.
 */
export function shockFactor(a, s = {}) {
  if (isLiability(a)) return 1;
  const usd = 1 + (+s.usd || 0);
  const exp = exposureOf(a);
  switch (exp) {
    case 'fx': return usd;
    case 'gold': return usd * (1 + (+s.gold || 0));
    case 'commodity': return usd * (1 + (+s.metals || 0));
    case 'crypto': return usd * (1 + (+s.crypto || 0));
    case 'equity': return a.category === 'private' ? 1 + (s.private ?? s.equity ?? 0) : 1 + (+s.equity || 0);
    case 'real': return 1 + (+s.real || 0);
    default: return 1;
  }
}
export function simulate(assets, quotes, settings, shocks = {}, pf = null) {
  pf = pf || portfolio(assets, quotes, settings);
  const rows = pf.rows.map((r) => { const f = shockFactor(r.asset, shocks); return { asset: r.asset, cat: r.cat, exposure: r.exposure, before: r.signedValue, after: r.signedValue * f, factor: f }; });
  const after = rows.reduce((x, r) => x + r.after, 0);
  const before = pf.net;
  const rates = denomRates(quotes);
  const usd1 = rates.usd ? rates.usd * (1 + (+shocks.usd || 0)) : null;
  const gold1 = rates.gold ? rates.gold * (1 + (+shocks.usd || 0)) * (1 + (+shocks.gold || 0)) : null;
  const byExp = {};
  for (const r of rows) {
    if (r.cat.liability) continue;
    const e = byExp[r.exposure] ||= { id: r.exposure, name: EXPOSURES[r.exposure]?.name || r.exposure, color: EXPOSURES[r.exposure]?.color, before: 0, after: 0 };
    e.before += r.before; e.after += r.after;
  }
  return {
    before, after, delta: after - before, pct: before ? (after - before) / Math.abs(before) : 0,
    usdBefore: rates.usd ? before / rates.usd : null, usdAfter: usd1 ? after / usd1 : null,
    goldBefore: rates.gold ? before / rates.gold : null, goldAfter: gold1 ? after / gold1 : null,
    rows: rows.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)),
    exposures: Object.values(byExp).sort((a, b) => b.before - a.before),
  };
}

/* ============================ history reconstruction (backfill) ============================ */
function lastOnOrBefore(series, iso) {
  // series ascending [{date, close}]
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (series[m].date <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? series[ans].close : null;
}
/**
 * Rebuild daily snapshots for the past `days` days from historical prices.
 * hist: { quoteId: [{date, close}] } in native units (USD for usd refs). Holdings are rolled back
 * through the event log; manual prices/balances without history are held constant (snapshot.est = 1).
 */
export function reconstructHistory(assets, events, hist, quotesNow, settings, days = 365, today = todayIso()) {
  const state = structuredClone(assets.filter((a) => !a.archived));
  const evs = (events || []).filter((e) => !e.undone && e.date && (e.changes?.length || e.restore)).sort((a, b) => b.date.localeCompare(a.date));
  let ei = 0;
  const out = {};
  const ids = Object.keys(quotesNow);
  for (let i = 1; i <= days; i++) {
    const d = addDaysIso(today, -i);
    while (ei < evs.length && evs[ei].date > d) { revertEvent(state, evs[ei]); ei++; }
    const q = {};
    for (const id of ids) {
      const series = hist[id];
      const p = series?.length ? lastOnOrBefore(series, d) : null;
      if (p > 0) q[id] = { price: p, at: 0, changePct: 0 };
      else if (series?.length && d < series[0].date) q[id] = { price: series[0].close, at: 0, changePct: 0 };
      else if (quotesNow[id]?.price > 0) q[id] = { ...quotesNow[id], changePct: 0 };
    }
    for (const a of state) if (a.mode === 'balance' && a.interest) a.interest = { ...a.interest, on: false };
    const pf = portfolio(state, q, settings, Date.now(), { asOf: d });
    out[d] = makeSnapshot(pf, q, { est: 1 });
  }
  return out;
}

/* ============================ weekly facts & narrative ============================ */
export function weeklyFacts(st, today = todayIso(), days = 7) {
  const { assets, quotes, settings, snapshots, events, flows } = st;
  const pf = portfolio(assets, quotes, settings);
  const att = attribution(assets, quotes, settings, snapshots, events, days, today, pf);
  const ch = changeSince(snapshots, days, pf.net, today);
  const s0 = snapshotBefore(snapshots, days, today)?.snap;
  const rates = denomRates(quotes);
  // change measured in dollars / grams of gold (relative to the size of the start, so a negative start keeps its sign)
  const inUnit = (r0, r1) => { if (!(r0 > 0 && r1 > 0) || !s0?.t) return null; const x0 = s0.t / r0, x1 = pf.net / r1; return (x1 - x0) / Math.abs(x0); };
  const usdPct = inUnit(s0?.usd, rates.usd);
  const goldPct = inUnit(s0?.gold, rates.gold);
  const from = addDaysIso(today, -days);
  const evs = (events || []).filter((e) => !e.undone && e.date > from);
  const interest = evs.filter((e) => e.kind === 'interest').reduce((x, e) => x + e.amount, 0);
  const g = pf.gross || 1;
  const top = pf.rows.filter((r) => !r.cat.liability).sort((a, b) => b.value - a.value)[0];
  const next = upcoming(assets, flows || [], 7, today);
  const marketMovers = (att?.rows || []).filter((r) => Math.abs(r.market) > 0).slice(0, 5).map((r) => ({ name: r.asset?.name || '—', market: Math.round(r.market) }));
  const priceMoves = ['tgju:geram18', 'tgju:price_dollar_rl', 'tgju:sekee', 'nobitex:btc'].map((id) => {
    const q = quotes[id]; return q?.price ? { id, name: { 'tgju:geram18': 'طلای ۱۸', 'tgju:price_dollar_rl': 'دلار', 'tgju:sekee': 'سکه امامی', 'nobitex:btc': 'بیت‌کوین' }[id], price: q.price, dayPct: q.changePct || 0 } : null;
  }).filter(Boolean);
  return {
    period: { from, to: today, days }, hasBase: !!ch, net: Math.round(pf.net), gross: Math.round(pf.gross), debt: Math.round(pf.debt),
    change: ch ? { abs: Math.round(ch.abs), pct: ch.pct, estimated: ch.est } : null, usdPct, goldPct,
    market: att ? Math.round(att.market) : null, external: att ? Math.round(att.external) : null, edits: att ? Math.round(att.edits) : null,
    internal: att ? Math.round(att.internal) : null,
    drivers: (att?.cats || []).slice(0, 5).map((c) => ({ name: c.name, market: Math.round(c.market), flow: Math.round(c.flow) })), marketMovers,
    interestReceived: Math.round(interest), eventsCount: evs.length,
    upcoming: next.map((e) => ({ date: e.date, title: e.title, amount: Math.round(e.amount || 0) })),
    stale: pf.attention.map((r) => ({ name: r.asset.name, status: r.status })),
    exposure: Object.fromEntries(Object.entries(pf.byExposure).map(([k, v]) => [EXPOSURES[k]?.name || k, +(v / g).toFixed(3)])),
    liquidHigh: +((pf.byLiquidity.high || 0) / g).toFixed(3),
    topHolding: top ? { name: top.asset.name, share: +(top.value / g).toFixed(3) } : null,
    priceMoves,
  };
}

/** Privacy filter: replace money amounts with % of net worth (for AI in "percent" mode) */
export function percentify(obj, net) {
  const base = Math.abs(net) || 1;
  const moneyKeys = new Set(['net', 'gross', 'debt', 'abs', 'market', 'external', 'edits', 'flow', 'amount', 'interestReceived', 'value', 'before', 'after', 'delta', 'price_rial']);
  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(o)) {
        if (moneyKeys.has(k) && typeof v === 'number') r[k + '_pct_of_net'] = +(v / base * 100).toFixed(2);
        else r[k] = walk(v);
      }
      return r;
    }
    return o;
  };
  const out = walk(obj);
  if ('net_pct_of_net' in out) delete out.net_pct_of_net;
  return out;
}

/* ============================ alerts, rebalancing, quotes ============================ */
export function checkAlerts(alerts, quotes) {
  const fired = [];
  for (const al of alerts) {
    if (!al.active) continue;
    const q = quotes[quoteId(al.ref)];
    if (!q || !(q.price > 0) || q.error) continue;
    const hit = al.op === 'gt' ? q.price >= al.value : q.price <= al.value;
    if (hit) { al.active = false; al.firedAt = Date.now(); al.firedPrice = q.price; fired.push({ ...al, price: q.price }); }
  }
  return fired;
}

export function rebalance(pf, targets = {}) {
  const sum = Object.values(targets).reduce((s, x) => s + (+x || 0), 0);
  const ids = new Set([...Object.keys(targets).filter((k) => +targets[k] > 0), ...pf.cats.filter((c) => !c.liability).map((c) => c.id)]);
  return [...ids].map((id) => {
    const c = CAT[id]; const cur = pf.cats.find((x) => x.id === id)?.value || 0;
    const t = +targets[id] || 0; const tv = pf.gross * t;
    return { id, cat: c, current: cur, currentShare: pf.gross ? cur / pf.gross : 0, target: t, targetValue: tv, diff: tv - cur, hasTarget: t > 0, sumTargets: sum };
  }).filter((r) => r.cat && !r.cat.liability).sort((a, b) => b.current - a.current);
}

export function collectRefs(assets, alerts = [], extra = []) {
  const refs = [...extra];
  for (const a of assets) if (!a.archived && a.mode === 'units' && a.price?.source === 'market' && a.price.ref?.key) refs.push(a.price.ref);
  for (const al of alerts) if (al.active && al.ref) refs.push(al.ref);
  if (refs.some((r) => isUsdRef(r))) refs.push({ provider: 'tgju', key: 'price_dollar_rl' });
  return refs;
}

/** Merge freshly fetched quotes; on error keep the last good price and mark it. */
export function mergeQuotes(stored, fetched, errors, now = Date.now()) {
  const out = { ...stored };
  for (const [id, q] of Object.entries(fetched)) out[id] = { ...q, fetchedAt: now, error: null };
  for (const [id, msg] of Object.entries(errors)) {
    if (out[id]?.price > 0) out[id] = { ...out[id], error: msg, errorAt: now };
    else out[id] = { price: 0, error: msg, errorAt: now, fetchedAt: now };
  }
  return out;
}

/** Fill in corrections logged while the new price source had no price yet (see saveAsset). Mutates assets & events. */
export function settlePending(assets, events, quotes) {
  for (const a of assets) {
    const fix = a.price?.pendingFix; if (!fix) continue;
    const u = unitPriceOf(a, quotes); if (u.fallback || !(u.price > 0)) continue;
    const c = events.find((e) => e.id === fix.eventId)?.changes?.find((c) => c.assetId === a.id && c.pending);
    if (c) { c.value = valueOf({ ...a, quantity: fix.qty }, quotes).signedValue - fix.before; delete c.pending; }
    delete a.price.pendingFix;
  }
}

export function rememberLastPrices(assets, quotes) {
  for (const a of assets) {
    if (a.mode !== 'units' || a.price?.source !== 'market' || !a.price.ref) continue;
    const u = unitPriceOf(a, quotes);
    if (u.q && u.q.price > 0 && !u.q.error && !u.fallback) a.price.last = { price: u.price, at: u.q.at || Date.now() };
  }
  return assets;
}
