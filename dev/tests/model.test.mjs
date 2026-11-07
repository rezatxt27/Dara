// «سبد مدل» (lib/model.js): the split by risk level, the picks by rule, diversity, keeping picks, the log and the
// numbers. Synthetic market and funds only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RD from '../../extension/lib/radar.js';
import * as MD from '../../extension/lib/model.js';
import * as PB from '../../extension/lib/builder.js';
import { addDaysIso } from '../../extension/lib/jalali.js';

const DAY0 = '2026-10-11'; const D0 = RD.dayNum(DAY0);
const money = (v) => String(Math.round(v));
const close = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);
function mk(R, ins, f, { pe = 10, eps = 100, sector = '27', val = 2e10, lastVol = 1e6 } = {}) {
  const d = [], p = [];
  for (let k = 365; k >= 0; k--) { d.push(D0 - k); p.push(f(k)); }
  const h = []; for (let k = 20; k >= 1; k--) h.push([D0 - k, 1e6, val]); h.push([D0, lastVol, val]);
  R.stocks[ins] = { sym: ins, name: 'شرکت ' + ins, isin: 'IRO1' + ins, sector, eps, pe, d, p, h, need: 0, today: { day: DAY0, close: p[p.length - 1], py: p[p.length - 2], vol: lastVol, val } };
}
function flow(R, ins, shares, power = 1.5) {
  const rec = R.stocks[ins]; const val = new Map(rec.h.map((x) => [x[0], x[2]]));
  rec.fl = shares.map((sh, i) => { const d = D0 - (shares.length - 1 - i); return [d, Math.round(sh * (val.get(d) || 0)), power]; });
}
const flat = (k) => (k === 0 ? 110 : 100);
const fund = (key, fundType, name, { y1 = 0.4, size = 5e12, traded = false, ins = null, manager = 'm' + key, nav = 1e4, bubble = null } = {}) =>
  ({ key, regNo: key, name, fundType, cancelNav: nav, date: DAY0, symbol: 'ص' + key, size, ret: { y1: y1 * 100 }, since: '2020-01-01', traded, insCode: ins, manager, _bubble: bubble });
function market() {
  const R = RD.empty(); R.day = DAY0;
  for (let i = 0; i < 30; i++) mk(R, 'S' + i, (k) => 100 * Math.pow(1 + i / 100, (365 - k) / 365), { pe: 8 + (i % 5), sector: String(20 + (i % 6)) });
  R.sess = Array.from({ length: 21 }, (_, i) => addDaysIso(DAY0, i - 20));
  // three candidates in two sectors (a breakout with volume, money in, cheap)
  for (const [ins, sector] of [['C1', '21'], ['C2', '21'], ['C3', '22']]) { mk(R, ins, flat, { lastVol: 3e6, pe: 4, sector }); flow(R, ins, [0.1, 0.1, 0.1, -0.01, 0.1, 0.1, 0.1]); }
  R.funds = [
    fund('F1', 4, 'درآمد ثابت یک', { y1: 0.36, manager: 'الف' }), fund('F2', 4, 'درآمد ثابت دو', { y1: 0.34, manager: 'الف' }), fund('F3', 4, 'درآمد ثابت سه', { y1: 0.33, manager: 'ب' }),
    fund('F4', 4, 'درآمد ثابت کوچک', { y1: 0.5, size: 1e11 }),
    fund('G1', 5, 'صندوق طلای یک', { traded: true, ins: 'g1', bubble: 0.02 }), fund('G2', 5, 'صندوق طلای دو', { traded: true, ins: 'g2', bubble: 0.004 }), fund('G3', 5, 'صندوق طلای سه', { traded: true, ins: 'g3', bubble: 0.01 }),
    fund('E1', 6, 'سهامی یک', { y1: 0.5, traded: true, ins: 'e1' }), fund('E2', 23, 'شاخصی دو', { y1: 0.45, traded: true, ins: 'e2', manager: 'ج' }), fund('E3', 6, 'سهامی سه', { y1: 0.9 }),
  ];
  R.etf = {};
  for (const f of R.funds) if (f.insCode) R.etf[f.insCode] = { sym: f.symbol, close: f.cancelNav * (1 + (f._bubble || 0)), val: 5e9, day: DAY0, hist: { [DAY0]: f.cancelNav * (1 + (f._bubble || 0)) } };
  return R;
}
const builtOf = (R) => RD.buildCards(R, { money, depositPct: 25 });

test('each level: the parts are the level\'s mix, all of it placed, a stock at 8% at most, sectors different', () => {
  const R = market(); const b = builtOf(R);
  for (const lv of MD.LEVELS) {
    const m = MD.buildModel(R, b, lv, { depositPct: 25 });
    close(m.items.reduce((t, i) => t + i.w, 0), 1, 1e-9, lv);
    for (const [c, w] of Object.entries(MD.blockWeights(lv))) close(m.items.filter((i) => i.block === c).reduce((t, i) => t + i.w, 0), w, 1e-9, `${lv} ${c}`);
    const st = m.items.filter((i) => i.kind === 'stock');
    assert.ok(st.every((i) => i.w <= MD.MAX_STOCK + 1e-12));
    assert.ok(st.length <= MD.MAX_STOCKS);
    assert.equal(new Set(st.map((i) => i.sector)).size, st.length, 'one per sector');
  }
  const mid = MD.buildModel(R, b, 'mid', { depositPct: 25 });
  // fixed income: two funds, two managers, both ahead of a deposit and large; the small one isn't taken
  const fx = mid.items.filter((i) => i.block === 'deposit');
  assert.deepEqual(fx.map((i) => i.id), ['f:F1', 'f:F3']);
  // gold: the lowest premiums (G2 0.4%, G3 1%)
  assert.deepEqual(mid.items.filter((i) => i.block === 'gold').map((i) => i.id), ['f:G2', 'f:G3']);
  // the stock market: traded funds before a fund that isn't, and two candidates from two sectors
  assert.ok(mid.items.some((i) => i.id === 'f:E1') && !mid.items.some((i) => i.id === 'f:E3'));
  assert.deepEqual(mid.items.filter((i) => i.kind === 'stock').map((i) => i.sym).sort(), ['C1', 'C3']);
  assert.ok(mid.items.find((i) => i.sym === 'C1').stop > 0);
  // low risk: no bitcoin; high: some
  assert.ok(!MD.buildModel(R, b, 'low').items.some((i) => i.block === 'btc'));
  assert.ok(MD.buildModel(R, b, 'high').items.some((i) => i.block === 'btc'));
  assert.ok(!MD.buildModel(R, b, 'high', { noCrypto: true }).items.some((i) => i.block === 'btc'));
});

test('picks stay while they hold; a stock under the price that undoes it leaves, with the reason', () => {
  const R = market(); const b = builtOf(R);
  const prev = { day: addDaysIso(DAY0, -7), items: [{ id: 'f:F2', w: 0.15 }, { id: 'f:G3', w: 0.1 }, { id: 's:S5', w: 0.08, stop: 50, sym: 'S5' }, { id: 's:S7', w: 0.08, stop: 1e9, sym: 'S7' }] };
  const m = MD.buildModel(R, b, 'mid', { prev, depositPct: 25 });
  const ids = m.items.map((i) => i.id);
  // F2 is still eligible and near the top, but its manager is F1's: one of the two goes — the kept one first
  assert.ok(ids.includes('f:F2') && !ids.includes('f:F1'));
  assert.ok(ids.includes('f:G3') && m.items.find((i) => i.id === 'f:G3').kept);
  assert.ok(ids.includes('s:S5') && m.items.find((i) => i.id === 's:S5').kept, 'still liquid, nothing severe, above its stop');
  assert.ok(!ids.includes('s:S7'));
  const out = m.changes.removed.find((r) => r.name === 'S7');
  assert.match(out.why, /باطل/);
  assert.ok(m.changes.added.length > 0);
});

test('the log: a new entry when the picks change or a week passes; the record chains entries with their prices', () => {
  const R = market(); const b = builtOf(R);
  const quotes = { 'tgju:price_dollar_rl': { price: 1e6 }, 'nobitex:btc': { price: 1e10 } };
  MD.updateModels(R, b, { quotes, depositPct: 25 });
  assert.equal(R.model.log.mid.length, 1);
  const e = R.model.log.mid[0]; assert.ok(e.items.every(([, w]) => w > 0));
  assert.equal(MD.modelRecord(R, 'mid', quotes).pct, null, 'no days yet');
  // a week later: every price 10% up — the record says about +10% (the deposit part grows by its rate)
  const R2 = structuredClone(R); R2.day = addDaysIso(DAY0, 7);
  for (const r of Object.values(R2.stocks)) { r.d.push(D0 + 7); r.p.push(r.p[r.p.length - 1] * 1.1); }
  for (const f of R2.funds) f.cancelNav *= 1.1;
  const q2 = { 'tgju:price_dollar_rl': { price: 1.1e6 }, 'nobitex:btc': { price: 1.1e10 } };
  const rec = MD.modelRecord(R2, 'mid', q2);
  close(rec.pct, 0.1, 1e-9); assert.equal(rec.days, 7);
  MD.updateModels(R2, builtOf(R2), { quotes: q2, depositPct: 25 });
  assert.equal(R2.model.log.mid.length, 2); assert.ok(R2.model.log.mid[0].exit);
  close(MD.modelRecord(R2, 'mid', q2).pct, 0.1, 1e-9, 'chained the same');
  // the model of a new day keeps yesterday's as the one to compare with
  assert.equal(R2.model.levels.mid.prev.day, DAY0);
});

test('the numbers: 12 months weighted, worst month, how much the parts move together, markets, cost', () => {
  const R = market(); const b = builtOf(R);
  R.bench = { index: RD.benchSeries(Array.from({ length: 400 }, (_, k) => ({ date: RD.isoOf(D0 - 399 + k), close: 1000 * (1 + 0.1 * Math.sin(k / 20)) + k })), D0) };
  const months = Array.from({ length: 25 }, (_, i) => `2024-${String(i)}`);
  const s = (k, sw) => Object.fromEntries(months.map((m, i) => [m, 100 * Math.pow(1 + k, i) * (1 + sw * Math.sin(i))]));
  const Rp = PB.returnsFrom({ gold: s(0.03, 0.05), usd: s(0.02, 0.03), index: s(0.02, 0.1), btc: s(0.04, 0.3) }, 25);
  const m = MD.buildModel(R, b, 'high', { depositPct: 25 });
  const st = MD.modelStats(m, R, { R: Rp, depositPct: 25 });
  assert.ok(st.y1 !== null && st.worst !== null && st.vol > 0, st);
  assert.ok(st.avgCorr !== null && st.avgCorr >= -1 && st.avgCorr <= 1);
  assert.ok(st.markets.index !== null && st.markets.gold !== null);
  close(st.protectedShare, 1 - m.blocks.deposit);
  assert.ok(st.cost > 0 && st.cost < 0.02);
  // without the market's past: still a 12-month number from what has its own (stocks, funds, the index)
  const st2 = MD.modelStats(m, R, { R: null, depositPct: 25 });
  assert.ok(st2.y1 !== null); assert.equal(st2.markets.gold, null);
});
