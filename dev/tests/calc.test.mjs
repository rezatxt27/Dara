// «ماشین‌حساب‌ها» (lib/calc.js). Synthetic prices only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../../extension/lib/calc.js';

const now = Date.now();
const close = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${m} ${a} ≉ ${b}`);
const Q = (price, extra = {}) => ({ price, at: now - 60000, fetchedAt: now - 60000, ...extra });
const quotes = { 'tgju:geram18': Q(100_000_000), 'tgju:sekee': Q(900_000_000), 'tgju:rob': Q(250_000_000), 'tgju:price_dollar_rl': Q(1_000_000), 'nobitex:usdt': Q(1_000_000, { at: now - 5 * 86400000 }) };

test('converter: an amount buys this much at market, a little less after the cost of buying', () => {
  const rows = Object.fromEntries(K.convertFrom(1_000_000_000, quotes, { now }).map((r) => [r.id, r]));
  close(rows.geram18.qty, 10); close(rows.geram18.net, 10 * (1 - 0.015 / 2));
  close(rows.usd.qty, 1000);
  assert.equal(rows.sekeb.price, null, 'no quote → no number, not zero');
  assert.equal(rows.usdt.stale, true, 'a five-day-old price is marked');
  assert.equal(rows.sekee.count, 1, 'one whole coin');
  close(rows.sekee.left, 1_000_000_000 - 900_000_000 / (1 - 0.01), 1e-9, 'what is left after one coin with its cost');
  assert.equal(rows.rob.count, 3); assert.ok(rows.rob.left > 0 && rows.rob.left < 250_000_000);
  assert.deepEqual(K.convertFrom(0, quotes), []);
  close(K.convertFrom(1e9, quotes, { now, costs: { geram18: 0 } }).find((r) => r.id === 'geram18').net, 10, 1e-9, 'cost can be changed');
});

test('converter: a quantity is worth this much today, and brings a little less when sold', () => {
  const r = K.convertTo('sekee', 2, quotes, { now });
  close(r.value, 1_800_000_000); close(r.net, 1_800_000_000 * (1 - 0.01));
  assert.equal(K.convertTo('nope', 2, quotes), null); assert.equal(K.convertTo('sekee', 0, quotes), null);
});

test('gold invoice: making charge, seller margin on gold + making, tax only on making + margin', () => {
  const r = K.goldBuy({ weight: 10, gram: 100, wage: { pct: 15 } });
  close(r.base, 1000); close(r.making, 150); close(r.seller, 0.07 * 1150); close(r.vat, 0.1 * (150 + 80.5));
  close(r.total, 1000 + 150 + 80.5 + 23.05);
  close(r.perGram, r.total / 10);
  close(r.resale, 10 * 100 * 740 / 750, 1e-9, 'sold back at 740');
  close(r.resaleLoss, 1 - (1000 * 740 / 750) / r.total);
  assert.ok(r.resaleLoss > 0.2 && r.resaleLoss < 0.22, 'about 21% for a 15% making charge');
  const pg = K.goldBuy({ weight: 10, gram: 100, wage: { perGram: 20 } });
  close(pg.making, 200); close(pg.makingPct, 0.2);
  assert.equal(K.goldBuy({ weight: 0, gram: 100 }), null);
  const used = K.goldBuy({ weight: 10, gram: 100, wage: { pct: 0 } });
  close(used.total, 1000 * 1.07 + 0.1 * 70, 1e-9, 'second-hand: no making charge, margin and its tax only');
});

test('selling old gold: stones off, 740 of 750, an offer compared', () => {
  const r = K.goldSell({ weight: 12, stones: 2, gram: 750, offer: 7000 });
  assert.equal(r.net, 10); close(r.expected, 10 * 740); close(r.diff, 7000 / 7400 - 1);
  close(K.goldSell({ weight: 10, gram: 750, k: 747 }).expected, 7470);
  close(K.goldSell({ weight: 10, gram: 750, k: 900 }).expected, 7400, 1e-9, 'a typo falls back to 740, not to 750');
  const none = K.goldSell({ weight: 1, stones: 5, gram: 750, offer: 100 });
  assert.equal(none.nothing, true); assert.equal(none.diff, undefined, 'no comparison with nothing to sell');
  assert.equal(K.clampK(74), 740); assert.equal(K.clampK(747), 747); assert.equal(K.clampPct(-5, 7), 0); assert.equal(K.clampPct(null, 7), 7);
});

test('a shop quote back to the making charge it implies (the invoice, reversed)', () => {
  for (const pct of [0, 7, 15, 30]) {
    const inv = K.goldBuy({ weight: 7.3, gram: 123_456, wage: { pct } });
    close(K.impliedWage({ weight: 7.3, gram: 123_456, total: inv.total }).pct, pct / 100, 1e-9, `${pct}%`);
  }
  const low = K.impliedWage({ weight: 10, gram: 100, total: 900 });
  assert.ok(low.belowGold && low.pct < 0);
  assert.equal(K.impliedWage({ weight: 10, gram: 100, total: 0 }), null);
});

test('rent and deposit: all-rent, all-deposit, and a new mix that keeps the contract equal', () => {
  const r = K.rentConvert({ deposit: 1_000_000_000, rent: 50_000_000, ratePct: 3 });
  close(r.fullRent, 80_000_000); close(r.fullDeposit, 1_000_000_000 + 50_000_000 / 0.03);
  const more = K.rentConvert({ deposit: 1e9, rent: 5e7, ratePct: 3, newDeposit: 1.5e9 });
  close(more.to.rent, 3.5e7, 1e-9, '500M more deposit → 15M less rent');
  const less = K.rentConvert({ deposit: 1e9, rent: 5e7, ratePct: 3, newRent: 2e7 });
  close(less.to.deposit, 2e9);
  const over = K.rentConvert({ deposit: 1e9, rent: 3e7, ratePct: 3, newDeposit: 3e9 });
  assert.equal(over.to.over, true); close(over.to.overBy, 1e9);
  assert.equal(K.rentConvert({ deposit: 0, rent: 0 }), null);
  const v = K.rentVsDeposit({ ratePct: 3, depositPct: 23 });
  close(v.rentYield, 0.36); assert.equal(v.more, 'deposit');
  assert.equal(K.rentVsDeposit({ ratePct: 1.5, depositPct: 23 }).more, 'bank');
});

test('loan: the bank installment, and a plain loan costs exactly its own rate', () => {
  const r = K.loanCost({ amount: 1e9, ratePct: 23, months: 36 });
  const i = 23 / 1200; close(r.installment, 1e9 * i / (1 - Math.pow(1 + i, -36)));
  close(r.realPct, 23, 1e-6, 'no conditions → the quoted rate'); assert.equal(r.extras, false);
  close(K.loanCost({ amount: 1.2e9, ratePct: 0, months: 12 }).installment, 1e8, 1e-9, 'interest-free');
});

test('loan conditions raise the real rate: a fee, blocked money, money parked before', () => {
  const fee = K.loanCost({ amount: 1e9, ratePct: 4, months: 36, feePct: 5 });
  assert.ok(fee.realPct > 7 && fee.realPct < 8, `${fee.realPct}`); close(fee.netReceived, 9.5e8);
  const blk = K.loanCost({ amount: 1e9, ratePct: 18, months: 24, blocked: 2e8, blockedPct: 0 });
  assert.ok(blk.realPct > 18, 'blocked money earning nothing makes it dearer'); close(blk.netReceived, 8e8);
  const blkPaid = K.loanCost({ amount: 1e9, ratePct: 18, months: 24, blocked: 2e8, blockedPct: 18 });
  close(blkPaid.realPct, 18, 1e-6, 'blocked money earning the loan rate changes nothing');
  // money parked before the loan costs the interest it gives up against a deposit, paid as if at payout
  const idle = K.loanCost({ amount: 1e9, ratePct: 4, months: 36, idle: 1e9, idleMonths: 6, idlePct: 0, opportunityPct: 23 });
  close(idle.idleCost, 1e9 * (Math.pow(1 + 23 / 1200, 6) - 1));
  const m = idle.realPct / 1200; let npv = 1e9 - idle.idleCost;
  for (let k = 1; k <= 36; k++) npv -= idle.installment / Math.pow(1 + m, k);
  assert.ok(Math.abs(npv) < 1, `${npv}`);
  assert.ok(idle.realPct > 4, 'dearer than its quoted rate');
  assert.equal(K.loanCost({ amount: 0, ratePct: 4, months: 12 }), null);
});

test('deposit: monthly interest, over the term, and with interest deposited again', () => {
  const d = K.depositYield({ principal: 1.2e9, ratePct: 24, months: 12 });
  close(d.monthly, 2.4e7); close(d.simple, 2.88e8); close(d.compounded, 1.2e9 * (Math.pow(1.02, 12) - 1)); close(d.effAnnual, Math.pow(1.02, 12) - 1);
});

test('breaking a deposit: the months held repaid at the lower rate, the rest off the principal; keep or move', () => {
  const b = K.depositBreak({ principal: 1.2e9, ratePct: 24, termMonths: 12, heldMonths: 5, breakPct: 12 });
  close(b.received, 1.2e9 * 0.24 * 5 / 12); close(b.penalty, 1.2e9 * 0.12 * 5 / 12); close(b.back, 1.2e9 - b.penalty);
  const mv = K.depositBreak({ principal: 1.2e9, ratePct: 24, termMonths: 12, heldMonths: 5, breakPct: 12, newPct: 30 });
  close(mv.diff, mv.back * (1 + 0.30 * 7 / 12) - 1.2e9 * (1 + 0.24 * 7 / 12));
  const even = K.depositBreak({ principal: 1.2e9, ratePct: 24, termMonths: 12, heldMonths: 5, breakPct: 12, newPct: mv.evenPct });
  close(even.diff, 0, 1e-3, 'at the break-even rate both end level');
  assert.equal(K.depositBreak({ principal: 1e9, ratePct: 24, termMonths: 12, heldMonths: 12, breakPct: 10 }).matured, true);
  close(K.depositBreak({ principal: 1e9, ratePct: 20, termMonths: 12, heldMonths: 3, breakPct: 25 }).penalty, 0, 1e-9, 'a break rate above the contract costs nothing');
});

test('review: idle money over a grid gives a real rate every time, never below the loan, rising with the months', () => {
  for (const rate of [4, 18, 23, 30]) for (const months of [6, 12, 24, 60]) for (const mult of [0.5, 1, 2]) {
    let prev = rate - 1e-9;
    for (const im of [1, 3, 6, 12]) {
      const r = K.loanCost({ amount: 1e9, ratePct: rate, months, idle: mult * 1e9, idleMonths: im, idlePct: 0, opportunityPct: 23 });
      if (r.noMoney) break;
      assert.ok(r.realPct !== null && r.realPct >= prev - 1e-6, `${rate}% ${months}m ×${mult} ${im}m: ${r.realPct} after ${prev}`);
      prev = r.realPct;
    }
  }
  const zero = K.loanCost({ amount: 1e9, ratePct: 18, months: 12, idle: 1e9, idleMonths: 6, idlePct: 23, opportunityPct: 23 });
  close(zero.realPct, 18, 1e-6, 'parked money earning as much as a deposit costs nothing');
});

test('review: nothing left to receive, a package that only earns, a blank rate', () => {
  assert.equal(K.loanCost({ amount: 1e9, ratePct: 18, months: 24, blocked: 1e9 }).noMoney, true);
  const earns = K.loanCost({ amount: 1e9, ratePct: 4, months: 36, blocked: 5e8, blockedPct: 20 });
  assert.ok(earns.earns || earns.realPct < 4, `${earns.realPct}`);
  assert.equal(K.loanCost({ amount: 1e9, ratePct: null, months: 12 }), null);
  assert.equal(K.loanCost({ amount: 1e9, ratePct: '', months: 12 }), null);
});

test('review: breaking a deposit whose interest stays on it; whole months only; never below zero', () => {
  const acc = K.depositBreak({ principal: 1e9, ratePct: 23, termMonths: 12, heldMonths: 6, breakPct: 10, paidOut: false });
  close(acc.back, 1e9 * (1 + 0.10 * 6 / 12)); close(acc.lost, 1e9 * 0.13 * 6 / 12); assert.equal(acc.penalty, 0);
  assert.equal(K.depositBreak({ principal: 1e9, ratePct: 24, termMonths: 12, heldMonths: 1.9, breakPct: 10 }).held, 1);
  const deep = K.depositBreak({ principal: 1e9, ratePct: 40, termMonths: 60, heldMonths: 36, breakPct: 0, newPct: 20 });
  assert.ok(deep.back >= 0); assert.equal(deep.back, 0); assert.equal(deep.evenPct, null);
  const cash = K.depositBreak({ principal: 1e9, ratePct: 24, termMonths: 12, heldMonths: 5, breakPct: 10, newPct: 0 });
  assert.ok(cash.diff < 0, 'cash (0%) can be compared too');
});
