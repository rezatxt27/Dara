import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../extension/lib/providers.js';
import * as A from '../../extension/lib/assistant.js';
import { cryptoRefFor, cryptoFixes, unpricedCrypto, isBitpin } from '../../extension/lib/catalog.js';

const COINS = [
  { key: 'zec', sym: 'ZEC', name: 'زی کش', en: 'Zcash' },
  { key: 'nvdax', sym: 'NVDAX', name: 'انویدیا', en: 'NVIDIA xStock' },
  { key: 'btc', sym: 'BTC', name: 'بیت کوین', en: 'Bitcoin' },
  { key: 'amdon', sym: 'AMDON', name: 'ای ام دی', en: 'AMD Tokenized Stock (Ondo)' },
];
const TICKERS = [
  { symbol: 'ZEC_IRT', price: '317728155', daily_change_price: 0.69, timestamp: Date.now() / 1000 - 60 },
  { symbol: 'ZEC_USDT', price: '1196.05', daily_change_price: 0.5, timestamp: Date.now() / 1000 },
  { symbol: 'NVDAX_IRT', price: '56777882', daily_change_price: -0.42, timestamp: Date.now() / 1000 - 30 },
  { symbol: 'BTC_IRT', price: '21453608069', daily_change_price: -1.23, timestamp: Date.now() / 1000 },
];
const bitpinOnly = (calls) => async (url, init) => {
  calls?.push(url);
  if (url.includes('api.bitpin.ir/api/v1/mkt/tickers')) return new Response(JSON.stringify(TICKERS));
  if (url.includes('api.bitpin.ir/v1/mkt/currencies')) return new Response(JSON.stringify({ results: [
    { code: 'ZEC', title: 'Zcash', title_fa: 'زی کش', tradable: true, price_info: { price: '317728155' } },
    { code: 'OLD', title: 'Old', title_fa: 'قدیمی', tradable: false, price_info: { price: '1' } },
    { code: 'IRT', title: 'Toman', tradable: true, price_info: { price: '1' } }] }));
  if (url.includes('nobitex')) return new Response(JSON.stringify({ status: 'ok', stats: {} }));
  return new Response('nope', { status: 404 });
};

test('bitpin: toman tickers become Rial quotes, unknown symbols are errors', async () => {
  P.resetBitpinCache(); P.setFetch(bitpinOnly());
  const { quotes, errors } = await P.bitpinQuotes(['zec', 'nvdax', 'xyz']);
  assert.equal(quotes.zec.price, 3177281550); assert.equal(quotes.zec.source, 'bitpin');
  assert.ok(Math.abs(quotes.nvdax.changePct + 0.0042) < 1e-12);
  assert.ok(errors.xyz);
  const coins = await P.bitpinCoins();
  assert.deepEqual(coins.map((c) => c.key), ['zec'], 'not tradable and toman itself are left out');
});

test('fetchAll: a coin Nobitex lacks is priced by Bitpin; a coin bought on Bitpin goes to Bitpin first', async () => {
  P.resetBitpinCache(); const calls = []; P.setFetch(bitpinOnly(calls));
  const { quotes, errors } = await P.fetchAll([{ provider: 'nobitex', key: 'zec' }, { provider: 'nobitex', key: 'nvdax', src: 'bitpin' }], { tgju: false });
  assert.equal(quotes['nobitex:zec'].price, 3177281550); assert.match(quotes['nobitex:zec'].note, /بیت‌پین/);
  assert.equal(quotes['nobitex:nvdax'].price, 567778820); assert.equal(quotes['nobitex:nvdax'].note, undefined);
  assert.deepEqual(errors, {});
  assert.ok(!calls.some((u) => u.includes('nobitex') && u.includes('nvdax')), 'the Bitpin coin is not asked of Nobitex');
});

test('cryptoRefFor: catalog by symbol, else Bitpin by symbol or Persian name; Bitpin custody prefers Bitpin', () => {
  assert.deepEqual(cryptoRefFor({ unit: 'BTC', name: 'بیت‌کوین', custodian: 'نوبیتکس' }, COINS), { provider: 'nobitex', key: 'btc' });
  assert.deepEqual(cryptoRefFor({ unit: 'BTC', custodian: 'بیت‌پین' }, COINS), { provider: 'nobitex', key: 'btc', src: 'bitpin' });
  assert.deepEqual(cryptoRefFor({ unit: 'NVDAX', name: 'انویدیا' }, COINS), { provider: 'nobitex', key: 'nvdax', sym: 'NVDAX', name: 'انویدیا', src: 'bitpin' });
  assert.equal(cryptoRefFor({ unit: 'عدد', name: 'ای‌ام‌دی' }, COINS).key, 'amdon');
  assert.equal(cryptoRefFor({ unit: 'FOO', name: 'چیزی' }, COINS), null);
  assert.ok(isBitpin('bitpin.ir') && isBitpin('بیت‌پین') && isBitpin('بیت پین') && !isBitpin('نوبیتکس'));
});

test('existing coins with a typed price: the ones online prices know are fixed', () => {
  const assets = [
    { id: 'a', name: 'زی کش', category: 'crypto', mode: 'units', quantity: 0.02, unit: 'ZEC', custodian: 'بیت‌پین', price: { source: 'manual', value: 0 } },
    { id: 'b', name: 'انویدیا', category: 'crypto', mode: 'units', quantity: 0.04, unit: 'NVDAX', custodian: 'بیت‌پین', price: { source: 'manual', value: 0 } },
    { id: 'c', name: 'ناشناخته', category: 'crypto', mode: 'units', quantity: 1, unit: 'FOO', price: { source: 'manual', value: 0 } },
    { id: 'd', name: 'بیت‌کوین', category: 'crypto', mode: 'units', quantity: 1, unit: 'BTC', price: { source: 'market', ref: { provider: 'nobitex', key: 'btc' } } },
  ];
  assert.deepEqual(unpricedCrypto(assets).map((a) => a.id), ['a', 'b', 'c']);
  const f = cryptoFixes(assets, COINS);
  assert.deepEqual(f.map((x) => [x.id, x.ref.key, x.ref.src]), [['a', 'zec', 'bitpin'], ['b', 'nvdax', 'bitpin']]);
});

test('capture: a coin from Bitpin gets Bitpin\'s price; nothing online → the page\'s own value, never 0', () => {
  const props = A.captureProposals({ currency_unit: 'toman', items: [
    { label: 'انویدیا', kind: 'quantity', amount: 0.0429, unit: 'NVDAX', type: 'crypto', symbol: 'NVDAX', value: 2435000, confidence: 0.9 },
    { label: 'توکن عجیب', kind: 'quantity', amount: 10, unit: 'FOO', type: 'crypto', symbol: 'FOO', value: 50000, confidence: 0.9 }] }, [], {}, {});
  const nv = A.newAssetFromCapture(props[0], { site: 'بیت‌پین', host: 'bitpin.ir', category: 'crypto', id: 'n', coins: COINS });
  assert.deepEqual(nv.price.ref, { provider: 'nobitex', key: 'nvdax', sym: 'NVDAX', name: 'انویدیا', src: 'bitpin' });
  assert.equal(nv.unit, 'NVDAX'); assert.equal(nv.review, undefined);
  const foo = A.newAssetFromCapture(props[1], { site: 'بیت‌پین', category: 'crypto', id: 'f', coins: COINS });
  assert.equal(foo.price.source, 'manual'); assert.equal(foo.price.value, 50000 * 10 / 10);
  assert.match(foo.review, /ارزش همان صفحه/);
  // Bitpin's list unreachable: the symbol is tried online anyway
  const g = A.newAssetFromCapture(props[1], { site: 'x', category: 'crypto', id: 'g', coins: [] });
  assert.equal(g.price.source, 'market'); assert.equal(g.price.ref.key, 'foo');
});

test('a coin held at Bitpin still gets Nobitex\'s price when Bitpin is down', async () => {
  P.resetBitpinCache();
  P.setFetch(async (url) => {
    if (url.includes('bitpin')) return new Response('down', { status: 503 });
    if (url.includes('nobitex')) return new Response(JSON.stringify({ status: 'ok', stats: { 'btc-rls': { latest: '2000000000', dayChange: '1', isClosed: false } } }));
    return new Response('nope', { status: 404 });
  });
  const { quotes } = await P.fetchAll([{ provider: 'nobitex', key: 'btc', src: 'bitpin' }], { tgju: false });
  assert.equal(quotes['nobitex:btc'].price, 2e9); assert.equal(quotes['nobitex:btc'].source, 'nobitex');
  // and when both answer, Bitpin's price is kept
  P.resetBitpinCache(); P.setFetch(async (url) => (url.includes('bitpin') ? new Response(JSON.stringify(TICKERS)) : new Response(JSON.stringify({ status: 'ok', stats: { 'btc-rls': { latest: '2000000000', dayChange: '1', isClosed: false } } }))));
  const r2 = await P.fetchAll([{ provider: 'nobitex', key: 'btc', src: 'bitpin' }], { tgju: false });
  assert.equal(r2.quotes['nobitex:btc'].price, 214536080690);
});

test('a coin priced by hand on purpose is not switched', () => {
  const kept = { id: 'k', name: 'زی کش', category: 'crypto', mode: 'units', quantity: 1, unit: 'ZEC', price: { source: 'manual', value: 5e9 } };
  assert.equal(cryptoFixes([kept], COINS).length, 0);
  assert.equal(cryptoFixes([{ ...kept, review: 'از صفحه ثبت شد' }], COINS).length, 1);
});

test('a Bitpin request that fails keeps the last good prices for a while', async () => {
  P.resetBitpinCache();
  P.setFetch(async (url) => (url.includes('bitpin') ? new Response(JSON.stringify(TICKERS)) : new Response('x', { status: 503 })));
  assert.equal((await P.bitpinQuotes(['zec'])).quotes.zec.price, 3177281550);
  // a minute later the list is asked again and the server refuses: the last good list still answers
  const realNow = Date.now; Date.now = () => realNow() + 2 * 60e3;
  try {
    P.setFetch(async () => new Response('blocked', { status: 403 }));
    const r = await P.bitpinQuotes(['zec']);
    assert.equal(r.quotes.zec?.price, 3177281550); assert.match(r.quotes.zec.note, /آخرین قیمت/);
    // the failure is remembered for a minute: nobody asks again meanwhile
    let asked = 0; P.setFetch(async () => { asked++; return new Response('blocked', { status: 403 }); });
    await P.bitpinQuotes(['zec']); assert.equal(asked, 0);
    P.setFetch(async () => new Response('blocked', { status: 403 }));
    Date.now = () => realNow() + 20 * 60e3; // too old to stand in
    const r2 = await P.bitpinQuotes(['zec']);
    assert.ok(r2.errors.zec && !r2.quotes.zec);
  } finally { Date.now = realNow; }
});

test('a price site that drops one request is asked once more', async () => {
  P.setRetryDelay(0);
  let n = 0;
  P.setFetch(async (url) => {
    if (url.includes('GetClosingPriceInfo')) { n++; return n === 1 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ closingPriceInfo: { pClosing: 5120, pDrCotVal: 5130, priceYesterday: 5000, dEven: 20261025, hEven: 122959 } })); }
    return new Response('x', { status: 503 });
  });
  const { quotes, errors } = await P.fetchAll([{ provider: 'tsetmc', key: '123', field: 'close' }], { tgju: false });
  assert.equal(n, 2); assert.equal(quotes['tsetmc:123:close'].price, 5120); assert.equal(errors['tsetmc:123:close'], undefined);
  P.setRetryDelay(1500);
});

test('one failed refresh after a recent good price is not «قیمت قدیمی»', async () => {
  const E = await import('../../extension/lib/engine.js');
  const a = { id: 'x', name: 'فزر', category: 'stock', mode: 'units', quantity: 10, price: { source: 'market', ref: { provider: 'tsetmc', key: '1', field: 'close' } } };
  const now = Date.now();
  const q = (fetchedAgo) => ({ 'tsetmc:1:close': { price: 100, at: now - 3600e3, fetchedAt: now - fetchedAgo, error: 'خطای سرور (503)', errorAt: now } });
  const v1 = E.valueOf(a, q(10 * 60e3), {}, now);
  assert.equal(v1.status, 'live'); assert.match(v1.note, /همان قیمت قبلی/);
  assert.equal(E.valueOf(a, q(5 * 3600e3), {}, now).status, 'delayed');
});
