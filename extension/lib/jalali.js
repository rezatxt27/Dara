// Jalali (Persian) calendar conversion — based on the jalaali-js algorithm.
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;

function jalCal(jy) {
  const gy = jy + 621;
  let leapJ = -14, jp = BREAKS[0], jm, jump = 0, n, i;
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]) throw new Error('Invalid Jalali year ' + jy);
  for (i = 1; i < BREAKS.length; i++) {
    jm = BREAKS[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f, jm, jd;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy, jm, jd }; }
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30); jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

export function isLeapJ(jy) { return jalCal(jy).leap === 0; }
export function monthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJ(jy) ? 30 : 29;
}
export function toJalali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
export function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }

// ISO 'YYYY-MM-DD' helpers (local, date-only)
const pad = (n) => String(n).padStart(2, '0');
export function isoFromDate(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function dateFromIso(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function isoToJ(iso) { const [y, m, d] = iso.split('-').map(Number); return toJalali(y, m, d); }
export function jToIso(jy, jm, jd) { const g = toGregorian(jy, jm, jd); return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; }
export function todayIso() { return isoFromDate(new Date()); }
export function daysBetween(isoA, isoB) {
  // whole days from A to B
  const a = dateFromIso(isoA), b = dateFromIso(isoB);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}
export function addDaysIso(iso, n) { const d = dateFromIso(iso); d.setDate(d.getDate() + n); return isoFromDate(d); }

/** Add n Jalali months to an ISO date, clamping the day to the target month's length (anchorDay keeps the original day). */
export function addJMonthsIso(iso, n, anchorDay) {
  const j = isoToJ(iso);
  let m = j.jm - 1 + n;
  const jy = j.jy + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12 + 1;
  const day = Math.min(anchorDay || j.jd, monthLength(jy, m));
  return jToIso(jy, m, day);
}

/** Format ISO date as Jalali text. style: 'long' => «۹ مهر ۱۴۰۵», 'short' => «۱۴۰۵/۰۷/۰۹», 'dm' => «۹ مهر» */
export function fmtJ(iso, style = 'long') {
  if (!iso) return '—';
  const j = isoToJ(iso.slice(0, 10));
  if (style === 'short') return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
  if (style === 'dm') return `${j.jd} ${MONTHS[j.jm - 1]}`;
  if (style === 'my') return `${MONTHS[j.jm - 1]} ${j.jy}`;
  return `${j.jd} ${MONTHS[j.jm - 1]} ${j.jy}`;
}

/** Parse user-typed Jalali date '1405/7/9' (Latin or Persian digits) -> ISO or null */
export function parseJ(text) {
  if (!text) return null;
  const t = String(text).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
  const m = t.match(/^\s*(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*$/);
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (jy < 1300 || jy > 1500) return null; // a typo like «۳۵۰۰» or «۰۰۰۱» is not a date anyone means
  if (jm < 1 || jm > 12 || jd < 1 || jd > monthLength(jy, jm)) return null;
  return jToIso(jy, jm, jd);
}
