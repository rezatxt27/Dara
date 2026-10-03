import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../extension/lib/engine.js';
import * as P from '../../extension/lib/providers.js';
import * as A from '../../extension/lib/assistant.js';
import * as J from '../../extension/lib/jalali.js';
import { numToWordsFa, parseNum } from '../../extension/lib/format.js';

const iso = J.todayIso();
const close = (a, b, eps = 1) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('day-count factors and year basis', () => {
  close(E.dayFactor('2026-01-01', '2026-01-31', 365), 30 / 365, 1e-12);
  close(E.dayFactor('2026-01-01', '2026-01-31', 360), 30 / 360, 1e-12);
  // 1403 is a leap Jalali year: each day = 1/366
  const f = E.dayFactor(J.jToIso(1403, 1, 1), J.jToIso(1403, 1, 11), 'actual');
  close(f, 10 / 366, 1e-12);
});

test('rate: compound / simple / payout (روزشمار) values', () => {
  const start = J.addDaysIso(iso, -365);
  close(E.rateValue({ principal: 1000, annualPct: 30, start, mode: 'compound' }, iso), 1300, 2);
  close(E.rateValue({ principal: 1000, annualPct: 30, start, mode: 'simple' }, iso), 1300, 2);
  // payout: accrued interest only since the last monthly anniversary
  const st2 = J.addDaysIso(iso, -10);
  close(E.rateValue({ principal: 1_000_000, annualPct: 36.5, start: st2, mode: 'payout' }, iso), 1_010_000, 1);
  // daily interest = P × r / 365
  close(E.rateDaily({ principal: 1e9, annualPct: 23, mode: 'payout' }, 1e9, iso), 1e9 * 0.23 / 365, 1e-6);
  // before start → principal; matured → stops
  assert.equal(E.rateValue({ principal: 500, annualPct: 20, start: J.addDaysIso(iso, 5), mode: 'simple' }, iso), 500);
  const m = E.rateValue({ principal: 1000, annualPct: 36.5, start: J.addDaysIso(iso, -100), maturity: J.addDaysIso(iso, -90), mode: 'simple' }, iso);
  close(m, 1010, 0.01);
});

test('payout schedule: Jalali anniversaries, idempotent, undo', () => {
  const start = J.jToIso(1405, 4, 9); // 2026-06-30
  const bank = { id: 'b', category: 'bank', mode: 'balance', balance: 0 };
  const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1_000_000_000, annualPct: 24, start, mode: 'payout', payoutTo: 'b' } };
  const r1 = E.applyAutomations([bank, dep], [], {}, J.jToIso(1405, 7, 9));
  assert.deepEqual(r1.events.map((e) => J.fmtJ(e.date, 'short')), ['1405/05/09', '1405/06/09', '1405/07/09']);
  assert.equal(r1.events[0].amount, Math.round(1e9 * 0.24 * 31 / 365));
  assert.equal(E.applyAutomations([bank, dep], [], {}, J.jToIso(1405, 7, 9)).events.length, 0);
  const total = r1.events.reduce((s, e) => s + e.amount, 0);
  assert.equal(bank.balance, total);
  E.undoEvent([bank, dep], r1.events[0]);
  assert.equal(bank.balance, total - r1.events[0].amount);
  // value right after payday = principal (accrual reset)
  close(E.rateValue(dep.rate, J.jToIso(1405, 7, 9)), 1e9, 1);
});

test('bank balance day-count interest (حساب روزشمار): daily accrual, monthly payout', () => {
  const since = J.jToIso(1405, 6, 1);
  const acc = { id: 'x', name: 'کوتاه‌مدت', category: 'bank', mode: 'balance', balance: 365_000_000,
    interest: { on: true, annualPct: 10, basis: 365, payDay: 1, since, accrued: 0 } };
  const today = J.jToIso(1405, 7, 5);
  const r = E.applyAutomations([acc], [], {}, today);
  assert.equal(r.events.length, 1, 'paid once on 1 Mehr');
  // Shahrivar has 31 days → 31 days × 10,000/day
  assert.equal(r.events[0].amount, 3_100_000); // Shahrivar = 31 days × 100,000/day
  assert.equal(r.events[0].date, J.jToIso(1405, 7, 1));
  // Mehr 1..4 accrued on the new balance (4 complete days)
  close(acc.interest.accrued, 4 * 368_100_000 * 0.10 / 365, 0.01);
  assert.equal(acc.interest.lastAccrual, J.addDaysIso(today, -1));
  assert.equal(E.applyAutomations([acc], [], {}, today).events.length, 0, 'idempotent');
  // valueOf includes accrued interest
  const v = E.valueOf(acc, {}, {});
  assert.ok(v.value >= acc.balance + acc.interest.accrued - 1);
});

test('recurring flows: salary, installment, DCA with count', () => {
  const start = J.addJMonthsIso(iso, -2);
  const bank = { id: 'b', category: 'bank', mode: 'balance', balance: 100 };
  const loan = { id: 'l', category: 'debt', mode: 'balance', balance: 1000 };
  const gold = { id: 'g', category: 'gold_online', mode: 'units', quantity: 1, price: { source: 'manual', value: 10 } };
  const flows = [
    { id: 'f1', title: 'حقوق', amount: 50, toId: 'b', freq: 'monthly', start, active: true },
    { id: 'f2', title: 'قسط', amount: 20, fromId: 'b', toId: 'l', freq: 'monthly', start, active: true },
    { id: 'f3', title: 'DCA', amount: 10, fromId: 'b', toId: 'g', freq: 'monthly', start, active: true, count: 2 },
  ];
  E.applyAutomations([bank, loan, gold], flows, {}, iso);
  const n = flows[0].done;
  assert.ok(n === 2 || n === 3);
  assert.equal(loan.balance, 1000 - 20 * flows[1].done);
  assert.equal(flows[2].done, 2);
  assert.equal(gold.quantity, 3);
  assert.equal(bank.balance, 100 + 50 * n - 20 * flows[1].done - 20);
});

test('valuation: market, adjust %, USD-priced metal, fallbacks and statuses', () => {
  const now = Date.now();
  const q = { 'tgju:geram18': { price: 100, changePct: 0.02, at: now }, 'tgju:price_dollar_rl': { price: 1000, at: now }, 'tgju:base_global_copper': { price: 10000, at: now } };
  const g = { id: 'x', category: 'gold', mode: 'units', quantity: 2, price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, adjustPct: -1, factor: 1, last: { price: 50, at: 1 } } };
  const v = E.valueOf(g, q, {});
  assert.equal(v.value, 198); assert.equal(v.status, 'live');
  close(v.dayChange, 198 * 0.02 / 1.02, 1e-9);
  const v2 = E.valueOf(g, {}, {});
  assert.equal(v2.value, 100); assert.equal(v2.status, 'delayed');
  const v3 = E.valueOf({ ...g, price: { ...g.price, last: null, value: null } }, { 'tgju:geram18': { price: 0, error: 'HTTP 403' } }, {});
  assert.equal(v3.status, 'error'); assert.equal(v3.error, 'HTTP 403');
  // copper: 10,000 USD/ton × 1000 rial × 0.001 → 10,000 rial per kg
  const cu = { id: 'c', category: 'metal', mode: 'units', quantity: 5, price: { source: 'market', ref: { provider: 'tgju', key: 'base_global_copper' }, factor: 0.001 } };
  assert.equal(E.valueOf(cu, q, {}).value, 50_000);
  assert.equal(E.exposureOf(cu), 'commodity');
  // stale quote with error but old price → delayed, not error
  const q2 = { 'tgju:geram18': { price: 100, error: 'timeout', at: now } };
  assert.equal(E.valueOf(g, q2, {}).status, 'delayed');
});

test('gold ETF exposure and scenario simulator', () => {
  const now = Date.now();
  const q = { 'tgju:geram18': { price: 100, at: now }, 'tgju:price_dollar_rl': { price: 1000, at: now } };
  const etf = { id: 'e', name: 'صندوق طلای «زر»', category: 'stock', mode: 'units', quantity: 1, price: { source: 'manual', value: 100 } };
  assert.equal(E.exposureOf(etf), 'gold');
  const assets = [
    { id: 'usd', category: 'fx', mode: 'units', quantity: 1, price: { source: 'manual', value: 1000 } },
    { id: 'gold', category: 'gold', mode: 'units', quantity: 10, price: { source: 'manual', value: 100 } },
    { id: 'bank', category: 'bank', mode: 'balance', balance: 1000 },
    { id: 'priv', category: 'private', mode: 'balance', balance: 1000 },
    { id: 'debt', category: 'debt', mode: 'balance', balance: 500 },
  ];
  const s = E.simulate(assets, q, {}, { usd: 0.3, gold: -0.1, private: 0.5 });
  // usd 1000→1300, gold 1000→1170, bank 1000, priv 1500, debt -500
  close(s.after, 1300 + 1170 + 1000 + 1500 - 500, 1e-6);
  close(s.before, 3500, 1e-6);
  close(s.usdAfter, s.after / 1300, 1e-9);
});

test('attribution separates market moves from money moved', () => {
  const y = J.addDaysIso(iso, -1);
  const assets = [
    { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1500 },
    { id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, price: { source: 'manual', value: 120 } },
  ];
  const snaps = { [y]: { t: 2000, v: { b: 1000, g: 1000 } } };
  const events = [{ kind: 'flow', date: iso, amount: 500, toId: 'b', fromId: null, changes: [] }];
  const at = E.attribution(assets, {}, {}, snaps, events, 1);
  assert.equal(at.total, 700);
  assert.equal(at.external, 500);
  assert.equal(at.market, 200);
  assert.equal(at.rows.find((r) => r.id === 'g').market, 200);
  assert.equal(at.rows.find((r) => r.id === 'b').market, 0);
});

test('history reconstruction rolls back events and uses daily prices', () => {
  const d2 = J.addDaysIso(iso, -2), d1 = J.addDaysIso(iso, -1);
  const assets = [
    { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1500 },
    { id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 2, price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
  ];
  const events = [{ kind: 'flow', date: d1, amount: 500, toId: 'b', changes: [{ assetId: 'b', field: 'balance', delta: 500 }] }];
  const quotes = { 'tgju:geram18': { price: 300, at: Date.now() } };
  const hist = { 'tgju:geram18': [{ date: J.addDaysIso(iso, -3), close: 100 }, { date: d1, close: 200 }] };
  const snaps = E.reconstructHistory(assets, events, hist, quotes, {}, 3);
  assert.equal(snaps[d1].t, 1500 + 2 * 200);
  assert.equal(snaps[d2].t, 1000 + 2 * 100, 'flow on d1 is rolled back and price forward-filled from d-3');
  assert.equal(snaps[d1].est, 1);
});

test('crypto: nobitex POST→GET, then tgju USD × dollar fallback', async () => {
  const calls = [];
  P.setFetch(async (url, init) => {
    calls.push((init?.method || 'GET') + ' ' + url);
    if (url.includes('nobitex')) return new Response('blocked', { status: 403 });
    if (url.includes('ajax.json')) return new Response(JSON.stringify({ current: { price_dollar_rl: { p: '2,500,000', dp: 1, dt: 'high', ts: '2026-10-01 10:00:00' } } }));
    if (url.includes('summary-table-data/crypto-bitcoin')) return new Response(JSON.stringify({ data: [['1', '1', '1', '80,000', '<span class="high">1</span>', '<span class="high">2%</span>', '2026/09/30', '']] }));
    return new Response('nope', { status: 404 });
  });
  const { quotes, errors } = await P.fetchAll([{ provider: 'nobitex', key: 'btc' }]);
  assert.ok(calls.some((c) => c.startsWith('POST https://api.nobitex.ir/market/stats')), 'POST tried first');
  assert.ok(calls.some((c) => c.startsWith('GET https://api.nobitex.ir/market/stats?')), 'GET retried');
  assert.equal(quotes['nobitex:btc'].price, 80_000 * 2_500_000);
  assert.ok(quotes['nobitex:btc'].approx);
  close(quotes['nobitex:btc'].changePct, 1.02 * 1.01 - 1, 1e-9);
  assert.deepEqual(errors, {});
});

test('nobitex success path (POST)', async () => {
  P.setFetch(async (url, init) => {
    if (url.includes('nobitex') && init?.method === 'POST') return new Response(JSON.stringify({ status: 'ok', stats: { 'btc-rls': { latest: '2000000000', dayChange: '-1.5', isClosed: false } } }));
    return new Response(JSON.stringify({ current: {} }));
  });
  const { quotes } = await P.fetchAll([{ provider: 'nobitex', key: 'btc' }], { tgju: false });
  assert.equal(quotes['nobitex:btc'].price, 2e9);
  close(quotes['nobitex:btc'].changePct, -0.015, 1e-12);
});

test('tgju table fallback uses the row date for staleness', async () => {
  P.setFetch(async (url) => {
    if (url.includes('ajax.json')) return new Response(JSON.stringify({ current: {} }));
    return new Response(JSON.stringify({ data: [['1', '1', '1', '253,580,000', '<span class="low">9</span>', '<span class="low">0.4%</span>', '2026/06/16', '']] }));
  });
  const { quotes } = await P.fetchAll([{ provider: 'tgju', key: 'geram18' }]);
  const q = quotes['tgju:geram18'];
  assert.equal(q.price, 253580000); assert.ok(q.changePct < 0);
  assert.ok(q.at < Date.now() - 30 * 86400000, 'old row date → old timestamp');
});

test('percentify hides amounts; words for numbers', () => {
  const p = E.percentify({ net: 1000, change: { abs: 50, pct: 0.05 }, drivers: [{ name: 'طلا', market: 30 }] }, 1000);
  assert.equal(p.change.abs_pct_of_net, 5);
  assert.equal(p.drivers[0].market_pct_of_net, 3);
  assert.ok(!('net' in p));
  assert.equal(numToWordsFa(2_100_000_000), 'دو میلیارد و صد میلیون');
  assert.equal(parseNum('۲٫۵ میلیارد'), 2.5e9);
});

test('weeklyFacts produces a coherent summary', () => {
  const y = J.addDaysIso(iso, -7);
  const st = { assets: [{ id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1100 }], quotes: {}, settings: {}, snapshots: { [y]: { t: 1000, v: { b: 1000 } } }, events: [], flows: [] };
  const f = E.weeklyFacts(st);
  assert.equal(f.change.abs, 100);
  assert.equal(f.net, 1100);
});

import * as AI from '../../extension/lib/ai.js';

test('attribution uses snapshot time for real snapshots (late-evening events)', () => {
  const y = J.addDaysIso(iso, -1);
  const snapAt = Date.now() - 3600_000;
  const assets = [{ id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1500 }];
  const snaps = { [y]: { t: 1000, v: { b: 1000 }, at: snapAt } };
  // dated yesterday but applied after the snapshot → still a flow
  const at = E.attribution(assets, {}, {}, snaps, [{ kind: 'flow', date: y, at: snapAt + 1000, amount: 500, toId: 'b', changes: [] }], 1);
  assert.equal(at.external, 500); assert.equal(at.market, 0);
});

test('AI: endpoint normalisation for different services', () => {
  assert.equal(AI.endpoint({ api: 'openai', baseUrl: 'https://api.openai.com' }, '/chat/completions'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(AI.endpoint({ api: 'openai', baseUrl: 'https://openrouter.ai/api/v1/' }, '/chat/completions'), 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(AI.endpoint({ api: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, '/messages'), 'https://api.anthropic.com/v1/messages');
  assert.equal(AI.permissionPattern('http://localhost:11434/v1'), 'http://localhost:11434/*');
});

test('AI: Anthropic tool loop (native) with tool_result messages', async () => {
  const bodies = [];
  AI.setAIFetch(async (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    assert.equal(init.headers['x-api-key'], 'k'); assert.ok(url.endsWith('/v1/messages'));
    const hasResult = b.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result'));
    const content = hasResult ? [{ type: 'text', text: 'نتیجه: ۱۰٪' }] : [{ type: 'tool_use', id: 'tu1', name: 'calc', input: { x: 2 } }];
    return new Response(JSON.stringify({ model: 'claude-x', content, stop_reason: hasResult ? 'end_turn' : 'tool_use' }));
  });
  let ran = null;
  const r = await AI.runAgent({ ai: { connections: [{ id: 'c', service: 'anthropic', api: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'm' }], activeId: 'c', fallback: true },
    system: 'sys', messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'calc', description: 'd', schema: { type: 'object', properties: { x: { type: 'number' } } }, run: (a) => { ran = a; return { y: a.x * 5 }; } }] });
  assert.deepEqual(ran, { x: 2 });
  assert.equal(r.text, 'نتیجه: ۱۰٪');
  assert.equal(bodies[0].system, 'sys');
  assert.equal(bodies[1].messages[1].content[0].type, 'tool_use');
  assert.equal(bodies[1].messages[2].content[0].type, 'tool_result');
});

test('AI: text-protocol fallback when the model rejects tools, and connection fallback', async () => {
  let calls = 0;
  AI.setAIFetch(async (url, init) => {
    calls++;
    const b = JSON.parse(init.body);
    if (url.includes('bad.example')) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 });
    if (b.tools) return new Response(JSON.stringify({ error: { message: 'tools are not supported for this model' } }), { status: 400 });
    const last = b.messages[b.messages.length - 1].content;
    const content = String(last).includes('[نتیجه ابزار') ? 'پاسخ نهایی' : '<<tool>>{"name":"calc","args":{"x":3}}<</tool>>';
    return new Response(JSON.stringify({ model: 'm', choices: [{ message: { role: 'assistant', content } }] }));
  });
  const updates = [];
  const ai = { connections: [{ id: 'a', service: 'custom', api: 'openai', baseUrl: 'https://bad.example/v1', apiKey: 'k', model: 'm' }, { id: 'b', service: 'custom', api: 'openai', baseUrl: 'https://good.example/v1', apiKey: 'k', model: 'm' }], activeId: 'a', fallback: true };
  let got = null;
  const r = await AI.runAgent({ ai, system: 's', messages: [{ role: 'user', content: 'q' }], onConnUpdate: (id, p) => updates.push([id, p]),
    tools: [{ name: 'calc', description: 'd', schema: { type: 'object', properties: {} }, run: (a) => { got = a; return { ok: 1 }; } }] });
  assert.equal(r.text, 'پاسخ نهایی'); assert.equal(r.conn.id, 'b'); assert.equal(r.mode, 'text');
  assert.deepEqual(got, { x: 3 });
  assert.deepEqual(updates, [['b', { supportsTools: false }]]);
});

test('AI: masking sensitive numbers keeps amounts', () => {
  const t = AI.maskSensitive('کارت 6037-9918-1234-5678 شبا IR12 3456 7890 1234 5678 9012 34 موبایل 09121234567 مانده 4,321,000,000');
  assert.ok(!t.includes('6037')); assert.ok(!t.includes('09121234567')); assert.ok(!/IR12/.test(t)); assert.ok(t.includes('4,321,000,000'));
});

test('stablecoins behave like dollars in scenarios', () => {
  const usdt = { id: 't', category: 'crypto', mode: 'units', quantity: 1, price: { source: 'market', ref: { provider: 'nobitex', key: 'usdt' } } };
  assert.equal(E.exposureOf(usdt), 'fx');
  assert.equal(E.shockFactor(usdt, { usd: 0.2, crypto: -0.5 }), 1.2);
});

test('crypto: coins added from search price via Nobitex in their own batch, else CoinGecko × dollar', async () => {
  const calls = [];
  P.setFetch(async (url, init) => {
    calls.push((init?.method || 'GET') + ' ' + url + ' ' + (init?.body || ''));
    if (url.includes('nobitex')) {
      const body = init?.body || url;
      if (body.includes('pepe')) return new Response(JSON.stringify({ status: 'failed', message: 'unknown currency' }));
      return new Response(JSON.stringify({ status: 'ok', stats: { 'btc-rls': { latest: '2000000000', dayChange: '1', isClosed: false } } }));
    }
    if (url.includes('ajax.json')) return new Response(JSON.stringify({ current: { price_dollar_rl: { p: '1,000,000', dp: 0, dt: 'high', ts: '2026-10-01 10:00:00' } } }));
    if (url.includes('api.coingecko.com/api/v3/simple/price')) { assert.ok(url.includes('ids=pepe')); return new Response(JSON.stringify({ pepe: { usd: 0.00002, usd_24h_change: 5 } })); }
    return new Response('nope', { status: 404 });
  });
  const { quotes, errors } = await P.fetchAll([{ provider: 'nobitex', key: 'btc' }, { provider: 'nobitex', key: 'pepe', name: 'Pepe', sym: 'PEPE', cg: 'pepe' }]);
  assert.equal(quotes['nobitex:btc'].price, 2e9, 'catalog coin unaffected by the unknown one');
  close(quotes['nobitex:pepe'].price, 0.00002 * 1_000_000, 1e-9);
  assert.equal(quotes['nobitex:pepe'].source, 'coingecko');
  assert.ok(quotes['nobitex:pepe'].approx);
  close(quotes['nobitex:pepe'].changePct, 0.05, 1e-9);
  assert.deepEqual(errors, {});
  const nb = calls.filter((c) => c.startsWith('POST https://api.nobitex.ir'));
  assert.ok(nb.some((c) => c.includes('srcCurrency=btc&')) && nb.some((c) => c.includes('srcCurrency=pepe&')), 'separate batches');
});

test('crypto: catalog coin without a tgju slug falls through to CoinGecko', async () => {
  P.setFetch(async (url) => {
    if (url.includes('nobitex')) return new Response('blocked', { status: 403 });
    if (url.includes('ajax.json')) return new Response(JSON.stringify({ current: { price_dollar_rl: { p: '1,000,000', dp: 0, dt: 'high', ts: '2026-10-01 10:00:00' } } }));
    if (url.includes('simple/price')) return new Response(JSON.stringify({ 'avalanche-2': { usd: 30, usd_24h_change: -2 } }));
    return new Response('nope', { status: 404 });
  });
  const { quotes } = await P.fetchAll([{ provider: 'nobitex', key: 'avax' }]);
  assert.equal(quotes['nobitex:avax'].price, 30_000_000);
});

test('crypto search: Persian names hit the catalog, Latin text adds CoinGecko results', async () => {
  P.setFetch(async (url) => {
    if (url.includes('/search?query=')) return new Response(JSON.stringify({ coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', market_cap_rank: 1 }, { id: 'bitcoin-gold', name: 'Bitcoin Gold', symbol: 'BTG', market_cap_rank: 900 }] }));
    return new Response('nope', { status: 404 });
  });
  const fa = await P.cryptoSearch('بیت');
  assert.ok(fa.items.some((c) => c.key === 'btc' && c.catalog));
  const en = await P.cryptoSearch('bitcoin');
  assert.ok(en.items.find((c) => c.key === 'btc').catalog, 'catalog entry first');
  assert.ok(en.items.some((c) => c.cg === 'bitcoin-gold' && c.key === 'btg'));
  assert.equal(en.items.filter((c) => c.cg === 'bitcoin').length, 1, 'no duplicate of a catalog coin');
});

test('capture: broker portfolio — symbol fallback match, new holdings priced from TSETMC with cost basis', () => {
  const assets = [
    { id: 'z', name: 'صندوق طلای «زر»', category: 'stock', mode: 'units', quantity: 100, price: { source: 'market', ref: { provider: 'tsetmc', key: '1', symbol: 'زر', label: 'زر', field: 'close' } } },
    { id: 'b', name: 'حساب بانکی الف', category: 'bank', mode: 'balance', balance: 5 },
  ];
  const json = { site: 'کارگزاری نمونه', currency_unit: 'rial', items: [
    { label: 'زر', kind: 'quantity', amount: 120, unit: 'واحد', type: 'stock', symbol: 'زر', match_id: null, confidence: 0.99 },
    { label: 'شستا', kind: 'quantity', amount: 5000, unit: 'سهم', type: 'stock', symbol: 'شستا', avg_cost: 1200, match_id: null, confidence: 0.97 },
    { label: 'عسکه۵', kind: 'quantity', amount: 10, unit: 'واحد', type: 'coin', symbol: 'عسكه5', match_id: null, confidence: 0.93 },
    { label: 'قدرت خرید', kind: 'balance', amount: 3_000_000, unit: 'ریال', type: 'cash', symbol: null, match_id: null, confidence: 0.99 },
  ] };
  const props = A.captureProposals(json, assets, {}, {});
  assert.equal(props[0].assetId, 'z', 'matched by ticker even though the model returned no match_id');
  assert.equal(props[0].field, 'quantity'); assert.equal(props[0].value, 120);
  assert.equal(props[1].assetId, null); assert.equal(props[1].category, 'stock'); assert.equal(props[1].avgCost, 1200);
  const shasta = A.newAssetFromCapture(props[1], { site: json.site, category: props[1].category });
  assert.equal(shasta.price.ref.provider, 'tsetmc'); assert.equal(shasta.price.ref.symbol, 'شستا'); assert.equal(shasta.price.ref.key, '');
  assert.equal(shasta.costBasis, 6_000_000); assert.equal(shasta.custodian, 'کارگزاری نمونه'); assert.equal(shasta.name, 'شستا');
  assert.equal(props[2].category, 'stock', 'coin certificate units trade on the exchange');
  const coin = A.newAssetFromCapture(props[2], { category: props[2].category });
  assert.equal(coin.price.ref.symbol, 'عسکه5');
  assert.equal(E.exposureOf(coin), 'gold', 'coin certificates count as gold');
  const cash = A.newAssetFromCapture(props[3], { category: props[3].category });
  assert.equal(cash.mode, 'balance'); assert.equal(cash.balance, 3_000_000); assert.equal(cash.category, 'bank');
});

/* ======================= v1.3: explain, performance, break-even, new money, NL helpers ======================= */
import * as IN from '../../extension/lib/insights.js';

test('explain: market units (USD-priced metal), payout deposit and bank interest show the real calculation', () => {
  const now = Date.now();
  const quotes = { 'tgju:base_global_copper': { price: 10_000, at: now }, 'tgju:price_dollar_rl': { price: 1_000_000, at: now } };
  const cu = { id: 'c', name: 'مس', category: 'metal', mode: 'units', quantity: 50, unit: 'کیلوگرم', price: { source: 'market', ref: { provider: 'tgju', key: 'base_global_copper' }, factor: 0.001 } };
  const ex = IN.explainAsset(cu, quotes, {});
  const by = (t) => ex.lines.find((l) => l.t.startsWith(t));
  assert.equal(by('قیمت بازار').k, 'usd'); assert.equal(by('قیمت بازار').v, 10_000);
  assert.equal(by('ضرب در نرخ دلار').v, 1_000_000);
  assert.equal(by('ضریب تبدیل').v, 0.001);
  assert.equal(by('قیمت هر واحد').v, 10_000 * 1_000_000 * 0.001);
  assert.equal(ex.lines.at(-1).v, 50 * 10_000_000);
  assert.equal(ex.value, 50 * 10_000_000);
  const today = J.todayIso();
  const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1_000_000_000, annualPct: 24, start: J.addDaysIso(today, -10), mode: 'payout', basis: 365 } };
  const ed = IN.explainAsset(dep, {}, {});
  const acc = ed.lines.find((l) => l.t === 'سود انباشته').v;
  // 10 full days plus the live fraction of today
  assert.ok(acc >= 1e9 * 0.24 * 10 / 365 - 1 && acc <= 1e9 * 0.24 * 11 / 365 + 1, String(acc));
  assert.match(ed.formula, /آخرین واریز ماهانه/);
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1e9, interest: { on: true, annualPct: 10, basis: 365, lastAccrual: J.addDaysIso(today, -1), accrued: 500_000 } };
  const eb = IN.explainAsset(bank, {}, {});
  assert.ok(eb.lines.some((l) => l.t.startsWith('سود انباشته') && l.v >= 500_000));
  assert.equal(eb.lines.at(-1).v, eb.value);
});

test('explainNet adds categories up to gross and subtracts debt', () => {
  const assets = [
    { id: 'b', name: 'b', category: 'bank', mode: 'balance', balance: 700, balanceAt: Date.now() },
    { id: 'g', name: 'g', category: 'gold', mode: 'units', quantity: 1, price: { source: 'manual', value: 300, updatedAt: Date.now() } },
    { id: 'l', name: 'l', category: 'debt', mode: 'balance', balance: 100, balanceAt: Date.now() },
  ];
  const pf = E.portfolio(assets, {}, {});
  const ex = IN.explainNet(pf);
  assert.equal(ex.lines.find((l) => l.t === 'جمع دارایی‌ها').v, 1000);
  assert.equal(ex.lines.at(-1).v, 900);
  assert.equal(ex.lines.filter((l) => !l.strong && !l.total).reduce((x, l) => x + l.v, 0), 900);
});

test('performance: salary is not return; benchmarks replay the same money into gold, dollar and deposit', () => {
  const today = J.todayIso();
  const d0 = J.addDaysIso(today, -90), d1 = J.addDaysIso(today, -30);
  const P0 = 100, Pm = 110, P1 = 120; // gold price per gram (also the 18k benchmark rate)
  const U0 = 50, Um = 50, U1 = 60;
  const now = Date.now();
  const assets = [
    { id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
    { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1000 + 300, balanceAt: now },
  ];
  const quotes = { 'tgju:geram18': { price: P1, at: now }, 'tgju:price_dollar_rl': { price: U1, at: now } };
  const snapshots = {
    [d0]: { t: 10 * P0 + 1000, v: { g: 10 * P0, b: 1000 }, gold: P0, usd: U0, est: 1 },
    [d1]: { t: 10 * Pm + 1000, v: { g: 10 * Pm, b: 1000 }, gold: Pm, usd: Um, est: 1 },
  };
  const events = [{ id: 'e', kind: 'flow', date: d1, at: now - 30 * 864e5, title: 'حقوق', amount: 300, fromId: null, toId: 'b' }];
  const st = { assets, quotes, settings: {}, snapshots, events };
  const r = IN.performance(st, 90, { depositPct: 20 });
  assert.equal(r.from, d0);
  close(r.market, 10 * (P1 - P0), 1e-6);
  close(r.moneyIn, 300, 1e-6);
  close(r.ret, 200 / (2000 + 300 * (30 / 90)), 1e-9);
  const g = r.bench.find((b) => b.id === 'gold'); const u = r.bench.find((b) => b.id === 'usd'); const d = r.bench.find((b) => b.id === 'deposit');
  close(g.end, 2000 * (P1 / P0) + 300 * (P1 / Pm), 1e-6);
  close(u.end, 2000 * (U1 / U0) + 300 * (U1 / Um), 1e-6);
  const dep = (days) => Math.pow(1 + 0.2 / 12, days * 12 / 365);
  close(d.end, 2000 * dep(90) + 300 * dep(30), 1e-6);
  close(g.diff, 2500 - g.end, 1e-6);
  assert.equal(r.end, 2500);
  // a 365-day request with 90 days of history falls back to the whole history
  const all = IN.performance(st, 365, { depositPct: 20 });
  assert.ok(all.partial); assert.equal(all.from, d0);
});

test('attribution: deleting an asset is a bookkeeping change, not a market loss', () => {
  const today = J.todayIso();
  const d0 = J.addDaysIso(today, -7);
  const assets = [{ id: 'b', name: 'b', category: 'bank', mode: 'balance', balance: 1000, balanceAt: Date.now() }];
  const snapshots = { [d0]: { t: 1500, v: { b: 1000, gone: 500 }, est: 1 } };
  const at = E.attribution(assets, {}, {}, snapshots, [], 7, today);
  close(at.market, 0, 1e-9);
  close(at.edits, -500, 1e-9);
});

test('break-even: deposit vs asset with fees', () => {
  const r = IN.breakEven({ price0: 1000, ratePct: 24, months: 6, feePct: 2 });
  const dg = Math.pow(1.02, 6); // 2% a month, re-deposited
  close(r.depositGain, dg - 1, 1e-12);
  close(r.needed, dg / 0.98 - 1, 1e-12);
  close(r.targetPrice, 1000 * dg / 0.98, 1e-9);
  close(r.annualNeeded, Math.pow(dg / 0.98, 2) - 1, 1e-12);
  // the annual rate needed is never below the deposit's own effective rate
  const long = IN.breakEven({ price0: 1, ratePct: 25, months: 24 });
  assert.ok(long.annualNeeded >= 0.25, String(long.annualNeeded));
  const z = IN.breakEven({ price0: 0, ratePct: 24, months: 12 });
  assert.equal(z.targetPrice, null);
});

test('new money fills the shortfalls first and never sells', () => {
  const now = Date.now();
  const assets = [
    { id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 2, price: { source: 'manual', value: 100, updatedAt: now } },
    { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 800, balanceAt: now },
  ];
  const pf = E.portfolio(assets, {}, {});
  const a = IN.allocateNew(pf, { gold: 0.5, bank: 0.5 }, 400);
  close(a.rows.find((r) => r.id === 'gold').add, 400, 1e-9);
  close(a.rows.find((r) => r.id === 'bank').add, 0, 1e-9);
  assert.equal(a.rows.find((r) => r.id === 'gold').vehicle.id, 'g');
  const b = IN.allocateNew(pf, { gold: 0.5, bank: 0.5 }, 1000);
  close(b.rows.find((r) => r.id === 'gold').add, 800, 1e-9);
  close(b.rows.find((r) => r.id === 'bank').add, 200, 1e-9);
  close(b.maxDevAfter, 0, 1e-12);
  // targets below 100% are used as entered (not scaled up); gold 20% of 2000 = 400 → +200, the rest by weight
  const c = IN.allocateNew(pf, { gold: 0.2, bank: 0.2 }, 1000);
  close(c.rows.find((r) => r.id === 'gold').target, 0.2, 1e-12);
  close(c.rows.find((r) => r.id === 'gold').add, 200 + 800 * 0.5, 1e-9);
  close(c.rows.reduce((x, r) => x + r.add, 0), 1000, 1e-9);
  const over = IN.allocateNew(pf, { gold: 0.8, bank: 0.8 }, 1000); // above 100% is scaled down
  close(over.rows.find((r) => r.id === 'gold').target, 0.5, 1e-12);
  assert.equal(IN.allocateNew(pf, {}, 1000), null);
  assert.equal(IN.allocateNew(pf, { gold: 1 }, 0), null);
});

test('NL scenario: clamped to slider ranges, reasons kept', () => {
  const sc = A.parseScenario({ title: 'توافق', shocks: { usd: -25, equity: 30, gold: 500, crypto: 'x' }, reasons: { usd: 'ارز ارزان‌تر', equity: 'خوش‌بینی', gold: 'بی‌ربط' } });
  assert.deepEqual(sc.shocks, { usd: -25, gold: 100, equity: 30, crypto: 0, metals: 0, private: 0, real: 0, bubble: 0 });
  // the bubble variable is clamped to −100…+100 like the slider
  assert.equal(A.parseScenario({ shocks: { bubble: -250 } }).shocks.bubble, -100);
  assert.equal(sc.assumptions.find((x) => x.key === 'gold').clamped, true);
  assert.equal(sc.assumptions.find((x) => x.key === 'usd').reason, 'ارز ارزان‌تر');
  assert.equal(sc.assumptions.length, 3);
  assert.equal(A.parseCritique({ points: [{ title: 'تمرکز', detail: 'x', level: 'weird' }, {}] }).length, 1);
  assert.equal(A.parseCritique({ points: [{ title: 'تمرکز', level: 'weird' }] })[0].level, 'mid');
});

test('one-sentence entry: validated against real assets, toman → rial, market price when missing', () => {
  const now = Date.now();
  const assets = [
    { id: 'g', name: 'طلای آب‌شده', category: 'gold_online', mode: 'units', quantity: 5, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
    { id: 'b', name: 'حساب الف', category: 'bank', mode: 'balance', balance: 1e9, balanceAt: now },
    { id: 'c', name: 'حساب ب', category: 'bank', mode: 'balance', balance: 1e8, balanceAt: now },
  ];
  const quotes = { 'tgju:geram18': { price: 250_000_000, at: now }, 'tgju:sekee': { price: 2_500_000_000, at: now } };
  const json = { actions: [
    { type: 'trade', asset_id: 'g', side: 'buy', quantity: 2, unit_price: 25_000_000, money_unit: 'toman', cash_asset_id: 'b' },
    { type: 'trade', asset_id: 'g', side: 'sell', quantity: 1, unit_price: null, total: null, money_unit: 'toman', cash_asset_id: null },
    { type: 'trade', asset_id: 'g', side: 'sell', quantity: 50 },
    { type: 'trade', asset_id: null, side: 'buy', quantity: 1, total: 260_000_000, money_unit: 'toman', new_asset: { kind: 'coin_emami', name: 'سکه امامی' } },
    { type: 'cash', asset_id: 'b', direction: 'out', amount: 5_000_000, money_unit: 'toman', note: 'خرج' },
    { type: 'transfer', from_id: 'b', to_id: 'c', amount: 1_000_000, money_unit: 'rial' },
    { type: 'set', asset_id: 'nope', field: 'balance', value: 1 },
  ] };
  const r = A.quickProposals(json, assets, quotes, { idFor: () => 'new1' });
  const [buy, sell, coin, cash, tr] = r.proposals;
  assert.equal(buy.type, 'trade'); assert.equal(buy.price, 250_000_000); assert.equal(buy.cashId, 'b');
  assert.equal(sell.side, 'sell'); assert.equal(sell.price, 250_000_000); assert.ok(sell.priceFromMarket);
  assert.equal(coin.type, 'newbuy'); assert.equal(coin.asset.price.ref.key, 'sekee'); assert.equal(coin.asset.id, 'new1'); assert.equal(coin.price, 2_600_000_000);
  assert.equal(cash.type, 'adjust'); assert.equal(cash.delta, -50_000_000);
  assert.equal(tr.type, 'transfer'); assert.equal(tr.amount, 1_000_000);
  assert.equal(r.proposals.length, 5);
  assert.equal(r.problems.length, 2, r.problems.join(' | '));
});

test('attribution/performance: realised gains survive deletion; new assets bought with cash earn market return; removals dated', () => {
  const today = J.todayIso();
  const d0 = J.addDaysIso(today, -90), d60 = J.addDaysIso(today, -60), d59 = J.addDaysIso(today, -59), d89 = J.addDaysIso(today, -89);
  const now = Date.now();
  // A) gold 1000 sold for 1300 into the bank, then deleted (removal recorded at value 0)
  {
    const assets = [{ id: 'b', name: 'b', category: 'bank', mode: 'balance', balance: 1300, balanceAt: now }];
    const snapshots = { [d0]: { t: 1000, v: { g: 1000, b: 0 }, est: 1 } };
    const events = [
      { id: 'e1', kind: 'trade', date: J.addDaysIso(today, -2), amount: 1300, fromId: 'g', toId: 'b' },
      { id: 'e2', kind: 'edit', date: J.addDaysIso(today, -1), amount: 0, changes: [{ assetId: 'g', field: 'remove', delta: 0, value: -0 }] },
    ];
    const at = E.attribution(assets, {}, {}, snapshots, events, 90, today);
    close(at.market, 300, 1e-9);
    const r = IN.performance({ assets, quotes: {}, settings: {}, snapshots, events }, 90, { depositPct: 20 });
    close(r.market, 300, 1e-9); close(r.moneyIn, 0, 1e-9);
  }
  // B) 2000 in the bank; 60 days ago 1000 bought 10 g of gold (new asset); gold now 150/g
  {
    const assets = [
      { id: 'b', name: 'b', category: 'bank', mode: 'balance', balance: 1000, balanceAt: now },
      { id: 'g', name: 'g', category: 'gold', mode: 'units', quantity: 10, createdAt: now - 60 * 864e5, price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
    ];
    const quotes = { 'tgju:geram18': { price: 150, at: now } };
    const snapshots = { [d0]: { t: 2000, v: { b: 2000 }, gold: 100, est: 1 }, [d59]: { t: 2000, v: { b: 1000, g: 1000 }, gold: 100, est: 1 } };
    const events = [{ id: 't', kind: 'trade', date: d60, amount: 1000, fromId: 'b', toId: 'g' }];
    const st = { assets, quotes, settings: {}, snapshots, events };
    const r = IN.performance(st, 90, { depositPct: 20 });
    close(r.market, 500, 1e-9);
    close(r.moneyIn, 0, 1e-6);
    const g = r.bench.find((x) => x.id === 'gold');
    close(g.end, 2000 * 1.5, 1e-6); // the same 2000 held in gold from the start
    close(g.diff, -500, 1e-6);
  }
  // C) 2000 a year ago, 1000 of it deleted the next day (older data: no removal record), gold doubled
  {
    const assets = [{ id: 'b', name: 'b', category: 'bank', mode: 'balance', balance: 1000, balanceAt: now }];
    const snapshots = { [d0]: { t: 2000, v: { b: 1000, x: 1000 }, gold: 100, est: 1 }, [d89]: { t: 2000, v: { b: 1000, x: 1000 }, gold: 100, est: 1 } };
    const quotes = { 'tgju:geram18': { price: 200, at: now } };
    const r = IN.performance({ assets, quotes, settings: {}, snapshots, events: [] }, 90, { depositPct: 20 });
    const g = r.bench.find((x) => x.id === 'gold');
    close(g.end, 2000 * 2 - 1000 * 2, 1e-6); // removed the day after its last snapshot, at that day's gold rate
    close(r.market, 0, 1e-9);
  }
});

test('assistant tools respect percent privacy for prices and plans', () => {
  const now = Date.now();
  const st = { assets: [{ id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
                        { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 5e9, balanceAt: now }],
    quotes: { 'tgju:geram18': { price: 250_000_000, at: now } }, settings: { currency: 'toman', targets: { gold: 50, bank: 50 } }, snapshots: {}, events: [], flows: [], alerts: [] };
  const tools = A.makeTools({ getState: () => st, privacy: 'percent' });
  const ex = tools.find((t) => t.name === 'explain_value').run({ asset_id: 'g' });
  const price = ex.lines.find((l) => l.label.startsWith('قیمت بازار'));
  assert.equal(price.amount, 25_000_000, 'public price stays absolute');
  const value = ex.lines.find((l) => l.label === 'ارزش');
  assert.ok(value.pct_of_net !== undefined && value.amount === undefined);
  assert.ok(!ex.lines.some((l) => 'quantity' in l));
  const plan = tools.find((t) => t.name === 'plan_new_money').run({ amount: 1_000_000_000 });
  assert.ok(!('amount' in plan) && plan.plan.every((x) => !('add' in x) && !('share_now_pct' in x)));
  assert.equal(IN.critiqueFacts(st, E.portfolio([], {}, {})), null, 'nothing to review on an empty portfolio');
});

test('one-sentence entry: running quantity across actions and side words', () => {
  const now = Date.now();
  const assets = [{ id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 5, price: { source: 'manual', value: 100, updatedAt: now } }];
  const r = A.quickProposals({ actions: [
    { type: 'trade', asset_id: 'g', side: 'فروش', quantity: 3, unit_price: 10 },
    { type: 'trade', asset_id: 'g', side: 'sell', quantity: 3, unit_price: 10 },
    { type: 'trade', asset_id: 'g', side: 'SELL', quantity: 1, unit_price: 10 },
    { type: 'trade', asset_id: 'g', side: 'maybe', quantity: 1, unit_price: 10 },
  ] }, assets, {});
  assert.equal(r.proposals.length, 2, JSON.stringify(r.problems)); // 3 sold, the next 3 exceed the 2 left, then 1 is fine
  assert.equal(r.proposals[1].qty, 1);
  assert.equal(r.problems.length, 2);
  const sc = A.parseScenario({ shocks: { usd: 0.2, equity: '-۰٫۱' } });
  assert.equal(sc.shocks.usd, 20); assert.equal(sc.shocks.equity, -10);
});

test('assets: values, signs and totals add up', () => {
  const now = Date.now();
  const assets = [
    { id: 'b', category: 'bank', mode: 'balance', balance: 1000, balanceAt: now },
    { id: 'h', category: 'property', mode: 'balance', balance: 5000, balanceAt: now },
    { id: 'l', category: 'debt', mode: 'balance', balance: 700, balanceAt: now },
    { id: 'ld', category: 'debt', mode: 'rate', rate: { principal: 1000, annualPct: 36.5, start: J.addDaysIso(iso, -10), mode: 'simple' } },
    { id: 'g', category: 'gold', mode: 'units', quantity: 2, costBasis: 150, price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
    { id: 'x', category: 'other', mode: 'balance', balance: 50, archived: true },
  ];
  const quotes = { 'tgju:geram18': { price: 100, changePct: 0.25, at: now } };
  const pf = E.portfolio(assets, quotes, {}, now);
  assert.equal(pf.rows.length, 5, 'archived assets are left out');
  close(pf.gross, 1000 + 5000 + 200, 1e-9);
  close(pf.debt, 700 + 1010, 1.01); // + the live part of today
  close(pf.net, pf.rows.reduce((t, r) => t + r.signedValue, 0), 1e-6);
  const g = pf.rows.find((r) => r.asset.id === 'g');
  close(g.dayChange, 200 * 0.25 / 1.25, 1e-9); close(g.pnl, 50, 1e-9); close(g.ret, 1 / 3, 1e-9);
  const ld = pf.rows.find((r) => r.asset.id === 'ld');
  assert.ok(ld.signedValue < 0 && ld.dayChange < 0, 'a growing loan lowers net worth every day');
  assert.equal(pf.rows.find((r) => r.asset.id === 'l').pnl, null);
});

test('assets: re-appraising a house is a market move; topping up a bank account is money in', () => {
  const now = Date.now();
  const snaps = { [J.addDaysIso(iso, -2)]: { t: 6000, at: now - 2 * 86400000, v: { h: 5000, b: 1000 } } };
  const assets = [{ id: 'h', name: 'خانه', category: 'property', mode: 'balance', balance: 6000, balanceAt: now }, { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1500, balanceAt: now }];
  const events = [{ id: 'e1', kind: 'edit', date: iso, at: now - 1000, title: 'ویرایش', amount: 0, changes: [{ assetId: 'h', field: 'balance', delta: 1000, reval: true }] },
                  { id: 'e2', kind: 'edit', date: iso, at: now - 900, title: 'ویرایش', amount: 0, changes: [{ assetId: 'b', field: 'balance', delta: 500 }] }];
  const at = E.attribution(assets, {}, {}, snaps, events, 1, iso);
  const h = at.rows.find((r) => r.id === 'h'), b = at.rows.find((r) => r.id === 'b');
  close(h.market, 1000, 1e-9); close(h.edit, 0, 1e-9);
  close(b.market, 0, 1e-9); close(b.edit, 500, 1e-9);
  // undo still reverses the appraisal
  const st = structuredClone(assets); E.undoEvent(st, events[0]); assert.equal(st[0].balance, 5000);
});

test('assets: matured deposits ask for attention; appraised assets are reminded quarterly', () => {
  const now = Date.now();
  const r = { principal: 1000, annualPct: 20, start: J.addDaysIso(iso, -100), maturity: J.addDaysIso(iso, -5), mode: 'simple' };
  const v = E.valueOf({ id: 'd', category: 'fixed', mode: 'rate', rate: r }, {}, {}, now);
  assert.equal(v.status, 'matured'); assert.ok(v.error); assert.equal(v.dayChange, 0);
  assert.equal(E.portfolio([{ id: 'd', category: 'fixed', mode: 'rate', rate: r }], {}, {}, now).attention.length, 1);
  assert.equal(E.valueOf({ id: 'd', category: 'fixed', mode: 'rate', rate: { ...r, maturity: J.addDaysIso(iso, 5) } }, {}, {}, now).status, 'auto');
  assert.equal(E.remindDaysFor({ category: 'property', mode: 'balance' }, { remindDays: { balance: 30, price: 7 } }), 90);
  assert.equal(E.remindDaysFor({ category: 'private', mode: 'units' }, { remindDays: { balance: 30, price: 7 } }), 90);
  assert.equal(E.remindDaysFor({ category: 'bank', mode: 'balance' }, { remindDays: { balance: 30, price: 7 } }), 30);
  assert.equal(E.remindDaysFor({ category: 'property', mode: 'balance', remindDays: 7 }, {}), 7);
  const h = E.valueOf({ id: 'h', category: 'property', mode: 'balance', balance: 1, balanceAt: now - 40 * 86400000 }, {}, { remindDays: { balance: 30, price: 7 } }, now);
  assert.equal(h.status, 'manual', 'a 40-day-old house value is not stale yet');
});

test('assets: undo and history rebuild handle removals and method changes', () => {
  const house = { id: 'h', name: 'خانه', category: 'property', mode: 'balance', balance: 900 };
  // a change of valuation method is undone by restoring the previous record, never by arithmetic on «mode»
  const now = [{ id: 'h', name: 'خانه', category: 'property', mode: 'units', quantity: 1, price: { source: 'manual', value: 1000 } }];
  const ev = { kind: 'edit', date: iso, changes: [{ assetId: 'h', field: 'value', delta: 0, value: 100 }], prev: house };
  E.undoEvent(structuredClone(now), ev); // must not throw or write NaN
  const back = E.revertEvent(structuredClone(now), ev);
  assert.deepEqual(back[0], house);
  const st = [];
  E.revertEvent(st, { kind: 'edit', date: iso, restore: house, changes: [{ assetId: 'h', field: 'remove', delta: 0, value: -900 }] });
  assert.equal(st.length, 1, 'going back past a deletion brings the asset back');
  const hist = E.reconstructHistory([], [{ id: 'e', kind: 'edit', date: iso, restore: house, changes: [{ assetId: 'h', field: 'remove', delta: 0, value: -900 }] }], {}, {}, {}, 3, iso);
  assert.equal(hist[J.addDaysIso(iso, -1)].t, 900);
});

test('rate assets: money added or withdrawn mid-way earns only from that day', () => {
  for (const mode of ['simple', 'compound', 'payout']) {
    const a = { id: 'd', category: 'fixed', mode: 'rate', rate: { principal: 1_000_000, annualPct: 20, start: J.addDaysIso(iso, -200), mode } };
    const t = Date.now();
    const v0 = E.rateValue(a.rate, iso, t);
    const ch = E.applyDelta(a, 500_000);
    close(E.rateValue(a.rate, iso, t) - v0, 500_000, 1, `${mode}: value jumps by exactly the money added`);
    // a year later the new money has earned ~20% (simple/payout: on a year; compound: compounded)
    const later = J.addDaysIso(iso, 365);
    if (mode !== 'payout') {
      const base = E.rateValue({ principal: 1_000_000, annualPct: 20, start: J.addDaysIso(iso, -200), mode }, later);
      close(E.rateValue(a.rate, later) - base, 600_000, 300); // less today's elapsed hours
    }
    const back = structuredClone([a]); E.undoEvent(back, { changes: ch });
    close(E.rateValue(back[0].rate, iso, t), v0, 1e-6, `${mode}: undo restores the value`);
  }
  // payout: the next monthly payout pays new money only for the days it was there
  const start = J.addDaysIso(iso, -45);
  const a = { id: 'p', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 3_650_000, annualPct: 10, start, mode: 'payout', payoutTo: 'self' } };
  E.applyAutomations([a], [], {}, J.addDaysIso(iso, -1)); // catch up the payouts until yesterday
  const since = a.rate.lastPayout || start;
  const P0 = a.rate.principal; // earlier payouts were added to it
  E.applyDelta(a, 3_650_000);
  const next = E.nextMonthlyAfter(start, since);
  const p0 = a.rate.principal;
  const { events } = E.applyAutomations([a], [], {}, next);
  const paid = events.find((e) => e.date === next).amount;
  const want = P0 * 0.1 * J.daysBetween(since, next) / 365 + 3_650_000 * 0.1 * J.daysBetween(iso, next) / 365;
  close(paid, want, 1001); // the new money starts earning at this hour, not at midnight
  close(a.rate.principal - p0, paid, 1e-9);
  assert.equal(a.rate.offset, 0, 'offset used up at the payout');
});

test('price-source change made offline: the correction is filled in once the price arrives', () => {
  const a = { id: 'x', category: 'gold', mode: 'units', quantity: 2, price: { source: 'market', ref: { provider: 'tgju', key: 'sekee' }, pendingFix: { eventId: 'e1', before: 300, qty: 2 } } };
  const events = [{ id: 'e1', kind: 'edit', date: iso, changes: [{ assetId: 'x', field: 'value', delta: 0, value: 0, pending: true }] }];
  E.settlePending([a], events, {});
  assert.ok(a.price.pendingFix, 'still waiting without a price');
  E.settlePending([a], events, { 'tgju:sekee': { price: 1000, at: Date.now() } });
  assert.equal(events[0].changes[0].value, 2000 - 300); assert.ok(!events[0].changes[0].pending && !a.price.pendingFix);
});

test('installment loans: bank formula, schedule, value and automatic installments', () => {
  // 100M at 18% over 12 months → standard annuity 9,167,999.29
  const L = { amount: 100_000_000, annualPct: 18, months: 12, firstDue: J.addJMonthsIso(iso, 1) };
  const p = E.loanPlan(L);
  close(p.A, 9_167_999.29, 0.01); assert.equal(p.n, 12);
  close(p.rows.at(-1).balance, 0, 1e-6); close(p.rows.reduce((t, x) => t + x.principal, 0), 100_000_000, 1e-3);
  assert.equal(E.loanPlan({ amount: 12e6, annualPct: 0, months: 12, firstDue: iso }).A, 1e6, 'zero-rate: equal parts');
  // an old loan: 6 installments already passed (incl. today) → owed = schedule balance, nothing accrued yet today
  const L2 = { ...L, firstDue: J.addJMonthsIso(iso, -5) };
  const st = E.loanState(L2, iso);
  assert.equal(st.paid, 6); close(st.owed, st.rows[5].balance, 1e-6); close(st.value, st.owed, 1e-6);
  // a debt in this mode lowers net worth; settled ones count zero
  const debt = { id: 'l', name: 'وام', category: 'debt', mode: 'loan', loan: { ...L2, account: 'b', lastRun: E.loanLastDue(L2, iso) } };
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1e9 };
  const t = Date.now();
  const pf = E.portfolio([debt, bank], {}, {}, t);
  close(pf.net, 1e9 - E.loanState(L2, iso, t).value, 1);
  // installments before tracking aren't replayed; the next one moves money account → loan
  assert.equal(E.applyAutomations([debt, bank], [], {}, iso).events.length, 0);
  const due = st.next.date;
  const { events } = E.applyAutomations([debt, bank], [], {}, due);
  assert.equal(events.length, 1); assert.equal(events[0].kind, 'loan');
  assert.equal(bank.balance, 1e9 - Math.round(st.next.payment));
  assert.equal(events[0].fromId, 'b'); assert.equal(events[0].toId, 'l');
  close(E.loanState(debt.loan, due).value, st.next.balance, 1e-6);
  assert.equal(E.applyAutomations([debt, bank], [], {}, due).events.length, 0, 'never paid twice');
  // upcoming and monthly cash
  assert.ok(E.upcoming([debt], [], 40, iso).some((e) => e.kind === 'loan'));
  close(E.monthlyAuto([debt], []).loanPay, st.next.payment, 1e-6);
});

test('installment loans: the interest is the cost, the installment is a transfer', () => {
  const now = Date.now();
  const L = { amount: 120_000_000, annualPct: 24, months: 12, firstDue: J.addJMonthsIso(iso, -2), account: 'b' };
  const debt = { id: 'l', name: 'وام', category: 'debt', mode: 'loan', loan: { ...L, lastRun: E.loanLastDue(L, J.addDaysIso(iso, -40)) } };
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 500_000_000, balanceAt: now };
  // a snapshot 40 days ago, then the automation pays what fell due since
  const d0 = J.addDaysIso(iso, -40);
  const pf0 = E.portfolio([debt, bank], {}, {}, now, { asOf: d0 });
  const snaps = { [d0]: { ...E.makeSnapshot(pf0, {}), at: now - 40 * 864e5 } };
  const evs = E.applyAutomations([debt, bank], [], {}, iso).events.map((e) => ({ ...e, at: now - 1000 }));
  assert.ok(evs.length >= 1);
  const at = E.attribution([debt, bank], {}, {}, snaps, evs, 40, iso);
  const r = at.rows.find((x) => x.id === 'l');
  close(at.external, 0, 1e-6, 'paid from a tracked account: no money in or out');
  // market effect of the loan = minus the interest that accrued over the period
  const s0 = E.loanState(debt.loan, d0), s1 = E.loanState(debt.loan, iso, now);
  const interest = s1.rows.filter((x) => x.date > d0 && x.date <= iso).reduce((t, x) => t + x.interest, 0) + s1.accrued - s0.accrued;
  close(r.market, -interest, 2);
});

test('installment loans: extra payment, settlement and undo keep the books straight', () => {
  const L = { amount: 50_000_000, annualPct: 20, months: 24, firstDue: J.addJMonthsIso(iso, -3) };
  const a = { id: 'l', name: 'وام', category: 'debt', mode: 'loan', loan: { ...L, lastRun: E.loanLastDue(L, iso) } };
  const t = Date.now();
  const v0 = E.loanState(a.loan, iso, t).value; const n0 = E.loanState(a.loan, iso).n - E.loanState(a.loan, iso).paid;
  const ch = E.applyDelta(a, 10_000_000);
  close(v0 - E.loanState(a.loan, iso, t).value, 10_000_000, 1, 'owed drops by exactly the payment');
  const st = E.loanState(a.loan, iso);
  assert.ok(st.n - st.paid < n0, 'same installment, fewer installments');
  close(st.A, E.loanPlan(L).A, 1e-6);
  // undo brings the old terms back but keeps installments already applied
  a.loan.lastRun = '2999-01-01';
  E.undoEvent([a], { changes: ch });
  close(E.loanState(a.loan, iso, t).value, v0, 1e-6); assert.equal(a.loan.lastRun, '2999-01-01');
  // settle
  E.applyDelta(a, E.loanState(a.loan, iso, Date.now()).value);
  assert.equal(E.valueOf(a, {}, {}).value, 0); assert.equal(E.valueOf(a, {}, {}).status, 'settled');
  assert.equal(E.portfolio([a], {}, {}).attention.length, 0);
  // a receivable: money received lowers it
  const rcv = { id: 'r', name: 'طلب', category: 'receivable', mode: 'loan', loan: { ...L } };
  const r0 = E.loanState(rcv.loan, iso, t).value;
  E.applyDelta(rcv, -5_000_000);
  close(r0 - E.loanState(rcv.loan, iso, t).value, 5_000_000, 1);
  assert.ok(E.valueOf(rcv, {}, {}).signedValue > 0);
});

test('amounts typed the way people say them', () => {
  const cases = { '۱۲ میلیون و ۵۰۰ هزار': 12_500_000, '۲ میلیارد و ۳۰۰ میلیون': 2_300_000_000, '۵ هزار میلیارد': 5e12, '۱۲٬۵۰۰٬۰۰۰': 12_500_000,
    '12 500 000': 12_500_000, '۱٫۵': 1.5, '1.5 میلیون': 1_500_000, '−۳۰۰ هزار': -300_000, '۱ میلیون و ۲۰۰ هزار و ۵۰۰': 1_200_500, '۱۲ میلیون تومان': 12e6 };
  for (const [t, v] of Object.entries(cases)) assert.equal(parseNum(t), v, t);
  assert.ok(Number.isNaN(parseNum('abc')));
});

test('page text sent to AI hides ids but keeps amounts and dates', async () => {
  const { maskSensitive, safeUrl } = await import('../../extension/lib/ai.js');
  const t = maskSensitive('کارت ٦٠٣٧ ٩٩٧٥ ٩٩٤٥ ١٢٣٤ شبا ۱۲۰۱۲۰۰۰۰۰۰۰۰۰۰۱۲۳۴۵۶۷۸۹ موبایل +98 912 345 6789 شماره حساب: 0101-1234567-1 کد ملی ۰۰۱۲۳۴۵۶۷۸ تاریخ ۱۴۰۵/۰۷/۰۹ موجودی ۱۲٬۵۰۰٬۰۰۰ ریال');
  for (const leak of ['6037', '1234567', '912', '0012345678', '120120']) assert.ok(!t.includes(leak), leak + ' leaked: ' + t);
  assert.ok(t.includes('1405/07/09') && t.includes('12٬500٬000'));
  assert.equal(safeUrl('https://x.example/a?token=1#y'), 'https://x.example/a');
});

test('monthly automation: debts cost interest, matured deposits earn nothing, a flow paying a debt is money out', () => {
  const assets = [
    { id: 'b', category: 'bank', mode: 'balance', balance: 1e9 },
    { id: 'd', category: 'fixed', mode: 'rate', rate: { principal: 1200, annualPct: 10, start: J.addDaysIso(iso, -100), mode: 'simple' } },
    { id: 'm', category: 'fixed', mode: 'rate', rate: { principal: 1200, annualPct: 10, start: J.addDaysIso(iso, -400), maturity: J.addDaysIso(iso, -30), mode: 'simple' } },
    { id: 'l', category: 'debt', mode: 'rate', rate: { principal: 1200, annualPct: 20, start: J.addDaysIso(iso, -10), mode: 'simple' } },
    { id: 'x', category: 'debt', mode: 'balance', balance: 500 },
  ];
  const flows = [{ id: 'f', active: true, amount: 50, freq: 'monthly', fromId: 'b', toId: 'x' }];
  const m = E.monthlyAuto(assets, flows, iso);
  close(m.interest, 10, 1e-9); close(m.debtInterest, 20, 1e-9); close(m.outflow, 50, 1e-9);
  // paying a debt from an account moves cash but doesn't make you poorer; interest that stays in a deposit isn't cash
  close(m.net, 10 - 20, 1e-9, 'wealth: interest earned − interest owed');
  close(m.cash, -50, 1e-9, 'cash: the debt payment leaves the account');
});

test('monthly automation: installments are cash, only their interest is a cost', () => {
  const assets = [
    { id: 'b', category: 'bank', mode: 'balance', balance: 0 },
    { id: 'L', category: 'debt', mode: 'loan', loan: { amount: 1.2e9, annualPct: 0, months: 12, firstDue: J.addDaysIso(iso, 20), account: 'b' } },
    { id: 'D', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 24, start: J.addDaysIso(iso, -5), mode: 'payout', payoutTo: 'b' } },
  ];
  const m = E.monthlyAuto(assets, [], iso);
  close(m.cash, 20e6 - 100e6, 1, 'interest paid to the account − installment');
  close(m.net, 20e6, 1, 'a 0% loan costs nothing; the deposit earns 20M');
});

test('same-day payouts: one deposit paying into another does not change what the other pays', () => {
  const start = J.addDaysIso(iso, -40);
  const mk = () => [
    { id: 'A', name: 'A', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 24, start, mode: 'payout', payoutTo: 'B' } },
    { id: 'B', name: 'B', category: 'fixed', mode: 'rate', rate: { principal: 2e9, annualPct: 24, start, mode: 'payout', payoutTo: 'self' } },
  ];
  const r1 = E.applyAutomations(mk(), [], {}, iso); const r2 = E.applyAutomations(mk().reverse(), [], {}, iso);
  const paid = (r) => r.events.filter((e) => e.fromId === 'B').map((e) => e.amount).join(',');
  assert.equal(paid(r1), paid(r2));
});

test('installments follow the loan as it is now (an extra payment earlier in the same catch-up)', () => {
  const firstDue = J.addJMonthsIso(iso, -2);
  const loan = { id: 'l', name: 'وام', category: 'debt', mode: 'loan', loan: { amount: 12e6, annualPct: 0, months: 12, firstDue, account: 'b', lastRun: J.addDaysIso(firstDue, -1) } };
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1e9 };
  // a flow pays the whole loan off between its first and second installment
  const flows = [{ id: 'f', title: 'تسویه', amount: 11e6, fromId: 'b', toId: 'l', freq: 'monthly', day: J.isoToJ(J.addDaysIso(firstDue, 3)).jd, start: J.addDaysIso(firstDue, 1), count: 1, active: true }];
  const r = E.applyAutomations([bank, loan], flows, {}, iso);
  const inst = r.events.filter((e) => e.kind === 'loan');
  assert.equal(inst.length, 1, 'no installment after it was paid off');
  close(r.assets[0].balance, 1e9 - 1e6 - 11e6, 1);
});

test('history rebuild brings back a deposit closed into an account', () => {
  const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', archived: true, rate: { principal: 0, annualPct: 20, start: J.addDaysIso(iso, -100), mode: 'simple' } };
  const prev = { ...dep, archived: false, rate: { ...dep.rate, principal: 1e9 } };
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1.05e9 };
  const ev = { id: 'e', kind: 'adjust', date: iso, at: Date.now(), amount: 1.05e9, fromId: 'd', toId: 'b', prev, changes: [{ assetId: 'b', field: 'balance', delta: 1.05e9 }, { assetId: 'd', field: 'remove', delta: 0, value: 0 }] };
  const hist = E.reconstructHistory([bank, dep], [ev], {}, {}, {}, 2, iso);
  const y = hist[J.addDaysIso(iso, -1)];
  assert.ok(y.v.d > 1e9 && y.v.b === 0, JSON.stringify(y.v));
});

test('monthly figures: a receivable installment is not counted twice', () => {
  const firstDue = J.addJMonthsIso(iso, 1);
  const mk = (cat) => ({ id: cat, category: cat, mode: 'loan', loan: { amount: 1e8, annualPct: 24, months: 12, firstDue } });
  const m = E.monthlyAuto([mk('debt'), mk('receivable')], [], iso);
  close(m.net, 0, 1);
});

test('fipiran: POST to the new host, unique keys for share classes, old refs still priced', async () => {
  // Synthetic list: one plain fund and an umbrella fund whose two classes share a registration number.
  const raw = { items: [
    { regNo: '90001', name: 'صندوق نمونه يكم', fundType: 4, cancelNav: 11000, issueNav: 11010, statisticalNav: 11000, date: '2026-09-29T00:00:00', smallSymbolName: 'نمون', netAsset: 5e12 },
    { regNo: '90002', name: 'بخشی نمونه', fundType: 21, cancelNav: 20000, issueNav: 20100, statisticalNav: 20000, date: '2026-09-29T00:00:00', netAsset: 3e12 },
    { regNo: '90002', name: '>صندوق بخشی نمونه-ب (کلاس دو)', fundType: 21, cancelNav: 30000, issueNav: 30100, statisticalNav: 30000, date: '2026-09-29T00:00:00', netAsset: 1e12 },
  ] };
  const calls = [];
  P.setFetch(async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return { ok: true, status: 200, text: async () => JSON.stringify(raw) };
  });
  const found = await P.fipiranSearch('نمونه');
  assert.equal(calls[0].url, 'https://www.fipiran.com/services/fund/fundcompare');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body), { regNos: [], showMarketMakers: false });
  assert.equal(found.length, 3);
  const keys = new Set(found.map((f) => f.key));
  assert.equal(keys.size, 3, 'every row has its own key');
  assert.ok(keys.has('90001'), 'a unique regNo stays the key (old refs keep working)');
  const cls2 = found.find((f) => f.name.includes('کلاس دو'));
  assert.ok(!cls2.name.startsWith('>'));
  assert.equal(cls2.type, 'بخشی');
  assert.equal(P.searchFunds(found, 'یکم')[0].regNo, '90001', 'Arabic ي/ك in the API match Persian input');
  assert.equal(P.searchFunds(found, 'نمون')[0].regNo, '90001');

  const { quotes, errors } = await P.fetchAll([
    { provider: 'fipiran', key: '90001', field: 'cancelNav' },
    { provider: 'fipiran', key: cls2.key, field: 'cancelNav' },
    { provider: 'fipiran', key: '90002', name: 'صندوق بخشی نمونه-ب (کلاس دو)', field: 'issueNav' },
    { provider: 'fipiran', key: '90002', field: 'statisticalNav' },
    { provider: 'fipiran', key: '99999', field: 'cancelNav' },
  ]);
  assert.equal(quotes['fipiran:90001:cancelNav'].price, 11000);
  assert.equal(quotes['fipiran:90001:cancelNav'].asOf, '2026-09-29');
  assert.equal(quotes[`fipiran:${cls2.key}:cancelNav`].price, 30000);
  assert.equal(quotes['fipiran:90002:issueNav'].price, 30100, 'an old regNo-only ref finds its class by name');
  assert.match(errors['fipiran:90002:statisticalNav'], /چند صندوق/);
  assert.match(errors['fipiran:99999:cancelNav'], /پیدا نشد/);
});

test('CSV export → import keeps every asset, debts stay debts, manual prices survive', async () => {
  const { toCSV, importCSVText } = await import('../../extension/lib/importer.js');
  const now = Date.now();
  const assets = [
    { id: 'b', code: 'A-001', name: 'حساب حقوق', category: 'bank', custodian: 'بانک نمونه', mode: 'balance', balance: 2_000_000_000, liquidity: 'high' },
    { id: 'd', code: 'A-002', name: 'وام نمونه', category: 'debt', custodian: 'بانک نمونه', mode: 'balance', balance: 800_000_000, liquidity: 'high' },
    { id: 'p', code: 'A-003', name: 'سهم شرکت نمونه', category: 'private', mode: 'units', quantity: 1000, unit: 'سهم', price: { source: 'manual', value: 50_000, updatedAt: now }, liquidity: 'low' },
    { id: 'r', code: 'A-004', name: 'طلب از دوست', category: 'receivable', mode: 'balance', balance: 100_000_000, liquidity: 'low' },
  ];
  const pf = E.portfolio(assets, {}, {});
  const back = importCSVText(toCSV(pf.rows).replace(/^﻿/, ''), { unit: 'toman' }).assets; // the wrong unit chosen on purpose: headers say «ریال»
  const by = Object.fromEntries(back.map((a) => [a.code, a]));
  assert.equal(back.length, 4);
  assert.equal(by['A-001'].name, 'حساب حقوق', 'a real account name is kept');
  assert.equal(by['A-002'].category, 'debt'); assert.equal(by['A-002'].balance, 800_000_000);
  assert.equal(by['A-003'].category, 'private'); assert.equal(E.valueOf(by['A-003'], {}, {}).value, 50_000_000);
  assert.equal(by['A-004'].category, 'receivable');
  close(E.portfolio(back, {}, {}).net, pf.net, 1);
});

test('review fixes (1.5): cost basis, full withdrawal, payouts, finished flows, grace period, extra payment count', () => {
  const iso = J.todayIso();
  // buying more of something with no recorded cost doesn't invent a profit
  const g = { id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 10, price: { source: 'manual', value: 1e8 } };
  E.applyDelta(g, 1e8, {});
  assert.ok(!(+g.costBasis > 0), 'cost stays unknown'); assert.equal(E.valueOf(g, {}, {}).pnl, null);
  // taking out a deposit's whole value never leaves a negative principal
  const dep = { id: 'd', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 24, start: J.addDaysIso(iso, -40), mode: 'payout', payoutTo: 'self' } };
  const v = E.rateValue(dep.rate, iso);
  E.applyDelta(dep, -v, {}, iso);
  assert.ok(+dep.rate.principal >= 0); close(E.rateValue(dep.rate, iso), 0, 1);
  // more than the principal but less than the value: the rest stays, exactly
  const dep2 = { id: 'd2', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 24, start: J.addDaysIso(iso, -100), mode: 'simple' } };
  const now = Date.now();
  const v2 = E.rateValue(dep2.rate, iso, now);
  E.applyDelta(dep2, -(1e9 + 1e6), {}, iso);
  close(E.rateValue(dep2.rate, iso, now), v2 - 1e9 - 1e6, 50);
  // a deposit payout can't be undone (the next run would only pay it again); interest owed on a debt isn't «received»
  const bank = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 0 };
  const d3 = { id: 'd3', name: 'سپرده', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 24, start: J.addJMonthsIso(iso, -1), mode: 'payout', payoutTo: 'b' } };
  const debt = { id: 'x', name: 'بدهی', category: 'debt', mode: 'rate', rate: { principal: 1e9, annualPct: 24, start: J.addJMonthsIso(iso, -1), mode: 'payout' } };
  const r = E.applyAutomations([bank, d3, debt], [], {}, iso);
  const pays = r.events.filter((e) => e.kind === 'interest');
  assert.equal(pays.length, 2); assert.ok(pays.every((e) => e.noUndo)); assert.ok(pays.find((e) => e.fromId === 'x').owed);
  const wf = E.weeklyFacts({ assets: r.assets, quotes: {}, settings: {}, snapshots: {}, events: r.events, flows: [] }, iso, 7);
  close(wf.interestReceived, pays.find((e) => e.fromId === 'd3').amount, 1);
  // a flow that has run all its times isn't monthly income any more
  const m = E.monthlyAuto([bank], [{ id: 'f', amount: 5e7, toId: 'b', freq: 'monthly', active: true, count: 3, done: 3 }], iso);
  assert.equal(m.inflow, 0);
  // grace period: installments stay equal (no ballooning last one)
  const L = { amount: 1e9, annualPct: 18, months: 12, start: '2026-06-22', firstDue: '2026-12-22' };
  const plan = E.loanPlan(L);
  const last = plan.rows[plan.rows.length - 1].payment;
  assert.ok(Math.abs(last - plan.A) < plan.A * 0.02, `last ${last} vs ${plan.A}`);
  // an extra payment keeps the count of installments already paid
  const ln = { id: 'l', name: 'وام', category: 'debt', mode: 'loan', loan: { amount: 1e8, annualPct: 18, months: 12, firstDue: J.addJMonthsIso(iso, -3) } };
  const st0 = E.loanState(ln.loan, iso);
  E.applyDelta(ln, -1e7, {}, iso);
  const st1 = E.loanState(ln.loan, iso);
  assert.equal(st1.paid + st1.before, st0.paid);
});

test('review 1.5 (round 2): payouts, maturity stub, interest vs price, deleted assets, overdrawn accounts', () => {
  // a) the deposit keeps its interest until the payout actually lands (no dip on payout day before the worker runs)
  const start = J.addJMonthsIso(iso, -1);
  const r = { principal: 1e9, annualPct: 24, start, mode: 'payout', lastPayout: start };
  const v = E.rateValue(r, iso);
  close(v, 1e9 + 1e9 * 0.24 * E.dayFactor(start, iso, 365), 1, 'interest since the last real payout is still in it');
  // b) the last short period is paid out on the maturity day
  const mat = J.addDaysIso(J.addJMonthsIso(iso, -1), 10);
  const d = { id: 'd', name: 'D', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 24, start: J.addJMonthsIso(iso, -2), maturity: mat, mode: 'payout', payoutTo: 'b', lastPayout: J.addJMonthsIso(iso, -1) } };
  const b = { id: 'b', name: 'B', category: 'bank', mode: 'balance', balance: 0 };
  const out = E.applyAutomations([d, b], [], {}, iso);
  const stub = out.events.find((e) => e.kind === 'interest' && e.date === mat);
  assert.ok(stub, 'a payout on the maturity day');
  close(stub.amount, 1e9 * 0.24 * E.dayFactor(J.addJMonthsIso(iso, -1), mat, 365), 1);
  close(E.rateValue(d.rate, iso), 1e9, 1, 'nothing left inside after maturity but the principal');
  // c) attribution: a deposit's growth is interest, a gold price move is price
  const y = J.addDaysIso(iso, -1);
  const dep = { id: 'dep', name: 'dep', category: 'fixed', mode: 'rate', rate: { principal: 1e9, annualPct: 36.5, start: J.addDaysIso(iso, -10), mode: 'simple' } };
  const gold = { id: 'g', name: 'g', category: 'gold', mode: 'units', quantity: 1, price: { source: 'manual', value: 110 } };
  const snaps = { [y]: { t: E.rateValue(dep.rate, y) + 100, v: { dep: E.rateValue(dep.rate, y), g: 100 }, est: true } };
  const at = E.attribution([dep, gold], {}, {}, snaps, [], 1, iso);
  close(at.price, 10, 1e-6, 'gold +10 is a price move');
  const depNow = E.portfolio([dep], {}, {}).rows[0].value; // includes the live part of today
  close(at.interest, depNow - E.rateValue(dep.rate, y), 1, 'the deposit earned interest');
  close(at.market, at.price + at.interest, 1e-6);
  // d) an edit on an account that was deleted later stays an edit (not a market move)
  const acc = { id: 'x', name: 'X', category: 'bank', mode: 'balance', balance: 1.2e9 };
  const snap2 = { [y]: { t: 1e9, v: { x: 1e9 }, at: Date.now() - 3600e3 } };
  const evs = [
    { id: 'e2', kind: 'edit', date: iso, at: Date.now(), title: 'del', amount: 0, restore: { ...acc }, changes: [{ assetId: 'x', field: 'remove', delta: 0, value: -1.2e9 }] },
    { id: 'e1', kind: 'edit', date: iso, at: Date.now() - 1000, title: 'fix', amount: 0, changes: [{ assetId: 'x', field: 'balance', delta: 2e8 }] },
  ];
  const at2 = E.attribution([], {}, {}, snap2, evs, 1, iso);
  close(at2.market, 0, 1, 'no fake market move');
  // e) an overdrawn account earns no (negative) interest
  const od = { id: 'o', name: 'o', category: 'bank', mode: 'balance', balance: -1e8, interest: { on: true, annualPct: 10, since: J.addDaysIso(iso, -40), payDay: 0 } };
  const r2 = E.applyAutomations([od], [], {}, iso);
  assert.ok(!(r2.assets[0].interest.accrued < 0), 'no negative accrual');
  // f) a year nobody means isn't a date (and doesn't throw)
  assert.equal(J.parseJ('3500/01/01'), null);
  assert.equal(J.parseJ('0001/01/01'), null);
});
