// «رشد خوب و پرمعامله» and the steadiness of trading (synthetic stocks only): a stock that rose a lot but traded on a few
// scattered days is neither in the new list nor «liquid»; a session nobody has rows for doesn't count against anyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RD from '../../extension/lib/radar.js';

const D0 = RD.dayNum('2026-01-31');
const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
const SESS = Array.from({ length: 30 }, (_, k) => iso(D0 - 29 + k));
// a year of closes rising by `g` over the year, trading on the days `on(k)` (k = days back from today)
function stock(sym, g, on = () => true, { val = 3e10, eps = 100, pe = 8 } = {}) {
  const d = [], p = [];
  for (let k = 365; k >= 0; k--) { d.push(D0 - k); p.push(+(100 * (1 + g) ** ((365 - k) / 365)).toFixed(4)); }
  const h = []; for (let k = 29; k >= 0; k--) if (on(k)) h.push([D0 - k, 1e6, val]);
  return { sym, name: 'شرکت ' + sym, isin: 'IRO1' + sym, sector: '27', eps, pe, d, p, h, need: 0, today: { day: iso(D0), close: p[p.length - 1], py: p[p.length - 2], vol: 1e6, val } };
}
const bench = { d: Array.from({ length: 400 }, (_, k) => D0 - 399 + k), p: Array.from({ length: 400 }, (_, k) => 1000 * (1 + 0.2 * k / 365)) };
function radar(stocks) { return { day: iso(D0), sess: SESS, stocks, etf: {}, funds: [], bench: { index: bench, usd: bench }, track: {} }; }

test('trading steadiness: days traded and the median day, a gappy stock is not liquid', () => {
  const steady = RD.stockMetrics(stock('الف', 1), D0, {}, SESS);
  assert.equal(steady.tradeOf, 20); assert.equal(steady.tradeDays, 20); assert.equal(steady.medVal, 3e10); assert.equal(steady.liquid, true); assert.equal(steady.tradedToday, true);
  // traded on 1 day in 4, but with big blocks: the average says liquid, the median and the count say not
  const gap = RD.stockMetrics(stock('ب', 1, (k) => k % 4 === 0, { val: 2e11 }), D0, {}, SESS);
  assert.equal(gap.tradeDays, 5); assert.ok(gap.avgVal >= RD.LIQ); assert.equal(gap.medVal, 0);
  assert.equal(gap.gappy, true); assert.equal(gap.liquid, false);
  const f = RD.stockFlags(gap).find((x) => x.k === 'gappy');
  assert.ok(f && f.severe); assert.match(f.t, /جلسه از/);
});

test('a session no stock has rows for (browser closed) does not count against anyone', () => {
  const st = { A: stock('الف', 1, (k) => k > 12), B: stock('ب', 0.1, (k) => k > 12) }; // nobody has the last 13 days
  const r = radar(st);
  const seen = RD.sessSeen(r);
  assert.ok(seen.length < SESS.length); assert.ok(seen.every((d) => RD.dayNum(d) < D0 - 12));
  const m = RD.stockMetrics(st.A, D0, {}, SESS, seen);
  assert.equal(m.gappy, false); assert.equal(m.tradeDays, m.tradeOf);
});

test('«رشد خوب و پرمعامله»: ahead of the index, still up, profitable and trading every day', () => {
  const st = {
    A: stock('پرمعامله', 1.0),                                    // +100% a year, trades every day → in
    B: stock('پراکنده', 1.5, (k) => k % 4 === 0, { val: 2e11 }),   // more return, a few scattered big days → out
    C: stock('کند', 0.15),                                       // behind the index (+20%) → out
    L: stock('زیان‌ده', 1.2, () => true, { eps: -10, pe: -5 }),  // loss-making → out
    M: stock('دوروزغیبت', 0.8, (k) => k !== 3 && k !== 7),        // missed two sessions → still in
    N: stock('سه‌روزغیبت', 0.8, (k) => k !== 3 && k !== 7 && k !== 9), // missed three → out
  };
  for (let i = 0; i < 20; i++) st['X' + i] = stock('عادی' + i, 0.05 + i / 100); // the rest of the market
  const built = RD.buildCards(radar(st), { money: (v) => String(v) });
  const act = built.cards.filter((c) => c.sig === 'active').map((c) => c.sym);
  assert.deepEqual(act.sort(), ['پرمعامله', 'دوروزغیبت'].sort());
  // the gappy stock isn't in the momentum lists any more either (it isn't liquid)
  assert.ok(!built.cards.some((c) => c.sym === 'پراکنده'));
  const card = built.cards.find((c) => c.sig === 'active');
  assert.match(card.why[1], /جلسه از/);
  assert.equal(RD.SIGNALS.active.kind, 'stock');
});
