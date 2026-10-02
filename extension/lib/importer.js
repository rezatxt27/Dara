// Smart import from spreadsheet CSV (e.g. a Google Sheets export) + CSV export.
import { uid, parseNum } from './format.js';
import { CAT, METAL_PRESETS } from './catalog.js';

export function parseCSV(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const has = (s, ...words) => words.some((w) => String(s || '').toLowerCase().includes(w.toLowerCase()));
const clean = (s) => String(s || '').replace(/[ \t]+/g, ' ').trim();
const norm = (s) => String(s || '').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();

const GOLD_ETFS = ['عیار', 'طلا', 'کهربا', 'مثقال', 'زر', 'گوهر', 'آلتون', 'نفیس', 'لیان', 'تابان', 'زرفام', 'جواهر', 'گنج', 'قیراط', 'درخشان', 'ناب', 'زرین', 'رز', 'آتش', 'نهال'];

function detectCategory(catText, name, holder) {
  const t = norm(catText);
  if (has(t, 'بدهی', 'وام')) return 'debt';
  if (has(t, 'حساب بانکی', 'بانک', 'نقد') && !has(t, 'ارز')) return 'bank';
  if (has(t, 'آب‌شده', 'آب شده', 'آبشده')) return 'gold_online';
  if (has(t + ' ' + name, 'نقره', 'پلاتین', 'پالادیوم') || /(^|\s)مس(\s|$)/.test(t + ' ' + name)) return 'metal';
  if (has(t, 'طلای فیزیکی', 'سکه', 'طلا')) return 'gold';
  if (has(t, 'سهام بورسی', 'بورس', 'صندوق بورسی')) return 'stock';
  if (has(t, 'درآمد ثابت', 'سپرده', 'صندوق')) return has(name, 'شراکت') ? 'receivable' : 'fixed';
  if (has(t, 'رمز')) return 'crypto';
  if (has(t, 'ارز')) return 'fx';
  if (has(t, 'ملک', 'خودرو')) return 'property';
  if (has(t, 'سایر')) {
    if (has(name, 'سهام')) return 'private';
    return 'other';
  }
  return 'other';
}

function detectGoldRef(name, holder, unit) {
  const s = norm(name + ' ' + holder);
  if (has(s, 'نیم سکه', 'نیم‌سکه')) return { provider: 'tgju', key: 'nim' };
  if (has(s, 'ربع سکه', 'ربع‌سکه')) return { provider: 'tgju', key: 'rob' };
  if (has(s, 'سکه گرمی')) return { provider: 'tgju', key: 'retail_gerami' };
  if (has(s, 'بهار آزادی')) return { provider: 'tgju', key: 'sekeb' };
  if (has(s, 'سکه امامی', 'تمام سکه')) return { provider: 'tgju', key: 'sekee' };
  if (has(s, '۲۴', '24')) return { provider: 'tgju', key: 'geram24' };
  return { provider: 'tgju', key: 'geram18' };
}

function detectFx(name, holder, unit) {
  const s = norm(name + ' ' + holder + ' ' + unit);
  if (has(s, 'دلار', 'usd')) return { provider: 'tgju', key: 'price_dollar_rl' };
  if (has(s, 'یورو', 'eur')) return { provider: 'tgju', key: 'price_eur' };
  if (has(s, 'پوند', 'gbp')) return { provider: 'tgju', key: 'price_gbp' };
  if (has(s, 'درهم', 'aed')) return { provider: 'tgju', key: 'price_aed' };
  if (has(s, 'لیر', 'try')) return { provider: 'tgju', key: 'price_try' };
  return null;
}

function detectCrypto(name, holder, unit, price) {
  const s = norm(name + ' ' + holder + ' ' + unit);
  if (has(s, 'بیت', 'btc', 'bitcoin')) return { ref: { provider: 'nobitex', key: 'btc' } };
  if (has(s, 'اتر', 'eth')) return { ref: { provider: 'nobitex', key: 'eth' } };
  if (has(s, 'تتر', 'usdt')) return { ref: { provider: 'nobitex', key: 'usdt' } };
  if (has(s, 'تون', 'ton')) return { ref: { provider: 'nobitex', key: 'ton' } };
  if (has(s, 'سولانا', 'sol')) return { ref: { provider: 'nobitex', key: 'sol' } };
  // Unit price above 10 billion Rial can only be Bitcoin
  if (price > 1e10) return { ref: { provider: 'nobitex', key: 'btc' }, review: 'رمزارز از روی قیمت، بیت‌کوین تشخیص داده شد؛ بررسی کنید.' };
  return null;
}

function detectSymbol(name, holder) {
  const parts = norm(holder).split(/[-–—/]/).map((x) => x.trim()).filter(Boolean);
  for (const p of parts.slice(1).concat(parts)) {
    const first = p.split(' ')[0];
    if (GOLD_ETFS.includes(first)) return first;
  }
  for (const w of norm(name + ' ' + holder).split(/[\s\-–—/]+/)) if (GOLD_ETFS.includes(w)) return w;
  return null;
}

/**
 * Map spreadsheet rows to Dara assets.
 * opts.unit: 'rial' | 'toman' — the unit used in the sheet's money columns.
 */
export function importRows(rows, opts = {}) {
  const mult = opts.unit === 'toman' ? 10 : 1;
  const hIdx = rows.findIndex((r) => r.some((c) => norm(c).includes('دسته')) && r.some((c) => norm(c).includes('نام')));
  if (hIdx < 0) throw new Error('سطر عنوان ستون‌ها پیدا نشد (ستون‌های «دسته دارایی» و «نام دارایی» لازم است).');
  const H = rows[hIdx].map(norm);
  const col = (...keys) => H.findIndex((h) => keys.some((k) => h.includes(k)));
  const C = {
    code: col('کد'), cat: col('دسته'), name: col('نام'), holder: col('محل', 'بانک', 'کارگزاری'), qty: col('مقدار', 'تعداد'),
    unit: col('واحد'), price: col('قیمت هر'), direct: col('مانده', 'ارزش مستقیم'), value: col('ارزش روز'), cost: col('بهای تمام'),
    liq: col('نقدشوندگی'), note: col('یادداشت'), date: col('آخرین بروزرسانی', 'آخرین به‌روزرسانی'),
  };
  const out = []; const notes = []; const codes = new Set();
  const now = Date.now();
  for (const r of rows.slice(hIdx + 1)) {
    const g = (k) => (C[k] >= 0 ? norm(r[C[k]]) : '');
    const catText = g('cat'); let name = clean(C.name >= 0 ? r[C.name] : '');
    if (!catText || !name) continue;
    const qty = parseNum(g('qty')); const price = parseNum(g('price')) * mult; const direct = parseNum(g('direct')) * mult;
    const value = parseNum(g('value')) * mult; const cost = parseNum(g('cost')) * mult;
    let holder = clean(C.holder >= 0 ? r[C.holder] : ''); const unit = g('unit');
    const total = isFinite(value) && value ? value : isFinite(direct) && direct ? direct : (isFinite(qty) && isFinite(price) ? qty * price : NaN);
    if (!isFinite(total) || total === 0) { notes.push(`ردیف «${name}» بدون مقدار بود و وارد نشد.`); continue; }
    const category = detectCategory(catText, name, holder);
    // Friendlier names for generic template rows
    const segs = holder.split(/\s*[-–—]\s*/).filter(Boolean);
    if (category === 'bank' && /حساب/.test(name) && holder) { name = holder; }
    else if ((category === 'gold' || category === 'gold_online') && name.includes('/') && segs.length) {
      name = segs[segs.length - 1]; holder = segs.length > 1 && !/محل نگهداری/.test(segs[0]) ? segs[0] : '';
    }
    let code = g('code') || `A-${String(out.length + 1).padStart(3, '0')}`;
    if (codes.has(code)) { let i = 2; while (codes.has(`${code}-${i}`)) i++; code = `${code}-${i}`; }
    codes.add(code);
    const liq = has(g('liq'), 'بالا') ? 'high' : has(g('liq'), 'پایین', 'کم') ? 'low' : has(g('liq'), 'متوسط') ? 'mid' : (CAT[category]?.liquidity || 'mid');
    const base = { id: uid('a'), code, name, category, custodian: holder, liquidity: liq, note: g('note'), createdAt: now, updatedAt: now };
    if (isFinite(cost) && cost > 0) base.costBasis = cost;
    const isMoneyUnit = /تومان|ریال/.test(unit) && !/به تومان|به ریال/.test(unit);
    let asset;
    const units = (ref, review) => ({ ...base, mode: 'units', quantity: qty, unit: unit.replace(/\s*\/\s*عدد/, '').replace(/به تومان|به ریال/, '').trim() || 'واحد',
      price: ref ? { source: 'market', ref, adjustPct: 0, factor: 1, value: price, updatedAt: now, last: { price, at: now } } : { source: 'manual', value: price, updatedAt: now }, ...(review ? { review } : {}) });
    if (category === 'bank' || category === 'receivable' || category === 'debt' || category === 'property' || (isMoneyUnit && (!isFinite(qty) || qty === 1))) {
      asset = { ...base, mode: 'balance', balance: total, balanceAt: now };
    } else if (category === 'gold' || category === 'gold_online') {
      const ref = detectGoldRef(name, holder, unit);
      asset = units(ref);
      if (ref.key !== 'geram18') asset.unit = 'عدد'; else asset.unit = 'گرم';
    } else if (category === 'metal') {
      const s2 = norm(name + ' ' + holder);
      const pr = METAL_PRESETS.find((m) => (m.id === 'silver925' && /925/.test(s2)) || (m.id === 'copper' && /(^|\s)مس/.test(s2)) || (m.id === 'platinum' && /پلاتین/.test(s2)) || (m.id === 'palladium' && /پالادیوم/.test(s2))) || METAL_PRESETS[0];
      asset = units({ ...pr.ref }); asset.unit = pr.unit; asset.price.factor = pr.factor;
    } else if (category === 'fx') {
      const ref = detectFx(name, holder, unit);
      asset = units(ref); asset.unit = (name || '').trim();
    } else if (category === 'crypto') {
      const d = detectCrypto(name, holder, unit, price);
      asset = units(d?.ref, d?.review); asset.unit = d?.ref?.key?.toUpperCase() || 'واحد';
    } else if (category === 'stock') {
      const sym = detectSymbol(name, holder);
      if (sym) { base.name = `صندوق طلای «${sym}»`; base.custodian = holder.split(/\s*[-–—]\s*/)[0] || holder; }
      asset = units(sym ? { provider: 'tsetmc', key: '', symbol: sym, field: 'close', label: sym } : null, sym ? `نماد «${sym}» از روی نام حدس زده شد؛ در اولین به‌روزرسانی در TSETMC جست‌وجو می‌شود.` : null);
      asset.unit = 'واحد';
    } else {
      asset = isFinite(qty) && isFinite(price) && qty !== 1 ? units(null) : { ...base, mode: 'balance', balance: total, balanceAt: now };
    }
    if (!isFinite(asset.quantity) && asset.mode === 'units') { asset.mode = 'balance'; asset.balance = total; asset.balanceAt = now; }
    out.push(asset);
  }
  return { assets: out, notes };
}

export function importCSVText(text, opts) { return importRows(parseCSV(text), opts); }

/* --------------------------- export --------------------------- */
// a text cell that a spreadsheet would run as a formula (=, +, -, @) gets a leading apostrophe; plain numbers stay numbers
const esc = (v) => {
  let s = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d[\d.,]*$/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCSV(rows) {
  const head = ['کد', 'دسته', 'نام', 'محل نگهداری', 'روش ارزش‌گذاری', 'مقدار', 'واحد', 'قیمت واحد (ریال)', 'ارزش روز (ریال)', 'بهای تمام‌شده (ریال)', 'سود/زیان (ریال)', 'منبع قیمت', 'وضعیت', 'یادداشت'];
  const lines = [head.map(esc).join(',')];
  for (const r of rows) {
    const a = r.asset;
    const mode = a.mode === 'units' ? 'تعداد × قیمت' : a.mode === 'rate' ? `نرخ ${a.rate?.annualPct}٪` : a.mode === 'loan' ? `قسطی ${a.loan?.annualPct}٪، ${a.loan?.months} قسط` : 'مانده';
    const src = a.mode === 'units' && a.price?.source === 'market' ? `${a.price.ref?.provider}:${a.price.ref?.symbol || a.price.ref?.key}` : a.mode === 'rate' || a.mode === 'loan' ? 'خودکار' : 'دستی';
    lines.push([a.code, r.cat?.name, a.name, a.custodian, mode, a.mode === 'units' ? a.quantity : '', a.unit || '', r.unitPrice ? Math.round(r.unitPrice) : '',
      Math.round(r.signedValue), a.costBasis || '', r.pnl !== null && r.pnl !== undefined ? Math.round(r.pnl) : '', src, r.status, a.note || ''].map(esc).join(','));
  }
  return '﻿' + lines.join('\n');
}
