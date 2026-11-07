// «کاندیداهای رشد», the newer signals, red flags and the signals' record (lib/radar.js). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RD from '../../extension/lib/radar.js';
import { addDaysIso } from '../../extension/lib/jalali.js';

const DAY0 = '2026-10-11'; const D0 = RD.dayNum(DAY0);
const D = (n) => addDaysIso(DAY0, n);
const money = (v) => String(Math.round(v));
// a stock: a year of closes from f(k) (k = days before today, 365…0), 20 sessions of usual volume, today's volume
function mk(R, ins, f, { pe = 10, eps = 100, sector = '27', val = 2e10, lastVol = 1e6 } = {}) {
  const d = [], p = [];
  for (let k = 365; k >= 0; k--) { d.push(D0 - k); p.push(f(k)); }
  const h = []; for (let k = 20; k >= 1; k--) h.push([D0 - k, 1e6, val]); h.push([D0, lastVol, val]);
  R.stocks[ins] = { sym: ins, name: 'شرکت ' + ins, isin: 'IRO1' + ins, sector, eps, pe, d, p, h, need: 0, today: { day: DAY0, close: p[p.length - 1], py: p[p.length - 2], vol: lastVol, val } };
}
// individual money: net as a share of the day's value, newest last
function flow(R, ins, shares, power = 1.5) {
  const rec = R.stocks[ins]; const val = new Map(rec.h.map((x) => [x[0], x[2]]));
  rec.fl = shares.map((sh, i) => { const d = D0 - (shares.length - 1 - i); return [d, Math.round(sh * (val.get(d) || 0)), Array.isArray(power) ? power[i] : power]; });
}
function market() {
  const R = RD.empty(); R.day = DAY0;
  for (let i = 0; i < 30; i++) mk(R, 'S' + i, (k) => 100 * Math.pow(1 + i / 100, (365 - k) / 365), { pe: 8 + (i % 5) });
  R.sess = Array.from({ length: 21 }, (_, i) => D(i - 20));
  return R;
}
const flat = (k) => (k === 0 ? 110 : 100); // flat for a year, then a close 10% above the ceiling today

test('breakout: the first close above the 6-month ceiling, with volume; a stock rising every day is not a fresh one', () => {
  const R = market();
  mk(R, 'BRK', flat, { lastVol: 3e6 });
  mk(R, 'QUIET', flat, { lastVol: 1e6 }); // the same close on its usual volume
  const b = RD.buildCards(R, { money });
  const brk = b.cards.filter((c) => c.sig === 'breakout').map((c) => c.sym);
  assert.deepEqual(brk, ['BRK']);
  const c = b.cards.find((x) => x.sig === 'breakout');
  assert.equal(c.m.hi6, 100); assert.ok(c.why[0].includes('۶ ماه') && c.why[1].includes('۳ برابر'));
  assert.equal(RD.stockMetrics(R.stocks.S20, D0, {}, R.sess).brk, false, 'already above its ceiling yesterday');
});

test('money that stays: in on 5 of the last 7 sessions; buyer power three sessions running', () => {
  const R = market();
  flow(R, 'S3', [0.1, 0.05, -0.02, 0.08, 0.1, -0.01, 0.06], 1.0);   // 5 of 7 in
  flow(R, 'S4', [0.1, -0.05, -0.02, 0.08, -0.1, -0.01, 0.06]); // 3 of 7
  flow(R, 'S5', [0.02, 0.03, 0.04], [1.3, 1.25, 1.4]);         // buyer power ≥ 1.2 three sessions
  flow(R, 'S6', [0.02, 0.03, 0.04], [1.3, 1.1, 1.4]);          // one session under
  const b = RD.buildCards(R, { money });
  const by = (sig) => b.cards.filter((c) => c.sig === sig).map((c) => c.sym);
  assert.deepEqual(by('flowRun'), ['S3']);
  assert.deepEqual(by('buyerPower'), ['S5']);
  assert.ok(b.cards.find((c) => c.sig === 'flowRun').why[0].includes('۵ جلسه از ۷'));
});

test('stronger than the index: ahead over 3 months and the last month', () => {
  const R = market();
  // the index flat: a stock up 20% over 3 months and 5% the last month is ahead; one that only rose long ago is not
  R.bench = { index: RD.benchSeries(Array.from({ length: 400 }, (_, k) => ({ date: RD.isoOf(D0 - 399 + k), close: 1000 })), D0) };
  mk(R, 'STR', (k) => (k > 91 ? 100 : k > 30 ? 100 + (91 - k) * (14.3 / 61) : 114.3 * (1 + (30 - k) * (0.05 / 30))));
  const b = RD.buildCards(R, { money });
  const s = b.cards.filter((c) => c.sig === 'strength').map((c) => c.sym);
  assert.ok(s.includes('STR'), s);
  const m = b.cards.find((c) => c.sym === 'STR' && c.sig === 'strength').m;
  assert.ok(m.rel91 >= 0.1 && m.rel30 >= 0.02, m);
});

test('red flags: severe ones (idle, heavy outflow, a fall on volume) and light ones, on the cards and for holders', () => {
  const f = (m) => RD.stockFlags({ traded: true, liquid: true, flowN: 0, flowShare5: null, dayChange: 0, volRatio: 1, powerN3: 0, ret30: 0, eps: 100, pe: 10, peRel: 1, ...m });
  assert.deepEqual(f({}).map((x) => x.k), []);
  assert.ok(f({ traded: false }).some((x) => x.k === 'idle' && x.severe));
  assert.ok(f({ flowN: 5, flowShare5: -0.12, flowPos5: 1 }).some((x) => x.k === 'outflow' && x.severe));
  assert.ok(f({ dayChange: -0.04, volRatio: 2.5 }).some((x) => x.k === 'dump' && x.severe));
  assert.ok(f({ powerN3: 3, powerMax3: 0.7 }).some((x) => x.k === 'sellers' && !x.severe));
  assert.ok(f({ ret30: 0.5 }).some((x) => x.k === 'hot' && !x.severe));
  assert.ok(f({ eps: -5, pe: -3 }).some((x) => x.k === 'loss'));
  assert.ok(f({ liquid: false }).some((x) => x.k === 'thin'));
  // a holder sees the new ones too
  const R = market();
  mk(R, 'DUMP', (k) => (k === 0 ? 95 : 100), { lastVol: 3e6 });
  const items = RD.mine(R, [{ provider: 'tsetmc', key: 'DUMP', label: 'DUMP', assets: ['a'] }]);
  assert.ok(items[0].flags.some((x) => x.k === 'dump' && x.warn));
});

test('candidates: three separate checks, one of them money or value, nothing severe; else the list stays empty', () => {
  const R = market();
  // a breakout with volume, money in on 6 of 7, cheap against its sector: a candidate
  mk(R, 'CAND', flat, { lastVol: 3e6, pe: 4 });
  flow(R, 'CAND', [0.1, 0.1, 0.1, -0.01, 0.1, 0.1, 0.1]);
  // the same, but price-only checks: breakout + calm — not enough
  mk(R, 'PRICE', flat, { lastVol: 3e6, pe: 40 });
  // the same as CAND but heavy individual selling: a severe flag keeps it out
  mk(R, 'BAD', flat, { lastVol: 3e6, pe: 4 });
  flow(R, 'BAD', [0.1, 0.1, -0.2, -0.2, -0.2, -0.2, 0.01]);
  const b = RD.buildCards(R, { money });
  const cands = b.cards.filter((c) => c.sig === 'cand');
  assert.deepEqual(cands.map((c) => c.sym), ['CAND']);
  const c = cands[0];
  const on = c.checks.filter((x) => x.on).map((x) => x.k);
  assert.ok(on.includes('breakout') && on.includes('money') && on.includes('value'), on);
  assert.equal(c.stop.price, 100); assert.match(c.stop.t, /سقف/);
  assert.ok(c.why[0].includes('نشانه'));
  assert.ok(RD.isFirst(c), 'never folded');
  // a market with no such stock: no candidates at all
  assert.equal(RD.buildCards(market(), { money }).cards.filter((x) => x.sig === 'cand').length, 0);
  // a weak record takes a check away: with «cheap» and the breakout weak, CAND has only money left
  const ck = RD.candidateChecks(c.m, 1, new Set(['cheap', 'breakout']));
  assert.ok(ck.find((x) => x.k === 'value').weak && ck.find((x) => x.k === 'breakout').weak);
  assert.equal(RD.isCandidate(c.m, ck, []), false);
});

test('back-test over the stored year: a breakout that kept rising beats a flat index; one that fell is weak', () => {
  const build = (after) => {
    const R = RD.empty(); R.day = DAY0; R.sess = [];
    R.bench = { index: RD.benchSeries(Array.from({ length: 420 }, (_, k) => ({ date: RD.isoOf(D0 - 419 + k), close: 1000 })), D0) };
    const list = [];
    for (let s = 0; s < 36; s++) {
      const i0 = RD.BRK + 1 + 3 * (s % 50); // a session the test looks at
      const d = [], p = [];
      for (let i = 0; i < 366; i++) { d.push(D0 - 365 + i); p.push(i < i0 ? 100 : after(i - i0)); }
      R.stocks['B' + s] = { sym: 'B' + s, d, p, h: [], need: 0 };
      list.push({ ins: 'B' + s, rec: R.stocks['B' + s] });
    }
    return { R, list };
  };
  const up = build((t) => 105 * (1 + 0.01 * t));
  const r = RD.backtest(up.R, 'breakout', up.list);
  assert.ok(r && r.n >= RD.REC_MIN_N && r.stocks >= RD.REC_MIN_STOCKS, r);
  assert.equal(r.hit, 1); assert.ok(r.excess > 0.2 && Math.abs(r.index) < 1e-9, r);
  assert.equal(RD.isWeak(r), false);
  const down = build((t) => 105 * (1 - 0.005 * t));
  const w = RD.backtest(down.R, 'breakout', down.list);
  assert.ok(w && w.excess < 0 && w.hit === 0 && RD.isWeak(w), w);
  assert.ok(w.p10 <= w.avg + 1e-9);
  // too few stocks: nothing to say
  assert.equal(RD.backtest(up.R, 'breakout', up.list.slice(0, 5)), null);
  // the records: back-tested signals carry the test; flow signals only their own (empty) track
  const recs = RD.signalRecords(down.R, down.list);
  assert.ok(recs.breakout.test && recs.breakout.weak);
  assert.equal(recs.flowRun.test, null); assert.equal(recs.flowRun.weak, false);
});

test('candidates\' history: from the first day each showed up, against the index over the same days', () => {
  const R = market();
  R.bench = { index: RD.benchSeries(Array.from({ length: 400 }, (_, k) => ({ date: RD.isoOf(D0 - 399 + k), close: 1000 + k })), D0) };
  R.track = { [D(-20)]: { cand: [['s:S10', 1]] }, [D(-10)]: { cand: [['s:S10', 1], ['s:S20', 1]] }, [D(-40)]: { cand: [['s:S1', 1]] } };
  const h = RD.candHistory(R, 30);
  assert.deepEqual(h.map((x) => [x.sym, x.day]), [['S20', D(-10)], ['S10', D(-20)]]);
  const s10 = h.find((x) => x.sym === 'S10');
  const rec = R.stocks.S10; const i = rec.d.indexOf(D0 - 20);
  assert.ok(Math.abs(s10.change - (rec.p[rec.p.length - 1] / rec.p[i] - 1)) < 1e-9);
  assert.ok(Math.abs(s10.index - ((1399) / (1379) - 1)) < 1e-9);
});

test('«برترین هر بخش»: the best of a part by combined score, nothing with a severe flag, a weak section last', () => {
  const cards = [
    { sig: 'breakout', kind: 'stock', sym: 'A', score: 60, flags: [] },
    { sig: 'strength', kind: 'stock', sym: 'B', score: 80, flags: [] },
    { sig: 'strength', kind: 'stock', sym: 'C', score: 95, flags: [{ t: 'خروج سنگین', severe: true }] },
    { sig: 'topFund', kind: 'fund', sym: 'F1', sub: 'سهامی، قابل معامله', rank: 0 },
    { sig: 'topFund', kind: 'fund', sym: 'F2', sub: 'مختلط، قابل معامله', rank: 1 },
  ];
  const trend = { sigs: ['breakout', 'strength'] };
  assert.equal(RD.bestOf(cards, trend).sym, 'B', 'the higher score, not the severe one');
  assert.equal(RD.bestOf(cards, trend, new Set(['strength'])).sym, 'A', 'a weak section goes last');
  assert.equal(RD.bestOf(cards, { sigs: ['topFund'], fund: (c) => /سهامی/.test(c.sub) }).sym, 'F1');
  assert.equal(RD.bestOf(cards, { sigs: ['cand'] }), null);
  assert.equal(RD.bestOf(cards.map((c, i) => ({ ...c, id: 'x' + i })), trend, new Set(), new Set(['x1'])).sym, 'A', 'taken by an earlier part');
});

test('a fund whose NAV stopped (more than a week old) is left out of the fund lists', () => {
  const R = market(); R.day = DAY0;
  const f = (key, date) => ({ key, name: 'درآمد ثابت ' + key, fundType: 4, cancelNav: 1e4, date, size: 5e12, ret: { y1: 40 }, since: '2020-01-01', traded: false });
  R.funds = [f('fresh', DAY0), f('old', addDaysIso(DAY0, -20))];
  assert.equal(RD.fundMetrics(R.funds[1], R, D0).navStale, true);
  assert.equal(RD.fundMetrics(R.funds[0], R, D0).navStale, false);
  const fixed = RD.buildCards(R, { money, depositPct: 25 }).cards.filter((c) => c.sig === 'fixedBeat').map((c) => c.key);
  assert.deepEqual(fixed, ['fresh']);
});
