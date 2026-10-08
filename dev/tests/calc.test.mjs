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
