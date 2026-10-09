// Fixes from the 1.12 review (finance, engineering and design). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importRows } from '../../extension/lib/importer.js';
import * as SM from '../../extension/lib/sheetmap.js';
import * as E from '../../extension/lib/engine.js';
import * as I from '../../extension/lib/insights.js';
import { cleanList, cleanSnapshots, okDate } from '../../extension/lib/store.js';
import { addDaysIso } from '../../extension/lib/jalali.js';

const HEAD = ['کد', 'دسته دارایی', 'نام دارایی', 'محل نگهداری', 'مقدار', 'واحد', 'قیمت هر واحد', 'مانده'];
const one = (cat, name, qty, unit, price, bal = '') => importRows([HEAD, ['', cat, name, '', String(qty), unit, String(price), String(bal)]], { unit: 'rial' }).assets[0];
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('import: «Tether» is USDT, not Ethereum (and Ethereum still is)', () => {
  assert.equal(one('رمزارز', 'Tether', 1000, '', 1_000_000).price.ref.key, 'usdt');
  assert.equal(one('رمزارز', 'تتر (Tether)', 1000, 'USDT', 1_000_000).price.ref.key, 'usdt');
  assert.equal(one('رمزارز', 'اتریوم', 2, 'ETH', 3e9).price.ref.key, 'eth');
  assert.equal(one('رمزارز', 'Ethereum', 2, '', 3e9).price.ref.key, 'eth');
});

test('import: coins, mesghal and 24k get their own price and unit', () => {
  const bahar = one('طلا و سکه', 'سکه تمام بهار', 3, 'عدد', 1e9);
  assert.equal(bahar.price.ref.key, 'sekeb'); assert.equal(bahar.unit, 'عدد');
  const bare = one('طلا و سکه', 'سکه', 3, 'عدد', 1e9);
  assert.equal(bare.price.ref.key, 'sekee'); assert.ok(bare.review);
  const m = one('طلا و سکه', 'طلای آب‌شده', 10, 'مثقال', 4e8);
  assert.equal(m.price.ref.key, 'mesghal'); assert.equal(m.unit, 'مثقال');
  const g24 = one('طلا و سکه', 'طلای ۲۴ عیار', 5, 'گرم', 1e8);
  assert.equal(g24.price.ref.key, 'geram24'); assert.equal(g24.unit, 'گرم');
  assert.equal(one('طلا و سکه', 'النگو', 20, 'گرم', 9e7).price.ref.key, 'geram18');
});

test('import: a debt written as a negative amount still lowers net worth', () => {
  const d = one('بدهی', 'وام مسکن', '', '', '', -500_000_000);
  assert.equal(d.balance, 500_000_000);
  const pf = E.portfolio([d], {}, {});
  assert.equal(pf.net, -500_000_000);
});

test('import: a unit price far from today\'s is flagged (coins read as grams)', () => {
  const quotes = { 'tgju:sekee': { price: 1e9, at: Date.now() }, 'tgju:geram18': { price: 9e7, at: Date.now() } };
  const coin = one('طلا و سکه', 'سکه امامی', 3, 'عدد', 1e9);
  assert.equal(SM.priceGap(coin, quotes), null);
  const wrong = { ...coin, price: { ...coin.price, ref: { provider: 'tgju', key: 'geram18' } } };
  assert.ok(SM.priceGap(wrong, quotes) > 0.3);
  assert.equal(SM.priceGap(coin, {}), null); // nothing to compare with
});

test('period %: money added during the period does not count as return (modified Dietz)', () => {
  const today = '2026-10-09';
  // 100 at the start; 1,000 added 20 days ago into something that then rose 10% (+100); start rose 10% (+10)
  const at = { from: addDaysIso(today, -30), base: 100, market: 110, total: 1110, rows: [{ moves: [{ date: addDaysIso(today, -20), amount: 1000 }] }] };
  const p = I.movePct(at, today);
  close(p, 110 / (100 + 1000 * 20 / 30));
  assert.ok(p < 0.2); // not +110% of the starting 100
});

test('inflation protection: «other» is not counted as protected', () => {
  const a = (id, category, value) => ({ id, name: id, category, mode: 'balance', balance: value });
  const st = { assets: [a('b', 'bank', 400), a('o', 'other', 600)], snapshots: {}, settings: {} };
  const pf = E.portfolio(st.assets, {}, {});
  const card = I.inflationCard(st, pf);
  assert.equal(card.share, 0);
  close(card.unprotectedShare, 1);
  assert.equal(I.PROTECTED('gold'), true); assert.equal(I.PROTECTED('other'), false);
});

test('buying into a priced asset converts at the market price, not the adjusted one', () => {
  const a = { id: 'g', category: 'gold_online', mode: 'units', quantity: 0, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, adjustPct: -3, factor: 1 } };
  const quotes = { 'tgju:geram18': { price: 100_000_000, at: Date.now() } };
  E.applyDelta(a, 1_000_000_000, quotes);
  close(a.quantity, 10);
  // selling takes the adjusted (lower) price: the same value buys back fewer grams' worth
  E.applyDelta(a, -97_000_000, quotes);
  close(a.quantity, 9);
});

test('freshness: a quote with no time of its own is as old as its fetch', () => {
  const a = { id: 'x', category: 'gold', mode: 'units', quantity: 1, price: { source: 'market', ref: { provider: 'tgju', key: 'sekee' } } };
  const now = Date.now();
  const old = E.valueOf(a, { 'tgju:sekee': { price: 1e9, fetchedAt: now - 30 * 864e5, changePct: 0.05 } }, {}, now);
  assert.equal(old.status, 'delayed'); assert.equal(old.dayChange, 0);
  const fresh = E.valueOf(a, { 'tgju:sekee': { price: 1e9, fetchedAt: now - 60e3 } }, {}, now);
  assert.equal(fresh.status, 'live');
});

test('damaged backup: bad dates and empty snapshots are cleaned, not fatal', () => {
  assert.equal(okDate('2026-02-30'), false); assert.equal(okDate('0500-01-01'), false); assert.equal(okDate('2026-10-09'), true);
  const flows = cleanList('flows', [{ id: 'f1', start: '0500-01-01' }, { id: 'f2', start: '2026-01-01' }, { id: 'f3', start: '2026-01-01', end: 'x' }]);
  assert.deepEqual(flows.map((f) => f.id), ['f2', 'f3']); assert.equal(flows[1].end, undefined); // a bad end is dropped, not the flow
  const [dep] = cleanList('assets', [{ id: 'd', mode: 'rate', category: 'fixed', rate: { principal: 1, annualPct: 20, start: '2026-01-01', maturity: '9999-99-99' } }]);
  assert.equal(dep.rate.start, '2026-01-01'); assert.equal(dep.rate.maturity, undefined);
  const snaps = cleanSnapshots({ '2026-10-01': null, '2026-10-02': { t: 5 }, bad: { t: 1 }, '2026-10-03': { t: 'x' } });
  assert.deepEqual(Object.keys(snaps), ['2026-10-02']);
  assert.doesNotThrow(() => E.seriesFrom(snaps, 'money', 0));
});

test('snapshots: per-asset detail kept for the last 400 days, the first day and the first of each month', () => {
  const today = '2026-10-09';
  const snaps = {};
  for (let i = 900; i >= 0; i--) snaps[addDaysIso(today, -i)] = { t: i, v: { a: i } };
  const out = E.pruneSnapshots(snaps, 1500, 400, today);
  const keys = Object.keys(out);
  assert.equal(keys.length, 901); // every day still charted
  assert.ok(out[keys[0]].v); // the first
  assert.ok(out[addDaysIso(today, -10)].v); // recent
  const oldDays = keys.filter((k) => k < addDaysIso(today, -400));
  const withV = oldDays.filter((k) => out[k].v);
  assert.ok(withV.length <= 20 && withV.length >= 15, String(withV.length)); // about one a month
  assert.ok(oldDays.every((k) => isFinite(out[k].t)));
});

test('review: a damaged «done up to» date never replays the past', () => {
  const today = new Date().toISOString().slice(0, 10);
  const [bank, dep, loan] = cleanList('assets', [
    { id: 'b', mode: 'balance', category: 'bank', balance: 1e9, interest: { on: true, annualPct: 20, since: '2025-01-01', lastAccrual: '2026/10/08' } },
    { id: 'd', mode: 'rate', category: 'fixed', rate: { principal: 1e9, annualPct: 20, start: '2026-01-01', mode: 'payout', lastPayout: '2026-1-05' } },
    { id: 'l', mode: 'loan', category: 'debt', loan: { amount: 1e9, annualPct: 20, months: 12, firstDue: '2026-01-01', settledAt: '2026-04-31', lastRun: 20260101 } },
  ]);
  assert.ok(bank.interest.lastAccrual <= today && bank.interest.lastAccrual >= '2026-01-01');
  assert.ok(dep.rate.lastPayout >= '2026-01-01');
  assert.ok(loan.loan.settledAt >= '2026-01-01' && typeof loan.loan.lastRun === 'string');
  const [f] = cleanList('flows', [{ id: 'f', start: '2026-01-01', end: 'bad', lastRun: '2026-13-01' }]);
  assert.equal(f.end, undefined); assert.ok(f.lastRun >= '2026-01-01');
});

test('review: gram items stay grams, and a coin is named, not guessed from where it is kept', () => {
  assert.equal(one('طلا و سکه', 'پلاک ۵ گرمی', 5, 'گرم', 1e8).price.ref.key, 'geram18');
  const bracelet = importRows([HEAD, ['', 'طلا و سکه', 'دستبند', 'طلافروشی بهار', '20', 'گرم', '90000000', '']], { unit: 'rial' }).assets[0];
  assert.equal(bracelet.price.ref.key, 'geram18'); assert.equal(bracelet.unit, 'گرم');
  const earring = one('طلا و سکه', 'گوشواره', 1, 'عدد', 9e7);
  assert.equal(earring.price.ref.key, 'geram18'); assert.ok(earring.review);
  assert.equal(one('طلا و سکه', 'سکه گرمی', 2, 'عدد', 3e8).price.ref.key, 'retail_gerami');
});

test('review: a coin priced in or kept as Tether is still that coin', () => {
  assert.equal(one('رمزارز', 'BTC', 0.01, 'USDT', 2e10).price.ref.key, 'btc');
  assert.equal(importRows([HEAD, ['', 'رمزارز', 'بیت‌کوین', 'کیف پول تتر', '0.01', '', '2e10', '']], { unit: 'rial' }).assets[0].price.ref.key, 'btc');
  assert.equal(one('رمزارز', 'ETH-USDT', 1, '', 3e9).price.ref.key, 'eth');
});

test('review: after the 1500-day trim the oldest kept day still has its detail', () => {
  const today = '2026-10-09';
  let snaps = {};
  for (let i = 1700; i >= 0; i--) { const d = addDaysIso(today, -i); snaps[d] = { t: i, v: { a: i } }; snaps = E.pruneSnapshots(snaps, 1500, 400, d); }
  const keys = Object.keys(snaps).sort();
  assert.ok(snaps[keys[0]].v, keys[0]);
  assert.ok(keys.length <= 1500);
});
