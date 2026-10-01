// Synthetic demo portfolio for UI/E2E tests — fictional names and amounts only.
// Usage: node dev/qa/demo_seed.mjs  → writes dev/qa/.seed.json (git-ignored)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as E from '../../extension/lib/engine.js';
import * as J from '../../extension/lib/jalali.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const now = Date.now(); const iso = J.todayIso();
const q = (price, pct, extra = {}) => ({ price, changePct: pct, change: price - price / (1 + pct), at: now - 600000, fetchedAt: now - 600000, source: 'mock', ...extra });
const mk = (o) => ({ createdAt: now, updatedAt: now, liquidity: 'mid', ...o });

const assets = [
  mk({ id: 'bankA', code: 'D-001', name: 'حساب بانکی الف', custodian: 'بانک الف', category: 'bank', mode: 'balance', balance: 4_000_000_000, balanceAt: now, liquidity: 'high',
    interest: { on: true, annualPct: 10, basis: 365, payDay: 1, since: J.addDaysIso(iso, -40), lastAccrual: J.addDaysIso(iso, -1), accrued: 1_000_000 } }),
  mk({ id: 'bankB', code: 'D-002', name: 'حساب بانکی ب', custodian: 'بانک ب', category: 'bank', mode: 'balance', balance: 90_000_000, balanceAt: now, liquidity: 'high' }),
  mk({ id: 'goldOnline', code: 'D-003', name: 'طلای آب‌شده', custodian: 'پلتفرم طلای نمونه', category: 'gold_online', mode: 'units', quantity: 30, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, adjustPct: 0, factor: 1 } }),
  mk({ id: 'gold', code: 'D-004', name: 'طلای فیزیکی', custodian: 'صندوق امانات', category: 'gold', mode: 'units', quantity: 10, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' } } }),
  mk({ id: 'coin', code: 'D-005', name: 'نیم سکه', custodian: 'صندوق امانات', category: 'gold', mode: 'units', quantity: 2, unit: 'عدد', price: { source: 'market', ref: { provider: 'tgju', key: 'nim' } } }),
  mk({ id: 'etf', code: 'D-006', name: 'صندوق طلای «زر»', custodian: 'کارگزاری نمونه', category: 'stock', mode: 'units', quantity: 1000, unit: 'واحد', price: { source: 'market', ref: { provider: 'tsetmc', key: '10000000000000001', symbol: 'زر', label: 'زر', field: 'close' } } }),
  mk({ id: 'priv', code: 'D-007', name: 'سهام شرکت خصوصی', custodian: 'شرکت نمونه', category: 'private', mode: 'units', quantity: 1_000_000, unit: 'سهم', price: { source: 'manual', value: 2500, updatedAt: now }, liquidity: 'low' }),
  mk({ id: 'usd', code: 'D-008', name: 'دلار', custodian: 'خانه', category: 'fx', mode: 'units', quantity: 2000, unit: 'دلار', price: { source: 'market', ref: { provider: 'tgju', key: 'price_dollar_rl' } }, liquidity: 'high' }),
  mk({ id: 'eur', code: 'D-009', name: 'یورو', custodian: 'خانه', category: 'fx', mode: 'units', quantity: 300, unit: 'یورو', price: { source: 'market', ref: { provider: 'tgju', key: 'price_eur' } }, liquidity: 'high' }),
  mk({ id: 'btc', code: 'D-010', name: 'بیت‌کوین', custodian: 'صرافی نمونه', category: 'crypto', mode: 'units', quantity: 0.002, unit: 'BTC', price: { source: 'market', ref: { provider: 'nobitex', key: 'btc' } }, liquidity: 'high' }),
  mk({ id: 'silver', code: 'D-011', name: 'نقره ۹۹۹', custodian: 'خانه', category: 'metal', mode: 'units', quantity: 300, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'silver_999' }, factor: 1 } }),
  mk({ id: 'copper', code: 'D-012', name: 'مس', custodian: 'انبار', category: 'metal', mode: 'units', quantity: 100, unit: 'کیلوگرم', price: { source: 'market', ref: { provider: 'tgju', key: 'base_global_copper' }, factor: 0.001 }, liquidity: 'low' }),
  mk({ id: 'fund', code: 'D-013', name: 'صندوق درآمد ثابت نمونه', custodian: 'کارگزاری نمونه', category: 'fixed', mode: 'rate', rate: { principal: 500_000_000, annualPct: 28, start: J.addDaysIso(iso, -50), mode: 'compound' }, liquidity: 'high' }),
  mk({ id: 'loanOut', code: 'D-014', name: 'قرض به دوست', custodian: '', category: 'receivable', mode: 'rate', rate: { principal: 1_000_000_000, annualPct: 24, start: J.addDaysIso(iso, -75), mode: 'payout', payoutTo: 'bankA', lastPayout: J.addJMonthsIso(J.addDaysIso(iso, -75), 2) }, liquidity: 'low' }),
];
const quotes = {
  'tgju:geram18': q(253_580_000, 0.0037), 'tgju:sekee': q(2_590_050_000, -0.004), 'tgju:nim': q(1_350_000_000, 0.002), 'tgju:rob': q(730_000_000, 0.001),
  'tgju:price_dollar_rl': q(2_547_000, 0.0028), 'tgju:price_eur': q(2_893_000, 0.0011), 'tgju:mesghal': q(1_098_490_000, 0.003), 'tgju:ons': q(4159.55, 0.0007),
  'tgju:silver_999': q(5_228_200, 0.006), 'tgju:silver_925': q(4_836_090, 0.006), 'tgju:base_global_copper': q(14_395.6, -0.0006), 'tgju:platinum': q(1721, 0.002),
  'nobitex:usdt': q(2_547_000, 0.0028, { approx: true, note: 'نوبیتکس در دسترس نبود؛ قیمت جهانی × نرخ دلار' }),
  'nobitex:btc': q(83_748.82 * 2_547_000, 0.004, { approx: true, note: 'نوبیتکس در دسترس نبود؛ قیمت جهانی × نرخ دلار' }),
  'tsetmc:10000000000000001:close': q(731_000, 0.006),
};
const flows = [{ id: 'f1', title: 'حقوق ماهانه', amount: 500_000_000, toId: 'bankA', fromId: null, freq: 'monthly', day: 25, start: J.addJMonthsIso(iso, -5), active: true, done: 5, lastRun: J.addJMonthsIso(iso, -1, 25) }];
const events = [{ id: 'e2', kind: 'flow', date: J.addDaysIso(iso, -3), at: now - 86400000 * 3, title: 'واریز پاداش', amount: 200_000_000, fromId: null, toId: 'bankA', changes: [{ assetId: 'bankA', field: 'balance', delta: 200_000_000 }] }];
const pf = E.portfolio(assets, quotes, {});
const snapshots = {};
for (let i = 200; i >= 1; i--) {
  const d = J.addDaysIso(iso, -i);
  const k = 1 - i * 0.0019 + Math.sin(i / 6) * 0.012 + Math.sin(i / 17) * 0.02;
  const v = {}; for (const r of pf.rows) v[r.asset.id] = Math.round(r.signedValue * k);
  if (i <= 3) v.bankA = Math.round(pf.rows.find((r) => r.asset.id === 'bankA').signedValue - 200_000_000);
  snapshots[d] = { t: Object.values(v).reduce((a, b) => a + b, 0), usd: 2_547_000 * (1 - i * 0.0011), gold: 253_580_000 * (1 - i * 0.0013), coin: 2_590_050_000 * (1 - i * 0.0012), cats: {}, v, est: i > 30 ? 1 : undefined };
}
const settings = { providers: { tgju: false, tsetmc: false, fipiran: false, nobitex: false }, onboarded: true, targets: { gold_online: 20, gold: 10, fx: 15, private: 20, bank: 15, stock: 10, crypto: 5, metal: 5 } };
const alerts = [{ id: 'al1', ref: { provider: 'tgju', key: 'geram18' }, op: 'lt', value: 240_000_000, active: true, createdAt: now }];
fs.writeFileSync(path.join(here, '.seed.json'), JSON.stringify({ assets, quotes, flows, events, snapshots, settings, alerts, reports: [], meta: { lastRun: now - 600000, lastOk: now - 600000, errCount: 0, errors: {} } }));
console.log('demo seed written:', assets.length, 'assets');
