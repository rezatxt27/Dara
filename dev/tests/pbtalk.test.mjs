import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as B from '../../extension/lib/builder.js';
import * as PT from '../../extension/lib/pbtalk.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/market-monthly.json', import.meta.url)));
const btc = Object.fromEntries(Object.entries(fx.btcUsd).filter(([m]) => fx.usd[m]).map(([m, v]) => [m, v * fx.usd[m]]));
const R = B.returnsFrom({ gold: fx.geram18, usd: fx.usd, index: fx.index, btc }, 24);

test('sentence: amount, horizon, risk and crypto without AI', () => {
  const a = PT.parseIntent('۷۰۰ میلیون دارم، دو سال لازمش ندارم، ریسک زیاد نمی‌خوام، رمزارز نه');
  assert.equal(a.amount, 7e9); assert.equal(a.horizon, 24); assert.equal(a.risk, 'low'); assert.equal(a.noCrypto, true); assert.equal(a.mode, null);
  const b = PT.parseIntent('یک میلیارد و ۲۰۰ میلیون تومن برای ۶ ماه، فقط همین پول، پرریسک');
  assert.equal(b.amount, 1.2e10); assert.equal(b.horizon, 6); assert.equal(b.mode, 'alone'); assert.equal(b.risk, 'high');
  const c = PT.parseIntent('۵۰۰ میلیون ریال کنار دارایی‌هام بلندمدت با ۱۰ سال گذشته');
  assert.equal(c.amount, 5e8); assert.equal(c.mode, 'with'); assert.equal(c.horizon, 36); assert.equal(c.years, 10);
  // a number before «سال» is time, not part of the amount
  const d = PT.parseIntent('نیم میلیارد یک سال و نیم ریسک متوسط بدون بیت کوین');
  assert.equal(d.amount, 5e9); assert.equal(d.horizon, 12); assert.equal(d.risk, 'mid'); assert.equal(d.noCrypto, true);
  assert.equal(PT.parseIntent('2 میلیارد 3 سال').amount, 2e10);
  // a bare amount in a Rial setting; and «ریسک بالا» said plainly
  assert.equal(PT.parseIntent('۳۰۰ میلیون', { unit: 'rial' }).amount, 3e8);
  // another currency is not toman; a monthly saving is still money; crypto words read as words
  const fx = PT.parseIntent('۲ میلیون دلار دارم');
  assert.equal(fx.amount, null); assert.equal(fx.fxAmount, true);
  assert.equal(PT.parseIntent('۳ میلیون ماهی پس انداز').amount, 3e7);
  assert.equal(PT.parseIntent('بیت کوین و خانه').noCrypto, null);
  assert.equal(PT.parseIntent('بیت کوین هم باشه ولی نه زیاد').noCrypto, false);
  assert.equal(PT.parseIntent('رمزارز نمی خوام').noCrypto, true);
  assert.equal(PT.parseIntent('بدون کریپتو').noCrypto, true);
  assert.equal(PT.parseIntent('ریسک بالا اوکیه').risk, 'high');
  // a time alone is not an amount; nothing said is null
  const e = PT.parseIntent('دو سال دیگه لازمش دارم');
  assert.equal(e.amount, null); assert.equal(e.horizon, 24); assert.equal(e.risk, null);
});

test('sentence: the AI never sees the amount it was not needed for, and its answer is checked', () => {
  const t = '۷۰۰ میلیون برای دو سال';
  const it = PT.parseIntent(t);
  assert.ok(!/700|۷۰۰/.test(PT.maskedSentence(t, it)));
  // every number that is not a time is hidden, found or not
  for (const x of ['200000000 دارم برای دو سال', '۳ میلیون ماهی پس انداز می کنم', '۲ میلیون دلار و ۵۰۰ هزار تومن', 'حدود ۲۰۰,۰۰۰,۰۰۰']) {
    const m = PT.maskedSentence(x, PT.parseIntent(x));
    assert.ok(!/\d{3}|میلیون|هزار/.test(m), m);
  }
  assert.ok(/2 سال|دو سال/.test(PT.maskedSentence('۷۰۰ میلیون دو سال', PT.parseIntent('۷۰۰ میلیون دو سال'))));
  const ai = PT.cleanIntent({ amount_toman: 'x', months: 10, mode: 'both', risk: 'mid', no_crypto: 'yes', past_years: 7 });
  assert.deepEqual([ai.amount, ai.horizon, ai.mode, ai.risk, ai.noCrypto, ai.years], [null, 12, null, 'mid', null, null]);
  const m = PT.mergeIntent(it, PT.cleanIntent({ amount_toman: 1, months: 6, risk: 'low' }));
  assert.equal(m.amount, 7e9); assert.equal(m.horizon, 6); assert.equal(m.risk, 'low');
  assert.equal(PT.mergeIntent({ ...PT.parseIntent('تا عید'), amount: null }, PT.cleanIntent({ amount_toman: 5e8 })).amount, 5e9);
});

test('builder: a risk said in a sentence picks the fitting mix and drops crypto for this run only', () => {
  const profile = { goal: 'grow', horizon: 'long', drop: 'buy' };
  const base = B.build({ R, profile, amount: 7e9, horizon: 24, mode: 'alone' });
  assert.equal(base.level, 'high'); assert.equal(base.levelFrom, 'profile');
  const r = B.build({ R, profile, amount: 7e9, horizon: 24, mode: 'alone', prefs: { risk: 'low', noCrypto: true } });
  assert.equal(r.level, 'low'); assert.equal(r.levelFrom, 'sentence'); assert.equal(r.noCrypto, true);
  assert.equal(r.cands.find((c) => c.fits).id, 'low');
  for (const c of r.cands.filter((x) => x.level)) assert.ok(!(c.weights.btc > 0), c.id);
  assert.equal(B.build({ R, amount: 7e9, horizon: 24, mode: 'alone' }).levelFrom, null);
});

test('explain: percentages only, never an amount', () => {
  const r = B.build({ R, amount: 7.123e9, horizon: 24, mode: 'alone' });
  const f = PT.explainFacts(r, { pick: 'ریسک کم' });
  const txt = JSON.stringify(f);
  assert.ok(!txt.includes('7123') && !/value0|adds|"bad":\s*\d{6,}/.test(txt));
  assert.equal(f.portfolios.length, r.cands.length);
  assert.ok(Math.abs(Object.values(f.portfolios[0].mix_pct).reduce((a, b) => a + b, 0) - 100) <= 3);
  assert.equal(PT.cleanExplain({ summary: '', points: [] }), null);
  assert.deepEqual(PT.cleanExplain({ summary: 'الف', points: ['ب', 3, ''], watch: 'ج' }), { summary: 'الف', points: ['ب'], watch: 'ج' });
});
