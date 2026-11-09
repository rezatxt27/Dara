// Fipiran can stop updating a fund's NAV for days (1.31.3): exchange-traded funds take the NAV the exchange showed in a
// newer session, when it is plausibly the same unit. Synthetic funds and numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RD from '../../extension/lib/radar.js';
import { sameNav } from '../../extension/lib/providers.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const mw = (ins, isin, close, nav) => ({ insCode: ins, insID: isin, lva: 'نمونه', lvc: 'صندوق نمونه', pcl: close, pdv: close, py: close, qtj: 1000, qtc: 5e9, ztd: 1e6, pRedTran: nav });
const fund = (extra = {}) => ({ key: '9001', name: 'صندوق درآمد ثابت نمونه', symbol: 'نمونه', fundType: 4, cancelNav: 10000, date: '2026-01-04T00:00:00', size: 3e12,
  ret: { d1: 0.1, w1: 0.6, m1: 2, m3: 6, m6: 12, y1: 25 }, since: '2020-01-01', traded: true, insCode: '111', mix: {}, ...extra });

test('market watch: an ETF row keeps its NAV per session', () => {
  const radar = RD.empty();
  RD.applySession(radar, [mw('111', 'IRT3XXXX0001', 10100, 10120)], '2026-01-11', ['2026-01-11'], 'live');
  assert.deepEqual(radar.etf['111'].navs, { '2026-01-11': 10120 });
  RD.applySession(radar, [mw('111', 'IRT3XXXX0001', 10150, 10160)], '2026-01-12', ['2026-01-12'], 'live');
  assert.deepEqual(radar.etf['111'].navs, { '2026-01-11': 10120, '2026-01-12': 10160 });
  // a later, unfinished session's numbers ('prev') are never taken
  RD.applySession(radar, [mw('111', 'IRT3XXXX0001', 10200, 10210)], '2026-01-12', ['2026-01-12'], 'prev');
  assert.equal(radar.etf['111'].navs['2026-01-12'], 10160);
});

test('a lagging Fipiran NAV takes the newer exchange NAV; returns carried by the same move; the radar no longer drops it', () => {
  const radar = { ...RD.empty(), day: '2026-01-12', funds: [fund()], etf: { 111: { close: 10150, day: '2026-01-12', hist: { '2026-01-12': 10150 }, navs: { '2026-01-11': 10120, '2026-01-12': 10200 } } } };
  const D = RD.dayNum(radar.day);
  assert.equal(RD.fundMetrics(radar.funds[0], radar, D).navStale, true); // 8 days behind: dropped before
  assert.equal(RD.patchNavs(radar), 1);
  const f = radar.funds[0];
  assert.equal(f.cancelNav, 10200); assert.equal(f.date, '2026-01-12'); assert.equal(f.navSrc, 'tsetmc');
  close(f.ret.y1, (1.25 * 1.02 - 1) * 100); close(f.ret.m1, (1.02 * 1.02 - 1) * 100);
  assert.equal(f.ret.d1, undefined); assert.equal(f.ret.w1, undefined); // would span more than their name says
  const m = RD.fundMetrics(f, radar, D);
  assert.equal(m.navStale, false); assert.equal(m.navSrc, 'tsetmc');
  close(m.bubble, 10150 / 10200 - 1); // price and NAV of the same session
  // running it again changes nothing
  assert.equal(RD.patchNavs(radar), 1); assert.equal(radar.funds[0].cancelNav, 10200); close(radar.funds[0].ret.y1, (1.25 * 1.02 - 1) * 100);
});

test('Fipiran already as new, too far apart, leveraged, or not traded: Fipiran stays', () => {
  const etf = { close: 10150, day: '2026-01-12', hist: {}, navs: { '2026-01-12': 10200 } };
  const run = (f, navs = etf.navs) => { const radar = { ...RD.empty(), day: '2026-01-12', funds: [f], etf: { 111: { ...etf, navs } } }; return [RD.patchNavs(radar), radar.funds[0]]; };
  assert.equal(run(fund({ date: '2026-01-12T00:00:00' }))[0], 0);
  assert.equal(run(fund(), { '2026-01-12': 22500 })[0], 0); // another unit (a leveraged fund's other class, a wrong link)
  assert.equal(run(fund({ fundType: 22 }))[0], 0);
  assert.equal(run(fund({ insCode: '' }))[0], 0);
  const [, f] = run(fund(), { '2026-01-12': 22500 });
  assert.equal(f.cancelNav, 10000); assert.equal(f.navSrc, undefined); assert.equal(f.fip, undefined);
});

test('a patch is undone when Fipiran catches up', () => {
  const radar = { ...RD.empty(), day: '2026-01-12', funds: [fund()], etf: { 111: { close: 1, day: '2026-01-12', hist: {}, navs: { '2026-01-11': 10100 } } } };
  RD.patchNavs(radar); assert.equal(radar.funds[0].cancelNav, 10100);
  radar.funds[0].fip.date = '2026-01-12T00:00:00'; radar.funds[0].fip.nav = 10150; // as if the next Fipiran list had it
  assert.equal(RD.patchNavs(radar), 0);
  assert.equal(radar.funds[0].cancelNav, 10150); assert.equal(radar.funds[0].ret.w1, 0.6);
});

test('sameNav: a week of moves fits, another unit does not', () => {
  assert.ok(sameNav(10100, 10000, 4)); assert.ok(sameNav(12000, 10000, 6)); assert.ok(sameNav(8000, 10000, 6));
  assert.ok(!sameNav(22000, 10000, 6)); assert.ok(!sameNav(10100, 10000, 22)); assert.ok(!sameNav(0, 10000, 4)); assert.ok(!sameNav(10000, 0, 4));
});
