import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../extension/lib/assistant.js';
import * as CH from '../../extension/lib/chats.js';
import * as PR from '../../extension/lib/profile.js';
import * as E from '../../extension/lib/engine.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const now = Date.now();
const state = (extra = {}) => ({
  assets: [{ id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
           { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 5e9, balanceAt: now }],
  quotes: { 'tgju:geram18': { price: 250_000_000, at: now } }, settings: { currency: 'toman', targets: {}, depositPct: 24, ...extra }, snapshots: {}, events: [], flows: [], alerts: [] });
const tool = (tools, n) => tools.find((t) => t.name === n);

test('every assistant tool has a Persian step label', () => {
  const names = A.makeTools({ getState: () => state() }).map((t) => t.name);
  for (const n of names) assert.ok(A.TOOL_STEPS[n], `no label for ${n}`);
});

test('calculator tools: display units in and out, same formulas as the calculators', () => {
  const tools = A.makeTools({ getState: () => state() });
  const loan = tool(tools, 'calc_loan').run({ amount: 100_000_000, annual_rate_pct: 0, months: 10 });
  assert.equal(loan.monthly_installment, 10_000_000); assert.equal(loan.total_interest, 0); assert.equal(loan.unit, 'تومان');
  const ins = tool(tools, 'calc_instalments').run({ cash_price: 80_000_000, each_installment: 8_000_000, months: 12, deposit_rate_pct: 40 });
  assert.equal(ins.more_than_cash, 16_000_000); assert.ok(ins.real_annual_rate_pct > 34 && ins.real_annual_rate_pct < 36); assert.equal(ins.cheaper, 'instalments');
  assert.equal(tool(tools, 'calc_savings_goal').run({ target: 1_200_000_000, months: 12, annual_rate_pct: 0 }).monthly_needed_first_year, 100_000_000);
  assert.equal(tool(tools, 'calc_savings_goal').run({ target: 1_200_000_000, monthly: 100_000_000, annual_rate_pct: 0 }).months_to_goal, 12);
  const avg = tool(tools, 'calc_average_buy').run({ have_qty: 100, have_avg: 5000, buy_qty: 200, buy_price: 4000, kind: 'none', target_avg: 4500 });
  assert.equal(avg.new_average, 4333.33); assert.equal(avg.units_to_buy_for_target, 100);
  const tr = tool(tools, 'calc_stock_trade').run({ kind: 'stock', buy_price: 4000 });
  assert.ok(tr.breakeven_sell_price > 4040 && tr.breakeven_sell_price < 4060);
  const dep = tool(tools, 'calc_deposit').run({ principal: 100_000_000, annual_rate_pct: 24, months: 12 });
  assert.equal(dep.monthly_interest, 2_000_000);
  const br = tool(tools, 'calc_deposit').run({ principal: 100_000_000, annual_rate_pct: 24, months: 12, held_months: 6, break_rate_pct: 12 });
  assert.equal(br.taken_from_principal, 6_000_000); assert.equal(br.back_if_broken_today, 94_000_000);
  const rent = tool(tools, 'calc_rent').run({ deposit: 100_000_000, rent: 0, new_deposit: 0 });
  assert.equal(rent.new_rent, 3_000_000);
  assert.ok(tool(tools, 'calc_loan').run({ amount: 1, annual_rate_pct: 20, months: 0 }).error);
});

test('show_chart attaches real data, never amounts in percent-only mode', () => {
  const st = state();
  st.snapshots = Object.fromEntries(Array.from({ length: 40 }, (_, i) => { const d = new Date(now - (39 - i) * 86400000).toISOString().slice(0, 10); return [d, { t: 1e10 + i * 1e8 }]; }));
  const got = []; const tools = A.makeTools({ getState: () => st, privacy: 'percent', onChart: (c) => got.push(c) });
  const sc = tool(tools, 'show_chart');
  assert.ok(sc.run({ kind: 'allocation' }).shown);
  assert.equal(got[0].type, 'donut'); close(got[0].items.reduce((t, x) => t + x.value, 0), 1);
  assert.ok(sc.run({ kind: 'net_worth', days: 30 }).shown);
  const c = got[1]; assert.equal(c.type, 'area'); assert.equal(c.money, false); close(c.points[0].value, 100); assert.ok(c.points.length <= 120);
  assert.ok(!c.points.some((p) => p.value > 1000), 'an index, not amounts');
  assert.ok(sc.run({ kind: 'custom', labels: ['a', 'b'], values: [1] }).error, 'labels and values must match');
  sc.run({ kind: 'custom', labels: ['وام الف', 'وام ب'], values: [23, 31.5], unit: 'pct' });
  close(got[got.length - 1].items[1].value, 0.315);
});

test('conversations: old single chat becomes a thread; edits move to top; empty threads are not kept', () => {
  const old = { messages: [{ id: 'm1', role: 'user', content: 'سلام، ارزش دارایی‌ام چقدر است و امروز چرا تغییر کرد؟ لطفاً کامل توضیح بده', at: 1 }, { id: 'm2', role: 'assistant', content: 'x', at: 2 }] };
  const n = CH.normalize(old);
  assert.equal(n.threads.length, 1); assert.equal(n.current, n.threads[0].id); assert.ok(n.threads[0].title.endsWith('…'));
  let c = CH.withMessages(n, 't2', [{ role: 'user', content: 'دوم', at: 3 }]);
  assert.equal(c.threads[0].id, 't2'); assert.equal(c.threads[0].title, 'دوم'); assert.equal(c.threads.length, 2);
  c = CH.withMessages(c, 't2', []); assert.equal(c.threads.length, 1, 'cleared thread dropped');
  c = CH.remove(c, n.threads[0].id); assert.equal(c.threads.length, 0); assert.equal(c.current, null);
  const many = Array.from({ length: 40 }, (_, i) => i).reduce((acc, i) => CH.withMessages(acc, 't' + i, [{ role: 'user', content: 'q' + i }]), {});
  assert.equal(many.threads.length, CH.MAX_THREADS); assert.equal(many.threads[0].id, 't39');
  assert.equal(CH.thinPoints(Array.from({ length: 500 }, (_, i) => i), 120).length, 120);
  assert.deepEqual([CH.thinPoints([1, 2, 3, 4, 5], 3)[0], CH.thinPoints([1, 2, 3, 4, 5], 3)[2]], [1, 5]);
});

test('investment profile: risk level, emergency fund, starting mix, red lines, assistant lines', () => {
  assert.equal(PR.riskLevel({ goal: 'grow', horizon: 'long', drop: 'buy' }), 'high');
  assert.equal(PR.riskLevel({ goal: 'grow', horizon: 'long', drop: 'sell' }), 'low', 'the lower of the two wins');
  assert.equal(PR.riskLevel({ goal: 'grow', horizon: 'short', drop: 'buy' }), 'low');
  assert.equal(PR.riskLevel({ horizon: 'long' }), null);
  for (const r of ['low', 'mid', 'high']) {
    const p = { goal: 'grow', horizon: { low: 'short', mid: 'mid', high: 'long' }[r], drop: 'buy' };
    assert.equal(Object.values(PR.suggestTargets(p)).reduce((a, b) => a + b, 0), 100);
    const nc = PR.suggestTargets({ ...p, noCrypto: true });
    assert.ok(!nc.crypto); assert.equal(Object.values(nc).reduce((a, b) => a + b, 0), 100);
  }
  const st = state(); const pf = E.portfolio(st.assets, st.quotes, st.settings); // bank 5e9 Rial
  const p = { goal: 'protect', horizon: 'mid', drop: 'wait', expense: 1e9 };
  const e = PR.emergency(p, pf);
  close(e.months, 5); assert.equal(e.want, 6); assert.equal(e.ok, false); close(e.short, 1e9);
  assert.equal(PR.emergencyMonths({ income: 'variable' }), 9);
  assert.equal(PR.emergency({ ...p, expense: null }, pf), null);
  assert.equal(PR.emergency({ ...p, emergencyMonths: 4 }, pf).ok, true);
  // buying gold from the bank account lowers it; moving money into a deposit does not
  assert.ok(PR.purchaseNotes({ ...p, emergencyMonths: 4 }, pf, { category: 'gold', value: 2e9, spendFromCash: true }).some((l) => l.k === 'emergency'));
  assert.equal(PR.purchaseNotes({ ...p, emergencyMonths: 4 }, pf, { category: 'fixed', value: 2e9, spendFromCash: true }).length, 0);
  assert.ok(PR.purchaseNotes({ ...p, noCrypto: true }, pf, { category: 'crypto', value: 1 }).some((l) => l.k === 'red'));
  // gold already 2.5e9 of 7.5e9; buying 1e9 more with new money → 3.5/8.5 ≈ 41% > 30%
  assert.ok(PR.purchaseNotes({ ...p, maxOne: 30 }, pf, { category: 'gold', value: 1e9, sameHeld: 2.5e9 }).some((l) => l.k === 'red'));
  assert.equal(PR.purchaseNotes({ ...p, maxOne: 50 }, pf, { category: 'gold', value: 1e9, sameHeld: 2.5e9 }).length, 0);
  assert.ok(PR.tooRisky({ ...p, horizon: 'short' }, { kind: 'stock', volRel: 1.5, m: {} }));
  assert.ok(!PR.tooRisky({ goal: 'grow', horizon: 'long', drop: 'buy' }, { kind: 'stock', volRel: 3, m: {} }));
  const lines = PR.promptLines({ ...p, noCrypto: true }, pf);
  assert.ok(lines.includes('سطح ریسک قابل‌قبول: متوسط') && lines.includes('۶') === false && lines.includes('رمزارز نه'));
  assert.ok(!/\d{7,}/.test(lines), 'no amounts in the assistant lines');
  const sys = A.systemPrompt({ ...st, settings: { ...st.settings, profile: p } }, 'percent');
  assert.ok(sys.includes('پروفایل سرمایه‌گذاری کاربر'));
  assert.ok(!A.systemPrompt(st, 'full').includes('پروفایل سرمایه‌گذاری کاربر'));
});

test('review fixes: stable migration id, unrounded unit prices, masked goal text, funded purchases, overdraft', () => {
  const old = { messages: [{ role: 'user', content: 'q', at: 1 }] };
  assert.equal(CH.normalize(old).threads[0].id, CH.normalize(old).threads[0].id, 'every page agrees on the migrated id');
  assert.equal(CH.withMessages(old, 'legacy', [...old.messages, { role: 'assistant', content: 'a' }]).threads.length, 1);
  const tools = A.makeTools({ getState: () => state() });
  const tr = tool(tools, 'calc_stock_trade').run({ kind: 'stock', buy_price: 100 });
  assert.ok(tr.breakeven_sell_price > 101 && tr.breakeven_sell_price < 101.5 && tr.breakeven_sell_price !== 101, tr.breakeven_sell_price);
  const st = state(); const pf = E.portfolio(st.assets, st.quotes, st.settings);
  const p = { goal: 'purchase', purchase: 'خانه ۵ میلیارد', horizon: 'mid', drop: 'wait' };
  assert.ok(!PR.promptLines(p, pf, 'percent').includes('۵'));
  assert.ok(PR.promptLines(p, pf, 'full').includes('۵ میلیارد'));
  // paid from an account already counted: the total doesn't grow, so the share is higher
  const a1 = PR.purchaseNotes({ ...p, maxOne: 45 }, pf, { category: 'gold', value: 1e9, sameHeld: 2.5e9, funded: true });
  const a2 = PR.purchaseNotes({ ...p, maxOne: 45 }, pf, { category: 'gold', value: 1e9, sameHeld: 2.5e9 });
  assert.ok(a1.length === 1 && a2.length === 0, '3.5/7.5 = 47% vs 3.5/8.5 = 41%');
  const st2 = { ...st, assets: [...st.assets, { id: 'o', name: 'جاری', category: 'bank', mode: 'balance', balance: -1e9, balanceAt: now }] };
  const pf2 = E.portfolio(st2.assets, st2.quotes, st2.settings);
  close(PR.emergency({ ...p, expense: 1e9 }, pf2).have, 4e9);
});
