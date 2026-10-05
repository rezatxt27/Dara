// «هر اکسلی»: read a sheet laid out any way — any column names, any order, with or without a category column — by
// guessing what each column holds (from its title and its values), letting the owner fix the guess, and then turning
// the rows into Dara assets through the same importer the standard template uses. Pure; money is Rial after import.
import { parseNum, toEnDigits } from './format.js';
import { CAT, CATEGORIES } from './catalog.js';
import { importRows } from './importer.js';

export const ROLES = [
  ['name', 'نام دارایی'], ['value', 'ارزش یا مانده'], ['quantity', 'مقدار / تعداد'], ['price', 'قیمت هر واحد'], ['category', 'دسته'],
  ['custodian', 'محل نگهداری'], ['unit', 'واحد'], ['cost', 'بهای خرید'], ['note', 'یادداشت'], ['code', 'کد'], ['ignore', 'نادیده بگیر'],
];
export const ROLE_NAME = Object.fromEntries(ROLES);
const SINGLE = new Set(ROLES.map(([r]) => r).filter((r) => r !== 'ignore'));

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const lc = (s) => toEnDigits(String(s ?? '')).replace(BIDI, '').replace(/\u2212/g, '-').replace(/‌/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim().toLowerCase();
// words match at the start of a word (« ارز» finds «ارز» and «ارزی» but not «ارزان»'s neighbours like «ارزش»: those are
// listed whole, with a trailing space); s is padded with spaces by the callers
const any = (s, words) => words.some((w) => s.includes(' ' + w));

// Title words for each role, most specific first («قیمت خرید» is a cost, not a unit price; «مبلغ خرید» likewise).
const TITLE = [
  ['cost', ['بهای تمام', 'قیمت خرید', 'مبلغ خرید', 'هزینه خرید', 'قیمت تمام', 'cost', 'paid', 'purchase', 'basis', 'book value']],
  ['value', ['قیمت کل', 'ارزش', 'مانده', 'موجودی', 'مبلغ', 'جمع', 'مجموع', 'value', 'balance', 'total', 'worth', 'amount', 'market value']],
  ['price', ['قیمت هر', 'قیمت واحد', 'فی ', 'فی(', 'نرخ', 'unit price', 'price', 'قیمت', 'rate']],
  ['quantity', ['مقدار', 'تعداد', 'وزن', 'حجم', 'quantity', 'qty', 'units', 'shares', 'weight', 'count', 'گرم']],
  ['category', ['دسته', 'نوع', 'گروه', 'طبقه', 'category', 'type', 'class', 'kind']],
  ['custodian', ['محل', 'نزد', 'کارگزاری', 'صرافی', 'پلتفرم', 'بانک', 'custodian', 'broker', 'bank', 'platform', 'location', 'where', 'account']],
  ['unit', ['واحد', 'unit']],
  ['note', ['یادداشت', 'توضیح', 'ملاحظات', 'note', 'comment', 'remark']],
  ['code', ['کد', 'شناسه', 'code', 'id ', 'id(']],
  ['name', ['نام', 'عنوان', 'شرح', 'دارایی', 'name', 'asset', 'item', 'description', 'title', 'symbol', 'نماد']],
];
// «ارزش هر واحد», «مبلغ هر گرم», «value per unit» are a unit price, not a value
const PER = / (هر|per|each) | واحد |unit (price|value)/;
const MONEYW = [' ارزش', ' قیمت', ' مبلغ', ' value', ' price', ' amount', ' نرخ'];
const titleRole = (h) => { const s = ' ' + lc(h) + ' '; if (!s.trim()) return null; if (PER.test(s.replace(/[()]/g, ' ')) && MONEYW.some((w) => s.includes(w)) && !/ کل |total/.test(s)) return 'price'; for (const [r, ws] of TITLE) if (any(s, ws)) return r; return null; };

/** a cell that is a number (maybe with separators and a short unit after it), not text that happens to hold digits */
export function isNumCell(v) {
  const s = lc(v).replace(/[()]/g, '');
  if (!s) return false;
  return /^[-+]?\s*[$€£]?\s*[-+]?[\d][\d.,٬٫/ ]*\s*([a-zآ-ی%٪$]{1,10}(\s[a-zآ-ی]{1,8})?)?$/.test(s) || /^[-+]?[\d.]+e[+-]?\d+$/.test(s);
}
const numOf = (v) => { const n = parseNum(v, { lenient: true }); return isFinite(n) ? n : NaN; };
const median = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
// a totals row: «جمع»، «جمع کل»، «Total:», «مجموع دارایی‌ها» — but not «جمع‌آوری سکه» or «Total Energies»
const TOTAL = /^(جمع|مجموع|سرجمع|کل|total|sum|subtotal|grand total)( (کل|دارایی.*|ها|assets?|portfolio|all))?\s*[:：]?$/i;
const isTotal = (name) => TOTAL.test(toEnDigits(name).replace(BIDI, '').replace(/\s+/g, ' ').trim().toLowerCase());

/** What a category cell or a name says, in Dara's categories (Persian or English words). null when it says nothing. */
export function categoryFrom(text) {
  const s = ' ' + lc(text) + ' ';
  if (!s.trim()) return null;
  const exact = CATEGORIES.find((c) => lc(c.name) === s.trim() || lc(c.short) === s.trim());
  if (exact) return exact.id;
  if (any(s, ['طلب', 'قرض به', 'قرض داده', 'وام داده', 'مطالبات', 'receivable', 'lent ', 'loaned'])) return 'receivable';
  if (any(s, ['وام', 'بدهی', 'قسط', 'debt', 'loan ', 'loans', 'mortgage', 'credit card'])) return 'debt';
  // a gold fund is a stock-exchange fund («صندوق طلای ...», «gold etf»), not grams of gold; a safe box is not a fund
  const t = s.replace(/ صندوق امانات/g, ' امانات');
  if ((any(t, ['صندوق']) && any(t, ['طلا', 'سکه', 'زر'])) || any(t, ['gold fund', 'gold etf'])) return 'stock';
  if (any(t, ['آب شده', 'آبشده', 'طلای آنلاین', 'میلی ', 'طلاین'])) return 'gold_online';
  if (any(t, ['نقره', 'پلاتین', 'پالادیوم', 'silver', 'platinum']) || / مس /.test(t)) return 'metal';
  if (any(t, ['سکه', 'طلا', 'النگو', 'جواهر', 'زیورآلات', 'زیور آلات', 'گردنبند', 'انگشتر', 'دستبند', 'gold', 'coin', 'jewel'])) return 'gold';
  if (any(t, ['بیت کوین', 'بیتکوین', 'اتریوم', 'تتر', 'رمز', 'کریپتو', 'btc', 'eth', 'usdt', 'crypto', 'bitcoin', 'tether', 'سولانا', 'تون ', 'ton '])) return 'crypto';
  if (any(t, ['دلار', 'یورو', 'درهم', 'پوند', 'لیر', 'ارز ', 'ارزی', 'اسکناس', 'usd', 'eur', 'aed', 'gbp', 'dollar', 'euro', 'currency', 'fx'])) return 'fx';
  if (any(t, ['سپرده', 'درآمد ثابت', 'deposit', 'fixed income', 'bond', 'اوراق'])) return 'fixed';
  if (any(t, ['سهام خصوصی', 'استارتاپ', 'private', 'startup'])) return 'private';
  if (any(t, ['سهام', 'سهم', 'بورس', 'صندوق', 'نماد', 'stock', 'share', 'equity', 'etf', 'fund'])) return 'stock';
  if (any(t, ['حساب', 'بانک', 'نقد', 'کیف پول', 'cash', 'bank', 'checking', 'saving', 'wallet'])) return 'bank';
  if (any(t, ['ملک', 'خانه', 'آپارتمان', 'زمین', 'مغازه', 'خودرو', 'ماشین', 'property', 'house', 'real estate', 'car ', 'land'])) return 'property';
  return null;
}

/** Profile of one column over the data rows: how numeric it is, typical size, how varied its text is. */
function profile(rows, c) {
  const cells = rows.map((r) => r[c]).filter((v) => String(v ?? '').trim() !== '');
  const nums = cells.filter(isNumCell).map(numOf).filter((x) => isFinite(x));
  const texts = cells.filter((v) => !isNumCell(v));
  return {
    filled: cells.length, numeric: cells.length ? nums.length / cells.length : 0, med: median(nums.map(Math.abs)), nums,
    distinct: texts.length ? new Set(texts.map(lc)).size / texts.length : 0, len: texts.length ? texts.reduce((t, v) => t + String(v).length, 0) / texts.length : 0,
    catHits: texts.length ? texts.filter((v) => categoryFrom(v)).length / texts.length : 0,
  };
}

/** The row that holds the column titles: mostly text, followed by rows with numbers. -1 when the sheet has none. */
export function findHeader(rows) {
  let best = -1, score = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i] || [];
    const cells = r.map((v) => String(v ?? '').trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const text = cells.filter((v) => !isNumCell(v)).length;
    if (text / cells.length < 0.6) continue;
    // titles are words: a row holding an amount is data (a small number like a year «1403» can still be a title)
    if (cells.some((v) => isNumCell(v) && Math.abs(numOf(v)) > 9999)) continue;
    const below = rows.slice(i + 1, i + 6).filter((x) => (x || []).some((v) => isNumCell(v))).length;
    if (!below) continue;
    const hits = r.filter((v) => titleRole(v)).length;
    const sc = hits * 3 + text + below;
    if (sc > score) { score = sc; best = i; }
  }
  // a header needs at least one known title, or it could just be the first row of data
  if (best >= 0 && !(rows[best] || []).some((v) => titleRole(v))) {
    const r = rows[best].map((v) => String(v ?? '').trim()).filter(Boolean);
    if (r.some((v) => categoryFrom(v))) return -1;
  }
  return best;
}

/** The market price a name points at, for checking a sheet's numbers against today's prices. */
function quoteRef(name) {
  const s = lc(name);
  if (/نیم سکه/.test(s)) return 'tgju:nim'; if (/ربع سکه/.test(s)) return 'tgju:rob'; if (/سکه گرمی/.test(s)) return 'tgju:retail_gerami';
  if (/بهار آزادی/.test(s)) return 'tgju:sekeb'; if (/سکه امامی|تمام سکه|سکه تمام/.test(s)) return 'tgju:sekee';
  if (/طلا|gold/.test(s) && /18|گرم/.test(s) && !/صندوق|fund/.test(s)) return 'tgju:geram18';
  if (/دلار|usd|dollar/.test(s)) return 'tgju:price_dollar_rl'; if (/یورو|eur/.test(s)) return 'tgju:price_eur';
  if (/تتر|usdt|tether/.test(s)) return 'nobitex:usdt';
  return null;
}
/** «(میلیون تومان)», «هزار ریال», «(K)» in a money column's title: every cell is that many times bigger */
export const scaleOf = (h) => { const t = lc(h); return /میلیارد|ملیارد|billion/.test(t) ? 1e9 : /میلیون|ملیون|million/.test(t) ? 1e6 : /هزار|thousand|\(k\)/.test(t) ? 1e3 : 1; };
const unitInTitle = (h) => { const t = lc(h); return /ریال|rial|\birr\b/.test(t) ? 'rial' : /تومان|toman|\birt\b/.test(t) ? 'toman' : null; };

/** Money unit of the sheet: from a title that names it, else by checking known prices against today's, else unknown. */
function unitOf(headers, roles, data, quotes) {
  const moneyCols = roles.map((r, i) => (['price', 'value', 'cost'].includes(r) ? i : -1)).filter((i) => i >= 0);
  for (const i of moneyCols) { const u = unitInTitle(headers[i]); if (u) return { unit: u, why: 'title' }; }
  const pi = roles.indexOf('price'), qi = roles.indexOf('quantity'), vi = roles.indexOf('value'), ni = roles.indexOf('name');
  const ratios = [];
  for (const r of data) {
    const id = ni >= 0 ? quoteRef(r[ni]) : null; const q = id && quotes?.[id]?.price;
    if (!q) continue;
    let p = pi >= 0 && isNumCell(r[pi]) ? numOf(r[pi]) * scaleOf(headers[pi]) : NaN;
    if (!(p > 0) && vi >= 0 && qi >= 0 && isNumCell(r[vi]) && isNumCell(r[qi]) && numOf(r[qi]) > 0) p = numOf(r[vi]) * scaleOf(headers[vi]) / numOf(r[qi]);
    if (p > 0) ratios.push(p / q);
  }
  if (ratios.length) {
    const m = median(ratios);
    if (m > 0.55 && m < 1.8) return { unit: 'rial', why: 'prices' };
    if (m > 0.055 && m < 0.18) return { unit: 'toman', why: 'prices' };
  }
  return { unit: 'toman', why: 'guess' };
}

/**
 * Guess what each column holds. Returns { headerRow, headers, roles[], how[] ('title'|'data'|null), unit, unitWhy,
 * missing[] } — `missing` lists what is still needed before import (a name, and a value or quantity × price).
 */
export function guessMapping(rows, { quotes = {}, headerRow: forced } = {}) {
  rows = (rows || []).map((r) => (r || []).map((v) => String(v ?? '')));
  const ncol = Math.max(0, ...rows.map((r) => r.length));
  // forced: the owner said where the titles are (-1 = no title row)
  const headerRow = Number.isInteger(forced) && forced >= -1 && forced < rows.length ? forced : findHeader(rows);
  const headers = Array.from({ length: ncol }, (_, i) => (headerRow >= 0 ? rows[headerRow][i] || '' : ''));
  const data = rows.slice(headerRow + 1).filter((r) => r.some((v) => v.trim()));
  const P = Array.from({ length: ncol }, (_, i) => profile(data, i));
  const roles = Array(ncol).fill('ignore'), how = Array(ncol).fill(null);
  const taken = new Set();
  const give = (i, r, h) => { if (i < 0 || taken.has(r) || roles[i] !== 'ignore') return false; roles[i] = r; how[i] = h; taken.add(r); return true; };

  // 1) titles, but a title must agree with the values: a «price» column full of words isn't one
  for (let i = 0; i < ncol; i++) {
    const r = titleRole(headers[i]);
    if (!r || !P[i].filled) continue;
    const numRole = ['price', 'quantity', 'value', 'cost'].includes(r);
    if (numRole && P[i].numeric < 0.6) continue;
    if (!numRole && r !== 'code' && P[i].numeric > 0.8) continue;
    give(i, r, 'title');
  }
  // «موجودی» or «مقدار» can mean either: small numbers next to a real value column are a quantity
  const vi0 = roles.indexOf('value');
  if (vi0 >= 0 && !taken.has('quantity') && /موجودی/.test(lc(headers[vi0]))) {
    const other = P.findIndex((p, i) => i !== vi0 && roles[i] === 'ignore' && p.numeric >= 0.6 && p.med > P[vi0].med * 1000);
    if (other >= 0) { roles[vi0] = 'quantity'; taken.delete('value'); taken.add('quantity'); give(other, 'value', 'data'); }
  }
  // 2) numbers: quantity × price = value, row by row. A product that holds on most rows outranks the titles
  // («موجودی» holding share counts next to «ارزش روز»). Capped: a dozen columns and 60 rows keep it instant.
  const numCols = P.map((p, i) => (p.numeric >= 0.6 ? i : -1)).filter((i) => i >= 0);
  const NUMR = ['quantity', 'price', 'value'];
  const cand = numCols.filter((i) => roles[i] === 'ignore' || NUMR.includes(roles[i]))
    .sort((a, b) => (NUMR.includes(roles[b]) - NUMR.includes(roles[a])) || (P[b].filled - P[a].filled) || (a - b)).slice(0, 12);
  const D = data.slice(0, 60);
  const N = Object.fromEntries(cand.map((c) => [c, D.map((r) => (isNumCell(r[c]) ? numOf(r[c]) : NaN))]));
  let tri = null;
  outer: for (const x of cand) for (const y of cand) {
    if (x >= y) continue;
    for (const z of cand) {
      if (z === x || z === y) continue;
      let ok = 0, both = 0;
      for (let k = 0; k < D.length; k++) {
        const a = N[x][k], b = N[y][k], c = N[z][k];
        if (!isFinite(a) || !isFinite(b) || !isFinite(c)) continue;
        both++;
        if (a && b && Math.abs(c) > 1 && Math.abs(a * b - c) <= Math.abs(c) * 0.02) ok++;
      }
      if (both >= 2 && ok / both >= 0.7) { tri = [x, y, z]; break outer; }
    }
  }
  if (tri) {
    const [x, y, z] = tri;
    // which of the two is the unit price: a title says so, else today's price of a named asset, else the larger numbers
    let q, p;
    if (roles[x] === 'quantity' || roles[y] === 'price') [q, p] = [x, y];
    else if (roles[y] === 'quantity' || roles[x] === 'price') [q, p] = [y, x];
    else {
      const ni = P.findIndex((pp, i) => roles[i] === 'name' || (roles[i] === 'ignore' && pp.numeric < 0.3 && pp.filled));
      let vx = 0, vy = 0;
      const near = (v, qt) => v > 0 && Math.min(Math.abs(Math.log10(v / qt)), Math.abs(Math.log10((v * 10) / qt))) < 0.5;
      if (ni >= 0) D.forEach((r, k) => { const qt = quotes?.[quoteRef(r[ni])]?.price; if (!qt) return; if (near(N[x][k], qt)) vx++; if (near(N[y][k], qt)) vy++; });
      [q, p] = vx > vy ? [y, x] : vy > vx ? [x, y] : median(N[x].filter(isFinite).map(Math.abs)) <= median(N[y].filter(isFinite).map(Math.abs)) ? [x, y] : [y, x];
    }
    for (let i = 0; i < ncol; i++) if (NUMR.includes(roles[i]) && ![q, p, z].includes(i)) { roles[i] = 'ignore'; how[i] = null; }
    for (const [i, r] of [[q, 'quantity'], [p, 'price'], [z, 'value']]) { if (roles[i] !== r) { roles[i] = r; how[i] = 'data'; } taken.add(r); }
  }
  if (!taken.has('value') && !(taken.has('quantity') && taken.has('price'))) {
    const free = numCols.filter((i) => roles[i] === 'ignore').sort((a, b) => P[b].med - P[a].med);
    if (free.length) give(free[0], 'value', 'data');
  }
  // 3) text: the name is the most varied text column; a category column repeats a few category words
  const textCols = P.map((p, i) => (p.filled && p.numeric < 0.3 ? i : -1)).filter((i) => i >= 0 && roles[i] === 'ignore');
  if (!taken.has('category')) { const c = textCols.filter((i) => P[i].catHits >= 0.5 && P[i].distinct <= 0.6).sort((a, b) => P[b].catHits - P[a].catHits)[0]; if (c !== undefined) give(c, 'category', 'data'); }
  const PLACE = ['بانک', 'کارگزاری', 'صرافی', 'پلتفرم', 'صندوق امانات', 'گاوصندوق', 'منزل', 'خانه', 'کیف', 'نزد', 'bank', 'broker', 'exchange', 'wallet', 'home', 'safe'];
  const placeHit = (i) => { const t = data.map((r) => r[i]).filter((v) => v.trim()); return t.length ? t.filter((v) => any(' ' + lc(v) + ' ', PLACE)).length / t.length : 0; };
  const isPlace = (i) => placeHit(i) >= 0.5;
  if (!taken.has('name')) {
    // the most varied text column, but not one that lists places (that is where things are kept)
    const c = textCols.filter((i) => roles[i] === 'ignore').sort((a, b) => (isPlace(a) - isPlace(b)) || (P[b].distinct - P[a].distinct) || (P[b].len - P[a].len) || (a - b))[0];
    if (c !== undefined) give(c, 'name', 'data');
  }
  // where it is kept: another text column whose cells name places (a bank, a broker, a safe box, home)
  if (!taken.has('custodian')) {
    const c = textCols.filter((i) => roles[i] === 'ignore').map((i) => [i, placeHit(i)]).filter(([, h]) => h >= 0.5).sort((a, b) => b[1] - a[1])[0];
    if (c) give(c[0], 'custodian', 'data');
  }
  const u = unitOf(headers, roles, data, quotes);
  return { headerRow, headers, ncol, roles, how, unit: u.unit, unitWhy: u.why, missing: missingOf(roles) };
}

export function missingOf(roles) {
  const m = [];
  if (!roles.includes('name')) m.push('name');
  if (!roles.includes('value') && !(roles.includes('quantity') && roles.includes('price'))) m.push('value');
  return m;
}

/** Set one column's role; a role used elsewhere moves here (each role belongs to one column). */
export function setRole(map, i, role) {
  const roles = map.roles.map((r, j) => (j !== i && r === role && SINGLE.has(role) ? 'ignore' : r));
  roles[i] = role;
  return { ...map, roles, how: map.how.map((h, j) => (j === i ? 'you' : roles[j] === map.roles[j] ? h : null)), missing: missingOf(roles) };
}

const HEAD = ['کد', 'دسته', 'نام', 'محل نگهداری', 'مقدار', 'واحد', 'قیمت هر واحد', 'ارزش روز', 'بهای تمام‌شده', 'یادداشت'];
const SLOT = { code: 0, category: 1, name: 2, custodian: 3, quantity: 4, unit: 5, price: 6, value: 7, cost: 8, note: 9 };

/**
 * Turn the sheet into assets with a mapping. Each data row gives { i, name, cat, asset|null, note|null, skipped? };
 * catOverride: { rowIndex: categoryId } (the owner's choice in the preview wins).
 * Rows without a name, totals rows («جمع کل») and rows without any amount are left out (with a note).
 */
export function applyMapping(rows, map, { unit = map.unit, catOverride = {} } = {}) {
  rows = (rows || []).map((r) => (r || []).map((v) => String(v ?? '')));
  const col = (role) => map.roles.indexOf(role);
  // money is turned into Rial here, column by column: a title that names its unit («(ریال)») or a scale
  // («میلیون تومان») wins over the sheet-wide choice
  const mul = (role) => { const h = map.headers?.[col(role)]; const u = unitInTitle(h) || unit; return (u === 'toman' ? 10 : 1) * scaleOf(h); };
  const M = { price: mul('price'), value: mul('value'), cost: mul('cost') };
  const out = [];
  rows.slice(map.headerRow + 1).forEach((r, k) => {
    const i = map.headerRow + 1 + k;
    if (!r.some((v) => v.trim())) return;
    const name = (r[col('name')] || '').trim();
    if (!name) return;
    if (isTotal(name)) { out.push({ i, name, skipped: 'total' }); return; }
    const hold = (r[col('custodian')] || '').trim();
    const catCell = col('category') >= 0 ? r[col('category')] : '';
    const said = categoryFrom(catCell);
    const num = (role) => { const c = col(role); return c >= 0 && isNumCell(r[c]) ? numOf(r[c]) : NaN; };
    const money = (role) => num(role) * M[role];
    const value = money('value');
    // where it is kept says little about what it is (a safe box holds coins and bangles alike); only a broker does
    const fromHold = /کارگزاری|broker/.test(lc(hold)) ? 'stock' : null;
    let cat = catOverride[i] || said || categoryFrom(name) || fromHold || null;
    // a negative amount is money owed, unless the row says it is an account (overdrawn) or the owner chose otherwise
    const owed = value < 0 && !catOverride[i] && !said && cat !== 'bank';
    if (owed) cat = 'debt';
    cat = cat || 'other';
    const line = Array(HEAD.length).fill('');
    for (const role of ['code', 'custodian', 'unit', 'note']) { const c = col(role); if (c >= 0) line[SLOT[role]] = r[c] ?? ''; }
    line[1] = CAT[cat].name; line[2] = name;
    const q = num('quantity');
    if (isFinite(q)) line[SLOT.quantity] = String(q);
    for (const role of ['price', 'value', 'cost']) { const v = money(role); if (isFinite(v)) line[SLOT[role]] = String(v); }
    // quantity and value but no unit price: the price is value ÷ quantity (both already in Rial)
    if (!(money('price') > 0) && q > 0 && isFinite(value) && value) line[SLOT.price] = String(Math.abs(value) / q);
    const res = importRows([HEAD, line], { unit: 'rial' });
    const asset = res.assets[0] || null;
    let note = res.notes[0] || null;
    if (asset && value < 0 && cat !== 'debt') {
      if (asset.mode === 'balance' && cat === 'bank') asset.balance = -Math.abs(asset.balance);   // an overdrawn account stays negative
      else note = 'مبلغ منفی بود؛ مثبت ثبت شد — اگر بدهی است، دسته را «بدهی» کن';
    }
    out.push({ i, name, cat, asset, note });
  });
  return out;
}

/* ------------------------------ Dara's own layout (its export and the template) ------------------------------ */
// A sheet with «دسته» and «نام» titles is read by the standard importer, which also knows the liquidity, «مانده» and
// per-column unit titles of Dara's own export. Rows are read one by one so the owner can change a row's category.
const isDaraHead = (r) => (r || []).some((c) => lc(c).includes('دسته')) && (r || []).some((c) => /(^|\s)نام/.test(lc(c)));
export const daraHeader = (rows) => { const i = (rows || []).slice(0, 15).findIndex(isDaraHead); return i; };
export function applyDara(rows, h, { unit = 'rial', catOverride = {} } = {}) {
  rows = (rows || []).map((r) => (r || []).map((v) => String(v ?? '')));
  const head = rows[h];
  const ci = head.findIndex((c) => lc(c).includes('دسته')); const ni = head.findIndex((c) => /(^|\s)نام/.test(lc(c)));
  const vcols = [head.findIndex((c) => lc(c).includes('ارزش روز')), head.findIndex((c) => /مانده|ارزش مستقیم/.test(lc(c)))];
  const out = [];
  rows.slice(h + 1).forEach((r, k) => {
    const i = h + 1 + k;
    const name = (r[ni] || '').trim();
    if (!name) return;
    if (isTotal(name)) { out.push({ i, name, skipped: 'total' }); return; }
    const line = r.slice();
    // the owner's choice wins; an empty category cell is guessed from the name instead of dropping the row
    const cat = catOverride[i] || (String(r[ci] || '').trim() ? null : categoryFrom(name) || 'other');
    if (cat) line[ci] = CAT[cat].name;
    const res = importRows([head, line], { unit });
    const asset = res.assets[0] || null;
    // the standard importer reads amounts as positive; an overdrawn account in Dara's own export stays negative
    const neg = vcols.some((c) => c >= 0 && numOf(r[c]) < 0);
    if (asset && neg && asset.mode === 'balance' && asset.category === 'bank') asset.balance = -Math.abs(asset.balance);
    out.push({ i, name: asset?.name || name, cat: asset?.category || cat, asset, note: res.notes[0] || null });
  });
  return out;
}

/** Everything the import screen needs about one sheet: Dara's own layout, or a guessed mapping to confirm. */
export function readSheet(rows, { quotes = {} } = {}) {
  rows = (rows || []).map((r) => (r || []).map((v) => String(v ?? '')));
  const map = guessMapping(rows, { quotes });
  const h = daraHeader(rows);
  if (h >= 0) {
    const got = applyDara(rows, h, { unit: map.unit }).filter((x) => !x.skipped);
    if (got.length && got.filter((x) => x.asset).length >= 0.6 * got.length) return { kind: 'dara', headerRow: h, map, unit: map.unit, unitWhy: map.unitWhy };
  }
  return { kind: 'map', headerRow: map.headerRow, map, unit: map.unit, unitWhy: map.unitWhy };
}

/* --------------------------------------- help from the AI (optional) --------------------------------------- */
// Only the titles and a few sample rows go out; in «percent only» privacy, every number is replaced by its shape
// («#,###,###») so no amount leaves the device. Names stay (they're needed to tell a coin from a deposit).
// every digit, in every cell («حدود ۴۵ میلیون»، «12.5 گرم» too): only the shape of the table goes out
const shapeOf = (v) => toEnDigits(String(v ?? '')).replace(/\d/g, '#');
export function aiMappingSystem() {
  return 'تو ستون‌های یک جدول دارایی شخصی را تشخیص می‌دهی. فقط JSON معتبر برگردان، بدون توضیح.';
}
export function aiMappingPrompt(rows, map, { privacy = 'full', maxRows = 12, mask = (x) => x } = {}) {
  const start = Math.max(0, map.headerRow);
  const sample = rows.slice(start, start + maxRows + (map.headerRow >= 0 ? 1 : 0)).map((r) => (r || []).map((v) => mask(privacy === 'percent' ? shapeOf(v) : String(v ?? '')).slice(0, 60)));
  const roles = ROLES.map(([r, n]) => `${r} (${n})`).join('، ');
  const cats = CATEGORIES.map((c) => `${c.id} (${c.name})`).join('، ');
  return `این چند سطر اول یک جدول دارایی است (هر سطر آرایه‌ای از سلول‌ها؛ شماره ستون از ۰). ${map.headerRow >= 0 ? 'سطر اول عنوان ستون‌هاست.' : 'عنوان ستون ندارد.'}
${JSON.stringify(sample)}
نقش هر ستون را از این فهرست تعیین کن: ${roles}. هر نقش (جز ignore) حداکثر یک ستون.
دسته‌ها: ${cats}.
واحد پول مبالغ (toman یا rial) را اگر از عنوان‌ها یا اندازه اعداد معلوم است بگو، وگرنه null.
برای هر نام دارایی در این سطرها که دسته‌اش از نامش معلوم است، دسته را بده.
خروجی فقط: {"columns":[{"index":0,"role":"name"}],"money_unit":"toman","categories":{"نام دارایی":"category_id"}}`;
}
/** Validated AI answer, merged into the local guess: roles only from the list, one column each, indices inside the
 *  sheet. A column the answer doesn't mention keeps its guess; a role the answer gives moves to its column. */
export function parseAiMapping(json, map) {
  let m = { ...map, roles: map.roles.slice(), how: map.how.slice() };
  const cols = Array.isArray(json?.columns) ? json.columns : [];
  const seen = new Set();
  for (const c of cols) {
    const i = c?.index; const r = typeof c?.role === 'string' ? c.role : '';
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= map.ncol || !Object.hasOwn(ROLE_NAME, r)) continue;
    if (r !== 'ignore' && seen.has(r)) continue;
    if (r !== 'ignore') seen.add(r);
    m = setRole(m, i, r); m.how[i] = 'ai';
  }
  const unit = json?.money_unit === 'rial' || json?.money_unit === 'toman' ? json.money_unit : null;
  const cats = {};
  const given = json?.categories && typeof json.categories === 'object' && !Array.isArray(json.categories) ? json.categories : {};
  for (const [k, v] of Object.entries(given)) if (typeof v === 'string' && Object.hasOwn(CAT, v)) cats[lc(k)] = v;
  return { ...m, missing: missingOf(m.roles), ...(unit ? { unit, unitWhy: 'ai' } : {}), aiCats: cats };
}
/** Category overrides from the AI's answer, by row index, for rows whose own text said nothing. */
export function aiCatOverrides(rows, map) {
  const out = {}; const ni = map.roles.indexOf('name'); const ci = map.roles.indexOf('category');
  if (ni < 0 || !map.aiCats) return out;
  rows.forEach((r, i) => {
    if (i <= map.headerRow) return;
    const name = (r?.[ni] || '').trim(); const v = Object.hasOwn(map.aiCats, lc(name)) ? map.aiCats[lc(name)] : null;
    if (v && !(ci >= 0 && categoryFrom(r[ci])) && !categoryFrom(name)) out[i] = v;
  });
  return out;
}
