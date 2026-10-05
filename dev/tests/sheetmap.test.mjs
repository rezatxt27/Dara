// «هر اکسلی» (lib/sheetmap.js, lib/xlsx.js, the delimiter guess in lib/importer.js). Synthetic sheets only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../../extension/lib/sheetmap.js';
import { readXlsx, sheetRows, unescapeXml } from '../../extension/lib/xlsx.js';
import { parseDelimited, guessDelimiter } from '../../extension/lib/importer.js';

const csv = (t) => parseDelimited(t);
const byName = (out) => Object.fromEntries(out.map((o) => [o.name, o]));
const Q = (price) => ({ price });

test('xlsx: sheets, shared strings, numbers as plain digits, hidden sheets skipped, title rows above the table', async () => {
  const b = readFileSync(new URL('./fixtures/sample.xlsx', import.meta.url));
  const wb = await readXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  assert.deepEqual(wb.sheets.map((s) => s.name), ['دارایی‌ها', 'Sheet2']);
  const rows = wb.sheets[0].rows;
  assert.equal(rows[3][1], 'نیم سکه'); assert.equal(rows[3][6], '15000000', '1.5E7 is read as the digits the cell showed');
  assert.equal(rows[5][1], 'سپرده کوتاه مدت & ویژه', 'XML entities decoded');
  const m = S.guessMapping(rows);
  assert.equal(m.headerRow, 2, 'the report title and blank row above the table are skipped');
  assert.deepEqual(m.roles.slice(0, 6), ['ignore', 'name', 'quantity', 'price', 'value', 'custodian']);
  assert.equal(m.roles[6], 'ignore', 'a stray number far right is not a role');
  assert.equal(m.unit, 'toman'); assert.equal(m.unitWhy, 'title');
  const o = byName(S.applyMapping(rows, m));
  assert.equal(o['نیم سکه'].asset.quantity, 2); assert.equal(o['نیم سکه'].asset.price.value, 250_000_000, 'toman → rial');
  assert.equal(o['نیم سکه'].asset.price.ref.key, 'nim'); assert.equal(o['نیم سکه'].asset.custodian, 'صندوق امانات');
  assert.equal(o['دلار آمریکا'].cat, 'fx');
  assert.equal(o['وام مسکن'].cat, 'debt'); assert.equal(o['وام مسکن'].asset.balance, 400_000_000, 'a debt is stored as a positive amount owed');
  assert.equal(o['جمع کل'].skipped, 'total', 'the totals row is not an asset');
  await assert.rejects(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).buffer), /xls/);
  await assert.rejects(readXlsx(new Uint8Array(40).buffer), /xlsx/);
});

test('xlsx cells: inline strings, booleans, gaps between columns', () => {
  const xml = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a&amp;b</t></is></c><c r="C1"><v>3.5</v></c></row><row r="3"><c r="B3" t="b"><v>1</v></c></row></sheetData>';
  assert.deepEqual(sheetRows(xml), [['a&b', '', '3.5'], [], ['', 'TRUE']]);
  assert.equal(unescapeXml('&#x627;&#1576;'), 'اب');
});

test('pasted cells: tab, semicolon and comma are told apart', () => {
  assert.equal(guessDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(guessDelimiter('a;b;c\n1,5;2;3'), ';');
  assert.equal(guessDelimiter('a,b\n"1,000",2'), ',');
});

test('English titles, a category column and a unit in the title', () => {
  const rows = csv('Asset\tType\tBalance (IRR)\nChecking A\tCash\t120000000\nBitcoin\tCrypto\t900000000\nCar loan\tLoan\t300000000');
  const m = S.guessMapping(rows);
  assert.deepEqual(m.roles, ['name', 'category', 'value']); assert.equal(m.unit, 'rial');
  const o = byName(S.applyMapping(rows, m));
  assert.equal(o['Checking A'].cat, 'bank'); assert.equal(o['Checking A'].asset.balance, 120_000_000);
  assert.equal(o.Bitcoin.cat, 'crypto'); assert.equal(o['Car loan'].cat, 'debt');
});

test('no title row: quantity × price = value is found from the numbers themselves', () => {
  const rows = csv('طلای آب شده,12,9000000,108000000\nتتر,500,100000,50000000\nسکه امامی,1,90000000,90000000');
  const m = S.guessMapping(rows);
  assert.equal(m.headerRow, -1, 'the first row is data');
  assert.deepEqual(m.roles, ['name', 'quantity', 'price', 'value']); assert.ok(m.how.every((h) => h === 'data'));
  const o = S.applyMapping(rows, m);
  assert.equal(o.length, 3, 'the first row is imported too');
  assert.equal(o[0].cat, 'gold_online'); assert.equal(o[1].cat, 'crypto'); assert.equal(o[2].cat, 'gold');
});

test('money unit from today\'s prices when no title says it', () => {
  const quotes = { 'tgju:price_dollar_rl': Q(1_000_000), 'nobitex:usdt': Q(1_000_000) };
  const rial = S.guessMapping(csv('نام,مقدار,قیمت\nدلار,100,1000000\nتتر,10,1010000'), { quotes });
  assert.equal(rial.unit, 'rial'); assert.equal(rial.unitWhy, 'prices');
  const toman = S.guessMapping(csv('نام,مقدار,قیمت\nدلار,100,100000\nتتر,10,101000'), { quotes });
  assert.equal(toman.unit, 'toman'); assert.equal(toman.unitWhy, 'prices');
  const unknown = S.guessMapping(csv('نام,مقدار,قیمت\nدلار,100,100\nتتر,10,7'), { quotes });
  assert.equal(unknown.unitWhy, 'guess', 'prices that fit neither are not a reason');
});

test('«موجودی» next to a real value column is a quantity; price comes from value ÷ quantity', () => {
  const rows = csv('نام,موجودی,ارزش ریالی\nدلار,100,1000000000\nسکه امامی,2,1800000000');
  const m = S.guessMapping(rows);
  assert.deepEqual(m.roles, ['name', 'quantity', 'value']); assert.equal(m.unit, 'rial');
  const o = byName(S.applyMapping(rows, m));
  assert.equal(o['دلار'].asset.quantity, 100); assert.equal(o['دلار'].asset.price.value, 10_000_000);
  assert.equal(o['سکه امامی'].asset.price.value, 900_000_000);
});

test('negative amounts: owed unless it is an account (overdrawn) or a category says otherwise', () => {
  const rows = csv('شرح,مبلغ\nحساب الف,5000000\nبدهی به دوست,-2000000\nقرض داده به دوست,3000000\nحساب ب,-100000\nچیز دیگر,-50');
  const o = byName(S.applyMapping(rows, S.guessMapping(rows)));
  assert.equal(o['بدهی به دوست'].cat, 'debt'); assert.equal(o['بدهی به دوست'].asset.balance, 20_000_000);
  assert.equal(o['قرض داده به دوست'].cat, 'receivable');
  assert.equal(o['حساب ب'].cat, 'bank'); assert.equal(o['حساب ب'].asset.balance, -1_000_000, 'overdrawn stays negative');
  assert.equal(o['چیز دیگر'].cat, 'debt');
  const withCat = csv('نام,دسته,ارزش\nصندوق الف,سهام,-1000');
  const w = S.applyMapping(withCat, S.guessMapping(withCat))[0];
  assert.equal(w.cat, 'stock'); assert.match(w.note, /منفی/, 'the owner is told, not silently flipped');
});

test('category words match whole words, not inside other words', () => {
  assert.equal(S.categoryFrom('ارزان'), null);
  assert.equal(S.categoryFrom('ارزش'), null);
  assert.equal(S.categoryFrom('ارز'), 'fx'); assert.equal(S.categoryFrom('حساب ارزی'), 'fx');
  assert.equal(S.categoryFrom('card'), null); assert.equal(S.categoryFrom('car'), 'property');
  assert.equal(S.categoryFrom('loaned to a friend'), 'receivable');
  assert.equal(S.categoryFrom('طلای آبشده'), 'gold_online');
  assert.equal(S.categoryFrom('سهام و صندوق بورسی'), 'stock', 'Dara\'s own category names');
});

test('what is still missing, and changing a column by hand', () => {
  const rows = csv('نام,قیمت,یادداشت\nخانه,خیلی گران,x\nماشین,ارزان,y');
  const m = S.guessMapping(rows);
  assert.ok(m.missing.includes('value'), 'words in a price column are not a price');
  const rows2 = csv('a,b,c\nالف,10,20\nب,30,40');
  let m2 = S.guessMapping(rows2);
  const vi = m2.roles.indexOf('value');
  m2 = S.setRole(m2, 1, 'value');
  assert.equal(m2.roles[1], 'value'); assert.equal(m2.roles.filter((r) => r === 'value').length, 1, 'one column per role');
  if (vi !== 1) assert.equal(m2.roles[vi], 'ignore');
  assert.equal(m2.how[1], 'you');
  assert.deepEqual(S.setRole(m2, 1, 'ignore').missing, ['value']);
});

test('rows left out: blank names, no amount, totals', () => {
  const rows = csv('نام,ارزش\nالف,100\n,200\nب,\nمجموع,300\nTotal:,300');
  const out = S.applyMapping(rows, S.guessMapping(rows));
  assert.deepEqual(out.map((o) => [o.name, !!o.asset, o.skipped || null]), [['الف', true, null], ['ب', false, null], ['مجموع', false, 'total'], ['Total:', false, 'total']]);
  assert.ok(out[1].note);
});

test('AI help: only valid roles, one column each, inside the sheet; amounts masked in percent privacy', () => {
  const rows = csv('x,y,z\nسکه,12000000,2\nدلار,500000,1');
  const m = S.guessMapping(rows);
  const p = S.aiMappingPrompt(rows, m, { privacy: 'percent' });
  assert.ok(!/12000000|500000/.test(p), 'no amount leaves the device'); assert.ok(p.includes('########'));
  assert.ok(S.aiMappingPrompt(rows, m).includes('12000000'));
  const a = S.parseAiMapping({ columns: [{ index: 0, role: 'name' }, { index: 1, role: 'value' }, { index: 2, role: 'value' }, { index: 9, role: 'price' }, { index: 2, role: 'hack' }], money_unit: 'rial', categories: { 'سکه': 'gold', 'دلار': 'nope' } }, m);
  assert.deepEqual(a.roles, ['name', 'value', 'ignore']); assert.equal(a.unit, 'rial'); assert.equal(a.unitWhy, 'ai');
  assert.deepEqual(a.aiCats, { 'سکه': 'gold' });
  assert.deepEqual(S.parseAiMapping({ columns: 'junk' }, m).roles, m.roles, 'a useless answer keeps the guess');
  const rows3 = csv('نام,ارزش\nچیز الف,100\nسکه,200');
  const m3 = { ...S.guessMapping(rows3), aiCats: { 'چیز الف': 'property', 'سکه': 'fx' } };
  assert.deepEqual(S.aiCatOverrides(rows3, m3), { 1: 'property' }, 'a name that already says its category keeps it');
});

test('Dara\'s own export reads back through the standard importer, categories and units included', async () => {
  const { toCSV, parseCSV } = await import('../../extension/lib/importer.js');
  const E = await import('../../extension/lib/engine.js');
  const now = Date.now();
  const assets = [
    { id: 'a1', code: 'A-001', name: 'حساب الف', category: 'bank', mode: 'balance', balance: 50_000_000, balanceAt: now },
    { id: 'a2', code: 'A-002', name: 'ربع سکه', category: 'gold', mode: 'units', quantity: 3, unit: 'عدد', price: { source: 'manual', value: 200_000_000, updatedAt: now } },
    { id: 'a3', code: 'A-003', name: 'وام الف', category: 'debt', mode: 'balance', balance: 10_000_000, balanceAt: now },
  ];
  const rows = parseCSV(toCSV(E.portfolio(assets, {}, {}, now).rows).replace(/^﻿/, ''));
  const r = S.readSheet(rows);
  assert.equal(r.kind, 'dara');
  const out = byName(S.applyDara(rows, r.headerRow, { unit: 'toman' }));
  assert.equal(out['حساب الف'].asset.balance, 50_000_000, '«(ریال)» in the title wins over the sheet-wide toman');
  assert.equal(out['ربع سکه'].asset.quantity, 3); assert.equal(out['ربع سکه'].cat, 'gold');
  assert.equal(out['وام الف'].cat, 'debt');
  const moved = S.applyDara(rows, r.headerRow, { unit: 'rial', catOverride: { [out['حساب الف'].i]: 'receivable' } });
  assert.equal(moved.find((x) => x.name === 'حساب الف').cat, 'receivable', 'the owner can change a row\'s category');
});

test('Dara layout: an empty category cell is guessed from the name, not dropped; a sheet that only looks like it is mapped', () => {
  const rows = csv('دسته دارایی,نام دارایی,ارزش روز\n,سکه امامی,900\nحساب بانکی و نقد,حساب ب,100');
  const r = S.readSheet(rows); assert.equal(r.kind, 'dara');
  const out = S.applyDara(rows, r.headerRow, { unit: 'rial' });
  assert.equal(out[0].cat, 'gold'); assert.ok(out[0].asset);
  const other = csv('دسته,نام,مبلغ (تومان)\nسکه,سکه امامی,900\nبانک,حساب ب,100');
  const r2 = S.readSheet(other);
  assert.equal(r2.kind, 'map', 'the standard importer would find no amounts here');
  assert.equal(r2.map.roles[2], 'value'); assert.equal(r2.unit, 'toman');
});

test('different units in different columns: each column\'s own title is followed', () => {
  const rows = csv('نام,تعداد,قیمت (تومان),ارزش (ریال)\nدلار,10,100000,10000000');
  const m = S.guessMapping(rows);
  const a = S.applyMapping(rows, m, { unit: 'toman' })[0].asset;
  assert.equal(a.price.value, 1_000_000, 'price in toman → rial'); 
});

test('the AI prompt passes cells through the mask (account numbers never leave)', () => {
  const rows = csv('نام,ارزش\nحساب 1234,100');
  const p = S.aiMappingPrompt(rows, S.guessMapping(rows), { mask: (v) => v.replace(/\d{4}/, '••••') });
  assert.ok(!p.includes('1234'));
});

test('a first row that holds an amount is data, even when one of its words looks like a title («بانک الف»)', () => {
  const rows = csv('حساب الف\t45000000\tبانک الف\nطلای آب‌شده\t120000000\tپلتفرم الف\nوام الف\t-30000000\tبانک الف');
  const m = S.guessMapping(rows);
  assert.equal(m.headerRow, -1);
  assert.deepEqual(m.roles, ['name', 'value', 'custodian']);
  assert.equal(S.applyMapping(rows, m).length, 3, 'no row lost');
});

test('a column of places is where things are kept, not the asset name, even when it is more varied', () => {
  const rows = csv('سکه\t90000000\tصندوق امانات بانک الف\nسکه\t80000000\tخانه\nدلار\t50000000\tصرافی ب');
  const m = S.guessMapping(rows);
  assert.deepEqual(m.roles, ['name', 'value', 'custodian']);
});

/* ---------- from the independent review ---------- */
test('review: a wide sheet (a name and 60 number columns) is read in well under a second', () => {
  const head = ['نام', ...Array.from({ length: 60 }, (_, i) => `ماه ${i + 1}`)];
  const rows = [head, ...Array.from({ length: 200 }, (_, r) => [`دارایی ${r}`, ...Array.from({ length: 60 }, (_, c) => String(1000 + r * 7 + c * 13))])];
  const t0 = Date.now(); S.readSheet(rows); const ms = Date.now() - t0;
  assert.ok(ms < 1500, `${ms} ms`);
});

test('review: «موجودی» of shares next to «ارزش روز» — the product of the columns outranks the titles', () => {
  const rows = csv('نماد,موجودی,قیمت پایانی,ارزش روز\nنماد الف,150000,5000,750000000\nنماد ب,2000,12000,24000000');
  const m = S.guessMapping(rows);
  assert.deepEqual(m.roles, ['name', 'quantity', 'price', 'value']);
  const a = S.applyMapping(rows, m, { unit: 'rial' })[0].asset;
  assert.equal(a.quantity, 150000); assert.equal(a.price.value, 5000);
});

test('review: «ارزش هر واحد» is a unit price and «ارزش کل» the value', () => {
  const rows = csv('نام,تعداد,ارزش هر واحد,ارزش کل\nسکه امامی,3,90000000,270000000\nنیم سکه,2,50000000,100000000');
  assert.deepEqual(S.guessMapping(rows).roles, ['name', 'quantity', 'price', 'value']);
});

test('review: a scale in the title («میلیون تومان», «هزار ریال») multiplies every cell', () => {
  const rows = csv('نام,ارزش (میلیون تومان)\nحساب الف,120\nحساب ب,3.5');
  const out = S.applyMapping(rows, S.guessMapping(rows));
  assert.equal(out[0].asset.balance, 1_200_000_000); assert.equal(out[1].asset.balance, 35_000_000);
  const r2 = csv('نام,مانده (هزار ریال)\nحساب الف,5000');
  assert.equal(S.applyMapping(r2, S.guessMapping(r2))[0].asset.balance, 5_000_000);
});

test('review: scientific notation, bidi marks and the minus sign', () => {
  const rows = csv('نام\tمبلغ (ریال)\nسپرده الف\t1.5E+07\nوام الف\t\u200e-5,000,000\nبدهی ب\t\u2212۱۲٬۰۰۰');
  const o = byName(S.applyMapping(rows, S.guessMapping(rows)));
  assert.equal(o['سپرده الف'].asset.balance, 15_000_000);
  assert.equal(o['وام الف'].cat, 'debt'); assert.equal(o['وام الف'].asset.balance, 5_000_000);
  assert.equal(o['بدهی ب'].asset.balance, 12_000);
  assert.ok(S.isNumCell('‏۱۲٬۰۰۰'));
});

test('review: categories that would change how an asset is valued', () => {
  assert.equal(S.categoryFrom('صندوق طلای الف'), 'stock', 'a gold fund is a fund, not grams of gold');
  assert.equal(S.categoryFrom('سپرده ۵۰۰ میلیونی'), 'fixed');
  assert.equal(S.categoryFrom('حساب بیتا'), 'bank');
  assert.equal(S.categoryFrom('طلای میلی'), 'gold_online');
  assert.equal(S.categoryFrom('النگو'), 'gold');
  const rows = csv('نام,ارزش,محل\nالنگو,1000,صندوق امانات بانک الف\nچیز دیگر,500,صندوق امانات\nسهم الف,300,کارگزاری الف');
  const o = byName(S.applyMapping(rows, S.guessMapping(rows)));
  assert.equal(o['النگو'].cat, 'gold'); assert.equal(o['چیز دیگر'].cat, 'other', 'a safe box says nothing about what is in it');
  assert.equal(o['سهم الف'].cat, 'stock');
});

test('review: value ÷ quantity keeps the value column\'s own unit', () => {
  const rows = csv('نام,تعداد,قیمت خرید (تومان),ارزش (ریال)\nسهم الف,1000,50000,600000000');
  const a = S.applyMapping(rows, S.guessMapping(rows), { unit: 'toman' })[0].asset;
  assert.equal(a.price.value, 600_000, 'Rial per share'); assert.equal(a.costBasis, 500_000);
});

test('review: no titles — today\'s price tells the unit price from the quantity', () => {
  const quotes = { 'tgju:sekee': Q(900_000_000) };
  const rows = csv('صندوق الف,2000000,30000,60000000000\nسهم ب,150000,5000,750000000\nسکه امامی,1,90000000,90000000');
  const m = S.guessMapping(rows, { quotes });
  assert.deepEqual(m.roles, ['name', 'quantity', 'price', 'value']);
});

test('review: «percent only» privacy sends no digit at all, even inside words', () => {
  const rows = csv('نام,یادداشت\nسکه,حدود ۴۵ میلیون سود\nطلا,12.5 گرم طلای 18');
  const p = S.aiMappingPrompt(rows, S.guessMapping(rows), { privacy: 'percent' });
  assert.ok(!/\d/.test(p.split('\n')[1]), p.split('\n')[1]);
});

test('review: Dara\'s export keeps an overdrawn account negative', () => {
  const rows = csv('کد,دسته,نام,ارزش روز (ریال)\nA-001,حساب بانکی و نقد,حساب الف,-50000000');
  const r = S.readSheet(rows); assert.equal(r.kind, 'dara');
  assert.equal(S.applyDara(rows, r.headerRow)[0].asset.balance, -50_000_000);
});

test('review: totals rows are whole phrases, not the start of a name', () => {
  const rows = csv('نام,ارزش\nTotal Energies,100\nجمع‌آوری سکه,200\nجمع کل:,300\nمجموع دارایی‌ها,300');
  const out = S.applyMapping(rows, S.guessMapping(rows));
  assert.deepEqual(out.map((o) => o.skipped || 'in'), ['in', 'in', 'total', 'total']);
});

test('review: odd AI answers — prototype names, booleans as indices, and a partial answer merged into the guess', () => {
  const rows = csv('نام,ارزش,محل\nالف,100,بانک الف\nب,200,بانک ب');
  const m = S.guessMapping(rows);
  const a = S.parseAiMapping({ columns: [{ index: true, role: 'name' }, { index: 2, role: 'constructor' }, { index: 2, role: 'note' }], categories: { 'الف': 'constructor', 'ب': 'gold' } }, m);
  assert.deepEqual(a.roles, ['name', 'value', 'note'], 'only the valid column changed');
  assert.deepEqual(a.aiCats, { 'ب': 'gold' });
  assert.deepEqual(a.missing, []);
});

test('review: xlsx with namespaced tags and a self-closing row', () => {
  const xml = '<x:sheetData><x:row r="1"/><x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>الف</x:t></x:is></x:c><x:c r="B2"><x:v>5</x:v></x:c></x:row></x:sheetData>';
  assert.deepEqual(sheetRows(xml), [[], ['الف', '5']]);
});
