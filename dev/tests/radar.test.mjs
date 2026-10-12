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
