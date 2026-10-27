// «رتبه بین بازارها» (lib/insights.js ranking): the same money on the same days in each market. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../../extension/lib/insights.js';
import * as E from '../../extension/lib/engine.js';
import { todayIso, addDaysIso } from '../../extension/lib/jalali.js';

const today = todayIso();
const now = Date.now();
const D = (n) => addDaysIso(today, n);
const close = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);
const Q = (p) => ({ price: p, at: now, fetchedAt: now, changePct: 0 });
const goldRef = { provider: 'tgju', key: 'geram18' };
// 30 days ago: 18k gold 100, dollar 50, coin 1000; today: 110, 55, 1200
const snaps = (v, t) => ({ [D(-30)]: { t, g: t, l: 0, v, usd: 50, gold: 100, coin: 1000, at: now - 30 * 864e5 } });
const quotes = { 'tgju:geram18': Q(110), 'tgju:price_dollar_rl': Q(55), 'tgju:sekee': Q(1200) };
const line = (p0, p1) => [[D(-40), p0], [D(-30), p0], [D(-1), p1]];
const series = { silver: line(10, 13), btc: line(1000, 900), index: line(100, 102) };

test('all in gold: the gold row is level with you; the order follows the money', () => {
  const assets = [{ id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, price: { source: 'market', ref: goldRef } }];
  const st = { assets, quotes, settings: { inflationPct: 40 }, snapshots: snaps({ g: 1000 }, 1000), events: [] };
  const R = I.ranking(st, 30, { today, series, depositPct: 24 });
  const gold = R.rows.find((r) => r.id === 'gold');
  close(R.you.ret, 0.1, 1e-9); close(gold.ret, 0.1, 1e-9); close(gold.diff, 0, 1e-6);
  close(R.rows.find((r) => r.id === 'coin').ret, 0.2, 1e-9); close(R.rows.find((r) => r.id === 'silver').ret, 0.3, 1e-9);
  close(R.rows.find((r) => r.id === 'usd').ret, 0.1, 1e-9);
  close(R.rows.find((r) => r.id === 'inflation').ret, Math.pow(1.4, 30 / 365) - 1, 1e-12);
  for (let i = 1; i < R.rows.length; i++) assert.ok(R.rows[i - 1].ret >= R.rows[i].ret && R.rows[i - 1].end >= R.rows[i].end - 1e-6, 'sorted by return = by end value');
  assert.equal(R.rows[0].id, 'silver'); assert.equal(R.missing.length, 0);
  assert.equal(R.of, R.rows.filter((r) => r.kind !== 'line').length);
  assert.equal(R.aboveInflation, true);
  // the inflation line isn't ranked
  assert.ok(R.rank <= R.of && R.rows.filter((r) => r.kind !== 'line').indexOf(R.you) + 1 === R.rank);
});

test('money added mid-way goes into each market on its own day', () => {
  // 1000 of cash 30 days ago, 1000 more added 10 days ago; cash earns nothing
  const assets = [{ id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 2000 }];
  const ev = [{ id: 'e', kind: 'flow', date: D(-10), at: now - 10 * 864e5, amount: 1000, toId: 'b', changes: [{ assetId: 'b', field: 'balance', delta: 1000 }] }];
  const st = { assets, quotes, settings: {}, snapshots: snaps({ b: 1000 }, 1000), events: ev };
  const R = I.ranking(st, 30, { today, series: {} });
  close(R.you.ret, 0, 1e-9);
  // gold: 1000 from day −30 (→1100) + 1000 from day −10 (snapshot price 100 then, 110 now → 1100)
  const gold = R.rows.find((r) => r.id === 'gold');
  close(gold.end, 2200, 1e-6); close(gold.diff, -200, 1e-6);
  assert.deepEqual(R.missing, ['نقره', 'بیت‌کوین', 'شاخص کل بورس'], 'markets without a history are named');
  // all of it was cash in an account (earning nothing, not a deposit), and gold did better: said why
  assert.ok(R.why && R.why.exposure === 'cash' && R.why.share > 0.99);
  assert.match(R.why.text, /حساب بانکی/);
});

test('your own target mix and the simple mix; costs come off the markets, not off you', () => {
  const assets = [{ id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, price: { source: 'market', ref: goldRef } }];
  const st = { assets, quotes, settings: { targets: { gold: 50, fx: 30, property: 20 } }, snapshots: snaps({ g: 1000 }, 1000), events: [] };
  const R = I.ranking(st, 30, { today, series });
  const t = R.rows.find((r) => r.id === 'target');
  close(t.weights.gold, 5 / 8); close(t.weights.usd, 3 / 8);
  close(t.ret, 0.1, 1e-9, 'gold 10% and dollar 10%');
  assert.match(t.note, /۲۰|20/);
  const b = R.rows.find((r) => r.id === 'balanced');
  assert.ok(b.ret > 0 && b.ret < 0.1);
  const C = I.ranking(st, 30, { today, series, costs: true });
  close(C.you.end, R.you.end, 1e-9);
  close(C.rows.find((r) => r.id === 'gold').end, R.rows.find((r) => r.id === 'gold').end * (1 - 0.015), 1e-6);
  // the path: your saved net worth next to the same money in gold
  const p = I.rankingPath(R, 'gold', st, today);
  assert.equal(p[0].date, D(-30)); close(p[0].alt, 1000, 1e-9); close(p[p.length - 1].alt, 1100, 1e-6);
});

test('a live price in another unit than the series is not used', () => {
  const f = I.priceOn([[D(-2), 100], [D(-1), 101]], 5000, today);
  assert.equal(f(today), 101);
  assert.equal(I.priceOn([[D(-2), 100], [D(-1), 101]], 103, today)(today), 103);
  assert.equal(I.priceOn([], null, today)(today), null);
  assert.equal(I.ranking({ assets: [], quotes: {}, settings: {}, snapshots: {}, events: [] }, 30, { today }), null);
});

test('a market whose history starts after the period begins is left out, not measured over less', () => {
  const assets = [{ id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, price: { source: 'market', ref: goldRef } }];
  const st = { assets, quotes, settings: {}, snapshots: snaps({ g: 1000 }, 1000), events: [] };
  const late = [[D(-10), 10], [D(-1), 13]];
  const R = I.ranking(st, 30, { today, series: { ...series, silver: late } });
  assert.equal(R.rows.find((r) => r.id === 'silver'), undefined);
  assert.ok(R.missing.includes('نقره'));
  // a few days late (a holiday) is fine
  const R2 = I.ranking(st, 30, { today, series: { ...series, silver: [[D(-27), 10], [D(-1), 13]] } });
  assert.ok(R2.rows.find((r) => r.id === 'silver'));
});
