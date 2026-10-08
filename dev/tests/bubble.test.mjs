// Coin and fund bubbles (lib/bubble.js) and where the engine uses them. Synthetic prices only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as BB from '../../extension/lib/bubble.js';
import * as E from '../../extension/lib/engine.js';

const now = Date.UTC(2026, 9, 3, 9, 0, 0);
const close = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);
const Q = (price, extra = {}) => ({ price, changePct: 0, at: now - 60000, fetchedAt: now - 60000, ...extra });
// ounce $4000, dollar 1,000,000 Rial → pure gram = 4e9 / 31.1034768 Rial
const base = () => ({
  'tgju:ons': Q(4000), 'tgju:price_dollar_rl': Q(1_000_000),
  'tgju:sekee': Q(1_000_000_000), 'tgju:nim': Q(520_000_000), 'tgju:rob': Q(300_000_000), 'tgju:retail_gerami': Q(125_000_000),
  'tgju:geram18': Q(96_000_000),
});
const G = 4000 * 1_000_000 / 31.1034768;

test('pure gold per gram = ounce × dollar ÷ 31.1035', () => {
  const g = BB.purePerGram(base(), now);
  close(g.price, G, 1e-3); assert.equal(g.stale, false);
  assert.equal(BB.purePerGram({ 'tgju:ons': Q(4000) }, now), null, 'no dollar → nothing');
  assert.equal(BB.purePerGram({ 'tgju:ons': Q(0), 'tgju:price_dollar_rl': Q(1) }, now), null, 'zero price → nothing');
});

test('coin bubble: gold content and bubble per coin', () => {
  const q = base();
  const e = BB.coinBubble('sekee', q, now);
  close(e.pure, 8.133 * 0.9, 1e-12);
  close(e.intrinsic, 8.133 * 0.9 * G, 1e-3);
  close(e.bubble, 1e9 / (8.133 * 0.9 * G) - 1, 1e-12);
  close(e.perPure, 1e9 / (8.133 * 0.9), 1e-3);
  const r = BB.coinBubble('rob', q, now);
  close(r.bubble, 3e8 / (2.03325 * 0.9 * G) - 1, 1e-12);
  // a coin selling below its gold has a negative bubble (a discount)
  q['tgju:nim'] = Q(0.95 * 4.0665 * 0.9 * G);
  close(BB.coinBubble('nim', q, now).bubble, -0.05, 1e-12);
  assert.equal(BB.coinBubble('unknown', q, now), null);
  assert.equal(BB.coinBubble('sekeb', q, now), null, 'no quote → null');
});

test('stale or failing quotes are flagged, never silently treated as today', () => {
  const q = base();
  q['tgju:sekee'] = Q(1e9, { at: now - 4 * 86400000 });
  assert.equal(BB.coinBubble('sekee', q, now).stale, true, 'coin 4 days old');
  const q2 = base(); q2['tgju:ons'] = Q(4000, { error: 'x' });
  assert.equal(BB.coinBubble('sekee', q2, now).stale, true, 'ounce with an error');
  assert.equal(BB.purePerGram(q2, now).stale, true);
});

test('cheapest gram of pure gold and how much dearer each is', () => {
  const { rows, best } = BB.coinBubbles(base(), now);
  const perPure = Object.fromEntries(rows.map((r) => [r.key, r.perPure]));
  const min = Math.min(...Object.values(perPure));
  assert.equal(best.perPure, min);
  for (const r of rows) close(r.vsBest, r.perPure / min - 1, 1e-12);
  assert.ok(rows.some((r) => r.kind === 'ref' && r.key === 'geram18'), '18k yardstick is listed');
  // 18k: 96M per gram of 0.75 → 128M per pure gram
  close(perPure.geram18, 96e6 / 0.75, 1e-3);
});

test('fund bubble: price vs redemption NAV, same trading day only', () => {
  const ref = { provider: 'tsetmc', key: '123', field: 'close' };
  const q = { 'tsetmc:123:close': Q(105_000), 'tsetmc:123:nav': Q(100_000) };
  const f = BB.fundBubble(ref, q, now);
  close(f.bubble, 0.05, 1e-12); assert.equal(f.stale, false);
  assert.equal(BB.navId(ref), 'tsetmc:123:nav');
  q['tsetmc:123:nav'] = Q(100_000, { at: now - 2 * 86400000 });
  assert.equal(BB.fundBubble(ref, q, now).stale, true, 'NAV from another day');
  assert.equal(BB.fundBubble({ provider: 'tsetmc', key: '123', field: 'nav' }, q, now), null, 'a NAV ref has no bubble');
  assert.equal(BB.fundBubble({ provider: 'tsetmc', key: '999' }, q, now), null, 'no NAV → null');
  assert.equal(BB.fundBubble({ provider: 'fipiran', key: '1' }, q, now), null, 'non-exchange fund → null');
});

test('asset bubble: share of value that is bubble', () => {
  const a = { id: 'c', mode: 'units', quantity: 2, price: { source: 'market', ref: { provider: 'tgju', key: 'nim' }, factor: 1 } };
  const q = base(); const v = 2 * 520e6;
  const b = BB.assetBubble(a, q, v, now);
  close(b.amount, v * b.bubble / (1 + b.bubble), 1e-3);
  // amount = what the coins sell for above their gold
  close(b.amount, 2 * (520e6 - 4.0665 * 0.9 * G), 1e-2);
  assert.equal(BB.assetBubble({ ...a, price: { source: 'manual', value: 1 } }, q, v, now), null, 'manual price → no bubble');
  assert.equal(BB.assetBubble({ ...a, mode: 'balance' }, q, v, now), null);
  assert.equal(BB.assetBubble({ ...a, price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } }, q, v, now), null, 'raw gold has no coin bubble');
});

test('bubble paid on a purchase and what its change did since', () => {
  const a = { id: 'c', mode: 'units', quantity: 3, price: { source: 'market', ref: { provider: 'tgju', key: 'rob' }, factor: 1 } };
  const q = base(); const I = 2.03325 * 0.9 * G;
  assert.equal(BB.paidBubble(a, 0, q, now), null);
  close(BB.paidBubble(a, I * 1.2, q, now), 0.2, 1e-12);
  const evs = [
    { kind: 'trade', toId: 'c', bub: { qty: 1, b: 0.2 } },
    { kind: 'trade', toId: 'c', bub: { qty: 2, b: 0.05 } },
    { kind: 'trade', toId: 'c', bub: { qty: 5, b: 0.9 }, undone: true }, // undone: ignored
    { kind: 'trade', toId: 'x', bub: { qty: 5, b: 0.9 } }, // another asset
    { kind: 'trade', toId: 'c' }, // older buy, no record
  ];
  const r = BB.buyBubble(a, evs, q, now);
  close(r.avg, (0.2 + 0.1) / 3, 1e-12); assert.equal(r.count, 2); assert.equal(r.units, 3);
  const cur = BB.coinBubble('rob', q, now).bubble;
  close(r.effect, 3 * I * (cur - r.avg), 1e-2);
  // sold down to 1 coin: the effect covers only what is still held
  const r1 = BB.buyBubble({ ...a, quantity: 1 }, evs, q, now);
  close(r1.effect, 1 * I * (cur - r1.avg), 1e-2);
  assert.equal(BB.buyBubble(a, [], q, now), null);
  // a stale price: no effect claimed
  const qs = base(); qs['tgju:rob'] = Q(3e8, { at: now - 5 * 86400000 });
  assert.equal(BB.buyBubble(a, evs, qs, now).effect, null);
});

test('period split of the coins\' move: gold vs bubble, from the start snapshot\'s global gold price', () => {
  const q = base();
  const nimRef = { provider: 'tgju', key: 'nim' };
  const g1 = 4000 * 1_000_000; const g0 = g1 / 1.0102; // global gold rose 1.02%
  const rows = [
    { asset: { mode: 'units', price: { source: 'market', ref: nimRef } }, now: 1040e6, market: 50e6, price: 50e6 },
    { asset: { mode: 'units', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } }, now: 1e9, market: 1e7, price: 1e7 },
    { asset: { mode: 'units', price: { source: 'market', ref: nimRef } }, now: 5e8, market: 5e8, price: 5e8, isNew: true },
  ];
  const s = BB.coinMoveSplit({ snap: { gx: g0 }, rows }, q, now);
  const gold = (1040e6 - 50e6) * 0.0102;
  close(s.total, 50e6, 1e-3); close(s.gold, gold, 1); close(s.bubble, 50e6 - gold, 1); assert.equal(s.count, 1, 'raw gold and newly added coins excluded');
  assert.equal(BB.coinMoveSplit({ snap: {}, rows }, q, now), null, 'older snapshot without the global gold price');
  const qs = base(); qs['tgju:ons'] = Q(4000, { at: now - 5 * 86400000 });
  assert.equal(BB.coinMoveSplit({ snap: { gx: g0 }, rows }, qs, now), null, 'stale ounce');
  // the snapshot records the global gold price only from fresh, error-free ounce and dollar
  const pf = E.portfolio([], q, {});
  assert.equal(E.makeSnapshot(pf, q).gx, 4000 * 1_000_000);
  assert.equal(E.makeSnapshot(pf, { ...q, 'tgju:ons': Q(4000, { error: 'x' }) }).gx, undefined);
});

test('bubble history: aligned series and its normal range', () => {
  const pure = 4.0665 * 0.9;
  const ounce = [['2026-09-01', 4e9], ['2026-09-03', 4.4e9]]; // no 09-02: the 09-01 ounce carries forward
  const coin = [['2026-09-01', pure * 4e9 / 31.1034768 * 1.1], ['2026-09-02', pure * 4e9 / 31.1034768 * 1.2], ['2026-09-03', pure * 4.4e9 / 31.1034768 * 1.05]];
  const s = BB.coinBubbleSeries('nim', coin, ounce);
  assert.deepEqual(s.map((p) => p[0]), ['2026-09-01', '2026-09-02', '2026-09-03']);
  close(s[0][1], 0.1, 1e-12); close(s[1][1], 0.2, 1e-12); close(s[2][1], 0.05, 1e-12);
  assert.equal(BB.bubbleStats(s), null, 'too few days for an average');
  // flat history: the 2-point floor decides
  const long = Array.from({ length: 30 }, (_, i) => [`d${i}`, 0.08]);
  const st = BB.bubbleStats(long, 0.15);
  close(st.avg, 0.08, 1e-12); assert.equal(st.level, 'high');
  assert.equal(BB.bubbleStats(long, 0.09).level, 'normal');
  assert.equal(BB.bubbleStats(long, 0.05).level, 'low');
  // a coin whose bubble usually swings ±4 points: 5 points above average is still normal, 7 is not
  const wavy = Array.from({ length: 40 }, (_, i) => [`d${i}`, 0.12 + (i % 2 ? 0.04 : -0.04)]);
  close(BB.bubbleStats(wavy).sd, 0.04, 1e-12);
  assert.equal(BB.bubbleStats(wavy, 0.17).level, 'normal');
  assert.equal(BB.bubbleStats(wavy, 0.19).level, 'high');
});

test('scenario: bubble disappearing hits coins and gold funds only, by their own bubble', () => {
  // simulate() judges freshness against the real clock, so these prices are fresh as of now (not the fixed test date)
  const t = Date.now();
  const q = Object.fromEntries(Object.entries(base()).map(([k, v]) => [k, { ...v, at: t - 60000, fetchedAt: t - 60000 }]));
  const coin = { id: 'c', name: 'نیم', category: 'gold', mode: 'units', quantity: 1, price: { source: 'market', ref: { provider: 'tgju', key: 'nim' }, factor: 1 } };
  const raw = { id: 'g', name: 'آب‌شده', category: 'gold_online', mode: 'units', quantity: 10, price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, factor: 1 } };
  const cash = { id: 'b', name: 'بانک', category: 'bank', mode: 'balance', balance: 1e9 };
  const b = BB.coinBubble('nim', q, t).bubble;
  const r = E.simulate([coin, raw, cash], q, {}, { bubble: -1 });
  const row = (id) => r.rows.find((x) => x.asset.id === id);
  close(row('c').factor, 1 / (1 + b), 1e-9, 'coin falls to its gold');
  close(row('c').after, 4.0665 * 0.9 * G, 1, 'coin worth exactly its gold');
  assert.equal(row('g').factor, 1, 'raw gold unaffected');
  assert.equal(row('b').factor, 1, 'cash unaffected');
  // bubble +100% (doubles) together with a dollar move
  const r2 = E.simulate([coin], q, {}, { bubble: 1, usd: 0.1 });
  close(r2.rows[0].factor, 1.1 * (1 + 2 * b) / (1 + b), 1e-9);
  // no bubble shock: identical to before
  close(E.simulate([coin], q, {}, { usd: 0.1 }).rows[0].factor, 1.1, 1e-12);
});

test('bubble alerts fire on the bubble, never on stale prices; price alerts unchanged', () => {
  const q = base(); const b = BB.coinBubble('nim', q, now).bubble;
  const al = () => [{ id: 'a', kind: 'bubble', ref: { provider: 'tgju', key: 'nim' }, op: 'lt', value: b + 0.01, active: true },
    { id: 'p', ref: { provider: 'tgju', key: 'nim' }, op: 'gt', value: 500e6, active: true }];
  const list = al(); const fired = E.checkAlerts(list, q, now);
  assert.deepEqual(fired.map((f) => f.id).sort(), ['a', 'p']);
  close(fired.find((f) => f.id === 'a').price, b, 1e-12);
  assert.equal(list[0].active, false);
  const qs = base(); qs['tgju:ons'] = Q(4000, { at: now - 5 * 86400000 });
  const list2 = al(); const fired2 = E.checkAlerts(list2, qs, now);
  assert.deepEqual(fired2.map((f) => f.id), ['p'], 'stale ounce: bubble alert waits');
  assert.equal(list2[0].active, true);
  const gt = [{ id: 'g', kind: 'bubble', ref: { provider: 'tgju', key: 'nim' }, op: 'gt', value: b + 0.01, active: true }];
  assert.equal(E.checkAlerts(gt, q, now).length, 0, 'not reached');
});

test('NAV refs: held, watched and alerted exchange symbols; misses skipped for a week', () => {
  const t = (key, field) => ({ provider: 'tsetmc', key, field });
  const assets = [{ mode: 'units', price: { source: 'market', ref: t('1', 'close') } }, { mode: 'units', archived: true, price: { source: 'market', ref: t('2') } },
    { mode: 'units', price: { source: 'market', ref: t('3', 'nav') } }, { mode: 'units', price: { source: 'market', ref: { provider: 'tgju', key: 'nim' } } }];
  const refs = E.navRefs(assets, [t('4'), t('1', 'last')], [{ active: true, kind: 'bubble', ref: t('5') }, { active: true, ref: t('6') }], { 4: now - 86400000 }, now);
  assert.deepEqual(refs.map((r) => E.quoteId(r)).sort(), ['tsetmc:1:nav', 'tsetmc:5:nav']);
  assert.deepEqual(E.navRefs(assets, [t('4')], [], { 4: now - 8 * 86400000 }, now).map((r) => r.key).sort(), ['1', '4'], 'retried after a week');
});

test('review fixes: time-matched prices, honest «lowest», split skips traded coins and rebuilt starts', () => {
  // a coin priced a day before the ounce and dollar is stale, even though each price alone is «fresh»
  const q = base(); q['tgju:rob'] = Q(3e8, { at: now - 20 * 3600000 });
  assert.equal(BB.coinBubble('rob', q, now).stale, true);
  assert.equal(BB.coinBubble('nim', q, now).stale, false);
  // stale rows get no «X% more» and never become the lowest
  const { rows, best } = BB.coinBubbles(q, now);
  assert.equal(rows.find((r) => r.key === 'rob').vsBest, null);
  assert.notEqual(best.key, 'rob');
  // everything stale: no lowest at all
  const qs = base(); qs['tgju:ons'] = Q(4000, { at: now - 5 * 86400000 });
  const all = BB.coinBubbles(qs, now);
  assert.equal(all.best, null); assert.ok(all.rows.every((r) => r.vsBest === null));
  // amount of value that is bubble is not claimed from stale prices
  const a = { id: 'c', mode: 'units', quantity: 1, price: { source: 'market', ref: { provider: 'tgju', key: 'rob' }, factor: 1 } };
  assert.equal(BB.assetBubble(a, q, 3e8, now).amount, null);
  // the split leaves out a coin bought or edited during the period, and a rebuilt start snapshot
  const nimRef = { provider: 'tgju', key: 'nim' };
  const g0 = 4e9 / 1.01;
  const traded = [{ asset: { mode: 'units', price: { source: 'market', ref: nimRef } }, now: 1040e6, market: 20e6, price: 20e6, flow: 500e6, edit: 0 }];
  assert.equal(BB.coinMoveSplit({ snap: { gx: g0 }, rows: traded }, base(), now), null);
  const held = [{ asset: { mode: 'units', price: { source: 'market', ref: nimRef } }, now: 1040e6, market: 20e6, price: 20e6, flow: 0, edit: 0 }];
  assert.ok(BB.coinMoveSplit({ snap: { gx: g0 }, rows: held }, base(), now));
  assert.equal(BB.coinMoveSplit({ est: true, snap: { gx: g0 }, rows: held }, base(), now), null);
  assert.equal(E.makeSnapshot(E.portfolio([], base(), {}), base(), { est: true }).gx, undefined, 'rebuilt days have no global gold price');
  // the scenario ignores a stale bubble
  const coin = { id: 'c', name: 'ربع', category: 'gold', mode: 'units', quantity: 1, price: { source: 'market', ref: { provider: 'tgju', key: 'rob' }, factor: 1 } };
  assert.equal(E.simulate([coin], q, {}, { bubble: -1 }).rows[0].factor, 1);
});

test('auxiliary NAVs: errors never kept; «no NAV» remembered only when the exchange answered; throttling retried', () => {
  const t = (key, field) => ({ provider: 'tsetmc', key, field });
  const refs = [t('1', 'close'), t('2', 'close'), t('3', 'close'), t('5', 'nav')];
  const navs = [t('1', 'nav'), t('2', 'nav'), t('3', 'nav'), t('4', 'nav'), t('5', 'nav')];
  const fresh = { 'tsetmc:1:close': Q(1), 'tsetmc:2:close': Q(1), 'tsetmc:1:nav': Q(1), 'tsetmc:12:close': Q(1) };
  const errors = { 'tsetmc:2:nav': 'NAV ابطال در دسترس نیست', 'tsetmc:3:nav': 'NAV ابطال در دسترس نیست', 'tsetmc:4:nav': 'خطای سرور (429)', 'tsetmc:5:nav': 'x' };
  const r = E.sortNavResults(navs, refs, fresh, errors, now);
  assert.deepEqual(Object.keys(r.miss), ['2'], '3: its price failed too (network), 4: throttled');
  assert.deepEqual(r.hit, ['1']);
  assert.ok(!r.aux.has('tsetmc:5:nav'), 'a NAV the owner values a fund at is a real price, not auxiliary');
  assert.deepEqual(Object.keys(errors), ['tsetmc:5:nav'], 'auxiliary errors removed, the real one kept');
});
