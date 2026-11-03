// «کمیتهٔ سرمایه‌گذاری» (lib/committee.js): cash for the next 90 days, the split toward targets, the ways in, the
// effect on the mix and the bad case. Synthetic assets and numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../extension/lib/committee.js';
import * as PB from '../../extension/lib/builder.js';
import * as J from '../../extension/lib/jalali.js';

const today = J.todayIso(); const now = Date.now();
const close = (a, b, eps = 1e-6, m = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${m} ${a} ≉ ${b}`);
const bal = (id, category, balance, extra = {}) => ({ id, name: id, category, mode: 'balance', balance, balanceAt: now, ...extra });
const manual = (id, category, value) => ({ id, name: id, category, mode: 'units', quantity: 1, price: { source: 'manual', value, updatedAt: now } });
const loan = (amount) => ({ id: 'l', name: 'وام نمونه', category: 'debt', mode: 'loan', loan: { amount, annualPct: 18, months: 12, firstDue: J.addDaysIso(today, 20), start: J.addDaysIso(today, -10), account: 'b' } });
const state = (assets, settings = {}, flows = []) => ({ assets, flows, quotes: {}, settings: { currency: 'toman', ...settings } });

test('cash for the next 90 days: instalments out, salary in; the low point is what must stay in cash', async () => {
  const salary = { id: 'f1', title: 'حقوق نمونه', active: true, freq: 'monthly', start: J.addDaysIso(today, 5), amount: 4e6, toId: 'b', fromId: null };
  const st = state([bal('b', 'bank', 20e6), loan(2e8), manual('g', 'gold', 30e6)], {}, [salary]);
  const E = await import('../../extension/lib/engine.js');
  const pf = E.portfolio(st.assets, {}, st.settings, now);
  const c = C.cashNeeds(st, pf, { amount: 50e6 });
  assert.equal(c.start, 20e6);
  assert.ok(c.events.some((e) => e.kind === 'loan' && e.sign === -1) && c.events.some((e) => e.kind === 'flow' && e.sign === 1));
  // the running cash, by hand
  let run = c.start, low = c.start; for (const e of c.events) { run += e.sign * e.amount; low = Math.min(low, run); }
  close(c.low, low); close(c.shortfall, Math.max(0, -low)); close(c.reserve, Math.min(50e6, Math.max(0, -low)));
  assert.ok(c.shortfall > 0, 'three instalments of ~18M against 20M and the salary');
  // money already in the account: it leaves the account, so less cash is left for the instalments
  const c2 = C.cashNeeds(st, pf, { amount: 10e6, source: 'b' });
  assert.equal(c2.start, 10e6); assert.ok(c2.shortfall > c.shortfall);
});

test('the split follows the targets after the reserve; impact on the mix; a plain bad case without the past', () => {
  const st = state([bal('b', 'bank', 20e6), manual('g', 'gold', 30e6), manual('s', 'stock', 50e6)], { targets: { gold: 40, stock: 30, fixed: 30 } });
  const r = C.committee(st, { amount: 50e6, now });
  assert.equal(r.cash.reserve, 0); assert.equal(r.invest, 50e6);
  assert.equal(r.basis.id, 'targets');
  close(r.blocks.reduce((t, b) => t + b.add, 0), 50e6);
  // gold is 30% of 100, wants 40% of 150 = 60 → gets 30; deposit 20 → wants 45 → 25; bourse already above its 45 → nothing
  const by = Object.fromEntries(r.blocks.map((b) => [b.id, b]));
  assert.ok(!by.bourse, 'the stock market is already over its target');
  assert.ok(by.gold.add > by.deposit.add);
  close(r.impact.protBefore, 0.8); close(r.impact.protAfter, (30e6 + by.gold.add + 50e6) / 150e6);
  assert.ok(r.impact.devAfter < r.impact.devBefore, 'closer to the targets');
  close(r.impact.largest.before, 0.5); close(r.impact.largest.after, 50 / 150);
  assert.equal(r.wrong.from, 'shock'); assert.equal(r.wrong.history, null);
  close(r.wrong.stress.pct, (by.gold.add * -0.15) / 50e6);
  assert.equal(r.wrong.worst, undefined, 'one risky place and no past: the shock line already says it');
  assert.ok(by.gold.options.length >= 1 && by.gold.options.every((o) => o.name && Array.isArray(o.pros) && Array.isArray(o.cons)));
  assert.ok(by.deposit.options.some((o) => /سپرده/.test(o.name)));
});

test('no targets: the profile\'s mix, else the mix held today; nothing to invest when the payments need it all', () => {
  const held = [bal('b', 'bank', 20e6), manual('g', 'gold', 30e6), manual('s', 'stock', 50e6)];
  assert.equal(C.committee(state(held, { profile: { goal: 'grow', horizon: 'long', drop: 'buy' } }), { amount: 10e6, now }).basis.id, 'profile');
  const cur = C.committee(state(held), { amount: 10e6, now });
  assert.equal(cur.basis.id, 'current');
  const by = Object.fromEntries(cur.blocks.map((b) => [b.id, b.share]));
  close(by.gold, 0.3); close(by.bourse, 0.5); close(by.deposit, 0.2);
  const tight = C.committee(state([bal('b', 'bank', 1e6), loan(1e8)]), { amount: 5e6, now });
  assert.equal(tight.cash.reserve, 5e6); assert.equal(tight.invest, 0); assert.equal(tight.blocks.length, 0);
  assert.ok(tight.notes.some((n) => n.includes('چیزی برای سرمایه‌گذاری نمی‌ماند')));
  assert.equal(C.committee(state(held), { amount: 0 }), null);
});

test('the bad case from the past of the markets when it is at hand', () => {
  const months = Array.from({ length: 72 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  const up = (k, sw) => Object.fromEntries(months.map((m, i) => [m, 100 * Math.pow(1 + k, i) * (1 + sw * Math.sin(i / 3))]));
  const R = PB.returnsFrom({ gold: up(0.005, 0.3), usd: up(0.01, 0.05), index: up(0.01, 0.4), btc: up(0.02, 0.5) }, 25);
  const st = state([bal('b', 'bank', 20e6), manual('g', 'gold', 30e6), manual('s', 'stock', 50e6)], { targets: { gold: 40, stock: 30, fixed: 30 } });
  const r = C.committee(st, { amount: 50e6, R, now });
  assert.equal(r.wrong.from, 'history');
  assert.ok(r.wrong.history.badPct <= r.wrong.history.midPct, r.wrong);
  assert.ok(r.wrong.stress.pct < 0, 'the plain shock is always there too');
  assert.equal(r.wrong.worst.from, 'history'); assert.ok(r.wrong.worst.fall < 0, r.wrong.worst);
});

test('a focused look (from a radar card): all of it in that place, with a note when it overshoots the target', () => {
  const st = state([bal('b', 'bank', 20e6), manual('g', 'gold', 30e6), manual('s', 'stock', 50e6)], { targets: { gold: 40, stock: 30, fixed: 30 } });
  const card = { id: 's:X', sig: 'cand', kind: 'stock', sym: 'نمونه', name: 'شرکت نمونه', ref: { provider: 'tsetmc', key: 'X' }, why: ['۳ نشانه از ۵'], flags: [{ t: 'رشد تند اخیر' }], stop: { price: 1000 } };
  const r = C.committee(st, { amount: 20e6, focus: card, now });
  assert.deepEqual(r.blocks.map((b) => b.id), ['bourse']);
  assert.equal(r.blocks[0].options[0].sym, 'نمونه'); assert.equal(r.blocks[0].options[0].stop, 1000);
  assert.ok(r.notes.some((n) => n.includes('بورس')), r.notes);
  assert.equal(r.focus.sym, 'نمونه');
});

test('for the assistant: the same facts, amounts left out in percent-only privacy', () => {
  const st = state([bal('b', 'bank', 20e6), manual('g', 'gold', 30e6)], { targets: { gold: 50, fixed: 50 } });
  const r = C.committee(st, { amount: 10e6, now });
  const full = C.forModel(r, { disp: (v) => Math.round(v / 10) });
  assert.equal(full.amount, 1e6); assert.ok(full.blocks.length && full.blocks[0].options);
  const priv = C.forModel(r, { percentOnly: true });
  assert.equal(priv.amount, undefined); assert.equal(priv.invested, undefined);
  assert.ok(priv.blocks.every((b) => b.amount === undefined && typeof b.pct_of_invested === 'number'));
  assert.ok(!JSON.stringify(priv).match(/\d{6,}/), 'no large amounts');
});

test('assistant: investment_committee shows the card and gives the model the facts (no amounts in percent-only mode)', async () => {
  const A = await import('../../extension/lib/assistant.js');
  const st = state([bal('b', 'bank', 20e6), manual('g', 'gold', 30e6), manual('s', 'stock', 50e6)], { targets: { gold: 40, stock: 30, fixed: 30 } });
  let shown = null;
  const tools = A.makeTools({ getState: () => st, privacy: 'full', getRadar: () => null, onCommittee: (c) => { shown = c; } });
  const t = tools.find((x) => x.name === 'investment_committee');
  assert.ok(t && A.TOOL_STEPS.investment_committee);
  const r = await t.run({ amount: 5e6 }); // toman
  assert.equal(shown.amount, 50e6); assert.ok(r.blocks.length && r.note.includes('تکرار نکن'));
  assert.equal(r.amount, 5e6, 'back in the display unit');
  const fromAcc = await t.run({ amount: 1e6, from_account: 'b' });
  assert.equal(fromAcc.from_account, 'b'); assert.equal(shown.source, 'b');
  const priv = A.makeTools({ getState: () => st, privacy: 'percent', getRadar: () => null, onCommittee: () => {} }).find((x) => x.name === 'investment_committee');
  const p = await priv.run({ amount: 5e6 });
  assert.equal(p.amount, undefined); assert.ok(!JSON.stringify(p).match(/\d{6,}/));
  assert.ok((await t.run({ amount: 0 })).error);
  assert.match(A.systemPrompt(st), /investment_committee/);
});
