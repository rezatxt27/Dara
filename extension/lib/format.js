// Number / money / time formatting. All money is stored in Rial.
const _nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const _nfc = {};
const _nf = (d) => (_nfc[d] ||= new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
// Persian separators when digits === 'fa' (digits themselves are drawn Persian by the Farsi-digit font)
let DIG = 'fa';
export function setDigits(mode) { DIG = mode === 'en' ? 'en' : 'fa'; }
export const getDigits = () => DIG;
const loc = (s) => (DIG === 'fa' ? s.replace(/,/g, '٬').replace(/\./g, '٫') : s);
const nf0 = { format: (v) => loc(_nf0.format(v)) };
const nf = (d) => ({ format: (v) => loc(_nf(d).format(v)) });

export const toFaDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
export const toEnDigits = (s) => String(s ?? '')
  .replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
  .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));

/** Parse a user-typed number ("۱٬۲۳۴٫۵", "1,234.5", "12 میلیون") */
export function parseNum(input) {
  if (input === null || input === undefined) return NaN;
  if (typeof input === 'number') return input;
  let s = toEnDigits(input).trim();
  let mult = 1;
  if (/میلیارد/.test(s)) mult = 1e9; else if (/میلیون/.test(s)) mult = 1e6; else if (/هزار/.test(s)) mult = 1e3;
  s = s.replace(/[٬,\s]/g, '').replace(/٫/g, '.').replace(/[^\d.\-]/g, '');
  if (!s || s === '-' || s === '.') return NaN;
  return parseFloat(s) * mult;
}

export function num(n, digits = 0) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  if (digits === 'auto') {
    const a = Math.abs(n);
    digits = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  }
  return digits ? nf(digits).format(n) : nf0.format(Math.round(n));
}

export function unitLabel(settings) { return settings?.currency === 'rial' ? 'ریال' : 'تومان'; }
export function fromRial(rial, settings) { return settings?.currency === 'rial' ? rial : rial / 10; }
export function toRial(v, settings) { return settings?.currency === 'rial' ? v : v * 10; }

/** Compact Persian scale: 12.4 میلیارد */
export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e12) return { n: nf(2).format(v / 1e12), s: 'هزار میلیارد' };
  if (a >= 1e9) return { n: nf(a >= 1e11 ? 1 : 2).format(v / 1e9), s: 'میلیارد' };
  if (a >= 1e6) return { n: nf(a >= 1e8 ? 0 : 1).format(v / 1e6), s: 'میلیون' };
  return { n: nf0.format(v), s: '' };
}

/** money(rial, settings, {compact, unit}) -> string */
export function money(rial, settings, opts = {}) {
  if (rial === null || rial === undefined || !isFinite(rial)) return '—';
  const v = fromRial(rial, settings);
  const useCompact = opts.compact ?? false;
  const unit = opts.unit === false ? '' : ' ' + unitLabel(settings);
  if (useCompact) {
    const c = compact(v);
    return `${c.n}${c.s ? ' ' + c.s : ''}${unit}`;
  }
  return nf0.format(Math.round(v)) + unit;
}

export function pct(p, { sign = true, digits = 1 } = {}) {
  if (p === null || p === undefined || !isFinite(p)) return '—';
  const s = nf(digits).format(Math.abs(p * 100));
  return (sign ? (p > 0.00005 ? '+' : p < -0.00005 ? '−' : '') : (p < 0 ? '−' : '')) + s + '٪';
}

export function signed(rial, settings, opts) {
  if (!isFinite(rial)) return '—';
  const s = money(Math.abs(rial), settings, opts);
  return (rial > 0 ? '+' : rial < 0 ? '−' : '') + s;
}

export function ago(ts) {
  if (!ts) return 'هرگز';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'لحظاتی پیش';
  if (s < 3600) return `${Math.floor(s / 60)} دقیقه پیش`;
  if (s < 86400) return `${Math.floor(s / 3600)} ساعت پیش`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} روز پیش`;
  if (d < 365) return `${Math.floor(d / 30)} ماه پیش`;
  return `${Math.floor(d / 365)} سال پیش`;
}

export function timeHM(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------- Persian number words (for safe money entry) ---------------- */
const W1 = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const W10 = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const WT = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const WH = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد', 'میلیون میلیارد'];
function chunkWords(n) {
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(WH[h]);
  if (r >= 10 && r < 20) parts.push(W10[r - 10]);
  else { const t = Math.floor(r / 10), o = r % 10; if (t) parts.push(WT[t]); if (o) parts.push(W1[o]); }
  return parts.join(' و ');
}
/** 2100000000 -> «دو میلیارد و صد میلیون». approx: keep the two largest groups and prefix «حدود». */
export function numToWordsFa(value, { approx = true } = {}) {
  if (value === null || value === undefined || !isFinite(value)) return '';
  let n = Math.round(Math.abs(value));
  if (n === 0) return 'صفر';
  const groups = [];
  let i = 0;
  while (n > 0 && i < SCALES.length) { groups.push({ v: n % 1000, s: SCALES[i] }); n = Math.floor(n / 1000); i++; }
  let nz = groups.filter((g) => g.v).reverse();
  let truncated = false;
  if (approx && nz.length > 2) { nz = nz.slice(0, 2); truncated = true; }
  const txt = nz.map((g) => (g.v === 1 && g.s === 'هزار' ? 'هزار' : chunkWords(g.v) + (g.s ? ' ' + g.s : ''))).join(' و ');
  return (value < 0 ? 'منفی ' : '') + (truncated ? 'حدود ' : '') + txt;
}

/** Group digits while typing: keeps a single decimal point, strips other chars. */
export function groupTyping(raw) {
  let s = toEnDigits(raw).replace(/٫/g, '.').replace(/[٬,\s]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  let int = dot >= 0 ? s.slice(0, dot) : s; const frac = dot >= 0 ? s.slice(dot + 1).replace(/\./g, '') : null;
  int = int.replace(/^0+(?=\d)/, '');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + g + (frac !== null ? '.' + frac : '');
}
