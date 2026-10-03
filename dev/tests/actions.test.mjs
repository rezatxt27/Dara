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

test('review fixes (1.5): rate change applies from today, undo with a deleted asset is refused, deleting an account pauses its loan', async () => {
  // a new rate on a running deposit doesn't rewrite the interest already earned
  for (const mode of ['compound', 'simple', 'payout']) {
    const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 20, start: J.addDaysIso(iso, -200), mode } };
    await reset({ assets: [dep] });
    const n0 = await net();
    await act.saveAsset({ ...structuredClone(dep), rate: { ...dep.rate, annualPct: 30 } }, { orig: dep });
    close(await net(), n0, 5000, `${mode}: today's value doesn't jump`);
  }
  // transfer, delete the target, undo the transfer: refused (else money appears)
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 500e6 };
  const box = { id: 'c', name: 'صندوق خانه', category: 'bank', mode: 'balance', balance: 0 };
  await reset({ assets: [bank, box] });
  const ev = await act.transfer({ fromId: 'b', toId: 'c', amount: 100e6 });
  await act.deleteAsset('c');
  await act.undoEvent(ev);
  close((await store.load('assets')).assets.find((a) => a.id === 'b').balance, 400e6, 1, 'the transfer was not half-undone');
  // deleting the account a loan pays from: flagged, and installments no longer touch any account
  const loan = { id: 'l', name: 'وام', category: 'debt', mode: 'loan', loan: { amount: 1e8, annualPct: 18, months: 12, firstDue: J.addJMonthsIso(iso, -2), start: J.addJMonthsIso(iso, -3), account: 'b' } };
  await reset({ assets: [{ ...bank }, loan] });
  await act.deleteAsset('b');
  const s = await store.load('assets', 'flows', 'quotes');
  const L = s.assets.find((a) => a.id === 'l');
  assert.equal(L.loan.paused, 'account');
  // the schedule goes on (the debt shrinks as the bank collects), but no account of ours is debited for it
  const r = E.applyAutomations(s.assets, [], {}, J.addDaysIso(iso, 40));
  const inst = r.events.filter((e) => e.kind === 'loan' && e.date > iso);
  assert.equal(inst.length, 1, 'the installment due in the next 40 days is logged');
  assert.equal(inst[0].changes.length, 0, 'no account is debited');
  assert.equal(inst[0].fromId, null);
  const L2 = r.assets.find((a) => a.id === 'l');
  close(E.loanState(L2.loan, J.addDaysIso(iso, 40)).owed, E.loanPlan(L2.loan).rows.find((x) => x.date > iso).balance, 1, 'value follows the schedule');
  assert.equal(E.valueOf(L, {}, {}).status, 'error', 'shows up in «needs attention»');
});

test('buying a coin records the bubble in the price paid; undo drops it; sells, backdated and non-coin buys record none', async () => {
  const t = Date.now();
  const Q = (price) => ({ price, changePct: 0, at: t - 60000, fetchedAt: t - 60000 });
  const quotes = { 'tgju:ons': Q(4000), 'tgju:price_dollar_rl': Q(1_000_000), 'tgju:rob': Q(300_000_000), 'tgju:geram18': Q(96_000_000) };
  const I = 2.03325 * 0.9 * 4000 * 1_000_000 / 31.1034768;
  const coin = { id: 'c', name: 'ربع', category: 'gold', mode: 'units', quantity: 1, unit: 'عدد', price: { source: 'market', ref: { provider: 'tgju', key: 'rob' }, factor: 1 } };
  const raw = { id: 'g', name: 'آب‌شده', category: 'gold_online', mode: 'units', quantity: 1, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, factor: 1 } };
  await reset({ assets: [coin, raw], quotes });
  const ev = await act.trade({ assetId: 'c', side: 'buy', qty: 2, price: I * 1.15 });
  close(ev.bub.b, 0.15, 1e-9, 'bubble paid'); assert.equal(ev.bub.qty, 2);
  const sell = await act.trade({ assetId: 'c', side: 'sell', qty: 1, price: 3e8 });
  assert.equal(sell.bub, undefined, 'a sale records nothing');
  const old = await act.trade({ assetId: 'c', side: 'buy', qty: 1, price: 3e8, date: J.addDaysIso(iso, -30) });
  assert.equal(old.bub, undefined, 'a backdated buy is not measured against today\'s gold');
  const g = await act.trade({ assetId: 'g', side: 'buy', qty: 1, price: 96e6 });
  assert.equal(g.bub, undefined, 'raw gold has no bubble');
  const BB = await import('../../extension/lib/bubble.js');
  let s = await store.load('assets', 'events', 'quotes');
  const a = s.assets.find((x) => x.id === 'c');
  close(BB.buyBubble(a, s.events, s.quotes).avg, 0.15, 1e-9);
  await act.undoEvent(ev);
  s = await store.load('assets', 'events', 'quotes');
  assert.equal(BB.buyBubble(s.assets.find((x) => x.id === 'c'), s.events, s.quotes), null, 'undone buy no longer counts');
});
