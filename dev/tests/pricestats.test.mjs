// The price detail page's numbers (lib/pricestats.js). Synthetic prices only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../extension/lib/pricestats.js';
import { addDaysIso } from '../../extension/lib/jalali.js';

const today = '2026-10-09';
const D = (n) => addDaysIso(today, n);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
// a year of daily prices: 100 → 200, with a peak of 250 sixty days ago and a dip to 80 three hundred days ago
const series = Array.from({ length: 366 }, (_, k) => { const d = -365 + k; const v = d === -60 ? 250 : d === -300 ? 80 : 100 + (100 * k) / 365; return [D(d), v]; });

test('range: the last N days, starting from the point just before', () => {
  const w = S.slice(series, 7, today);
  assert.equal(w[0][0], D(-7)); assert.equal(w[w.length - 1][0], today);
  const gap = [[D(-10), 1], [D(-3), 2], [today, 3]];
  assert.deepEqual(S.slice(gap, 7, today).map((p) => p[0]), [D(-10), D(-3), today], 'the price in force at the range start comes along');
});

test('high, low, change, distance from the high', () => {
  const st = S.stats(series);
  assert.equal(st.hi.v, 250); assert.equal(st.hi.date, D(-60)); assert.equal(st.lo.v, 80); assert.equal(st.lo.date, D(-300));
  close(st.change, 200 / 100 - 1); close(st.fromHigh, 200 / 250 - 1);
  assert.equal(S.stats([[today, 5]]), null);
});

test('changes over a week, month, three months and a year; null when the history is too short', () => {
  const c = S.periodChanges(series, today);
  close(c[7], 200 / (100 + 100 * 358 / 365) - 1);
  close(c[365], 200 / 100 - 1);
  const short = S.periodChanges(series.slice(-20), today);
  assert.equal(short[91], null); assert.equal(short[365], null);
});

test('in dollars: each day divided by that day\'s dollar, carried over days without one', () => {
  const p = [[D(-2), 100], [D(-1), 110], [today, 120]];
  const usd = [[D(-3), 10], [today, 12]];
  assert.deepEqual(S.inDollars(p, usd), [[D(-2), 10], [D(-1), 11], [today, 10]]);
  assert.deepEqual(S.inDollars(p, []), []);
});

test('position: quantity in the price\'s unit, value, average cost only when every lot has a cost', () => {
  const ref = { provider: 'tgju', key: 'geram18' };
  const quotes = { 'tgju:geram18': { price: 1000, at: Date.now() } };
  const a = { id: 'a', name: 'الف', mode: 'units', quantity: 2, unit: 'گرم', costBasis: 1600, price: { source: 'market', ref, factor: 1 } };
  const b = { id: 'b', name: 'ب', mode: 'units', quantity: 3, unit: 'گرم', costBasis: 2600, price: { source: 'market', ref, factor: 1 } };
  const p = S.position([a, b, { ...a, id: 'z', archived: true }], quotes, {}, ref);
  assert.equal(p.qty, 5); assert.equal(p.value, 5000); close(p.avg, 840); close(p.pnl, 800); close(p.ret, 800 / 4200); assert.equal(p.unit, 'گرم');
  const noCost = S.position([a, { ...b, costBasis: null }], quotes, {}, ref);
  assert.equal(noCost.avg, null, 'no average line when a lot has no cost'); assert.equal(noCost.partialCost, true); close(noCost.pnl, 2000 - 1600);
  assert.equal(S.position([a], quotes, {}, { provider: 'tgju', key: 'sekee' }), null);
});

test('buys and sells as marks on the series; undone ones left out; one per day and kind', () => {
  const pts = [[D(-3), 1], [D(-2), 1], [D(-1), 1], [today, 1]];
  const ev = [
    { date: D(-2), changes: [{ assetId: 'a', field: 'quantity', delta: 1 }] },
    { date: D(-2), changes: [{ assetId: 'a', field: 'quantity', delta: 2 }] },
    { date: D(-1), changes: [{ assetId: 'a', field: 'quantity', delta: -1 }] },
    { date: D(-1), undone: true, changes: [{ assetId: 'a', field: 'quantity', delta: 5 }] },
    { date: D(-9), changes: [{ assetId: 'a', field: 'add', delta: 0 }] },
    { date: today, changes: [{ assetId: 'x', field: 'quantity', delta: 1 }] },
  ];
  assert.deepEqual(S.marks(ev, ['a'], pts).map((m) => [m.i, m.kind]), [[1, 'buy'], [2, 'sell']]);
});
