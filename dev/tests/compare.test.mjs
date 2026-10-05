// «مقایسه دو گزینه» (lib/compare.js). Synthetic numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../extension/lib/compare.js';
import * as I from '../../extension/lib/insights.js';
import * as E from '../../extension/lib/engine.js';
import { todayIso, addDaysIso } from '../../extension/lib/jalali.js';

const today = todayIso(); const now = Date.now();
const D = (n) => addDaysIso(today, n);
const close = (a, b, eps = 1e-6, m = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${m} ${a} ≉ ${b}`);
const Q = (price, extra = {}) => ({ price, changePct: 0, at: now - 60000, fetchedAt: now - 60000, ...extra });
const quotes = { 'tgju:ons': Q(4000), 'tgju:price_dollar_rl': Q(1_000_000), 'tgju:geram18': Q(100_000_000), 'tgju:nim': Q(500_000_000), 'nobitex:usdt': Q(1_000_000) };
const bank = (id, balance, rate) => ({ id, name: id, category: 'bank', mode: 'balance', balance, balanceAt: now, ...(rate ? { interest: { on: true, annualPct: rate, basis: 365, payDay: 30, since: D(-1), lastAccrual: D(-1), accrued: 0 } } : {}) });
const gold = { id: 'g', name: 'g', category: 'gold', mode: 'units', quantity: 10, price: { source: 'manual', value: 100_000_000, updatedAt: now } };
const st = (assets) => ({ assets, quotes, settings: {}, snapshots: {}, events: [], flows: [] });
const pfOf = (s) => E.portfolio(s.assets, s.quotes, s.settings, now);
const P = 1_000_000_000;

test('keep vs deposit: interest where the money is, interest given up, same growth rule as break-even', () => {
  const s = st([bank('b', 2 * P, 20), gold]);
  const r = C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'b', a: { id: 'keep' }, b: { id: 'deposit', ratePct: 25 }, months: 12, today, now });
  close(r.a.final, P * I.depositGrowth(20, 12)); assert.equal(r.a.lost, 0);
  close(r.b.final, P * I.depositGrowth(25, 12));
  close(r.b.lost, P * (I.depositGrowth(20, 12) - 1), 1e-6, 'moving the money gives up the account\'s own interest');
  assert.equal(r.a.breakEven, null); assert.equal(r.b.breakEven, null, 'no price to move between two fixed options');
  assert.equal(r.a.after, r.before, 'keeping changes nothing');
});

test('market option: round-trip cost, value at a price change, and the move needed to match a deposit', () => {
  const s = st([bank('b', 2 * P), gold]);
  const r = C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'b', a: { id: 'deposit', ratePct: 25 }, b: { id: 'geram18', costPct: 2 }, months: 6, today, now });
  close(r.b.final, P * 0.98); close(r.b.costAmount, P * 0.02);
  close(r.b.valueAt(0.1), P * 0.98 * 1.1);
  close(r.b.breakEven, I.breakEven({ price0: 1, ratePct: 25, months: 6, feePct: 2 }).needed, 1e-9, 'same as the break-even card');
  close(r.b.units, P * 0.99 / 100_000_000);
  assert.equal(r.a.breakEven, null);
  const o = C.outcome(r, 0, 0.3);
  close(o.diff, r.a.final - P * 0.98 * 1.3);
});

test('coin: today\'s bubble and what a return to its average would do', () => {
  const s = st([bank('b', 2 * P)]);
  const pure = 4.0665 * 0.9 * 4000 * 1_000_000 / 31.1034768; // gold inside a half coin, Rial
  const r = C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'b', a: { id: 'keep' }, b: { id: 'nim' }, months: 12, bubbleAvg: { nim: 0.05 }, today, now });
  close(r.b.bubble, 500_000_000 / pure - 1);
  close(r.b.bubbleRevert, 1.05 / (1 + r.b.bubble) - 1);
  close(r.b.cost, 0.025, 1e-9, 'default cost of a half coin');
});

test('portfolio after the move: new money counts as cash on both sides', () => {
  const s = st([bank('b', P), gold]); // bank 1e9 rial, gold 1e9 manual → 50% protected
  const r = C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'new', a: { id: 'keep' }, b: { id: 'usdt', costPct: 0 }, months: 12, today, now });
  close(r.before.protected, 1 / 3, 1e-9, 'bank + new cash rial, gold protected');
  close(r.b.after.protected, 2 / 3, 1e-9, 'the new money now in dollars-tether');
  close(r.b.after.by.fx, 1 / 3, 1e-9);
  close(r.before.by.fx || 0, 0);
  assert.equal(r.a.name, 'نقد بماند'); close(r.a.final, P);
});

test('flags: more than the account holds, breaking a deposit early, a deposit that ends before the horizon, stale price', () => {
  const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: P, annualPct: 24, start: D(-30), maturity: D(90), mode: 'payout', payoutTo: 'self' } };
  const s = st([bank('b', P / 10), dep]);
  const r1 = C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'b', a: { id: 'keep' }, b: { id: 'deposit' }, months: 12, today, now });
  assert.equal(r1.source.exceeds, true);
  const r2 = C.compareOptions(s, pfOf(s), { amount: P / 2, sourceId: 'd', a: { id: 'keep' }, b: { id: 'sekee' }, months: 12, today, now });
  assert.equal(r2.source.early, true); assert.equal(r2.source.renewed, true);
  assert.ok(r2.a.notes.some((n) => /تمدید/.test(n)));
  assert.ok(r2.b.stale, 'no quote for the full coin'); assert.ok(r2.b.notes.length);
  const matured = { ...dep, rate: { ...dep.rate, maturity: D(-1) } };
  assert.equal(C.sourceRate(matured, today), 0, 'a matured deposit earns nothing more');
});

test('sources and invalid input', () => {
  const debt = { id: 'x', name: 'وام', category: 'debt', mode: 'balance', balance: 5 };
  const s = st([bank('b', P), gold, debt, { ...bank('old', P), archived: true }]);
  assert.deepEqual(C.sources(s.assets, pfOf(s)).map((x) => x.id), ['b'], 'only accounts and deposits that are the owner\'s');
  assert.equal(C.compareOptions(s, pfOf(s), { amount: 0, a: { id: 'keep' }, b: { id: 'deposit' } }), null);
  assert.equal(C.compareOptions(s, pfOf(s), { amount: P, a: { id: 'nope' }, b: { id: 'deposit' } }), null);
  assert.equal(C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'missing', a: { id: 'keep' }, b: { id: 'deposit' } }), null);
});

test('review: a debt cannot be the source; months 0 means one month, not a year', () => {
  const debt = { id: 'x', name: 'وام', category: 'debt', mode: 'balance', balance: P };
  const s = st([bank('b', 2 * P, 20), debt]);
  assert.equal(C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'x', a: { id: 'keep' }, b: { id: 'deposit' } }), null);
  assert.equal(C.compareOptions(s, pfOf(s), { amount: P, sourceId: 'b', a: { id: 'keep' }, b: { id: 'deposit' }, months: 0, today, now }).months, 1);
});
