// Automatic backups (lib/backup.js). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../extension/lib/backup.js';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 8, 9, 0, 0); // 1405-07-16

test('due: never when off, at once the first time, a period after the last (an hour early is fine)', () => {
  assert.equal(B.isDue({ freq: 'off' }, {}, now), false);
  assert.equal(B.isDue({ freq: 'weekly' }, {}, now), true);
  assert.equal(B.isDue({ freq: 'weekly' }, { lastAt: now - 6 * DAY }, now), false);
  assert.equal(B.isDue({ freq: 'weekly' }, { lastAt: now - 7 * DAY + 1800000 }, now), true);
  assert.equal(B.isDue({ freq: 'daily' }, { lastAt: now - 23.5 * 3600000 }, now), true);
  assert.equal(B.isDue({ freq: 'weekly' }, { lastAt: now - 9 * DAY, checkedAt: now - DAY }, now), false, 'checked and nothing had changed');
  assert.deepEqual(B.backupSettings({}), { freq: 'weekly', keep: 'all', last: 8 }, 'defaults: weekly, keep everything');
});

test('a change is what the owner entered, not prices or the daily history', () => {
  const st = { assets: [{ id: 'a', balance: 1 }], flows: [], events: [], alerts: [], settings: { theme: 'auto', lastUpdateCheck: 1 }, quotes: { x: 1 }, snapshots: { d: 1 } };
  const h = B.coreHash(st);
  assert.equal(B.coreHash({ ...st, quotes: { x: 2 }, snapshots: { d: 2, e: 3 }, settings: { theme: 'auto', lastUpdateCheck: 99 } }), h);
  assert.notEqual(B.coreHash({ ...st, assets: [{ id: 'a', balance: 2 }] }), h);
});

test('file names: Jalali date in the backup folder; locked ones say so', () => {
  assert.equal(B.fileName(now), 'Dara-Backups/dara-backup-1405-07-16.json');
  assert.equal(B.fileName(now, { locked: true }), 'Dara-Backups/dara-backup-1405-07-16-locked.json');
});

test('keeping files: all by default, smart thinning like Time Machine, or the last few', () => {
  const files = Array.from({ length: 120 }, (_, i) => ({ id: i, at: now - i * 7 * DAY })); // weekly, over ~2.3 years
  assert.deepEqual(B.toRemove(files, 'all', { now }), []);
  const last = B.toRemove(files, 'last', { now, last: 8 });
  assert.equal(last.length, 112); assert.ok(!last.includes(0));
  const gone = new Set(B.toRemove(files, 'smart', { now }));
  const kept = files.filter((f) => !gone.has(f.id));
  assert.ok(kept.filter((f) => now - f.at <= 28 * DAY).length === 5, 'all of the last four weeks');
  const yearKept = kept.filter((f) => now - f.at > 28 * DAY && now - f.at <= 365 * DAY);
  assert.ok(yearKept.length >= 10 && yearKept.length <= 13, `about one a month: ${yearKept.length}`);
  const older = kept.filter((f) => now - f.at > 365 * DAY);
  assert.ok(older.length >= 1 && older.length <= 3, `one a year: ${older.length}`);
  assert.deepEqual(B.toRemove([{ id: 'x', at: now - 900 * DAY }], 'smart', { now }), [], 'the newest is never removed');
});

test('password: a locked backup opens with the right password only, and contains no trace of the key', async () => {
  const vault = await B.makeKey('رمز-آزمایشی ۱۲۳');
  const obj = { app: 'dara', schema: 1, exportedAt: '2026-10-08T09:00:00Z', data: { assets: [{ id: 'a', name: 'حساب الف', balance: 5 }] } };
  const env = await B.encrypt(obj, vault);
  assert.ok(B.isLocked(env)); assert.ok(!JSON.stringify(env).includes('حساب الف'), 'nothing readable inside');
  assert.ok(!JSON.stringify(env).includes(vault.key), 'the key is not in the file');
  assert.deepEqual(await B.decrypt(env, 'رمز-آزمایشی ۱۲۳'), obj);
  await assert.rejects(B.decrypt(env, 'غلط'), /رمز درست نیست/);
  const again = await B.makeKey('رمز-آزمایشی ۱۲۳', vault.salt);
  assert.equal(again.key, vault.key, 'same password and salt → same key');
});

test('file payload: plain JSON when small, gzip when large, locked envelope with a password', async () => {
  const small = await B.filePayload({ app: 'dara', data: { a: 1 } });
  assert.equal(small.ext, ''); assert.ok(small.url.startsWith('data:application/json;base64,'));
  const big = { app: 'dara', data: { snapshots: Object.fromEntries(Array.from({ length: 30000 }, (_, i) => [`2026-01-${i}`, { t: i * 123456789, v: { a: i, b: i * 2 } }])) } };
  const p = await B.filePayload(big);
  assert.equal(p.ext, '.gz'); assert.ok(p.url.length < 2_000_000, 'fits in a data: URL');
  const bytes = B.fromB64(p.url.split(',')[1]); assert.ok(B.isGzip(bytes));
  assert.deepEqual(JSON.parse(await B.gunzip(bytes)), big);
  const vault = await B.makeKey('x');
  const lk = await B.filePayload(big, vault);
  assert.equal(lk.locked, true);
  const env = JSON.parse(new TextDecoder().decode(B.fromB64(lk.url.split(',')[1])));
  assert.deepEqual(await B.decrypt(env, 'x'), big);
});

test('review: a price refresh is not a change; display settings are not either', () => {
  const st = { assets: [{ id: 'g', mode: 'units', price: { source: 'market', ref: { key: 'geram18' } } }], settings: { theme: 'auto' } };
  const h = B.coreHash(st);
  const refreshed = { ...st, assets: [{ ...st.assets[0], price: { ...st.assets[0].price, last: { price: 5, at: 1 } } }], settings: { theme: 'dark', privacy: true, backup: { freq: 'daily' } } };
  assert.equal(B.coreHash(refreshed), h);
});

test('review: a locked file opens with the iteration count it was made with', async () => {
  const old = await B.makeKey('رمز طولانی ۱', null, 250000);
  const env = await B.encrypt({ app: 'dara', data: { x: 1 } }, old);
  assert.equal(env.kdf.iterations, 250000);
  assert.deepEqual(await B.decrypt(env, 'رمز طولانی ۱'), { app: 'dara', data: { x: 1 } });
  const cur = await B.makeKey('رمز طولانی ۲');
  assert.equal(cur.iterations, 600000); assert.equal((await B.encrypt({ a: 1 }, cur)).kdf.iterations, 600000);
  await assert.rejects(B.decrypt({ ...env, kdf: { ...env.kdf, iterations: 5 } }, 'x'), /خراب/);
  assert.ok(B.PASSWORD_MIN >= 8);
});

test('review: a file waiting in a «Save as» dialog is never removed by thinning', () => {
  const files = [{ id: 1, at: 1000 }, { id: 2, at: 2000, pending: true }, { id: 3, at: 3000 }];
  assert.deepEqual(B.toRemove(files, 'last', { last: 1 }), [1]);
});

test('review: restoring a backup keeps how this computer backs up', async () => {
  const store = await import('../../extension/lib/store.js');
  await store.clearAll();
  await store.save({ settings: { ...store.DEFAULT_SETTINGS, backup: { freq: 'off', keep: 'all', last: 8 } } });
  const file = { app: 'dara', schema: 1, data: { assets: [], settings: { ...store.DEFAULT_SETTINGS, theme: 'dark', backup: { freq: 'daily', keep: 'last', last: 2 } } } };
  await store.importBackup(file);
  const { settings } = await store.load('settings');
  assert.equal(settings.theme, 'dark'); assert.deepEqual(settings.backup, { freq: 'off', keep: 'all', last: 8 });
});
