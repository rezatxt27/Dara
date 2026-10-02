// Bookkeeping of user actions (ui/actions.js) against the in-memory store. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../extension/lib/store.js';
import * as E from '../../extension/lib/engine.js';
import * as J from '../../extension/lib/jalali.js';
import { act } from '../../extension/ui/actions.js';

const iso = J.todayIso();
const net = async () => { const s = await store.load('assets', 'quotes'); return E.portfolio(s.assets, s.quotes, {}).net; };
const reset = async (o) => { await store.clearAll(); await store.save({ assets: [], flows: [], events: [], quotes: {}, snapshots: {}, ...o }); };
const close = (a, b, eps = 1, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);

test('closing a matured deposit moves its value to the account; a matured debt is paid from it', async () => {
  const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 100e6, annualPct: 20, start: J.addDaysIso(iso, -400), maturity: J.addDaysIso(iso, -5), mode: 'simple' } };
  const debt = { id: 'x', name: 'بدهی', category: 'debt', mode: 'rate', rate: { principal: 50e6, annualPct: 20, start: J.addDaysIso(iso, -400), maturity: J.addDaysIso(iso, -5), mode: 'simple' } };
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 500e6 };
  await reset({ assets: [bank, dep, debt], flows: [{ id: 'f', title: 'پس‌انداز', amount: 1e6, fromId: 'b', toId: 'd', freq: 'monthly', day: 1, start: iso, active: true }] });
  const n0 = await net();
  const ev1 = await act.closeDeposit({ assetId: 'd', accountId: 'b' });
  const ev2 = await act.closeDeposit({ assetId: 'x', accountId: 'b' });
  close(await net(), n0, 1, 'net worth unchanged');
  const s = await store.load('assets', 'flows', 'events');
  const b = s.assets.find((a) => a.id === 'b');
  close(b.balance, 500e6 + E.rateValue(dep.rate, iso) - E.rateValue(debt.rate, iso), 1, 'account');
  assert.equal(s.flows[0].active, false, 'a flow into a closed deposit pauses');
  // what it earned before closing stays a market result, not «money moved»
  const ef = E.eventEffects(s.events, { date: '2000-01-01', snap: { at: 1, v: {} } }, Object.fromEntries(s.assets.map((a) => [a.id, a])));
  assert.ok(ef.byAsset.d.some((m) => m.removal));
  await act.undoEvent(ev2); await act.undoEvent(ev1);
  const s2 = await store.load('assets', 'flows');
  assert.ok(!s2.assets.find((a) => a.id === 'd').archived); assert.equal(s2.flows[0].active, true);
  close(s2.assets.find((a) => a.id === 'b').balance, 500e6, 1, 'undo');
});

test('editing a deposit principal is logged as a correction; a loan account can be unlinked', async () => {
  const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 20, start: J.addDaysIso(iso, -100), mode: 'compound' } };
  const loan = { id: 'l', name: 'وام', category: 'debt', mode: 'loan', loan: { amount: 1e8, annualPct: 18, months: 12, firstDue: J.addJMonthsIso(iso, 1), account: 'b' } };
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 5e8 };
  await reset({ assets: [bank, dep, loan] });
  const ev = await act.saveAsset({ ...dep, rate: { ...dep.rate, principal: 1.5e9 } }, { orig: dep });
  assert.ok(ev && ev.prev && ev.changes[0].field === 'value' && ev.changes[0].value > 5e8);
  await act.saveAsset({ ...loan, loan: { ...loan.loan, account: null } }, { orig: loan });
  assert.equal((await store.load('assets')).assets.find((a) => a.id === 'l').loan.account, null);
});

test('turning day-count interest off moves it into the balance without a fake edit', async () => {
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1e9, interest: { on: true, annualPct: 10, payDay: 1, since: J.addDaysIso(iso, -10), lastAccrual: J.addDaysIso(iso, -1), accrued: 2e6 } };
  await reset({ assets: [bank] });
  const n0 = await net();
  const ev = await act.saveAsset({ ...bank, interest: { ...bank.interest, on: false } }, { orig: bank });
  close(await net(), n0, 50, 'net worth');
  assert.ok(!ev || !ev.changes?.some((c) => c.field === 'balance'), 'no balance edit logged');
});

test('a funded purchase can be reversed only while nothing else happened to it', async () => {
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 5e8 };
  const gold = { id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, unit: 'گرم', price: { source: 'manual', value: 1e7 } };
  await reset({ assets: [bank] });
  const ev = await act.saveAsset(gold, { fund: { accountId: 'b', amount: 1e8 } });
  assert.equal((await store.load('assets')).assets.find((a) => a.id === 'b').balance, 4e8);
  await act.trade({ assetId: 'g', side: 'sell', qty: 5, price: 1e7, cashId: 'b' });
  await act.undoEvent(ev);
  const s = await store.load('assets');
  assert.ok(s.assets.some((a) => a.id === 'g'), 'refused after a sale');
  assert.equal(s.assets.find((a) => a.id === 'b').balance, 4.5e8);
});

test('a new recurring flow keeps the count of runs it skipped', async () => {
  await reset({});
  await act.saveFlow({ id: 'f1', title: 'قسط', amount: 1, fromId: null, toId: null, freq: 'monthly', day: 1, start: J.addJMonthsIso(iso, -4), count: 6, done: 4, lastRun: iso, active: true });
  assert.equal((await store.load('flows')).flows[0].done, 4);
});
