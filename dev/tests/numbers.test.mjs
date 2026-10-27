// Numbers that were right but measured the wrong thing (1.25): the target plan, return with debts, a corrected price,
// the inflation card's net Rial, «today» measured from an old price, and the price sources' health.
// Synthetic assets only; dates are relative to today because valuation reads the real clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../../extension/lib/insights.js';
import * as E from '../../extension/lib/engine.js';
import * as store from '../../extension/lib/store.js';
import { act } from '../../extension/ui/actions.js';
import { todayIso, addDaysIso } from '../../extension/lib/jalali.js';

const today = todayIso();
const now = Date.now();
const D = (n) => addDaysIso(today, n);
const close = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);
const Q = (p, extra = {}) => ({ price: p, at: now, fetchedAt: now, changePct: 0, ...extra });
const manual = (id, category, qty, price, extra = {}) => ({ id, name: id, category, mode: 'units', quantity: qty, price: { source: 'manual', value: price, updatedAt: now }, ...extra });
const bal = (id, category, balance) => ({ id, name: id, category, mode: 'balance', balance, balanceAt: now });

/* ---------------- target plan ---------------- */
test('target plan: online gold counts with gold, buys equal sells, new money to reach it without selling', () => {
  const assets = [manual('go', 'gold_online', 50, 100), bal('b', 'bank', 3000), manual('f', 'fx', 40, 50)];
  const pf = E.portfolio(assets, {}, {}, now);
  const p = E.rebalancePlan(pf, { gold: 0.4, bank: 0.3, fx: 0.3 });
  const g = p.rows.find((r) => r.id === 'gold');
  assert.deepEqual(g.ids, ['gold', 'gold_online']);
  close(g.current, 5000); close(g.diff, -1000, 1e-6, 'sell 10% of gold, not buy 40% more');
  close(p.rows.find((r) => r.id === 'fx').diff, 1000, 1e-6);
  close(p.rows.find((r) => r.id === 'bank').diff, 0, 1e-6);
  close(p.buy, p.sell, 1e-6, 'buys = sells');
  assert.equal(p.rows.find((r) => r.id === 'gold_online').mergedInto, 'gold');
  close(p.needNew, 2500, 1e-6, 'gold 5000 at 40% → total 12500');
  // the old table: gold target × all assets − gold held = +4000 «buy», with nothing to sell
  assert.ok(E.rebalance(pf, { gold: 0.4, bank: 0.3, fx: 0.3 }).every((r) => r.id !== 'gold' || r.diff < 0));
});

test('target plan: a kind without a target stays out; targets not adding up to 100% are read in proportion', () => {
  const assets = [manual('g', 'gold', 1, 4000), manual('f', 'fx', 1, 3000), bal('b', 'bank', 3000)];
  const pf = E.portfolio(assets, {}, {}, now);
  const p = E.rebalancePlan(pf, { gold: 0.5, fx: 0.5 });
  close(p.base, 7000); assert.deepEqual(p.outside, ['bank']); close(p.outsideValue, 3000);
  close(p.rows.find((r) => r.id === 'gold').diff, -500, 1e-6); close(p.rows.find((r) => r.id === 'fx').diff, 500, 1e-6);
  assert.equal(p.rows.find((r) => r.id === 'bank').hasTarget, false); close(p.rows.find((r) => r.id === 'bank').diff, 0);
  // targets only on kinds not held yet: nothing to move, flagged so the table doesn't say «balanced»
  const e = E.rebalancePlan(E.portfolio([bal('b', 'bank', 3000)], {}, {}, now), { gold: 0.5, fx: 0.5 });
  assert.equal(e.empty, true); assert.equal(p.empty, false);
  const q = E.rebalancePlan(pf, { gold: 0.3, fx: 0.3 });
  assert.equal(q.scaled, true); close(q.rows.find((r) => r.id === 'gold').target, 0.5);
  // both gold kinds with a target: apart
  const r = E.rebalancePlan(E.portfolio([...assets, manual('go', 'gold_online', 1, 1000)], {}, {}, now), { gold: 0.3, gold_online: 0.2, fx: 0.5 });
  assert.equal(r.rows.find((x) => x.id === 'gold').twin, null); assert.ok(r.rows.find((x) => x.id === 'gold_online').hasTarget);
  // new money follows the same plan: online gold is gold, so gold needs nothing new here
  const a = I.allocateNew(E.portfolio([manual('go', 'gold_online', 50, 100), manual('f', 'fx', 1, 1000)], {}, {}, now), { gold: 0.5, fx: 0.5 }, 4000);
  close(a.rows.find((x) => x.id === 'fx').add, 4000, 1e-6);
  close(a.rows.reduce((t, x) => t + x.add, 0), 4000, 1e-6);
});

/* ---------------- return with debts ---------------- */
test('with debts: return on own capital and on assets apart; after inflation', () => {
  const assets = [manual('x', 'gold', 10, 110), bal('d', 'debt', 900)];
  const snaps = { [D(-30)]: { t: 100, g: 1000, l: 900, v: { x: 1000, d: -900 }, at: now - 30 * 864e5 } };
  const s = { assets, quotes: {}, settings: {}, snapshots: snaps, events: [] };
  const r = I.performance(s, 30, { today, pf: E.portfolio(assets, {}, {}, now), inflationPct: 0 });
  close(r.ret, 1, 1e-9, 'own capital 100 → 200');
  close(r.retAssets, 0.1, 1e-9, 'assets 1000 → 1100');
  close(r.real.ret, r.ret, 1e-12, 'no inflation: the same');
  const r2 = I.performance(s, 30, { today, pf: E.portfolio(assets, {}, {}, now), inflationPct: 73.6 });
  const infl = Math.pow(1.736, 30 / 365) - 1;
  close(r2.real.inflation, infl, 1e-12); close(r2.real.ret, 2 / (1 + infl) - 1, 1e-12);
  // without debts there is one return
  const s3 = { assets: [manual('x', 'gold', 10, 110)], quotes: {}, settings: {}, snapshots: { [D(-30)]: { t: 1000, g: 1000, l: 0, v: { x: 1000 }, at: now - 30 * 864e5 } }, events: [] };
  assert.equal(I.performance(s3, 30, { today }).retAssets, null);
  assert.equal(I.defaultInflationPct({ settings: {} }), 73.6); assert.equal(I.defaultInflationPct({ settings: { inflationPct: 40 } }), 40);
});

/* ---------------- a corrected price ---------------- */
test('a hand-typed price put right is a correction, not a market move; a new price still is', async () => {
  const a = manual('p', 'private', 1000, 4500);
  const reset = async () => { await store.clearAll(); await store.save({ assets: [structuredClone(a)], flows: [], events: [], quotes: {}, snapshots: { [D(-1)]: { t: 4.5e6, v: { p: 4.5e6 }, at: now - 3600e3 } } }); };
  const att = async () => { const s = await store.load('assets', 'events', 'snapshots', 'quotes'); return E.attribution(s.assets, s.quotes, {}, s.snapshots, s.events, 1, today); };
  await reset();
  const ev = await act.saveAsset({ ...structuredClone(a), price: { ...a.price, value: 4050 } }, { orig: a, priceFix: true });
  let r = await att();
  close(r.market, 0, 1e-6, 'not a loss'); close(r.edits, -450000, 1e-6, 'a correction');
  assert.equal(ev.title, 'اصلاح قیمت «p»');
  await act.undoEvent(ev);
  assert.equal((await store.load('assets')).assets[0].price.value, 4500, 'undo puts the old price back');
  await reset();
  await act.saveAsset({ ...structuredClone(a), price: { ...a.price, value: 4050 } }, { orig: a });
  r = await att(); close(r.market, -450000, 1e-6, 'a new price is the market');
  await reset();
  await act.patchAsset('p', { price: { ...a.price, value: 4950 } }, { priceFix: true });
  r = await att(); close(r.market, 0, 1e-6); close(r.edits, 450000, 1e-6);
  // price and quantity corrected together: the whole change is the correction, in both ways of saving
  await reset();
  await act.patchAsset('p', { quantity: 2000, price: { ...a.price, value: 45000 } }, { priceFix: true });
  r = await att(); close(r.market, 0, 1e-6, 'patch'); close(r.edits, 2000 * 45000 - 4.5e6, 1e-6);
  await reset();
  await act.saveAsset({ ...structuredClone(a), quantity: 2000, price: { ...a.price, value: 45000 } }, { orig: a, priceFix: true });
  r = await att(); close(r.market, 0, 1e-6, 'save'); close(r.edits, 2000 * 45000 - 4.5e6, 1e-6);
});

/* ---------------- net Rial ---------------- */
test('inflation card: a Rial debt is set against Rial owned; a gold debt is not', () => {
  const assets = [manual('x', 'gold', 10, 100), bal('c', 'bank', 1000), bal('d', 'debt', 1000)];
  const pf = E.portfolio(assets, {}, {}, now);
  const c = I.inflationCard({ assets, snapshots: {}, settings: {} }, pf);
  close(c.share, 0.5); close(c.rialOwned, 1000); close(c.rialDebt, 1000); close(c.netRial, 0);
  const g = { ...bal('gd', 'debt', 300), exposure: 'gold' };
  const c2 = I.inflationCard({ assets: [...assets, g], snapshots: {}, settings: {} }, E.portfolio([...assets, g], {}, {}, now));
  close(c2.rialDebt, 1000); close(c2.otherDebt, 300);
});

/* ---------------- «today» from an old price ---------------- */
test('today: measured from the last record and its time; an old price in it is named with its date', () => {
  const ref = { provider: 'tgju', key: 'geram18' };
  const a = { id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 1, price: { source: 'market', ref, last: { price: 100, at: now - 4 * 864e5 } } };
  // yesterday the source was down: the asset was valued at its last price, 4 days old
  const pfY = E.portfolio([a], { 'tgju:geram18': { price: 0, error: 'قطع', errorAt: now - 864e5, fetchedAt: now - 864e5 } }, {}, now);
  assert.equal(pfY.rows[0].status, 'delayed');
  const snapY = { ...E.makeSnapshot(pfY, {}), at: now - 20 * 3600e3 };
  assert.ok(snapY.old?.g > 0, 'the old price is kept in the record');
  const st = { assets: [a], quotes: { 'tgju:geram18': Q(130) }, settings: {}, snapshots: { [D(-1)]: snapY }, events: [] };
  const pf = E.portfolio(st.assets, st.quotes, {}, now);
  const mv = I.marketMove(st, pf, 1, today);
  close(mv.abs, 30, 1e-9);
  assert.equal(mv.late.length, 1); assert.equal(mv.late[0].since, addDaysIso(today, -4));
  assert.equal(mv.baseAt, snapY.at);
  assert.match(I.baseLabel(mv, today, () => '08:15'), /^از دیروز ساعت 08:15$/);
  assert.ok(I.explainChange(st, 1, pf, today).notes.some((n) => n.includes('قیمت قدیمی')));
  // a fresh price yesterday: nothing to say
  const fresh = { ...E.makeSnapshot(E.portfolio([a], { 'tgju:geram18': Q(100) }, {}, now), {}), at: now - 20 * 3600e3 };
  assert.equal(fresh.old, undefined);
  assert.equal(I.marketMove({ ...st, snapshots: { [D(-1)]: fresh } }, pf, 1, today).late.length, 0);
  // a rebuilt starting point says so
  assert.match(I.baseLabel({ from: D(-1), est: true }, today), /تخمینی/);
});

/* ---------------- price sources ---------------- */
test('price sources: ok, some failed, down, idle — only the latest round counts', () => {
  const h = I.providerHealth({
    'tgju:geram18': Q(1), 'tgju:sekee': Q(2),
    'tsetmc:1:p': { price: 5, fetchedAt: now - 3600e3, error: 'timeout', errorAt: now }, 'tsetmc:2:p': Q(3),
    'nobitex:btc': { price: 9, fetchedAt: now - 5 * 3600e3, error: 'HTTP 503', errorAt: now },
    // a leftover from a deleted asset, failed long ago: not news
    'fipiran:old': { price: 0, error: 'x', errorAt: now - 30 * 864e5, fetchedAt: now - 30 * 864e5 }, 'fipiran:new': Q(7),
  }, now);
  assert.equal(h.tgju.status, 'ok'); assert.equal(h.tgju.n, 2);
  assert.equal(h.tsetmc.status, 'some'); assert.equal(h.tsetmc.failed, 1); assert.equal(h.tsetmc.error, 'timeout');
  assert.equal(h.nobitex.status, 'down'); close(h.nobitex.lastOk, now - 5 * 3600e3);
  assert.equal(h.fipiran.status, 'ok'); assert.equal(h.fipiran.n, 1);
  assert.equal(I.providerHealth({}, now).tgju.status, 'idle');
  // Bitpin's prices, kept under the crypto source's name, are reported apart
  const b = I.providerHealth({ 'nobitex:btc': Q(1), 'nobitex:tsla': { price: 5, source: 'bitpin', fetchedAt: now - 3600e3, error: 'HTTP 502', errorAt: now } }, now);
  assert.equal(b.nobitex.status, 'ok'); assert.equal(b.bitpin.status, 'down');
});
