// The dashboard's four cards (lib/insights.js): inflation shield, liquidity, automatic income, needs-attention.
// Synthetic assets only; dates are relative to today because valuation reads the real clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../../extension/lib/insights.js';
import * as E from '../../extension/lib/engine.js';
import { todayIso, addDaysIso, isoToJ } from '../../extension/lib/jalali.js';

const today = todayIso();
const now = Date.now();
const D = (n) => addDaysIso(today, n);
const close = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);
const manual = (id, category, value, extra = {}) => ({ id, name: id, category, mode: 'units', quantity: 1, price: { source: 'manual', value, updatedAt: now }, ...extra });
const bank = (id, balance, extra = {}) => ({ id, name: id, category: 'bank', mode: 'balance', balance, balanceAt: now, ...extra });
const st = (assets, more = {}) => ({ assets, flows: [], quotes: {}, settings: {}, snapshots: {}, events: [], ...more });
const pfOf = (s) => E.portfolio(s.assets, s.quotes, s.settings, now);

test('protected share on a past snapshot: debts left out, deleted assets only up to 5%', () => {
  const assets = [bank('b', 0), manual('g', 'gold', 0), { id: 'd', name: 'd', category: 'debt', mode: 'balance', balance: 0 }];
  close(I.protectedShareAt({ v: { b: 100, g: 300, d: -50 } }, assets), 0.75);
  close(I.protectedShareAt({ v: { b: 100, g: 300, gone: 10 } }, assets), 0.75, 1e-9, 'a small deleted asset is ignored');
  assert.equal(I.protectedShareAt({ v: { b: 100, g: 300, gone: 30 } }, assets), null, 'too much unknown: no answer');
  assert.equal(I.protectedShareAt({ t: 1 }, assets), null, 'old snapshots without per-asset values');
});

test('protected target comes from a target mix that adds up to 100%', () => {
  close(I.protectedTarget({ bank: 20, gold: 50, stock: 30 }), 0.8);
  close(I.protectedTarget({ bank: 20, fixed: 10, gold: 70, debt: 40 }), 0.7, 1e-9, 'a debt target is not part of the mix');
  assert.equal(I.protectedTarget({ bank: 20, gold: 50 }), null, 'adds up to 70%: no target');
  assert.equal(I.protectedTarget({}), null);
  assert.equal(I.protectedTarget(undefined), null);
});

test('inflation card: share, move over a month, target status and what is unprotected', () => {
  const assets = [bank('b', 200), manual('g', 'gold', 500), manual('s', 'stock', 100), { id: 'dep', name: 'dep', category: 'fixed', mode: 'balance', balance: 200, balanceAt: now }];
  const s = st(assets, { snapshots: { [D(-31)]: { v: { b: 400, g: 500, s: 100, dep: 0 } } }, settings: { targets: { bank: 15, fixed: 10, gold: 50, stock: 25 } } });
  const c = I.inflationCard(s, pfOf(s), today);
  close(c.share, 0.6);
  assert.notEqual(c.delta, null);
  close(c.delta, 0.6 - 0.6, 1e-9, 'a month ago: 600 of 1000 protected too');
  // a month ago 400 of 1000 was protected: up 20 points
  const sUp = st(assets, { snapshots: { [D(-30)]: { v: { b: 600, g: 300, s: 100 } } } });
  close(I.inflationCard(sUp, pfOf(sUp), today).delta, 0.2);
  close(c.target, 0.75);
  assert.equal(c.status, 'below', '15 points under the 75% target');
  assert.deepEqual(c.unprotected.map((u) => u.id).sort(), ['bank', 'fixed']);
  close(c.unprotectedShare, 0.4);
  assert.equal(c.parts[0].key, 'gold', 'largest protected part first');
  // within 5 points of the target: near; at or above: ok
  const s2 = st(assets, { settings: { targets: { bank: 35, gold: 40, stock: 25 } } });
  assert.equal(I.inflationCard(s2, pfOf(s2), today).status, 'near');
  const s3 = st(assets, { settings: { targets: { bank: 45, gold: 30, stock: 25 } } });
  assert.equal(I.inflationCard(s3, pfOf(s3), today).status, 'ok');
  // a snapshot from long ago doesn't stand in for «last month»; no target, no status
  const s4 = st(assets, { snapshots: { [D(-80)]: { v: { b: 100, g: 100 } } } });
  const c4 = I.inflationCard(s4, pfOf(s4), today);
  assert.equal(c4.delta, null); assert.equal(c4.target, null); assert.equal(c4.status, null);
  assert.equal(I.inflationCard(st([]), pfOf(st([])), today), null, 'no assets: no card');
});

test('liquidity card: days / weeks / longer, by category or the asset\'s own setting', () => {
  const assets = [bank('b', 300), manual('g', 'gold', 200), manual('h', 'property', 500), manual('c', 'gold', 100, { liquidity: 'high' })];
  const c = I.liquidityCard(pfOf(st(assets)));
  close(c.tiers.high.value, 400); close(c.tiers.mid.value, 200); close(c.tiers.low.value, 500);
  close(c.share, 400 / 1100);
  assert.deepEqual(c.tiers.high.names, ['b', 'c'], 'largest first');
});

test('income card: interest and recurring income; the next money that actually comes in', () => {
  const dep = { id: 'dep', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1_200_000_000, annualPct: 24, start: D(-20), mode: 'payout', payoutTo: 'b' } };
  const loanIn = { id: 'li', name: 'وام داده‌شده', category: 'receivable', mode: 'loan', loan: { amount: 120_000_000, annualPct: 0, months: 12, firstDue: D(40), start: D(10), account: 'b' } };
  const debtDep = { id: 'dd', name: 'بدهی', category: 'debt', mode: 'rate', rate: { principal: 100_000_000, annualPct: 30, start: D(-25), mode: 'payout', payoutTo: 'self' } };
  const flows = [{ id: 'f1', title: 'حقوق', amount: 50_000_000, toId: 'b', fromId: null, freq: 'weekly', start: D(3), active: true },
    { id: 'f2', title: 'اجاره', amount: 30_000_000, fromId: 'b', toId: null, freq: 'weekly', start: D(1), active: true }];
  const s = st([bank('b', 10_000_000), dep, loanIn, debtDep], { flows });
  const c = I.incomeCard(s, today);
  assert.ok(c.interest > 0 && c.inflow > 0);
  close(c.total, c.interest + c.inflow);
  assert.equal(c.next.title, 'حقوق', 'rent going out and a debt\'s interest are not income');
  assert.equal(c.next.date, D(3));
  // without the salary the next income is the deposit's interest, not the debt's interest added to the debt
  const sNo = st([bank('b', 10_000_000), dep, debtDep], { flows: [] });
  const n2 = I.incomeCard(sNo, today).next;
  assert.equal(n2.assetId, 'dep');
  const none = I.incomeCard(st([bank('b', 5)]), today);
  assert.equal(none.total, 0); assert.equal(none.next, null);
});

test('needs attention: short account first, grouped stale prices, matured, maturities, nothing when all is well', () => {
  const loan = { id: 'L', name: 'وام خودرو', category: 'debt', mode: 'loan', loan: { amount: 120_000_000, annualPct: 0, months: 12, firstDue: D(3), start: D(-27), account: 'b' } };
  const old = now - 40 * 86400000;
  const assets = [bank('b', 5_000_000), loan,
    manual('p1', 'private', 100, { price: { source: 'manual', value: 100, updatedAt: old - 90 * 86400000 } }),
    manual('p2', 'gold', 100, { price: { source: 'manual', value: 100, updatedAt: old } }),
    { id: 'm', name: 'سپرده قدیمی', category: 'fixed', mode: 'rate', rate: { principal: 100, annualPct: 20, start: D(-400), maturity: D(-2), mode: 'compound' } },
    { id: 'n', name: 'سپرده نو', category: 'fixed', mode: 'rate', rate: { principal: 100, annualPct: 20, start: D(-355), maturity: D(10), mode: 'compound' } }];
  const s = st(assets);
  const items = I.attentionItems(s, pfOf(s), today, now);
  assert.equal(items[0].tone, 'neg', 'the installment the account can\'t pay comes first');
  assert.match(items[0].text, /قسط «وام خودرو».*موجودی حساب کافی نیست/);
  assert.ok(items.some((x) => /«سپرده قدیمی» سررسید شده/.test(x.text)));
  assert.ok(items.some((x) => x.href === '#/assets?f=attention' && /دارایی دستی/.test(x.text)), 'two stale prices: one grouped item');
  assert.ok(items.some((x) => /«سپرده نو».*سررسید می‌شود/.test(x.text)));
  // enough money: the installment is a reminder, not a warning
  const s2 = st([bank('b', 50_000_000), loan]);
  const it2 = I.attentionItems(s2, pfOf(s2), today, now);
  assert.equal(it2.length, 1); assert.equal(it2[0].tone, 'info');
  // money leaving the same account earlier in the week counts against the installment
  const s3 = st([bank('b', 15_000_000), loan], { flows: [{ id: 'f', title: 'خرید طلا', amount: 10_000_000, fromId: 'b', toId: null, freq: 'weekly', start: D(1), active: true }] });
  assert.equal(I.attentionItems(s3, pfOf(s3), today, now)[0].tone, 'neg');
  // salary arriving before it covers it
  const s4 = st([bank('b', 5_000_000), loan], { flows: [{ id: 'f', title: 'حقوق', amount: 20_000_000, toId: 'b', fromId: null, freq: 'weekly', start: D(1), active: true }] });
  assert.equal(I.attentionItems(s4, pfOf(s4), today, now)[0].tone, 'info');
  assert.deepEqual(I.attentionItems(st([bank('b', 5)]), pfOf(st([bank('b', 5)])), today, now), []);
});

test('cards with an overdrawn account still add up; the account is flagged first', () => {
  const s = st([bank('b', -100), manual('g', 'gold', 500), { id: 'dep', name: 'dep', category: 'fixed', mode: 'balance', balance: 200, balanceAt: now }],
    { snapshots: { [D(-30)]: { v: { b: -100, g: 500, dep: 200 } } } });
  const pf = pfOf(s);
  const c = I.inflationCard(s, pf, today);
  close(c.share, 500 / 700); close(c.delta, 0); close(c.unprotectedShare, 200 / 700);
  close(c.unprotected.reduce((t, u) => t + u.share, 0), c.unprotectedShare);
  close(c.parts.reduce((t, p) => t + p.share, 0) + c.unprotectedShare, 1);
  const l = I.liquidityCard(pf);
  close(l.tiers.high.share + l.tiers.mid.share + l.tiers.low.share, 1);
  const items = I.attentionItems(s, pf, today, now);
  assert.match(items[0].text, /موجودی «b» منفی است/); assert.equal(items[0].tone, 'neg');
});

test('same day: money out before money in, whatever order the assets are in', () => {
  const debt = { id: 'L', name: 'وام', category: 'debt', mode: 'loan', loan: { amount: 120_000_000, annualPct: 0, months: 12, firstDue: D(3), start: D(-27), account: 'b' } };
  const lent = { id: 'R', name: 'قرض داده‌شده', category: 'receivable', mode: 'loan', loan: { amount: 120_000_000, annualPct: 0, months: 12, firstDue: D(3), start: D(-27), account: 'b' } };
  for (const order of [[bank('b', 5_000_000), lent, debt], [bank('b', 5_000_000), debt, lent]]) {
    const s = st(order);
    const it = I.attentionItems(s, pfOf(s), today, now).find((x) => /قسط «وام»/.test(x.text));
    assert.equal(it.tone, 'neg', 'the 10M received the same day is not counted before the 10M paid');
  }
});

test('a paused loan says what is wrong, not that a price is missing', () => {
  const loan = { id: 'L', name: 'وام', category: 'debt', mode: 'loan', loan: { amount: 120_000_000, annualPct: 18, months: 12, firstDue: D(20), start: D(-10), paused: true } };
  const s = st([bank('b', 5), loan]);
  const it = I.attentionItems(s, pfOf(s), today, now).find((x) => x.assetId === 'L');
  assert.doesNotMatch(it.text, /قیمت/); assert.match(it.text, /حساب قسط‌ها حذف شده/);
});

test('a bank\'s own payday interest is not counted twice when checking an installment', () => {
  // payday falls within the week; the accrued part is already in the account's value
  const payDay = isoToJ(D(2)).jd;
  const b = bank('b', 9_850_000, { interest: { on: true, annualPct: 24, basis: 365, payDay, since: D(-28), lastAccrual: D(-1), accrued: 0 } });
  const loan = { id: 'L', name: 'وام', category: 'debt', mode: 'loan', loan: { amount: 120_000_000, annualPct: 0, months: 12, firstDue: D(4), start: D(-26), account: 'b' } };
  const s = st([b, loan]);
  const it = I.attentionItems(s, pfOf(s), today, now).find((x) => /قسط/.test(x.text));
  assert.ok(E.upcoming(s.assets, [], 7, today).some((e) => e.kind === 'interest' && e.toId === 'b'), 'payday is inside the week');
  assert.equal(it.tone, 'neg', 'about 9.86M (accrued included) against a 10M installment; payday interest would wrongly cover it');
});

test('deleted assets above 5% of a past snapshot: no monthly move on the card', () => {
  const s = st([bank('b', 100), manual('g', 'gold', 300)], { snapshots: { [D(-30)]: { v: { b: 100, g: 300, gone: 100 } } } });
  assert.equal(I.inflationCard(s, pfOf(s), today).delta, null);
});
