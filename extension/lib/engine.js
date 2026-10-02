// Valuation + automation + analytics engine. Pure functions shared by the service worker and the UI.
// All money is Rial. Dates are ISO 'YYYY-MM-DD' (local calendar day); Jalali is used for schedules.
import { CAT, CATEGORIES, EXPOSURES, GOLD_ETFS, TGJU_BY_KEY } from './catalog.js';
import { quoteId, isUsdRef } from './providers.js';
import { todayIso, daysBetween, addDaysIso, addJMonthsIso, isoToJ, jToIso, monthLength, isLeapJ, isoFromDate } from './jalali.js';
import { uid } from './format.js';

export { quoteId, isUsdRef, addDaysIso };
const DAY = 86400000;

export const isLiability = (a) => !!CAT[a.category]?.liability;

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
        const cp = q.changePct || 0;
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
    if (asset.interest?.on && !asOf) {
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
/** Money flowing INTO an asset (negative = out). Returns change records for undo. */
export function applyDelta(asset, delta, quotes = {}) {
  const liab = isLiability(asset);
  const changes = [];
  const rec = (field, d) => { if (d) changes.push({ assetId: asset.id, field, delta: d }); };
  if (asset.mode === 'rate') {
    const d = liab ? -delta : delta;
    const r = asset.rate; const a = (+r.annualPct || 0) / 100; const today = todayIso();
    // Money added today earns from today, not from the start date: keep the value jump equal to the money moved.
    if (a && r.start && r.start < today && r.mode === 'compound') {
      // same value right now, grows only from now on
      const v = rateValue(r, today, Date.now());
      const dp = +r.principal > 0 && v > 0 ? d * (+r.principal) / v : d / Math.pow(1 + a, daysBetween(r.start, today) / 365);
      r.principal = (+r.principal || 0) + dp; rec('rate.principal', dp);
    } else {
      r.principal = (+r.principal || 0) + d; rec('rate.principal', d);
      if (a && r.start && r.start < today && !(r.maturity && r.maturity < today)) {
        // simple: interest on d for [start, today) never existed; payout: same, until the next payout
        const since = r.mode === 'payout' ? payoutSince(r, today) : r.start;
        const off = -d * a * (dayFactor(since, today, r.basis || 365) + fracOfDay(Date.now()) / yearDays(today, r.basis || 365));
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
  for (const c of ev.changes || []) {
    const a = byId[c.assetId]; if (!a || typeof c.delta !== 'number' || !UNDOABLE.has(c.field)) continue;
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
 * Apply everything due up to today: fixed-income payouts, day-count interest on bank balances,
 * and recurring flows. Mutates; returns { assets, flows, events }.
 */
export function applyAutomations(assets, flows, quotes = {}, today = todayIso()) {
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const events = [];
  // 1) Fixed-income payouts (روزشمار با واریز ماهانه)
  for (const a of assets) {
    if (a.archived || a.mode !== 'rate' || a.rate?.mode !== 'payout' || !a.rate.start || !(+a.rate.annualPct)) continue;
    const r = a.rate;
    let last = r.lastPayout || r.start;
    let guard = 0;
    while (guard++ < 240) {
      const next = nextMonthlyAfter(r.start, last);
      if (next > today) break;
      if (r.maturity && next > r.maturity) break;
      let interest = Math.round((+r.principal || 0) * (+r.annualPct / 100) * dayFactor(last, next, r.basis || 365));
      // money added mid-period earned only from the day it came in
      const off = r.offset && r.offsetFrom === last ? +r.offset : 0;
      if (off) { interest = Math.round(interest + off); r.offset = 0; }
      let changes = [];
      const target = r.payoutTo && r.payoutTo !== 'self' ? byId[r.payoutTo] : null;
      if (target && !target.archived) changes = applyDelta(target, interest, quotes);
      else { r.principal = (+r.principal || 0) + interest; changes = [{ assetId: a.id, field: 'rate.principal', delta: interest }]; }
      if (off) changes.push({ assetId: a.id, field: 'rate.offset', delta: -off });
      r.lastPayout = next; last = next;
      events.push({ id: uid('e'), kind: 'interest', date: next, at: Date.now(), title: `واریز سود «${a.name}»`, amount: interest,
        fromId: a.id, toId: target ? target.id : a.id, changes });
    }
  }
  // 2) Day-count interest on bank balances (حساب روزشمار)
  for (const a of assets) {
    const it = a.interest;
    if (a.archived || a.mode !== 'balance' || !it?.on || !(+it.annualPct)) continue;
    let d = it.lastAccrual ? addDaysIso(it.lastAccrual, 1) : (it.since || today);
    let guard = 0;
    while (d <= today && guard++ < 800) {
      if (isPayDay(d, it.payDay) && (+it.accrued || 0) >= 1 && (!it.since || d > it.since)) {
        const amt = Math.floor(it.accrued);
        it.accrued -= amt;
        const changes = applyDelta(a, amt, quotes);
        changes.push({ assetId: a.id, field: 'interest.accrued', delta: -amt });
        events.push({ id: uid('e'), kind: 'interest', date: d, at: Date.now(), title: `سود روزشمار «${a.name}»`, amount: amt, fromId: a.id, toId: a.id, changes });
      }
      if (d < today) { it.accrued = (+it.accrued || 0) + (+a.balance || 0) * (+it.annualPct / 100) / yearDays(d, it.basis || 365); it.lastAccrual = d; }
      d = addDaysIso(d, 1);
    }
  }
  // 3) Recurring flows
  for (const f of flows) {
    if (!f.active || !(+f.amount)) continue;
    const after = f.lastRun || addDaysIso(f.start, -1);
    for (const d of flowOccurrences(f, after, today, 60)) {
      const changes = [];
      if (f.fromId && byId[f.fromId]) changes.push(...applyDelta(byId[f.fromId], -f.amount, quotes));
      if (f.toId && byId[f.toId]) changes.push(...applyDelta(byId[f.toId], +f.amount, quotes));
      f.lastRun = d; f.done = (+f.done || 0) + 1;
      events.push({ id: uid('e'), kind: 'flow', flowId: f.id, date: d, at: Date.now(), title: f.title, amount: +f.amount, fromId: f.fromId || null, toId: f.toId || null, changes });
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
        while (g++ < 6) {
          const next = nextMonthlyAfter(r.start, last);
          if (next > until || (r.maturity && next > r.maturity)) break;
          list.push({ date: next, kind: 'interest', title: `سود «${a.name}»`, amount: Math.round(r.principal * r.annualPct / 100 * dayFactor(last, next, r.basis || 365)), assetId: a.id, toId: r.payoutTo !== 'self' ? r.payoutTo : a.id });
          last = next;
        }
      }
      if (r.maturity && r.maturity >= today && r.maturity <= until) list.push({ date: r.maturity, kind: 'maturity', title: `سررسید «${a.name}»`, amount: rateValue(r, r.maturity), assetId: a.id });
    }
    if (a.mode === 'balance' && a.interest?.on && +a.interest.annualPct) {
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
  for (const f of flows) {
    if (!f.active) continue;
    const yesterday = addDaysIso(today, -1);
    const after = f.lastRun && f.lastRun > yesterday ? f.lastRun : yesterday;
    for (const d of flowOccurrences(f, after, until, 10)) list.push({ date: d, kind: 'flow', title: f.title, amount: f.amount, flowId: f.id, fromId: f.fromId, toId: f.toId });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Automatic monthly income: interest (rate assets + day-count bank interest) and recurring in/out flows */
export function monthlyAuto(assets, flows) {
  let interest = 0, inflow = 0, outflow = 0;
  for (const a of assets) {
    if (a.archived || isLiability(a)) continue;
    if (a.mode === 'rate') interest += rateMonthly(a.rate, rateValue(a.rate));
    if (a.mode === 'balance' && a.interest?.on) interest += (+a.balance || 0) * (+a.interest.annualPct || 0) / 100 / 12;
  }
  for (const f of flows) {
    if (!f.active) continue;
    const m = flowMonthly(f);
    if (f.toId && !f.fromId) inflow += m;
    if (f.fromId && !f.toId) outflow += m;
  }
  return { interest, inflow, outflow, net: interest + inflow - outflow };
}

/* ============================ snapshots & series ============================ */
export function makeSnapshot(pf, quotes, extra = {}) {
  const cats = {}; for (const c of pf.cats) cats[c.id] = Math.round(c.value);
  const v = {}; for (const r of pf.rows) v[r.asset.id] = Math.round(r.signedValue);
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
      if (k1) {
        const sn = snaps[k1]; const v1 = sn.v[id];
        const later = moves.filter((m) => (sn.est || !sn.at ? m.date > k1 : m.at > sn.at));
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
  const usdPct = s0?.usd && rates.usd ? (pf.net / rates.usd) / (s0.t / s0.usd) - 1 : null;
  const goldPct = s0?.gold && rates.gold ? (pf.net / rates.gold) / (s0.t / s0.gold) - 1 : null;
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
