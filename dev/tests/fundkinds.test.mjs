// What a fund holds, by its type on Fipiran (1.27): fixed income is Rial, a mixed fund is split by its own mix, the
// owner's choice wins. Synthetic funds and numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../../extension/lib/insights.js';
import * as E from '../../extension/lib/engine.js';
import { todayIso, addDaysIso } from '../../extension/lib/jalali.js';

const today = todayIso(); const now = Date.now();
const close = (a, b, eps = 1e-6, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);
const fund = (id, kind, value, extra = {}) => ({ id, name: id, category: 'stock', mode: 'units', quantity: 1, price: { source: 'manual', value, updatedAt: now },
  ...(kind ? { fundKind: { ref: 'tsetmc:' + id, at: now, ...kind } } : {}), ...extra });
const bal = (id, category, balance) => ({ id, name: id, category, mode: 'balance', balance, balanceAt: now });
const FIXED = { type: 4, name: 'درآمد ثابت نمونه' };
const MIXED = { type: 7, name: 'مختلط نمونه', mix: { stock: 30, bond: 40, deposit: 15, cash: 5, other: 10 } };

test('types: fixed income → Rial, equity kinds → shares, commodity by name, property, unknown → as before', () => {
  assert.deepEqual(E.fundParts(FIXED), [['rial', 1]]);
  assert.deepEqual(E.fundParts({ type: 24 }), [['rial', 1]]);
  for (const t of [6, 11, 12, 16, 21, 22, 23]) assert.deepEqual(E.fundParts({ type: t }), [['equity', 1]], 'type ' + t);
  assert.deepEqual(E.fundParts({ type: 5, name: 'صندوق کالایی طلای نمونه' }), [['gold', 1]]);
  assert.deepEqual(E.fundParts({ type: 5, name: 'صندوق کالایی نقره نمونه' }), [['commodity', 1]]);
  for (const t of [13, 14, 18]) assert.deepEqual(E.fundParts({ type: t }), [['real', 1]]);
  assert.equal(E.fundParts({ type: 0 }), null); assert.equal(E.fundParts(null), null); assert.equal(E.fundParts({ type: 99 }), null);
  // a share that isn't a fund keeps what it had (a gold ETF by its symbol stays gold)
  const gold = fund('g', { type: 0 }, 100, { price: { source: 'market', ref: { provider: 'tsetmc', key: 'g', symbol: 'عیار' } } });
  assert.equal(E.exposureOf(gold), 'gold');
});

test('a mixed fund: shares 30/(30+60), Rial the rest; «other» is left out of the split', () => {
  const p = E.fundParts(MIXED);
  close(p.find(([e]) => e === 'equity')[1], 30 / 90); close(p.find(([e]) => e === 'rial')[1], 60 / 90);
  close(p.reduce((t, [, w]) => t + w, 0), 1);
  assert.equal(E.exposureOf(fund('m', MIXED, 1)), 'rial', 'its larger part');
  // a mix Fipiran left empty: counted as shares, as before
  assert.deepEqual(E.fundParts({ type: 7, mix: {} }), [['equity', 1]]);
});

test('portfolio and inflation card: a fixed-income fund in «بورس» is Rial, not protected', () => {
  const assets = [fund('fi', FIXED, 600), fund('eq', { type: 6 }, 200), fund('m', MIXED, 90), bal('b', 'bank', 110)];
  const pf = E.portfolio(assets, {}, {}, now);
  close(pf.byExposure.rial, 600 + 60 + 110); close(pf.byExposure.equity, 200 + 30);
  const c = I.inflationCard({ assets, snapshots: {}, settings: {} }, pf, today);
  close(c.share, 230 / 1000); close(c.rialOwned, 770);
  const fr = c.unprotected.find((x) => x.id === 'fund_rial');
  close(fr.value, 660); assert.match(fr.name, /صندوق/);
  close(c.unprotected.reduce((t, x) => t + x.value, 0), c.unprotectedShare * 1000);
  // a past snapshot is read with the same rule (no jump between this month and last)
  close(I.protectedShareAt({ t: 1000, v: { fi: 600, eq: 200, m: 90, b: 110 } }, assets), c.share);
});

test('scenario: shares −25% leaves the fixed-income fund alone and moves a mixed fund by its share part', () => {
  const assets = [fund('fi', FIXED, 600), fund('eq', { type: 6 }, 200), fund('m', MIXED, 90)];
  const r = E.simulate(assets, {}, {}, { equity: -0.25 });
  const row = (id) => r.rows.find((x) => x.asset.id === id);
  close(row('fi').after, 600); close(row('eq').after, 150); close(row('m').after, 90 - 30 * 0.25);
  const eq = r.exposures.find((e) => e.id === 'equity'); const rl = r.exposures.find((e) => e.id === 'rial');
  close(eq.before, 230); close(eq.after, 230 * 0.75); close(rl.before, 660); close(rl.after, 660);
  close(r.delta, -(200 + 30) * 0.25);
});

test('the owner\'s choice wins; a debt is never a fund', () => {
  const mine = fund('fi', FIXED, 100, { exposure: 'equity' });
  assert.deepEqual(E.exposureParts(mine), [['equity', 1]]); assert.equal(E.exposureOf(mine), 'equity');
  const debt = { id: 'd', name: 'd', category: 'debt', mode: 'balance', balance: 50, fundKind: { type: 6 } };
  assert.equal(E.exposureOf(debt), 'rial');
  const c = I.inflationCard({ assets: [mine], snapshots: {}, settings: {} }, E.portfolio([mine], {}, {}, now), today);
  close(c.share, 1);
});

test('lookup: by exchange code or Fipiran key, once a week, again when the symbol changes; not a fund → type 0', () => {
  const funds = [{ key: '11', regNo: '11', name: 'درآمد ثابت نمونه', fundType: 4, insCode: '777', symbol: 'نمونه', mix: { stock: 0, bond: 70, deposit: 25, cash: 5, other: 0 } },
    { key: '12', regNo: '12', name: 'صدور و ابطال نمونه', fundType: 7, insCode: '', mix: { stock: 40, bond: 60 } }];
  const tse = { mode: 'units', category: 'stock', quantity: 1, price: { source: 'market', ref: { provider: 'tsetmc', key: '777' } } };
  assert.equal(E.fundKindDue(tse, now), true);
  const k = E.fundKindOf(tse.price.ref, funds, now);
  assert.equal(k.type, 4); assert.equal(k.ref, 'tsetmc:777'); assert.equal(k.mix.bond, 70);
  tse.fundKind = k;
  assert.equal(E.fundKindDue(tse, now + 86400e3), false);
  assert.equal(E.fundKindDue(tse, now + 8 * 86400e3), true, 'a week later');
  assert.equal(E.fundKindDue({ ...tse, price: { ...tse.price, ref: { provider: 'tsetmc', key: '888' } } }, now), true, 'symbol changed');
  const fip = E.fundKindOf({ provider: 'fipiran', key: '12' }, funds, now);
  assert.equal(fip.type, 7); assert.equal(fip.mix.stock, 40);
  const share = E.fundKindOf({ provider: 'tsetmc', key: '999' }, funds, now);
  assert.equal(share.type, 0); assert.equal(E.fundKindTag(share), null);
  // not looked up: manual prices, debts, a symbol not resolved yet
  assert.equal(E.fundKindDue({ ...tse, fundKind: undefined, price: { source: 'manual', value: 1 } }, now), false);
  assert.equal(E.fundKindDue({ ...tse, fundKind: undefined, price: { source: 'market', ref: { provider: 'tsetmc', symbol: 'x' } } }, now), false);
  assert.deepEqual(E.fundKindTag({ type: 22 }), { text: 'اهرمی', risky: true });
});
