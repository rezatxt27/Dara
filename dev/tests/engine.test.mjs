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
  assert.deepEqual(sc.shocks, { usd: -25, gold: 100, equity: 30, crypto: 0, metals: 0, private: 0, real: 0 });
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
