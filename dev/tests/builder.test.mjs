import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as B from '../../extension/lib/builder.js';
import * as E from '../../extension/lib/engine.js';
import * as A from '../../extension/lib/assistant.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/market-monthly.json', import.meta.url)));
const btc = Object.fromEntries(Object.entries(fx.btcUsd).filter(([m]) => fx.usd[m]).map(([m, v]) => [m, v * fx.usd[m]]));
const R = B.returnsFrom({ gold: fx.geram18, usd: fx.usd, index: fx.index, btc }, 24);

test('builder: returns and a single block reproduce the market', () => {
  assert.equal(R.months[R.months.length - 1], '2026-10');
  const W = B.lastMonths(R, 60);
  const p = B.path({ gold: 1 }, W);
  close(p[p.length - 1], fx.geram18['2026-10'] / fx.geram18['2021-10'], 1e-9);
  const d = B.path({ deposit: 1 }, W);
  close(d[d.length - 1], Math.pow(1 + 24 / 1200, 60), 1e-9);
  const m = B.metrics(d, { depositPct: 24, horizon: 12 });
  assert.equal(m.maxDD, 0); assert.equal(m.beat, 0, 'the deposit never beats itself');
  // a 50/50 mix rebalanced yearly sits between its parts
  const mix = B.path({ gold: 0.5, deposit: 0.5 }, W);
  assert.ok(mix[mix.length - 1] < p[p.length - 1] && mix[mix.length - 1] > d[d.length - 1]);
});

test('builder: metrics on a known path', () => {
  const m = B.metrics([1, 1.1, 0.88, 0.99, 1.21], { depositPct: 0, horizon: 2 });
  close(m.maxDD, 0.88 / 1.1 - 1); assert.equal(m.under, 2);
  close(m.cagr, Math.pow(1.21, 12 / 4) - 1);
});

test('builder: bitcoin only from its first month; missing data gives its share to deposits', () => {
  const W = B.lastMonths(R, 150);
  assert.ok(W.r.btc.some((x) => x === null));
  const u = B.usable({ btc: 0.2, gold: 0.8 }, W);
  assert.deepEqual(u.moved, ['btc']); close(u.w.deposit, 0.2);
});

test('builder: four mixes, profile fit, red lines, ranges ordered, stress', () => {
  const profile = { goal: 'grow', horizon: 'mid', drop: 'wait', noCrypto: true };
  const r = B.build({ R, amount: 7e9, horizon: 24, mode: 'alone', years: 5, profile });
  assert.equal(r.cands.length, 3, 'no holdings: no «current» mix');
  assert.equal(r.cands.find((c) => c.fits).id, 'mid');
  for (const c of r.cands) {
    assert.ok(!(c.weights.btc > 0), 'no crypto as a red line');
    close(Object.values(c.weights).reduce((a, b) => a + b, 0), 1);
    assert.ok(c.range.bad <= c.range.mid && c.range.mid <= c.range.good);
    assert.ok(c.metrics.maxDD <= 0 && c.metrics.beat >= 0 && c.metrics.beat <= 1);
    close(c.stress.usdUp, 0.5 * ((c.weights.gold || 0) + (c.weights.usd || 0)));
  }
  close(r.depositGain, Math.pow(1.02, 24) - 1);
  // the same inputs give the same answer
  const again = B.build({ R, amount: 7e9, horizon: 24, mode: 'alone', years: 5, profile });
  assert.equal(again.cands[1].range.mid, r.cands[1].range.mid);
});

test('builder: with holdings, new money fills gaps toward each mix and everything is measured together', () => {
  const now = Date.now();
  const assets = [{ id: 'g', name: 'طلا', category: 'gold', mode: 'units', quantity: 100, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } },
    { id: 'h', name: 'خانه', category: 'property', mode: 'balance', balance: 5e10, balanceAt: now }];
  const pf = E.portfolio(assets, { 'tgju:geram18': { price: 2.6e8, at: now } }, {});
  const r = B.build({ R, pf, amount: 7e9, horizon: 12, mode: 'with', years: 5, profile: { goal: 'grow', horizon: 'mid', drop: 'wait' } });
  assert.equal(r.mode, 'with'); close(r.other, 5e10);
  const cur = r.cands.find((c) => c.id === 'current');
  close(cur.adds.gold, 7e9, 1e-9); close(cur.weights.gold, 1);
  const low = r.cands.find((c) => c.id === 'low');
  close(Object.values(low.adds).reduce((a, b) => a + b, 0), 7e9, 1e-6);
  assert.ok((low.adds.gold || 0) < 1, 'already more gold than the mix wants: none of the new money goes to gold');
  close(low.value0, 2.6e10 + 7e9, 1e-9);
});

test('builder: saved plan valued from later prices', () => {
  const p = { at: Date.now() - 365 * 864e5, adds: { gold: 1e9, deposit: 1e9 }, start: { gold: 100 }, depositPct: 20 };
  const v = B.planToday(p, { gold: 150 });
  const dep = Math.pow(1 + 20 / 1200, 12) - 1;
  close(v.pct, (1.5e9 + 1e9 * (1 + dep)) / 2e9 - 1, 1e-3); close(v.deposit, dep, 1e-3); assert.deepEqual(v.missing, []);
  assert.deepEqual(B.planToday({ ...p, adds: { usd: 1e9 } }, { gold: 150 }).missing, ['usd']);
  assert.equal(B.planToday({ ...p, at: undefined }, { gold: 150 }), null);
});

test('assistant build_portfolio: table numbers, two charts, a link, nothing absolute in percent mode', async () => {
  const st = { assets: [], quotes: {}, settings: { currency: 'toman', targets: {}, depositPct: 24 }, snapshots: {}, events: [], flows: [], alerts: [] };
  const pts = (m) => Object.entries(m).map(([k, v]) => [k + '-28', v]);
  const data = { gold: pts(fx.geram18), usd: pts(fx.usd), index: pts(fx.index), btc: pts(btc) };
  const charts = [], links = [];
  const tools = A.makeTools({ getState: () => st, privacy: 'percent', onChart: (c) => charts.push(c), onLink: (l) => links.push(l), pbData: async () => data });
  const r = await tools.find((t) => t.name === 'build_portfolio').run({ amount: 700_000_000, months: 20 });
  assert.equal(r.horizon_months, 24); assert.equal(r.portfolios.length, 3);
  assert.equal(charts.length, 2); assert.ok(links[0].href.startsWith('#/analysis?pb=7000000000&m=24'));
  assert.ok(!JSON.stringify(r).match(/range_value|new_money_split/), 'no amounts in percent mode');
  assert.ok(A.TOOL_STEPS.build_portfolio);
});

test('builder: the owner’s target mix is one of the candidates', () => {
  const r = B.build({ R, amount: 1e9, horizon: 12, mode: 'alone', targets: { gold: 50, fixed: 50, property: 10 } });
  const t = r.cands.find((c) => c.id === 'targets');
  close(t.weights.gold, 0.5); close(t.weights.deposit, 0.5);
  assert.ok(!B.build({ R, amount: 1e9, horizon: 12, mode: 'alone', targets: {} }).cands.some((c) => c.id === 'targets'));
});

test('review fixes: allocation by block, deposit never «beats» itself, cost inside the path', () => {
  // online gold counts as gold: a 25%-gold mix adds no more gold to an owner who is all online gold
  const add = B.allocClasses({ gold: 1e10 }, { deposit: 0.55, gold: 0.25, usd: 0.15, bourse: 0.05 }, 1e10);
  assert.ok(add.gold < 1); close(Object.values(add).reduce((a, b) => a + b, 0), 1e10);
  const W = B.lastMonths(R, 60);
  assert.equal(B.metrics(B.path({ deposit: 1 }, W), { depositPct: 24, horizon: 24 }).beat, 0);
  const r = B.build({ R, amount: 1e9, horizon: 12, mode: 'alone' });
  const low = r.cands.find((c) => c.id === 'low');
  assert.ok(low.path[0] < 1 && low.path[0] > 0.98, 'the cost of buying in comes off at the start');
  assert.ok(isFinite(low.range.midUsdPct) && low.range.midUsdPct < low.range.midPct);
});

test('build_portfolio in percent mode with holdings: no post-addition weights or stress', async () => {
  const now = Date.now();
  const st = { assets: [{ id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 5e10, balanceAt: now }], quotes: {}, settings: { currency: 'toman', targets: {}, depositPct: 24 }, snapshots: {}, events: [], flows: [], alerts: [] };
  const pts = (m) => Object.entries(m).map(([k, v]) => [k + '-28', v]);
  const data = { gold: pts(fx.geram18), usd: pts(fx.usd), index: pts(fx.index), btc: pts(btc) };
  const tools = A.makeTools({ getState: () => st, privacy: 'percent', pbData: async () => data });
  const r = await tools.find((t) => t.name === 'build_portfolio').run({ amount: 700_000_000, months: 24 });
  assert.equal(r.mode, 'with');
  const json = JSON.stringify(r);
  assert.ok(!json.includes('weights_pct') && !json.includes('stress_pct') && json.includes('mix_recipe_pct'));
  const full = await A.makeTools({ getState: () => st, privacy: 'full', pbData: async () => data }).find((t) => t.name === 'build_portfolio').run({ amount: 700_000_000, months: 24 });
  assert.ok(JSON.stringify(full).includes('weights_pct'));
});

test('glossary: words found as whole words, each once; search; the assistant can read it', async () => {
  const G = await import('../../extension/lib/glossary.js');
  const p = G.split('حباب ۳٪ (آخرین قیمت در برابر آخرین NAV)؛ حباب بالا. P/E ۸ در برابر میانهٔ گروه');
  const ids = p.filter((x) => typeof x !== 'string').map((x) => x.id);
  assert.deepEqual(ids, ['bubble', 'nav', 'pe', 'median']);
  assert.equal(p.map((x) => (typeof x === 'string' ? x : x.text)).join(''), 'حباب ۳٪ (آخرین قیمت در برابر آخرین NAV)؛ حباب بالا. P/E ۸ در برابر میانهٔ گروه');
  assert.ok(!G.split('حبابی').some((x) => typeof x !== 'string'), 'not inside a longer word');
  assert.equal(G.split('NAV ابطال امروز')[0].id, 'nav');
  assert.equal(G.search('nav')[0].id, 'nav');
  for (const t of G.TERMS) assert.ok(t.short && t.long && t.aliases.length, t.id);
  const st = { assets: [], quotes: {}, settings: { currency: 'toman' }, snapshots: {}, events: [], flows: [], alerts: [] };
  const r = A.makeTools({ getState: () => st }).find((t) => t.name === 'explain_term').run({ term: 'P/E' });
  assert.equal(r.entries[0].term.startsWith('P/E'), true);
});
