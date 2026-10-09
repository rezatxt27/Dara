// The numbers on a price's detail page: a range of its daily history, its high and low, changes over common periods,
// the same series in dollars, and the owner's own position in it (quantity, value, average cost, buys and sells).
// Pure. Points are [isoDate, price] sorted by date; prices are Rial (or dollars for the dollar view).
import * as E from './engine.js';
import { addDaysIso } from './jalali.js';

/** The last point on or before `iso` (null when the series starts later). */
export function pointOn(points, iso) {
  let found = null;
  for (const p of points || []) { if (p[0] <= iso) found = p; else break; }
  return found;
}

/** The part of the series inside the last `days` (plus the point just before, so the range starts where it should). */
export function slice(points, days, today) {
  const from = addDaysIso(today, -days);
  const list = (points || []).filter((p) => p[1] > 0);
  const i = list.findIndex((p) => p[0] >= from);
  if (i < 0) return list.slice(-1);
  return list.slice(Math.max(0, i - (list[i][0] > from ? 1 : 0)));
}

/** High, low, first, last and change over a series; fromHigh: how far the last price is below the high (≤ 0). */
export function stats(points) {
  const list = (points || []).filter((p) => p[1] > 0);
  if (list.length < 2) return null;
  let hi = list[0], lo = list[0];
  for (const p of list) { if (p[1] > hi[1]) hi = p; if (p[1] < lo[1]) lo = p; }
  const first = list[0], last = list[list.length - 1];
  return { hi: { v: hi[1], date: hi[0] }, lo: { v: lo[1], date: lo[0] }, first: first[1], last: last[1], change: last[1] / first[1] - 1, fromHigh: last[1] / hi[1] - 1, fromLow: last[1] / lo[1] - 1 };
}

/** Change from each period's start to the latest point: { 7: x, 30: x, 91: x, 365: x }; null where the history is too short. */
export function periodChanges(points, today, periods = [7, 30, 91, 365]) {
  const list = (points || []).filter((p) => p[1] > 0);
  const last = list[list.length - 1];
  const out = {};
  for (const d of periods) {
    const base = pointOn(list, addDaysIso(today, -d));
    out[d] = last && base && base !== last ? last[1] / base[1] - 1 : null;
  }
  return out;
}

/** The series divided by the dollar on each day (the dollar rate carried forward over days it has no price). */
export function inDollars(points, dollar) {
  const usd = (dollar || []).filter((p) => p[1] > 0);
  const out = []; let j = 0, rate = null;
  for (const [d, v] of points || []) {
    while (j < usd.length && usd[j][0] <= d) rate = usd[j++][1];
    if (rate > 0 && v > 0) out.push([d, v / rate]);
  }
  return out;
}

/**
 * The owner's position in a price: every live asset priced from it. qty is in the price's own unit (quantity × factor);
 * avg: total cost ÷ quantity, only when every one of them has a cost; pnl: value − cost over those that do.
 */
export function position(assets, quotes, settings, ref, now = Date.now()) {
  const id = E.quoteId(ref);
  const held = (assets || []).filter((a) => !a.archived && a.mode === 'units' && a.price?.source === 'market' && a.price.ref && E.quoteId(a.price.ref) === id);
  if (!held.length) return null;
  let qty = 0, value = 0, cost = 0, costed = 0, costedValue = 0;
  for (const a of held) {
    const q = (+a.quantity || 0) * (+a.price.factor || 1);
    const v = E.valueOf(a, quotes, settings, now).value || 0;
    qty += q; value += v;
    if (+a.costBasis > 0) { cost += +a.costBasis; costed += q; costedValue += v; }
  }
  const all = costed > 0 && Math.abs(costed - qty) < 1e-9;
  return {
    ids: held.map((a) => a.id), assets: held, qty, value,
    unit: new Set(held.map((a) => a.unit)).size === 1 && held.every((a) => (+a.price.factor || 1) === 1) ? held[0].unit : null,
    cost: cost || null, avg: all && qty > 0 ? cost / qty : null,
    pnl: costed > 0 ? costedValue - cost : null, ret: costed > 0 ? costedValue / cost - 1 : null, partialCost: costed > 0 && !all,
  };
}

/** Buys and sells of these assets as marks on the series: { i, date, kind: 'buy' | 'sell' } (undone ones left out). */
export function marks(events, ids, points) {
  const set = new Set(ids || []);
  const out = [];
  for (const e of events || []) {
    if (e.undone) continue;
    for (const c of e.changes || []) {
      if (!set.has(c.assetId)) continue;
      const kind = c.field === 'add' || (c.field === 'quantity' && c.delta > 0) ? 'buy' : c.field === 'quantity' && c.delta < 0 ? 'sell' : null;
      if (!kind || !e.date) continue;
      let i = -1;
      for (let k = 0; k < points.length; k++) { if (points[k][0] <= e.date) i = k; else break; }
      out.push({ i, date: e.date, kind }); // i = −1: before the range shown
    }
  }
  // one mark per day and kind
  const seen = new Set();
  return out.filter((m) => m.i >= 0 && !seen.has(m.i + m.kind) && seen.add(m.i + m.kind));
}
