// «رادار فرصت‌ها» (lib/radar.js) and TSETMC's adjusted daily closes (providers.adjustDaily). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RD from '../../extension/lib/radar.js';
import { adjustDaily } from '../../extension/lib/providers.js';
import { addDaysIso } from '../../extension/lib/jalali.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const dEven = (iso) => +iso.replace(/-/g, '');
const DAY0 = '2026-10-11';
const D = (n) => addDaysIso(DAY0, n);

// a TSETMC daily list (newest first) from ascending [iso, close] with a capital increase on `eventDay` (priceYesterday = adjusted base)
function rows(points, events = {}) {
  const asc = points.map(([date, c], i) => ({ dEven: dEven(date), pClosing: c, priceYesterday: i ? (events[date] ?? points[i - 1][1]) : c, qTotTran5J: 1e6, qTotCap: 2e10 }));
  return asc.reverse();
}
const mw = (o) => ({ insCode: o.ins, insID: o.isin || 'IRO1TEST0001', lva: o.sym || 'تست', lvc: o.name || 'شرکت تست', csv: o.sector || '27 ', pcl: o.close, pdv: o.close, py: o.py ?? o.close, eps: o.eps ?? 100, pe: o.pe ?? '10.0', qtj: o.vol ?? 1e6, qtc: o.val ?? 2e10 });

test('adjustDaily: a capital increase is not a fall; the latest close never changes', () => {
  // 1000 → 1100, then a 100% capital increase: next day priceYesterday is 550 (not 1100) and it closes at 560
  const r = adjustDaily(rows([[D(-3), 1000], [D(-2), 1100], [D(-1), 560]], { [D(-1)]: 550 }));
  assert.deepEqual(r.map((x) => x.date), [D(-3), D(-2), D(-1)]);
  close(r[2].close, 560); close(r[1].close, 550); close(r[0].close, 500);
  close(r[2].close / r[0].close - 1, 0.12); // the real return: +12%, not −44%
  // no event: untouched
  const p = adjustDaily(rows([[D(-2), 100], [D(-1), 105]]));
  close(p[0].close, 100); close(p[1].close, 105);
});

test('session: consecutive days append; an event in priceYesterday scales the past', () => {
  const R = RD.empty();
  R.day = D(-1);
  R.stocks.A = { sym: 'الف', name: 'الف', d: [RD.dayNum(D(-2)), RD.dayNum(D(-1))], p: [1000, 1100], h: [], need: 0 };
  RD.applySession(R, [mw({ ins: 'A', close: 560, py: 550 })], DAY0, [D(-2), D(-1), DAY0]);
  const a = R.stocks.A;
  assert.equal(a.need, 0);
  assert.deepEqual(a.p.map(Math.round), [500, 550, 560]);
  assert.equal(R.day, DAY0);
  // running the same session again replaces the last close instead of adding a day
  RD.applySession(R, [mw({ ins: 'A', close: 570, py: 550 })], DAY0, [D(-2), D(-1), DAY0]);
  assert.equal(a.p.length, 3); close(a.p[2], 570);
});

test('session: a missed session asks for the days in between instead of guessing', () => {
  const R = RD.empty(); R.day = D(-3);
  R.stocks.A = { sym: 'الف', d: [RD.dayNum(D(-3))], p: [1000], h: [], need: 0 };
  RD.applySession(R, [mw({ ins: 'A', close: 1200, py: 1150 })], DAY0, [D(-3), D(-2), D(-1), DAY0]);
  assert.equal(R.stocks.A.need, 2 + 6); // two sessions missed (+ a margin)
  assert.equal(R.stocks.A.p.length, 1); // nothing appended blindly
  // the fetch joins on a shared day and rescales the older closes onto the new basis
  RD.mergeDaily(R.stocks.A, adjustDaily(rows([[D(-3), 1000], [D(-2), 1100], [D(-1), 1150], [DAY0, 1200]])), RD.dayNum(DAY0));
  assert.deepEqual(R.stocks.A.p, [1000, 1100, 1150, 1200]);
  assert.equal(R.stocks.A.need, 0);
});

test('session: a stock seen for the first time waits for its year of history; ETFs keep a few days of closes', () => {
  const R = RD.empty();
  RD.applySession(R, [mw({ ins: 'N', close: 100 }), mw({ ins: 'E', isin: 'IRTKTEST0001', sym: 'طلا', close: 50 }), mw({ ins: 'B', isin: 'IRB3TEST0001', close: 1 })], DAY0, []);
  assert.equal(R.stocks.N.need, RD.FULL_ROWS);
  assert.ok(!R.stocks.B); // bonds are left out
  assert.equal(R.etf.E.hist[DAY0], 50);
  assert.deepEqual(RD.nextToFetch(R, 5), [{ ins: 'N', need: RD.FULL_ROWS }]);
});

test('mergeDaily: a short fetch that cannot be joined becomes a full one (history is never cut)', () => {
  const rec = { d: [RD.dayNum(D(-30)), RD.dayNum(D(-29))], p: [10, 11], h: [], need: 8 };
  RD.mergeDaily(rec, adjustDaily(rows([[D(-2), 20], [D(-1), 21]])), RD.dayNum(DAY0));
  assert.equal(rec.need, RD.FULL_ROWS);
  assert.deepEqual(rec.p, [10, 11]);
});

// a market of stocks with a year of daily closes
function market() {
  const R = RD.empty(); R.day = DAY0;
  const D0 = RD.dayNum(DAY0);
  const mk = (ins, growth, { pe = 10, eps = 100, sector = '27', val = 2e10, lastVol = 1e6, low = false } = {}) => {
    const d = [], p = [];
    for (let k = 365; k >= 0; k--) { d.push(D0 - k); p.push(low ? 100 * (1 + 0.5 * (k / 365)) : 100 * Math.pow(1 + growth, (365 - k) / 365)); }
    const h = []; for (let k = 20; k >= 1; k--) h.push([D0 - k, 1e6, val]); h.push([D0, lastVol, val]);
    R.stocks[ins] = { sym: ins, name: 'شرکت ' + ins, isin: 'IRO1' + ins, sector, eps, pe, d, p, h, need: 0, today: { day: DAY0, close: p[p.length - 1], py: p[p.length - 2], vol: lastVol, val } };
  };
  for (let i = 0; i < 30; i++) mk('S' + i, i / 100, { pe: 8 + (i % 5) });
  mk('HOT', 2.0, { pe: 40 });                 // tripled in a year
  mk('VOL', 0.05, { lastVol: 5e6 });          // 5× its usual volume today
  mk('CHEAP', 0.05, { pe: 3 });               // a third of its sector's P/E
  mk('LOW', 0, { low: true, pe: 8 });          // fell all year, now at its low, still profitable
  mk('THIN', 3.0, { val: 1e8 });              // huge return but barely traded
  R.sess = Array.from({ length: 21 }, (_, i) => D(i - 20)); // a session every day (synthetic)
  return R;
}

test('cards: each signal finds what it should, with its reason and the other side', () => {
  const R = market();
  const b = RD.buildCards(R, { depositPct: 25 });
  const by = (sig) => b.cards.filter((c) => c.sig === sig).map((c) => c.sym);
  assert.equal(by('momentum12')[0], 'HOT');
  assert.ok(!by('momentum12').includes('THIN') && !by('momentum3').includes('THIN')); // thin stocks are not ranked
  assert.deepEqual(by('volume'), ['VOL']);
  assert.deepEqual(by('cheap'), ['CHEAP']);
  assert.deepEqual(by('nearLow'), ['LOW']);
  const hot = b.cards.find((c) => c.sym === 'HOT');
  assert.ok(hot.why[0].includes('۱۲ ماه') && hot.check.some((t) => t.includes('گران‌تر از هم‌گروه‌ها')) && hot.check.some((t) => t.includes('بالاترین')));
  close(hot.m.ret365, 2.0, 1e-6);
  assert.equal(hot.ref.provider, 'tsetmc'); assert.equal(hot.ref.key, 'HOT');
  assert.ok(b.cards.every((c) => !/بخر|بفروش/.test([...c.why, ...c.check].join(' '))));
});

test('sector median P/E needs enough profitable peers', () => {
  const m = RD.sectorMedians({ a: { sector: '1', pe: 4 }, b: { sector: '1', pe: 6 }, c: { sector: '1', pe: 8 }, d: { sector: '1', pe: 10 }, e: { sector: '1', pe: -3 }, f: { sector: '1', pe: 12 }, g: { sector: '2', pe: 5 } });
  assert.equal(m['1'], 8); // −3 left out: 4, 6, 8, 10, 12
  assert.equal(m['2'], undefined);
});

test('funds: a bubble only from a price and a NAV of the same day; fixed income against the deposit', () => {
  const R = RD.empty(); R.day = DAY0;
  R.etf = { X: { sym: 'طلا۱', close: 102, val: 5e9, day: DAY0, hist: { [D(-1)]: 98, [DAY0]: 102 } } };
  const f = (o) => ({ key: o.key, name: o.name, symbol: o.symbol || '', fundType: o.t, cancelNav: o.nav ?? 100, date: o.date ?? D(-1), size: 5e12, since: '2020-01-01', traded: !!o.ins, insCode: o.ins || '', ret: o.ret || {}, mix: {} });
  R.funds = [f({ key: 'g', name: 'صندوق طلا یک', symbol: 'طلا۱', t: 5, ins: 'X', nav: 100 }), f({ key: 'd', name: 'درآمد ثابت خوب', t: 4, ret: { y1: 35, m3: 8, m1: 2.6 } }), f({ key: 'e', name: 'درآمد ثابت ضعیف', t: 4, ret: { y1: 20 } })];
  const m = RD.fundMetrics(R.funds[0], R, RD.dayNum(DAY0));
  close(m.bubble, -0.02); // yesterday's price 98 against yesterday's NAV 100 — not today's 102
  const b = RD.buildCards(R, { depositPct: 25 });
  assert.deepEqual(b.cards.filter((c) => c.sig === 'negBubble').map((c) => c.key), ['g']);
  assert.deepEqual(b.cards.filter((c) => c.sig === 'fixedBeat').map((c) => c.key), ['d']); // 35% beats ~28% effective; 20% doesn't
  // no NAV for a day we have a price for: no bubble at all
  R.funds[0].date = D(-5);
  assert.equal(RD.fundMetrics(R.funds[0], R, RD.dayNum(DAY0)).bubble, null);
});

test('rules: validated, percent fields, and only new matches notify', () => {
  const R = market();
  assert.equal(RD.validRule({ kind: 'stock', conds: [{ f: 'nope', op: '<=', v: 1 }] }), false);
  const rule = { id: 'r1', name: 'P/E پایین', kind: 'stock', conds: [{ f: 'pe', op: '<=', v: 5 }, { f: 'ret365', op: '>=', v: 1 }] };
  assert.deepEqual(RD.runRule(R, rule).map((x) => x.sym), ['CHEAP']); // ret365 ≥ 1% (CHEAP grew 5%)
  const first = RD.newHits(undefined, RD.runRule(R, rule));
  assert.equal(first.fresh.length, 1);
  const again = RD.newHits(first.ids, RD.runRule(R, rule));
  assert.equal(again.fresh.length, 0);
});

test('before a purchase: concentration, distance from the high, liquidity and the deposit hurdle', () => {
  const R = market();
  const rep = RD.report(R, { ins: 'HOT' });
  assert.equal(rep.kind, 'stock');
  const lines = RD.preBuy({ value: 1e10, funded: false, held: { gross: 9e10, sameRef: 0, sameSector: 0 }, rep, depositPct: 25, fee: 1.5 });
  const k = Object.fromEntries(lines.map((l) => [l.k, l]));
  close(k.share.v, 0.1);
  assert.ok(k.high.warn); // at its yearly high
  close(k.liq.v, 0.5); assert.ok(k.liq.warn); // half of a usual day's trading
  close(k.deposit.v, Math.pow(1 + 0.25 / 12, 12) / 0.985 - 1);
  // funded from an account already in Dara: the total doesn't grow
  const f = RD.preBuy({ value: 1e10, funded: true, held: { gross: 1e11 }, rep: null, depositPct: 25, fee: 0 });
  close(f.find((l) => l.k === 'share').v, 0.1);
});

test('report, find and change since marked (adjusted: a capital increase since is not a loss)', () => {
  const R = RD.empty(); R.day = DAY0;
  R.stocks.A = { sym: 'فولاد', name: 'فولاد مبارکه', d: [RD.dayNum(D(-10)), RD.dayNum(DAY0)], p: [500, 560], h: [], need: 0, sector: '27', isin: 'IRO1FOLD0001' };
  assert.deepEqual(RD.find(R, 'فولاد'), { ins: 'A' });
  // marked at a raw 1000 on D(−10); a 100% capital increase later halved the price: the series says +12%
  close(RD.changeSince(R, 's:A', D(-10), 1000), 0.12);
});

test('final session prices: only after 13:30 Tehran or on a later day', () => {
  const at = (iso, hh, mm) => Date.parse(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:30`);
  assert.equal(RD.sessionFinal(DAY0, at(DAY0, 11, 0)), false);
  assert.equal(RD.sessionFinal(DAY0, at(DAY0, 14, 0)), true);
  assert.equal(RD.sessionFinal(D(-1), at(DAY0, 9, 0)), true);
});

test('adjustDaily: days without a trade (and TSETMC\'s nominal 1000 before a listing) are dropped', () => {
  // listed at a nominal 1000 for months, first trade at 8000: no +700% «return»; a halted day keeps no price
  const raw = [
    { dEven: dEven(D(-6)), pClosing: 1000, priceYesterday: 1000, zTotTran: 0, qTotTran5J: 0, qTotCap: 0 },
    { dEven: dEven(D(-5)), pClosing: 1000, priceYesterday: 1000, zTotTran: 0, qTotTran5J: 0, qTotCap: 0 },
    { dEven: dEven(D(-4)), pClosing: 8000, priceYesterday: 7900, zTotTran: 120, qTotTran5J: 1e6, qTotCap: 8e9 },
    { dEven: dEven(D(-3)), pClosing: 8000, priceYesterday: 8000, zTotTran: 0, qTotTran5J: 0, qTotCap: 0 },
    // a 100% capital increase while halted: the next traded day's priceYesterday is the adjusted base
    { dEven: dEven(D(-2)), pClosing: 4100, priceYesterday: 4000, zTotTran: 90, qTotTran5J: 1e6, qTotCap: 4e9 },
  ].reverse();
  const r = adjustDaily(raw);
  assert.deepEqual(r.map((x) => x.date), [D(-4), D(-2)]);
  close(r[0].close, 4000); close(r[1].close, 4100); // +2.5%, not a halving
});

// the largest stocks' daily lists say whether a market watch is the finished session or already reset for the next one
test('snapshotMode: live, reset (list) or not published yet (wait)', () => {
  const ref = (ins, prev, c) => ({ ins, close: c, py: prev, rows: adjustDaily(rows([[D(-1), prev], [DAY0, c]])) });
  const live = [mw({ ins: 'A', close: 110, py: 100 }), mw({ ins: 'B', close: 205, py: 200 })];
  assert.equal(RD.snapshotMode(live, [ref('A', 100, 110), ref('B', 200, 205)], DAY0), 'live');
  // the morning after: volumes 0 and priceYesterday already equals the close
  const reset = [mw({ ins: 'A', close: 110, py: 110, vol: 0, val: 0 }), mw({ ins: 'B', close: 205, py: 205, vol: 0, val: 0 })];
  const refsR = [{ ...ref('A', 100, 110), py: 110 }, { ...ref('B', 200, 205), py: 205 }];
  assert.equal(RD.snapshotMode(reset, refsR, DAY0), 'list');
  // the daily lists don't have the session yet
  const old = (ins, c) => ({ ins, close: c, py: c, rows: adjustDaily(rows([[D(-2), c], [D(-1), c]])) });
  assert.equal(RD.snapshotMode(live, [old('A', 110), old('B', 205)], DAY0), 'wait');
  // a close that disagrees with the stock's own list: don't trust the snapshot
  assert.equal(RD.snapshotMode(live, [{ ...ref('A', 100, 111), close: 110 }, ref('B', 200, 205)], DAY0), 'wait');
  // largest = by market value (shares × price), not by today's (possibly zero) value traded
  const big = [{ ...mw({ ins: 'S', close: 10, val: 0 }), ztd: 1e12 }, { ...mw({ ins: 'T', close: 1000, val: 9e12 }), ztd: 1e6 }];
  assert.deepEqual(RD.largest(big, 2).map((x) => x.ins), ['S', 'T']);
});

test('session from a reset market watch: no phantom capital increase, prices come from the daily list', () => {
  const R = RD.empty(); R.day = D(-1);
  R.stocks.A = { sym: 'الف', d: [RD.dayNum(D(-2)), RD.dayNum(D(-1))], p: [4000, 4100], h: [], need: 0 };
  // reset: priceYesterday shows today's close (4180), which in live mode would look like an event
  RD.applySession(R, [mw({ ins: 'A', close: 4180, py: 4180, vol: 0, val: 0 })], DAY0, [D(-2), D(-1), DAY0], 'list');
  const a = R.stocks.A;
  assert.deepEqual(a.p, [4000, 4100]);  // untouched
  assert.equal(a.need, 6);              // a few days from its own list
  assert.equal(a.today.py, null);
  RD.mergeDaily(a, adjustDaily(rows([[D(-2), 4000], [D(-1), 4100], [DAY0, 4180]])), RD.dayNum(DAY0));
  assert.deepEqual(a.p, [4000, 4100, 4180]);
  assert.equal(a.today.py, 4100); assert.equal(a.today.val, 2e10);
  close(RD.stockMetrics(a, RD.dayNum(DAY0)).dayChange, 4180 / 4100 - 1);
  // running the reset snapshot again changes nothing
  RD.applySession(R, [mw({ ins: 'A', close: 4180, py: 4180, vol: 0, val: 0 })], DAY0, [D(-2), D(-1), DAY0], 'list');
  assert.equal(a.need, 0); assert.equal(a.today.py, 4100);
  // ETFs keep their last known value traded
  R.etf.E = { val: 5e10, hist: {} };
  RD.applySession(R, [mw({ ins: 'E', isin: 'IRTKTEST0001', close: 50, vol: 0, val: 0 })], DAY0, [], 'list');
  assert.equal(R.etf.E.val, 5e10); assert.equal(R.etf.E.hist[DAY0], 50);
});

test('mergeDaily ignores the next, unfinished session; nextToFetch: largest first, short fetches cost less', () => {
  const rec = { d: [], p: [], h: [], need: RD.FULL_ROWS };
  RD.mergeDaily(rec, adjustDaily(rows([[D(-1), 100], [DAY0, 101], [D(1), 140]])), RD.dayNum(DAY0));
  assert.deepEqual(rec.p, [100, 101]);
  const R = RD.empty();
  for (let i = 0; i < 10; i++) R.stocks['s' + i] = { d: [], p: [], h: [], need: 6, cap: i };
  R.stocks.F = { d: [], p: [], h: [], need: RD.FULL_ROWS, cap: 100 };
  const t = RD.nextToFetch(R, 2);
  assert.equal(t[0].ins, 'F');
  assert.equal(t.length, 5); // 1 full + 4 short = 2
  assert.deepEqual(t.slice(1).map((x) => x.ins), ['s9', 's8', 's7', 's6']);
});

test('a halted stock that trades again catches up with a short fetch (its own missed sessions), not a whole year', () => {
  const R = RD.empty(); R.day = D(-1);
  R.stocks.H = { sym: 'ح', d: [RD.dayNum(D(-6)), RD.dayNum(D(-5))], p: [6000, 6200], h: [], need: 0 };
  const sessions = [-6, -5, -4, -3, -2, -1, 0].map(D);
  RD.applySession(R, [mw({ ins: 'H', close: 6390, py: 6200, vol: 0, val: 0 })], DAY0, sessions, 'list');
  assert.equal(R.stocks.H.need, 4 + 6); // D-4..D-1 had no trade for it
  // its list: halted days without a trade, then a trade today
  const list = [[-6, 6000, 5900, 50], [-5, 6200, 6000, 40], [-4, 6200, 6200, 0], [-3, 6200, 6200, 0], [-2, 6200, 6200, 0], [-1, 6200, 6200, 0], [0, 6390, 6200, 30]]
    .map(([k, c, py, z]) => ({ dEven: dEven(D(k)), pClosing: c, priceYesterday: py, zTotTran: z, qTotTran5J: z * 1000, qTotCap: z * 1e7 })).reverse();
  RD.mergeDaily(R.stocks.H, adjustDaily(list), RD.dayNum(DAY0));
  assert.deepEqual(R.stocks.H.p, [6000, 6200, 6390]);
  assert.equal(R.stocks.H.need, 0);
  assert.equal(R.stocks.H.today.py, 6200);
});

test('liquidity counts sessions without a trade as zero; a halted stock is neither refetched daily nor «cheap»', () => {
  const R = market();
  const D0 = RD.dayNum(DAY0);
  // traded 3 times in the last 20 sessions at 3e10 each: 4.5e9 a session, not 3e10
  const t = R.stocks.S5; t.h = [[D0 - 15, 1e6, 3e10], [D0 - 8, 1e6, 3e10], [D0, 1e6, 3e10]];
  const m = RD.stockMetrics(t, D0, {}, R.sess);
  close(m.avgVal, 9e10 / 20); assert.equal(m.liquid, false);
  // halted (last trade 40 days ago, checked through yesterday): a live session with no trade appends, no refetch
  const H = { sym: 'ح', d: [D0 - 41, D0 - 40], p: [100, 100], h: [[D0 - 40, 1e6, 5e10]], need: 0, upTo: D0 - 1, pe: 2, eps: 50, sector: '27' };
  const R2 = RD.empty(); R2.day = D(-1); R2.stocks.H = H;
  RD.applySession(R2, [mw({ ins: 'H', close: 100, py: 100, vol: 0, val: 0, pe: '2', eps: 50 })], DAY0, [D(-41), D(-40), D(-1), DAY0]);
  assert.equal(H.need, 0); assert.equal(H.upTo, D0);
  // without upTo it would have asked for its idle sessions again
  const H2 = { ...H, d: [D0 - 41, D0 - 40], p: [100, 100], upTo: undefined };
  const R3 = RD.empty(); R3.day = D(-1); R3.stocks.H = H2;
  RD.applySession(R3, [mw({ ins: 'H', close: 100, py: 100, vol: 0, val: 0 })], DAY0, [D(-41), D(-40), D(-1), DAY0]);
  assert.ok(H2.need > 0);
  // a P/E far under its sector's but not trading: no «cheap» card
  const M = market(); M.stocks.HALT = { ...H, sym: 'HALT', isin: 'IRO1HALT', d: [...M.stocks.S1.d], p: [...M.stocks.S1.p], h: [[D0 - 40, 1e6, 5e11]] };
  assert.ok(!RD.buildCards(M).cards.some((c) => c.sym === 'HALT'));
});

test('mergeDaily: an event on a cut (next-session) row does not shift the stored basis off the real close', () => {
  const rec = { d: [], p: [], h: [], need: RD.FULL_ROWS };
  // tomorrow (D+1) carries a 100% capital increase: priceYesterday 525 vs close 1050
  RD.mergeDaily(rec, adjustDaily(rows([[D(-1), 1000], [DAY0, 1050], [D(1), 530]], { [D(1)]: 525 })), RD.dayNum(DAY0));
  assert.deepEqual(rec.p, [1000, 1050]);
});

test('rules: all matches, best first; a year\'s high/low only with a year of history; an empty value is invalid', () => {
  const R = market();
  const hits = RD.runRule(R, { kind: 'stock', conds: [{ f: 'ret365', op: '>=', v: 10 }] });
  assert.ok(hits.length > 10);
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].m.ret365 >= hits[i].m.ret365);
  const short = market(); const D0 = RD.dayNum(DAY0);
  for (const r of Object.values(short.stocks)) { const k = r.d.findIndex((x) => x >= D0 - 100); r.d = r.d.slice(k); r.p = r.p.slice(k); }
  assert.equal(RD.runRule(short, { kind: 'stock', conds: [{ f: 'fromHigh', op: '<=', v: 0 }] }).length, 0);
  assert.equal(RD.validRule({ kind: 'stock', conds: [{ f: 'pe', op: '<=', v: '' }] }), false);
  assert.equal(RD.validRule({ kind: 'stock', conds: [{ f: 'pe', op: '<=', v: '6' }] }), true);
});

test('find: a fragment of a name answers only when it points to one thing', () => {
  const R = market();
  R.funds = [{ key: 'g1', name: 'صندوق طلای الف', symbol: 'الف' }, { key: 'g2', name: 'صندوق طلای ب', symbol: 'ب' }];
  assert.equal(RD.find(R, 'طلا'), null);
  assert.equal(RD.find(R, 'طلای ب').fundKey, 'g2');
  assert.equal(RD.find(R, 'الف').fundKey, 'g1');
});

test('a lagging or empty list never marks a session as checked; a never-traded stock keeps no placeholder prices', () => {
  const D0 = RD.dayNum(DAY0);
  // list-mode day D: its list still ends yesterday although it traded today
  const rec = { sym: 'ل', d: [D0 - 2, D0 - 1], p: [40, 45], h: [], need: 6, today: { day: DAY0 } };
  const lag = adjustDaily(rows([[D(-2), 40], [D(-1), 45]]));
  assert.equal(lag.through, D(-1));
  RD.mergeDaily(rec, lag, D0);
  assert.equal(rec.upTo, D0 - 1);
  // next live session: one session unaccounted for → refetch, no blind append (which would erase today's move)
  const R = RD.empty(); R.day = DAY0; R.stocks.L = rec;
  RD.applySession(R, [mw({ ins: 'L', close: 51, py: 50 })], D(1), [D(-2), D(-1), DAY0, D(1)]);
  assert.ok(rec.need > 0); assert.deepEqual(rec.p, [40, 45]);
  // the list covers a day with no trade: checked through it
  const idle = adjustDaily([{ dEven: dEven(DAY0), pClosing: 45, priceYesterday: 45, zTotTran: 0, qTotTran5J: 0 }, ...rows([[D(-2), 40], [D(-1), 45]])]);
  const rec2 = { d: [D0 - 2, D0 - 1], p: [40, 45], h: [], need: 6 };
  RD.mergeDaily(rec2, idle, D0); assert.equal(rec2.upTo, D0);
  // idle days appended flat, but a priceYesterday that isn't the last close → fetch instead of guessing an event
  const R2 = RD.empty(); R2.day = DAY0; R2.stocks.I = rec2;
  RD.applySession(R2, [mw({ ins: 'I', close: 50, py: 48 })], D(1), [D(-2), D(-1), DAY0, D(1)]);
  assert.ok(rec2.need > 0); assert.deepEqual(rec2.p, [40, 45]);
  // listed, never traded: nothing appended from the market watch's nominal price
  const R3 = RD.empty(); R3.day = DAY0;
  R3.stocks.N = { sym: 'ن', d: [], p: [], h: [], need: 0, upTo: D0 };
  RD.applySession(R3, [mw({ ins: 'N', close: 1000, py: 1000, vol: 0, val: 0 })], D(1), [DAY0, D(1)]);
  assert.equal(R3.stocks.N.p.length, 0); assert.equal(R3.stocks.N.need, 0);
  RD.applySession(R3, [mw({ ins: 'N', close: 1200, py: 1000, vol: 5e5, val: 6e8 })], D(2), [DAY0, D(1), D(2)]);
  assert.ok(R3.stocks.N.need > 0);
});

test('find: a whole name wins even when it is part of another name', () => {
  const R = market();
  R.funds = [{ key: 'a', name: 'صندوق طلا', symbol: 'x1' }, { key: 'b', name: 'صندوق طلای ب', symbol: 'x2' }];
  assert.equal(RD.find(R, 'صندوق طلا').fundKey, 'a');
});

test('prev mode: while today is unfinished, the last session in the lists is used and no price comes from the market watch', () => {
  const R = RD.empty();
  // first install during the session of D(1): the market watch shows today's intraday prices
  RD.applySession(R, [mw({ ins: 'A', close: 999, py: 100 }), mw({ ins: 'E', isin: 'IRTKTEST0001', close: 77 })], DAY0, [D(-2), D(-1), DAY0], 'prev');
  assert.equal(R.day, DAY0);
  const a = R.stocks.A;
  assert.equal(a.need, RD.FULL_ROWS); assert.equal(a.today.close, null);
  assert.equal(R.etf.E, undefined); // no bubble from a later session's price
  RD.mergeDaily(a, adjustDaily(rows([[D(-2), 98], [D(-1), 100], [DAY0, 103]])), RD.dayNum(DAY0));
  assert.deepEqual(a.p, [98, 100, 103]); assert.equal(a.today.close, 103); assert.equal(a.today.py, 100);
  // the finished session D(1) then appends normally
  RD.applySession(R, [mw({ ins: 'A', close: 106, py: 103 })], D(1), [D(-2), D(-1), DAY0, D(1)], 'live');
  assert.deepEqual(a.p, [98, 100, 103, 106]); assert.equal(a.need, 0);
});

test('search: symbol first (exact, prefix), then name; stocks and funds; nothing for an empty query', () => {
  const R = market();
  R.stocks.HOT.sym = 'فولاد'; R.stocks.HOT.cap = 9; R.stocks.S1.sym = 'فولاژ'; R.stocks.S1.cap = 99; R.stocks.S2.name = 'شرکت فولاد خوزستان';
  R.funds = [{ key: 'g', name: 'صندوق طلای عیار', symbol: 'عیار', fundType: 5, size: 1 }];
  const r = RD.search(R, 'فولاد');
  assert.equal(r[0].id, 's:HOT'); // exact symbol beats a bigger company's prefix
  assert.ok(r.some((x) => x.id === 's:S2')); // name match
  assert.equal(RD.search(R, 'فول')[0].id, 's:S1'); // prefix ties: the larger first
  assert.equal(RD.search(R, 'طلا')[0].kind, 'fund');
  assert.equal(RD.search(R, 'طلا')[0].ref.provider, 'fipiran');
  assert.deepEqual(RD.search(R, '  '), []);
  assert.equal(RD.search(R, 'فولاد', 1).length, 1);
});

test('spark and year position: a year of closes, evenly picked; position between the low and high', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  const v = RD.spark(R.stocks.HOT, D0, 48);
  assert.equal(v.length, 48); assert.equal(v[v.length - 1], R.stocks.HOT.p[R.stocks.HOT.p.length - 1]);
  assert.ok(v[0] < v[47]);
  const m = RD.stockMetrics(R.stocks.HOT, D0, {}, R.sess);
  close(RD.yearPos(m), 1);
  close(RD.yearPos(RD.stockMetrics(R.stocks.LOW, D0, {}, R.sess)), 0);
  assert.equal(RD.yearPos({ fullYear: false, hi52: 2, lo52: 1, close: 1.5 }), null);
  assert.deepEqual(RD.spark({ d: [], p: [] }, D0), []);
});

test('holdings in the radar: one entry per symbol, warnings as facts, the cards they are in', () => {
  const R = market();
  R.funds = [{ key: 'fx', name: 'درآمد ثابت کم‌بازده', symbol: '', fundType: 4, cancelNav: 100, date: DAY0, size: 3e12, since: '2020-01-01', ret: { y1: 15, m3: 3, m1: 1 } },
    { key: 'gx', name: 'صندوق طلا', symbol: 'طلا', fundType: 5, insCode: 'E9', cancelNav: 100, date: DAY0, size: 3e12, since: '2020-01-01', ret: { y1: 40, m3: 5, m1: 2 } }];
  const units = (id, provider, key, extra = {}) => ({ id, mode: 'units', quantity: 10, price: { source: 'market', ref: { provider, key } }, ...extra });
  const assets = [units('a', 'tsetmc', 'LOW'), units('b', 'tsetmc', 'LOW'), units('c', 'tsetmc', 'HOT'), units('d', 'fipiran', 'fx'), units('e', 'tsetmc', 'E9'),
    units('z', 'tsetmc', 'HOT', { quantity: 0 }), units('y', 'tgju', 'sekee'), units('x', 'tsetmc', 'GONE'), { id: 'w', mode: 'balance' }];
  const refs = RD.holdRefs(assets);
  assert.deepEqual(refs.map((r) => r.key), ['LOW', 'HOT', 'fx', 'E9', 'GONE']);
  assert.deepEqual(refs[0].assets, ['a', 'b']);
  const items = RD.mine(R, refs, { depositPct: 25 });
  const by = Object.fromEntries(items.map((x) => [x.hold.key, x]));
  assert.ok(by.LOW.sigs.includes('nearLow'));
  assert.ok(by.LOW.flags.some((f) => f.k === 'high' && !f.warn)); // far under its high — said plainly, it's also a «near its low» card
  assert.ok(by.HOT.flags.some((f) => f.k === 'pe' && f.warn));
  assert.ok(!by.LOW.flags.some((f) => f.k === 'low')); // the same fall isn't counted twice
  assert.ok(by.HOT.sigs.includes('momentum12'));
  assert.ok(by.HOT.flags.some((f) => f.k === 'top' && !f.warn));
  assert.ok(by.fx.flags.some((f) => f.k === 'dep' && f.warn)); // 15% < a 25% deposit
  assert.equal(by.E9.id, 'f:gx'); // an exchange-traded fund held by its TSETMC code is the Fipiran fund
  assert.equal(by.GONE.missing, true);
  assert.equal(items[items.length - 1].hold.key, 'GONE');
  assert.ok(items[0].flags.filter((f) => f.warn).length >= items[1].flags.filter((f) => f.warn).length);
  // notifications: the first scan only remembers; nothing twice; no flapping; a just-bought holding only remembers
  const D0 = RD.dayNum(DAY0);
  const w1 = RD.newWarnings(null, items, D0);
  assert.equal(w1.fresh.length, 0); assert.ok(w1.state.seen['s:HOT|pe'] === D0);
  assert.equal(RD.newWarnings(w1.state, items, D0 + 1).fresh.length, 0);
  const calm = items.map((x) => ({ ...x, flags: [] }));
  const w2 = RD.newWarnings(w1.state, calm, D0 + 2);               // the warning goes away…
  assert.equal(RD.newWarnings(w2.state, items, D0 + 3).fresh.length, 0); // …and back within a week: quiet
  assert.equal(RD.newWarnings(w1.state, items, D0 + 40).fresh.length, 0); // still there after a long gap: not news
  const later = RD.newWarnings({ seen: {}, ids: w1.state.ids }, items, D0 + 30);
  assert.ok(later.fresh.some((w) => w.key === 's:HOT|pe'));          // a really new one notifies
  assert.equal(RD.newWarnings({ seen: {}, ids: [] }, items, D0).fresh.length, 0); // holdings new since last time: only remembered
  const day = RD.newWarnings({ seen: {}, ids: w1.state.ids }, [{ ...by.HOT, flags: [{ k: 'day', t: 'امروز −۵٪', warn: true }] }], D0);
  assert.equal(day.fresh.length, 0);                                    // today's move never notifies
  // a stock still gathering its year shows only that, no false warnings
  const P2 = market(); P2.stocks.LOW.need = 270;
  const it = RD.mine(P2, [{ provider: 'tsetmc', key: 'LOW', label: 'کف', assets: ['a'] }])[0];
  assert.deepEqual(it.flags.map((f) => f.k), ['partial']);
  // one row for a fund held by its TSETMC code and by its Fipiran key
  const two = RD.mine(R, [{ provider: 'tsetmc', key: 'E9', label: 'طلا', assets: ['e'] }, { provider: 'fipiran', key: 'gx', label: 'طلا', assets: ['f'] }]);
  assert.equal(two.length, 1); assert.deepEqual(two[0].hold.assets, ['e', 'f']);
  // an umbrella fund's class saved by its registration number alone, picked by name
  R.funds.push({ key: '777-a1', name: 'صندوق چتری کلاس الف', fundType: 6, ret: {} }, { key: '777-b2', name: 'صندوق چتری کلاس ب', fundType: 6, ret: {} });
  assert.equal(RD.fundOf(R, '777', 'صندوق چتری کلاس ب').key, '777-b2');
  assert.equal(RD.fundOf(R, '777', ''), null);
  assert.equal(RD.report(R, { fundKey: '777', fundName: 'صندوق چتری کلاس الف' }).name, 'صندوق چتری کلاس الف');
  // debts aren't holdings
  assert.equal(RD.holdRefs([units('q', 'tsetmc', 'HOT')], () => true).length, 0);
});

test('risk and earnings yield: worst fall from a peak, daily swing, profit as a share of price — in the card', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  const rec = R.stocks.S5;
  // a peak of 150 then a fall to 90 inside the year: worst fall −40%
  rec.p = rec.p.map((v, i) => (i === 200 ? 150 : i > 200 && i < 260 ? 90 : v));
  const m = RD.stockMetrics(rec, D0, {}, R.sess);
  close(m.dd1y, 90 / 150 - 1, 1e-6);
  assert.ok(m.dvol > 0);
  close(m.ey, 1 / rec.pe);
  // a realistic wobble on HOT (its year's two ends untouched), so it has a daily swing to speak of
  R.stocks.HOT.p = R.stocks.HOT.p.map((v, i, a) => (i > 0 && i < a.length - 1 ? v * (1 + 0.02 * ((i * 7) % 5 - 2) / 2) : v));
  const b = RD.buildCards(R, { depositPct: 30 });
  const hot = b.cards.find((c) => c.id === 's:HOT');
  // a perfectly smooth price has no swing worth a line
  assert.ok(!b.cards.find((c) => c.id === 's:S29')?.check.some((t) => t.includes('نوسان روزانه')));
  assert.ok(hot.check.some((t) => t.includes('سود برآوردی سالانهٔ هر سهم معادل') && t.includes('سپرده ۳۰٪')), hot.check);
  assert.ok(hot.check.some((t) => t.includes('نوسان روزانه')), hot.check);
});

test('benchmarks: index and dollar over the same period; a line on momentum cards and in the report', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  const rows = (f) => Array.from({ length: 400 }, (_, k) => ({ date: RD.isoOf(D0 - 399 + k), close: f(k) }));
  R.bench = { index: RD.benchSeries(rows((k) => 100 + k * 0.25), D0), usd: RD.benchSeries(rows(() => 50), D0) };
  const b = RD.benchRet(R, 365);
  close(b.index, (100 + 399 * 0.25) / (100 + 34 * 0.25) - 1, 1e-9); close(b.usd, 0);
  const hot = RD.buildCards(R).cards.find((c) => c.id === 's:HOT' && c.sig === 'momentum12');
  assert.ok(hot.why[1].startsWith('در همین ۱۲ ماه: شاخص کل'), hot.why);
  const rep = RD.report(R, { ins: 'HOT' });
  close(rep.bench.y1.index, b.index);
  // no bench (or too short): nothing said
  const N = market(); assert.equal(RD.benchLine(N, 365, '۱۲ ماه'), '');
  N.bench = { index: RD.benchSeries(rows((k) => 100 + k).slice(-20), D0) };
  assert.equal(RD.benchRet(N, 365).index, null);
});

test('«همه را ببین»: every qualifying card with its rank; the first SHOW are the shown ones; momentum3 skips only the shown 12-month ones', () => {
  const R = market();
  for (let i = 0; i < 80; i++) { const s = JSON.parse(JSON.stringify(R.stocks.S20)); s.sym = 'X' + i; R.stocks['X' + i] = s; }
  const b = RD.buildCards(R);
  const m12 = b.cards.filter((c) => c.sig === 'momentum12');
  assert.ok(m12.length > RD.SHOW);
  assert.deepEqual(m12.map((c) => c.rank), m12.map((_, i) => i));
  assert.equal(b.count.momentum12, m12.length);
  assert.equal(RD.shown(b.cards).filter((c) => c.sig === 'momentum12').length, RD.SHOW);
  const first = new Set(m12.slice(0, RD.SHOW).map((c) => c.id));
  assert.ok(!b.cards.some((c) => c.sig === 'momentum3' && first.has(c.id)));
});

test('alerts on followed items: above, below and a fall since marked; each fires once; stocks still gathering wait', () => {
  const R = market(); const p = RD.priceOf(R, 's:HOT');
  const marks = [{ id: 's:HOT', sym: 'HOT', day: DAY0, price: p, alert: { above: p * 0.9, below: null, fall: 15 } },
    // marked 300 days ago: the adjusted series says how much it fell since (about −30%)
    { id: 's:LOW', sym: 'LOW', day: D(-300), price: 100, alert: { above: null, below: RD.priceOf(R, 's:LOW') * 1.1, fall: 15 } },
    { id: 's:S1', sym: 'S1', day: DAY0, price: 1, alert: { above: 1e12 } }];
  const r1 = RD.checkMarkAlerts(R, marks);
  assert.deepEqual(r1.fired.map((f) => `${f.id}|${f.k}`).sort(), ['s:HOT|above', 's:LOW|below', 's:LOW|fall']);
  assert.equal(RD.checkMarkAlerts(R, r1.marks).fired.length, 0); // once
  R.stocks.S1.need = 270; R.stocks.S1.d = []; // gathering: not judged
  assert.equal(RD.checkMarkAlerts(R, [{ id: 's:S1', alert: { above: 1 } }]).fired.length, 0);
});

test('the radar\'s track record: kept once per session, first cards only; a month later, the average against the index', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  const rows = Array.from({ length: 400 }, (_, k) => ({ date: RD.isoOf(D0 - 399 + k), close: 100 + k }));
  R.bench = { index: RD.benchSeries(rows, D0) };
  // pretend these first cards were shown every day for the past 100 days
  const b = RD.buildCards(R);
  for (let k = 100; k >= 31; k--) { R.day = RD.isoOf(D0 - k); RD.recordTrack(R, b.cards); }
  R.day = DAY0; RD.recordTrack(R, b.cards); RD.recordTrack(R, b.cards);
  assert.equal(Object.keys(R.track).length, 71);
  assert.ok(Object.values(R.track[DAY0]).every((l) => l.length <= RD.SHOW));
  // a stock that stays on the list counts once per 30-day window, so 3 stocks over 70 days are 9 samples at most —
  // too few to say anything yet
  const t = RD.trackStats(R, 'momentum12');
  const shownIds = new Set(RD.shown(b.cards).filter((c) => c.sig === 'momentum12').map((c) => c.id));
  assert.equal(t.stocks, shownIds.size);
  assert.ok(t.n <= shownIds.size * 3, t);
  assert.equal(t.avg, null);
  // with enough different stocks over time it speaks, against the index of the same months
  const T = market(); T.bench = R.bench; T.track = {};
  const ids = Object.keys(T.stocks).filter((k) => /^S/.test(k));
  for (let k = 200; k >= 31; k -= 3) T.track[RD.isoOf(D0 - k)] = { momentum12: ids.slice((k % 10), (k % 10) + 10).map((x) => [`s:${x}`, 1]) };
  const t2 = RD.trackStats(T, 'momentum12');
  assert.ok(t2.n >= 20 && t2.stocks >= 8 && t2.avg !== null && t2.index > 0, t2);
  assert.equal(RD.trackStats(R, 'goldBubble').avg, null);
});

test('price alert levels follow a capital increase since the mark; topFund is never folded', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  const rec = R.stocks.S3; const p0 = RD.priceOf(R, 's:S3');
  const mark = { id: 's:S3', sym: 'S3', day: D(-10), price: rec.p[rec.d.indexOf(D0 - 10)], alert: { below: p0 * 0.9 } };
  // a 100% capital increase today: the raw price halves, every earlier close is scaled by ½
  rec.p = rec.p.map((v, i) => (i < rec.p.length - 1 ? v / 2 : (v / 2) * 1.05));
  assert.equal(RD.checkMarkAlerts(R, [mark]).fired.length, 0); // it rose ~5%, it didn't fall under the level
  const tf = RD.buildCards(R).cards.filter((c) => c.sig === 'topFund');
  assert.ok(tf.every(RD.isFirst));
});

/* ---------------------- 1.23: money flow, combined score, market pulse, gold routes ---------------------- */
// ClientTypeAll rows (synthetic): volumes of individual (I) and institutional (N) buyers and sellers
const ct = (ins, { bI, bN, sI, sN, cb = 100, cs = 100 }) => ({ insCode: ins, buy_I_Volume: bI, buy_N_Volume: bN, sell_I_Volume: sI, sell_N_Volume: sN, buy_CountI: cb, sell_CountI: cs });

test('money flow: only rows that add up to the session\'s volume; one entry per session; net = (buy − sell) × close', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  const vol = R.stocks.S1.today.vol; const px = R.stocks.S1.today.close;
  const n = RD.applyFlows(R, [
    ct('S1', { bI: vol * 0.7, bN: vol * 0.3, sI: vol * 0.4, sN: vol * 0.6, cb: 50, cs: 100 }),
    ct('S2', { bI: vol * 0.3, bN: vol * 0.3, sI: vol * 0.3, sN: vol * 0.3 }),   // doesn't add up (a reset list): skipped
    ct('NOPE', { bI: 1, bN: 0, sI: 1, sN: 0 }),                                  // not a radar stock
  ], DAY0);
  assert.equal(n, 1);
  const [d, net, power] = R.stocks.S1.fl[0];
  assert.equal(d, D0); close(net, Math.round(0.3 * vol * px), 1e-6);
  close(power, Math.round(((0.7 * vol / 50) / (0.4 * vol / 100)) * 100) / 100); // each buyer bought 3.5× what each seller sold
  assert.ok(!R.stocks.S2.fl);
  assert.deepEqual(R.flowDays, [DAY0]);
  // the same session again replaces, never doubles
  RD.applyFlows(R, [ct('S1', { bI: vol * 0.6, bN: vol * 0.4, sI: vol * 0.5, sN: vol * 0.5 })], DAY0);
  assert.equal(R.stocks.S1.fl.length, 1);
  // another day's list (its own stock's session isn't that day) is skipped
  assert.equal(RD.applyFlows(R, [ct('S1', { bI: vol, bN: 0, sI: 0, sN: vol })], D(-1)), 0);
});

// seed `days` sessions of individual money into a stock: share of each session's value (val), positive or negative
function seedFlow(R, ins, shares) {
  const rec = R.stocks[ins]; const D0 = RD.dayNum(DAY0);
  const val = new Map(rec.h.map((x) => [x[0], x[2]]));
  rec.fl = shares.map((sh, i) => { const d = D0 - (shares.length - 1 - i); return [d, Math.round(sh * (val.get(d) || 0)), 1.5]; });
  R.flowDays = [...new Set([...(R.flowDays || []), ...rec.fl.map(([d]) => RD.isoOf(d))])].sort();
}

test('inflow: most recent sessions positive and a real share of value traded; a warning for a holder on steady outflow', () => {
  const R = market();
  seedFlow(R, 'S3', [0.12, 0.10, -0.02, 0.15, 0.11]);   // in on 4 of 5, ~9% of value
  seedFlow(R, 'S4', [0.30, -0.10, -0.10, -0.10, 0.02]);  // one big day, then out: 2 of 5 positive
  seedFlow(R, 'S5', [0.20, 0.20]);                       // only 2 sessions known: too early
  seedFlow(R, 'S6', [-0.2, -0.15, -0.1, 0.01, -0.12]);
  const b = RD.buildCards(R, { depositPct: 25, money: (v) => String(Math.round(v / 1e7)) });
  const inflow = b.cards.filter((c) => c.sig === 'inflow');
  assert.deepEqual(inflow.map((c) => c.sym), ['S3']);
  assert.ok(inflow[0].why[0].includes('ورود پول حقیقی') && inflow[0].why[1].includes('۴ جلسه از ۵'));
  const m3 = RD.stockMetrics(R.stocks.S3, RD.dayNum(DAY0), RD.sectorMedians(R.stocks), R.sess);
  assert.equal(m3.flowN, 5); assert.equal(m3.flowPos5, 4); close(m3.flowShare5, (0.12 + 0.10 - 0.02 + 0.15 + 0.11) / 5, 1e-6);
  assert.equal(RD.stockMetrics(R.stocks.S5, RD.dayNum(DAY0), {}, R.sess).flowN, 2);
  const items = RD.mine(R, [{ provider: 'tsetmc', key: 'S6', label: 'S6', assets: ['a'] }, { provider: 'tsetmc', key: 'S3', label: 'S3', assets: ['b'] }]);
  const f6 = items.find((x) => x.id === 's:S6').flags.find((f) => f.k === 'outflow');
  assert.ok(f6 && f6.warn && f6.t.includes('خروج پول حقیقی'));
  assert.ok(items.find((x) => x.id === 's:S3').flags.some((f) => f.k === 'inflow' && !f.warn));
});

test('combined score: 0…100 from percentiles; weights follow the risk level; a missing part shares its weight; loss-making gets no value', () => {
  const R = market();
  const D0 = RD.dayNum(DAY0); const sec = RD.sectorMedians(R.stocks);
  const list = Object.entries(R.stocks).map(([ins, rec]) => ({ ins, rec, m: RD.stockMetrics(rec, D0, sec, R.sess) })).filter((s) => s.m.liquid && s.m.traded);
  const sc = RD.scoreStocks(list, 'mid');
  assert.ok([...sc.values()].every((x) => x.score >= 0 && x.score <= 100 && Number.isInteger(x.score)));
  assert.ok(!sc.has('THIN')); // not liquid: not in the list
  // no money flow known yet: that part is left out, not counted as zero
  assert.ok([...sc.values()].every((x) => x.parts.flow === undefined));
  // a cautious owner weighs calm more: the tripled stock (big swings) falls behind a steady one
  const hot = (lv) => RD.scoreStocks(list, lv).get('HOT').score;
  assert.ok(hot('high') > hot('low'), `${hot('high')} vs ${hot('low')}`);
  // a loss-making company scores nothing on value
  R.stocks.S10.eps = -5; R.stocks.S10.pe = -20;
  const l2 = list.map((s) => (s.ins === 'S10' ? { ...s, m: RD.stockMetrics(R.stocks.S10, D0, sec, R.sess) } : s));
  assert.equal(RD.scoreStocks(l2).get('S10').parts.value, 0);
  // unknown EPS: value left out instead
  R.stocks.S11.eps = null; R.stocks.S11.pe = NaN;
  const l3 = list.map((s) => (s.ins === 'S11' ? { ...s, m: RD.stockMetrics(R.stocks.S11, D0, sec, R.sess) } : s));
  assert.equal(RD.scoreStocks(l3).get('S11').parts.value, undefined);
});

test('«برترین‌ها»: score at least TOP_MIN, best first; every stock card carries its score and the other lists it is in; a rule on the score', () => {
  const R = market();
  for (let i = 0; i < 30; i++) seedFlow(R, 'S' + i, [0.01 * (i % 7), 0.02, 0.01 * (i % 3), 0.03, 0.01]);
  const b = RD.buildCards(R, { level: 'mid' });
  const top = b.cards.filter((c) => c.sig === 'top');
  assert.ok(top.length > 0 && top.length <= RD.TOP_N);
  assert.ok(top.every((c) => c.score >= RD.TOP_MIN));
  assert.ok(top.every((c, i) => !i || top[i - 1].score >= c.score));
  assert.ok(top[0].why[0].includes('امتیاز') && top[0].why[1].includes('قوی‌ترین بخش‌ها'));
  const stockCards = b.cards.filter((c) => c.kind === 'stock' && c.sym !== 'THIN');
  assert.ok(stockCards.every((c) => typeof c.score === 'number' && Array.isArray(c.lit)));
  const hot = b.cards.find((c) => c.sig === 'momentum12' && c.sym === 'HOT');
  assert.ok(!hot.lit.includes('top') && hot.lit.includes('momentum12'));
  assert.ok(RD.validRule({ kind: 'stock', conds: [{ f: 'score', op: '>=', v: 70 }] }));
  const hits = RD.runRule(R, { kind: 'stock', conds: [{ f: 'score', op: '>=', v: 70 }] }, { level: 'mid' });
  assert.ok(hits.length > 0 && hits.every((h) => h.m.score >= 70));
  assert.ok(b.cards.every((c) => !/بخر|بفروش/.test([...c.why, ...c.check].join(' '))));
});

test('market pulse: index today and over a month, breadth, individual money, the market P/E against the deposit', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  const ix = Array.from({ length: 60 }, (_, k) => ({ date: RD.isoOf(D0 - 59 + k), close: 1000 + k * 10 }));
  R.bench = { index: RD.benchSeries(ix, D0) };
  seedFlow(R, 'S3', [0.1, 0.1, 0.1]); seedFlow(R, 'S4', [-0.05, -0.05, -0.3]);
  const p = RD.pulse(R, { depositPct: 25 });
  close(p.indexDay, 1590 / 1580 - 1, 1e-9);
  assert.ok(p.index1m > 0);
  assert.equal(p.up + p.down + p.flat, Object.values(R.stocks).filter((r) => r.today.vol > 0).length);
  const v3 = R.stocks.S3.h.at(-1)[2], v4 = R.stocks.S4.h.at(-1)[2];
  close(p.flowToday, Math.round(0.1 * v3) + Math.round(-0.3 * v4), 1e-9);
  assert.equal(p.flowSessions, 3);
  assert.ok(p.pe > 0 && Math.abs(p.ey - 1 / p.pe) < 1e-12); close(p.eyVsDeposit, p.ey - 0.25, 1e-12);
  // nothing known about flows: null, not zero
  delete R.flowDays; for (const r of Object.values(R.stocks)) delete r.fl;
  const q = RD.pulse(R); assert.equal(q.flowToday, null); assert.equal(q.flow5, null);
  assert.equal(RD.pulse(RD.empty()), null);
});

test('gold funds for the gold routes: traded gold funds with a same-day bubble, lowest first', () => {
  const R = RD.empty(); R.day = DAY0;
  R.etf = { X: { close: 101, val: 5e9, day: DAY0, hist: { [DAY0]: 101 } }, Y: { close: 98, val: 5e9, day: DAY0, hist: { [DAY0]: 98 } }, Z: { close: 90, val: 1e6, day: DAY0, hist: { [DAY0]: 90 } } };
  const f = (key, ins, sym) => ({ key, name: 'صندوق طلا ' + sym, symbol: sym, fundType: 5, cancelNav: 100, date: DAY0, size: 5e12, since: '2020-01-01', traded: true, insCode: ins, ret: {}, mix: {} });
  R.funds = [f('x', 'X', 'طلاا'), f('y', 'Y', 'طلاب'), f('z', 'Z', 'طلاج')];
  const g = RD.goldFunds(R);
  assert.deepEqual(g.map((x) => x.key), ['y', 'x']); // z barely trades
  close(g[0].bubble, -0.02); assert.equal(g[0].ref.provider, 'tsetmc');
});

test('review fixes: «5 sessions» are the market\'s last 5; the share counts only days with a known value; top needs enough parts; pulse waits for every stock', () => {
  const R = market(); const D0 = RD.dayNum(DAY0);
  // money known only from 3 weeks ago: nothing in the last 5 sessions
  const rec = R.stocks.S3; const v = rec.h.at(-1)[2];
  rec.fl = [[D0 - 25, v, 1], [D0 - 24, v, 1], [D0 - 23, v, 1]];
  let m = RD.stockMetrics(rec, D0, {}, R.sess);
  assert.equal(m.flowN, 0); assert.equal(m.flow5, null);
  // two of the last five sessions known, one of them missing from the value history: the share leaves it out
  rec.fl = [[D0 - 1, Math.round(0.1 * v), 1], [D0, Math.round(0.1 * v), 1]];
  rec.h = rec.h.filter((x) => x[0] !== D0 - 1);
  m = RD.stockMetrics(rec, D0, {}, R.sess);
  assert.equal(m.flowN, 2); close(m.flowShare5, 0.1, 1e-6); close(m.flow5, 2 * Math.round(0.1 * v), 1e-9);
  // without a session list: the calendar (5 sessions ≈ 7 days)
  const sl = RD.lastSessions([], D0, 5); assert.ok(sl.has(D0 - 6) && !sl.has(D0 - 7));
  // the highest-score list wants at least TOP_PARTS parts known, including risk
  const b = RD.buildCards(R);
  for (const c of b.cards.filter((x) => x.sig === 'top')) assert.ok(Object.keys(c.parts).length >= RD.TOP_PARTS && c.parts.safety !== undefined);
  // a stock still waiting for its list: no breadth, no market money (it would be part of the market only)
  R.stocks.S9.need = 8;
  const p = RD.pulse(R);
  assert.equal(p.pending, 1); assert.equal(p.up + p.down + p.flat, 0); assert.equal(p.flowToday, null);
  assert.equal(RD.SIGNALS.top.t, 'بالاترین امتیاز ترکیبی امروز');
});
