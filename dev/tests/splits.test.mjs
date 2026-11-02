// Unit splits of exchange-traded funds (engine.applySplits). Synthetic data only: prices shaped like a real 1→10 split.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../extension/lib/engine.js';
import { todayIso, addDaysIso } from '../../extension/lib/jalali.js';

const today = todayIso(); const now = Date.now(); const D = (n) => addDaysIso(today, n);
const ref = { provider: 'tsetmc', key: '1', symbol: 'طلا', name: 'صندوق س. كالاي پارسيان', field: 'close' };
const fund = (qty = 100) => ({ id: 'f', name: 'صندوق طلا', category: 'stock', mode: 'units', quantity: qty, costBasis: 150_000_000, price: { source: 'market', ref } });
// yesterday 1,767,873 a unit; today the exchange's base is 176,787 and the close 178,507
const quotes = { 'tsetmc:1:close': { price: 178_507, prev: 176_787, asOf: today, at: now, fetchedAt: now } };
const snaps = (v, extra = {}) => ({ [D(-1)]: { t: v, v: { f: v }, at: now - 20 * 3600e3, ...extra } });

test('a 1→10 split: ten times the units, no gain or loss, today\'s move only', () => {
  const a = [fund()];
  const s = snaps(100 * 1_767_873);
  const out = E.applySplits(a, quotes, s, [], today, now);
  assert.equal(out.length, 1); assert.equal(out[0].k, 10);
  assert.equal(a[0].quantity, 1000); assert.equal(a[0].costBasis, 150_000_000, 'what it cost is the same');
  assert.match(out[0].event.title, /تجزیه/);
  const at = E.attribution(a, quotes, {}, s, [out[0].event], 1, today);
  // the real move: 1000 × 178,507 against 100 × 1,767,873 (+0.97%), not −90%
  assert.ok(Math.abs(at.market - (1000 * 178_507 - 100 * 1_767_873)) < 1);
  assert.equal(Math.round(at.edits), 0);
  // run again: nothing more (the quantity changed after that day)
  assert.equal(E.applySplits(a, quotes, s, [out[0].event], today, now).length, 0);
  // undo puts the units back
  E.undoEvent(a, out[0].event); assert.equal(a[0].quantity, 100);
});

test('not a split: a normal day, a dividend, a quantity changed since, an old price, a rebuilt day', () => {
  const normal = { 'tsetmc:1:close': { ...quotes['tsetmc:1:close'], prev: 1_767_873, price: 1_785_070 } };
  assert.equal(E.applySplits([fund()], normal, snaps(100 * 1_767_873), [], today, now).length, 0);
  const dividend = { 'tsetmc:1:close': { ...quotes['tsetmc:1:close'], prev: 1_500_000, price: 1_510_000 } };
  assert.equal(E.applySplits([fund()], dividend, snaps(100 * 1_767_873), [], today, now).length, 0);
  const bought = [{ id: 'e', kind: 'edit', at: now - 3600e3, date: today, changes: [{ assetId: 'f', field: 'quantity', delta: 5 }] }];
  assert.equal(E.applySplits([fund()], quotes, snaps(100 * 1_767_873), bought, today, now).length, 0);
  assert.equal(E.applySplits([fund()], quotes, snaps(100 * 1_767_873, { old: { f: now - 3 * 864e5 } }), [], today, now).length, 0);
  assert.equal(E.applySplits([fund()], quotes, snaps(100 * 1_767_873, { est: 1 }), [], today, now).length, 0);
  // the session is the snapshot's own day (already counted): nothing
  const same = { 'tsetmc:1:close': { ...quotes['tsetmc:1:close'], asOf: D(-1) } };
  assert.equal(E.applySplits([fund()], same, snaps(100 * 1_767_873), [], today, now).length, 0);
});

test('a reverse split, and a few days missed in between', () => {
  const a = [fund(1000)];
  const q = { 'tsetmc:1:close': { price: 1_800_000, prev: 1_790_000, asOf: today, at: now, fetchedAt: now } };
  const out = E.applySplits(a, q, { [D(-3)]: { t: 1, v: { f: 1000 * 183_000 }, at: now - 3 * 864e5 } }, [], today, now);
  assert.equal(out[0]?.k, 0.1); assert.equal(a[0].quantity, 100); assert.match(out[0].event.title, /تجمیع/);
});

test('a split entered by hand: no gain, no money in, the cost stays — also over a week', async () => {
  const store = await import('../../extension/lib/store.js');
  const { act } = await import('../../extension/ui/actions.js');
  const a = fund();
  // a week ago and yesterday at the old price; today the split price (the browser saved today's value before the update)
  const sn = { [D(-7)]: { t: 100 * 1_750_000, v: { f: 100 * 1_750_000 }, at: now - 7 * 864e5 }, [D(-1)]: { t: 100 * 1_767_873, v: { f: 100 * 1_767_873 }, at: now - 864e5 } };
  await store.clearAll(); await store.save({ assets: [structuredClone(a)], flows: [], events: [], quotes, snapshots: sn });
  const ev = await act.saveAsset({ ...structuredClone(a), quantity: 1000 }, { orig: a, qtySplit: true });
  assert.match(ev.title, /تجزیه/);
  const s = await store.load('assets', 'events', 'snapshots', 'quotes');
  assert.equal(s.assets[0].costBasis, 150_000_000);
  for (const days of [1, 7]) {
    const at = E.attribution(s.assets, s.quotes, {}, s.snapshots, s.events, days, today);
    const then = s.snapshots[days === 1 ? D(-1) : D(-7)].v.f;
    assert.ok(Math.abs(at.market - (1000 * 178_507 - then)) < 1, `${days}d market is the real move`);
    assert.equal(Math.round(at.edits), 0);
  }
});

test('shares are not changed: a halved base (bonus shares or a rights issue) or a dividend is flagged for the owner', () => {
  const share = { id: 's', name: 'سهم نمونه', category: 'stock', mode: 'units', quantity: 1000, price: { source: 'market', ref: { provider: 'tsetmc', key: '9', symbol: 'نمونه', name: 'شركت نمونه', field: 'close' } } };
  const sn = { [D(-1)]: { t: 1, v: { s: 1000 * 50_000 }, at: now - 20 * 3600e3 } };
  const halved = { 'tsetmc:9:close': { price: 25_300, prev: 25_000, asOf: today, at: now } };
  const a = [structuredClone(share)];
  assert.equal(E.applySplits(a, halved, sn, [], today, now).length, 0); assert.equal(a[0].quantity, 1000);
  const f = E.priceAdjustments(a, halved, sn, [], today);
  assert.equal(f.length, 1); assert.equal(f[0].k, 2);
  const dividend = { 'tsetmc:9:close': { price: 44_000, prev: 43_500, asOf: today, at: now } };
  const g = E.priceAdjustments(a, dividend, sn, [], today);
  assert.equal(g.length, 1); assert.equal(g[0].k, null); assert.ok(g[0].r > 1.1);
  const normal = { 'tsetmc:9:close': { price: 51_000, prev: 50_000, asOf: today, at: now } };
  assert.equal(E.priceAdjustments(a, normal, sn, [], today).length, 0);
  // a share whose exchange-traded fund NAV is known is a fund: changed, not flagged
  const etf = { ...halved, 'tsetmc:9:nav': { price: 25_100 } };
  assert.equal(E.priceAdjustments(a, etf, sn, [], today).length, 0);
  assert.equal(E.applySplits(a, etf, sn, [], today, now)[0]?.k, 2);
});

test('a fund priced by its NAV (Fipiran) splits too; an ordinary NAV day does not', () => {
  const nf = { id: 'n', name: 'صندوق نمونه', category: 'fixed', mode: 'units', quantity: 50, price: { source: 'market', ref: { provider: 'fipiran', key: '77', name: 'نمونه', field: 'cancelNav' } } };
  const sn = { [D(-1)]: { t: 1, v: { n: 50 * 1_000_000 }, at: now - 20 * 3600e3 } };
  const a = [structuredClone(nf)];
  assert.equal(E.applySplits(a, { 'fipiran:77:cancelNav': { price: 100_090, asOf: today } }, sn, [], today, now)[0]?.k, 10);
  assert.equal(a[0].quantity, 500);
  const b = [structuredClone(nf)];
  assert.equal(E.applySplits(b, { 'fipiran:77:cancelNav': { price: 1_001_000, asOf: today } }, sn, [], today, now).length, 0);
  // a leveraged fund falling 30% in a day is not a split
  assert.equal(E.applySplits(b, { 'fipiran:77:cancelNav': { price: 700_000, asOf: today } }, sn, [], today, now).length, 0);
});

test('«نیاز به توجه» names a share whose base was adjusted, until its quantity is updated', async () => {
  const I = await import('../../extension/lib/insights.js');
  const a = { id: 's', name: 'سهم نمونه', category: 'stock', mode: 'units', quantity: 1000, price: { source: 'manual', value: 25_000, updatedAt: now } };
  const st = { assets: [a], flows: [], quotes: {}, settings: {}, snapshots: {}, events: [], meta: { priceAdjust: { s: { assetId: 's', r: 2, k: 2, day: today, at: now - 1000 } } } };
  const pf = E.portfolio(st.assets, {}, {}, now);
  assert.ok(I.attentionItems(st, pf, today, now).some((x) => /۱ به 2|۱ به ۲/.test(x.text) && x.assetId === 's'));
  st.events = [{ id: 'e', kind: 'edit', at: now, date: today, changes: [{ assetId: 's', field: 'quantity', delta: 1000, value: 0, split: 2 }] }];
  assert.ok(!I.attentionItems(st, pf, today, now).some((x) => x.assetId === 's' && /تعدیل/.test(x.text)));
});
