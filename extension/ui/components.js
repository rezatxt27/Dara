import { html, render, useState, useEffect, useMemo, useRef, useCallback } from '../lib/vendor/preact-htm.js';
import { ICONS } from './icons.js';
import * as store from '../lib/store.js';
import { money, pct, num, parseNum, setDigits, signed, compact, numToWordsFa, groupTyping, getDigits, toEnDigits, timeHM } from '../lib/format.js';
import { fmtJ, parseJ, todayIso, isoToJ, jToIso, monthLength, dateFromIso, MONTHS } from '../lib/jalali.js';
import { CAT, TGJU_BY_KEY, NOBITEX_BY_KEY, PROVIDERS } from '../lib/catalog.js';

export { html, render, useState, useEffect, useMemo, useRef, useCallback };

/* ---------------- infra ---------------- */
export const hasChrome = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
export function send(type, payload = {}) {
  if (!hasChrome) return Promise.resolve({ ok: false, error: 'offline preview' });
  return new Promise((res) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (r) => {
        if (chrome.runtime.lastError) res({ ok: false, error: chrome.runtime.lastError.message });
        else res(r || { ok: false });
      });
    } catch (e) { res({ ok: false, error: String(e) }); }
  });
}

export function applyTheme(settings) {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', settings.theme);
  root.classList.toggle('digits-en', settings.digits === 'en');
  document.body.classList.toggle('privacy', !!settings.privacy);
  setDigits(settings.digits);
}

/** Loads every store key and keeps it in sync with chrome.storage changes. */
export function useStore() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let alive = true;
    store.loadAll().then((s) => { if (alive) { applyTheme(s.settings); setSt(s); } });
    const off = store.onChanged(async (changes) => {
      const keys = Object.keys(changes).filter((k) => store.KEYS.includes(k));
      if (!keys.length) return;
      const fresh = await store.load(...keys);
      setSt((prev) => { const n = { ...prev, ...fresh }; if (fresh.settings) applyTheme(n.settings); return n; });
    });
    return () => { alive = false; off(); };
  }, []);
  return st;
}

export function useTick(ms = 5000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

/* ---------------- toasts ---------------- */
let pushToast = () => {};
export function toast(msg, action) { pushToast({ id: Math.random(), msg, action }); }
export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    pushToast = (t) => { setList((l) => [...l, t]); setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.action ? 7000 : 3500); };
  }, []);
  return html`<div class="toasts">${list.map((t) => html`<div class="toast" key=${t.id}><span class="grow">${t.msg}</span>${t.action && html`<button onClick=${() => { t.action.fn(); setList((l) => l.filter((x) => x.id !== t.id)); }}>${t.action.label}</button>`}</div>`)}</div>`;
}

/* ---------------- atoms ---------------- */
export function Icon({ n, cls = '' }) {
  return html`<svg class=${'i ' + cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML=${{ __html: ICONS[n] || '' }}></svg>`;
}

/** Split a Rial amount into isolated sign+number, scale word and unit so RTL text never flips the sign. */
function moneyParts(v, s, compactMode) {
  const disp = s?.currency === 'rial' ? v : v / 10;
  const a = Math.abs(disp);
  if (compactMode) { const c = compact(a); return { n: c.n, scale: c.s }; }
  return { n: num(a), scale: '' };
}
export function Money({ v, s, compact: cmp = false, unit = true, cls = '', sign = false }) {
  if (v === null || v === undefined || !isFinite(v)) return html`<span class=${'money ' + cls}>—</span>`;
  const { n, scale } = moneyParts(v, s, cmp);
  const zero = Math.round(Math.abs(s?.currency === 'rial' ? v : v / 10)) === 0;
  const sg = zero ? '' : v < 0 ? '−' : sign && v > 0 ? '+' : '';
  const u = unit ? (s?.currency === 'rial' ? 'ریال' : 'تومان') : '';
  return html`<span class=${'money num ' + cls} title=${cmp ? money(v, s) : ''}><span class="n"><span class="ltr">${sg}${n}</span>${scale ? ' ' + scale : ''}</span>${u && html`<span class="u"> ${u}</span>`}</span>`;
}

export function Delta({ p, abs, s, compact: cmp = true, showAbs = true, cls = '' }) {
  if ((p === null || p === undefined || !isFinite(p)) && !isFinite(abs)) return html`<span class="delta flat">—</span>`;
  const dir = (isFinite(p) ? p : abs) > 0.00001 ? 'up' : (isFinite(p) ? p : abs) < -0.00001 ? 'down' : 'flat';
  return html`<span class=${`delta ${dir} ${cls}`}>
    ${dir !== 'flat' && html`<${Icon} n=${dir === 'up' ? 'arrowUp' : 'arrowDown'} cls="sm" />`}
    ${isFinite(p) && html`<span class="ltr">${pct(p)}</span>`}
    ${showAbs && isFinite(abs) && abs !== 0 && html`<span>(<${Money} v=${abs} s=${s} compact=${cmp} sign unit=${false} />)</span>`}
  </span>`;
}

export function Ava({ cat, size = 34 }) {
  const c = CAT[cat] || CAT.other;
  return html`<span class="ava" style=${`background:${c.color}1F;color:${c.color};width:${size}px;height:${size}px`}><${Icon} n=${c.icon} /></span>`;
}

export const STATUS = {
  live: { t: 'زنده', cls: 'live' }, auto: { t: 'خودکار', cls: 'auto' }, manual: { t: 'دستی', cls: '' },
  stale: { t: 'نیاز به به‌روزرسانی', cls: 'stale' }, delayed: { t: 'قیمت قدیمی', cls: 'delayed' }, error: { t: 'خطای دریافت', cls: 'error' },
};
export function StatusPill({ status, title }) {
  const s = STATUS[status] || STATUS.manual;
  return html`<span class=${'pill ' + s.cls} title=${title || ''}>${status === 'live' && html`<i class="blink"></i>`}${s.t}</span>`;
}

export function refLabel(ref) {
  if (!ref) return '';
  if (ref.provider === 'tgju') return TGJU_BY_KEY[ref.key]?.name || ref.key;
  if (ref.provider === 'nobitex') return NOBITEX_BY_KEY[ref.key]?.name || ref.name || String(ref.sym || ref.key).toUpperCase();
  if (ref.provider === 'tsetmc') return ref.label || ref.symbol || ref.key;
  if (ref.provider === 'fipiran') return ref.label || ref.name || ref.key;
  return ref.key;
}
export const providerName = (p) => PROVIDERS[p]?.name || p;

export function Toggle({ on, onChange, title }) {
  return html`<button type="button" class=${'toggle' + (on ? ' on' : '')} title=${title} aria-pressed=${!!on} onClick=${() => onChange(!on)}></button>`;
}
export function Seg({ value, options, onChange, cls = '' }) {
  return html`<div class=${'seg ' + cls}>${options.map(([v, l]) => html`<button type="button" class=${v === value ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
}

/* ---------------- inputs ---------------- */
const fmtVal = (v) => (v === null || v === undefined || v === '' || !isFinite(v) ? '' : localSep(groupTyping(String(+(+v).toFixed(8)))));
const localSep = (g) => (getDigits() === 'fa' ? g.replace(/,/g, '٬') : g);

/**
 * Number input with live thousand separators, caret preservation, Persian words underneath
 * and a sanity warning when the new value is ~10× off the previous one.
 */
export function NumField({ label, value, onInput, suffix, hint, placeholder, digits = 'auto', autoFocus, err, words = false, wordsUnit = '', prev = null, compact = false }) {
  const [txt, setTxt] = useState(fmtVal(value));
  const ref = useRef();
  useEffect(() => { if (document.activeElement !== ref.current) setTxt(fmtVal(value)); }, [value]);
  const onIn = (e) => {
    const el = e.target; const raw = el.value; const caret = el.selectionStart ?? raw.length;
    const sig = toEnDigits(raw.slice(0, caret)).replace(/[^\d.\-]/g, '').length;
    const g = localSep(groupTyping(raw));
    setTxt(g);
    requestAnimationFrame(() => {
      let i = 0, c = 0; const t = toEnDigits(g);
      while (i < t.length && c < sig) { if (/[\d.\-]/.test(t[i])) c++; i++; }
      try { el.setSelectionRange(i, i); } catch { /* ignore */ }
    });
    const v = parseNum(g);
    onInput(g !== '' && isFinite(v) ? v : null);
  };
  const v = parseNum(txt);
  const has = txt !== '' && isFinite(v);
  const w = words && has ? numToWordsFa(v) + (wordsUnit ? ' ' + wordsUnit : '') : '';
  const ratio = has && prev > 0 && v > 0 ? v / prev : 1;
  const warn = ratio >= 8 || ratio <= 1 / 8;
  return html`<div class="field">
    ${label && html`<label>${label}</label>`}
    <div class="input-wrap">
      <input ref=${ref} class=${'input num-in' + (err ? ' err' : '') + (warn ? ' warn' : '')} inputmode="decimal" placeholder=${placeholder || ''} autoFocus=${autoFocus} value=${txt} onInput=${onIn} />
      ${suffix && html`<span class="suffix">${suffix}</span>`}
    </div>
    ${!compact && (w || hint || warn) && html`<span class="hint">
      ${w && html`<span class="words">${w}</span>`}
      ${warn && html`<span class="warn-line"><${Icon} n="alert" cls="sm" /> ${ratio >= 8 ? `حدود ${num(ratio, 0)} برابرِ مقدار قبلی است؛ تعداد صفرها را چک کن` : `حدود ${num(1 / ratio, 0)} برابر کمتر از مقدار قبلی است؛ تعداد صفرها را چک کن`}</span>`}
      ${hint && html`<span>${hint}</span>`}
    </span>`}
  </div>`;
}

/** Money input in the user's display unit (toman/rial); stores Rial. Shows the amount in words. */
export function MoneyField({ label, rial, onRial, s, hint, autoFocus, err, prev = null }) {
  const k = s?.currency === 'rial' ? 1 : 10;
  const unit = s?.currency === 'rial' ? 'ریال' : 'تومان';
  return html`<${NumField} label=${label} value=${rial === null || rial === undefined || rial === '' ? '' : Math.round(rial / k)} onInput=${(v) => onRial(v === null ? null : v * k)}
    suffix=${unit} hint=${hint} digits=${0} autoFocus=${autoFocus} err=${err} words wordsUnit=${unit} prev=${prev ? prev / k : null} />`;
}

const WD = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
/** Jalali month calendar (week starts Saturday) */
export function JCalendar({ value, onPick, onClear, onClose }) {
  const t = isoToJ(todayIso());
  const init = value ? isoToJ(value) : t;
  const [ym, setYm] = useState({ jy: init.jy, jm: init.jm });
  const box = useRef();
  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) onClose(); };
    const k = (e) => e.key === 'Escape' && onClose();
    setTimeout(() => { document.addEventListener('mousedown', h); box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 0); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  const first = jToIso(ym.jy, ym.jm, 1);
  const lead = (dateFromIso(first).getDay() + 1) % 7;
  const len = monthLength(ym.jy, ym.jm);
  const move = (d) => { let m = ym.jm + d, y = ym.jy; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } setYm({ jy: y, jm: m }); };
  const sel = value ? isoToJ(value) : null;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(html`<span></span>`);
  for (let d = 1; d <= len; d++) {
    const isSel = sel && sel.jy === ym.jy && sel.jm === ym.jm && sel.jd === d;
    const isToday = t.jy === ym.jy && t.jm === ym.jm && t.jd === d;
    cells.push(html`<button type="button" class=${'cal-d' + (isSel ? ' on' : '') + (isToday ? ' today' : '')} onClick=${() => { onPick(jToIso(ym.jy, ym.jm, d)); onClose(); }}>${d}</button>`);
  }
  return html`<div class="cal" ref=${box} role="dialog" aria-label="انتخاب تاریخ">
    <div class="cal-h">
      <button type="button" class="btn icon sm ghost" onClick=${() => move(-1)} aria-label="ماه قبل"><${Icon} n="chevronRight" cls="sm" /></button>
      <div class="cal-t"><select value=${ym.jm} onChange=${(e) => setYm({ ...ym, jm: +e.target.value })}>${MONTHS.map((m, i) => html`<option value=${i + 1}>${m}</option>`)}</select>
        <select value=${ym.jy} onChange=${(e) => setYm({ ...ym, jy: +e.target.value })}>${Array.from({ length: 31 }, (_, i) => t.jy - 25 + i).map((y) => html`<option value=${y}>${y}</option>`)}</select></div>
      <button type="button" class="btn icon sm ghost" onClick=${() => move(1)} aria-label="ماه بعد"><${Icon} n="chevronLeft" cls="sm" /></button>
    </div>
    <div class="cal-g">${WD.map((w) => html`<span class="cal-w">${w}</span>`)}${cells}</div>
    <div class="cal-f"><button type="button" class="btn sm ghost" onClick=${() => { onPick(todayIso()); onClose(); }}>امروز</button>${onClear && html`<button type="button" class="btn sm ghost" onClick=${() => { onClear(); onClose(); }}>بدون تاریخ</button>`}</div>
  </div>`;
}

export function JDateField({ label, iso, onIso, hint, allowEmpty }) {
  const [txt, setTxt] = useState(iso ? fmtJ(iso, 'short') : '');
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setTxt(iso ? fmtJ(iso, 'short') : ''); setBad(false); }, [iso]);
  return html`<div class="field" style="position:relative">
    ${label && html`<label>${label}</label>`}
    <div class="input-wrap">
      <input class=${'input num-in' + (bad ? ' err' : '')} placeholder=${allowEmpty ? 'بدون تاریخ' : '۱۴۰۵/۰۷/۰۹'} value=${txt} style="padding-left:44px"
        onFocus=${() => setOpen(true)}
        onInput=${(e) => { setTxt(e.target.value); const v = parseJ(e.target.value); setBad(!v && !!e.target.value); if (v) onIso(v); else if (!e.target.value && allowEmpty) onIso(null); }} />
      <button type="button" class="cal-btn" aria-label="تقویم" onClick=${() => setOpen(!open)}><${Icon} n="calendar" cls="sm" /></button>
    </div>
    ${open && html`<${JCalendar} value=${iso} onPick=${(v) => onIso(v)} onClear=${allowEmpty ? () => onIso(null) : null} onClose=${() => setOpen(false)} />`}
    <span class="hint">${bad ? 'به شکل ۱۴۰۵/۰۷/۰۹ وارد کن یا از تقویم انتخاب کن' : iso ? fmtJ(iso) : hint || ''}</span>
  </div>`;
}

export function Slider({ label, value, onChange, min = -50, max = 100, step = 1, fmt = (v) => `${v > 0 ? '+' : ''}${num(v, 0)}٪`, note }) {
  const zero = ((0 - min) / (max - min)) * 100, pos = ((value - min) / (max - min)) * 100;
  const a = Math.min(zero, pos), b = Math.max(zero, pos);
  return html`<div class="slider">
    <div class="row between"><span class="sb small">${label}</span><span class=${'num sb small ' + (value > 0 ? 'pos' : value < 0 ? 'neg' : 'muted')}><span class="ltr">${fmt(value)}</span></span></div>
    <div class="slider-track" dir="ltr">
      <div class="slider-fill" style=${`left:${a}%;width:${b - a}%;background:${value >= 0 ? 'var(--pos)' : 'var(--neg)'}`}></div>
      <div class="slider-zero" style=${`left:${zero}%`}></div>
      <input type="range" dir="ltr" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onChange(+e.target.value)} onDblClick=${() => onChange(0)} />
    </div>
    ${note && html`<div class="xs muted">${note}</div>`}
  </div>`;
}

/** Minimal, safe Markdown → HTML (bold, lists, headings, paragraphs) */
export function Markdown({ text }) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (li) { if (!list) { list = []; } list.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(`<h4>${inline(h[1])}</h4>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return html`<div class="md" dangerouslySetInnerHTML=${{ __html: out.join('') }}></div>`;
}

/* ---------------- overlays ---------------- */
export function Drawer({ title, onClose, children, footer, icon }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, []);
  return html`<div class="scrim" onClick=${onClose}></div>
  <aside class="drawer" role="dialog" aria-label=${title}>
    <div class="dh">${icon}<h2>${title}</h2><button class="btn icon ghost" onClick=${onClose} aria-label="بستن"><${Icon} n="x" /></button></div>
    <div class="db">${children}</div>
    ${footer && html`<div class="df">${footer}</div>`}
  </aside>`;
}
export function Modal({ title, onClose, children, footer }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, []);
  return html`<div class="scrim" onClick=${onClose}></div>
  <div class="modal" role="dialog">
    <div class="row between" style="margin-bottom:14px"><h3 style="margin:0;font-size:16px">${title}</h3><button class="btn icon ghost sm" onClick=${onClose}><${Icon} n="x" /></button></div>
    <div class="col" style="gap:14px">${children}</div>
    ${footer && html`<div class="row end" style="margin-top:18px">${footer}</div>`}
  </div>`;
}

/* ---------------- charts (hand-made SVG) ---------------- */
export function Donut({ data, size = 180, thick = 22, center, hl, onHover }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const r = (size - thick) / 2, C = 2 * Math.PI * r;
  let acc = 0;
  const gap = data.length > 1 ? 2 : 0;
  return html`<div style=${`position:relative;width:${size}px;height:${size}px;margin:auto`}>
    <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} style="transform:rotate(-90deg)">
      <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--surface-3)" stroke-width=${thick} />
      ${data.map((d) => {
        const len = Math.max(0, d.value) / total * C;
        const el = html`<circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${d.color} stroke-width=${hl === d.id ? thick + 6 : thick}
          stroke-dasharray=${`${Math.max(0, len - gap)} ${C}`} stroke-dashoffset=${-acc} style="transition:stroke-width .15s;cursor:pointer"
          onMouseEnter=${() => onHover && onHover(d.id)} onMouseLeave=${() => onHover && onHover(null)} />`;
        acc += len; return el;
      })}
    </svg>
    <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;pointer-events:none">${center}</div>
  </div>`;
}

export function StackBar({ items, height = 10, radius = 10 }) {
  const total = items.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  return html`<div style=${`display:flex;height:${height}px;border-radius:${radius}px;overflow:hidden;gap:2px;background:var(--surface-3)`}>
    ${items.filter((d) => d.value > 0).map((d) => html`<i title=${d.name} style=${`flex:${d.value / total};background:${d.color}`}></i>`)}
  </div>`;
}

export function Sparkline({ values, w = 96, h = 30, color = 'var(--accent)', fill = true }) {
  if (!values || values.length < 2) return html`<svg width=${w} height=${h}></svg>`;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [i / (values.length - 1) * w, h - 3 - (v - min) / span * (h - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const id = 'sg' + Math.random().toString(36).slice(2, 7);
  return html`<svg width=${w} height=${h} style="display:block">
    <defs><linearGradient id=${id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color=${color} stop-opacity=".25" /><stop offset="1" stop-color=${color} stop-opacity="0" /></linearGradient></defs>
    ${fill && html`<path d=${d + ` L${w} ${h} L0 ${h} Z`} fill=${`url(#${id})`} />`}
    <path d=${d} fill="none" stroke=${color} stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

/**
 * Area chart (time axis left→right, as on Iranian market sites).
 * points: [{date, value}]
 */
export function AreaChart({ points, height = 180, fmt = (v) => num(v), color = 'var(--accent)', stroke, onDark = false, emptyText = 'هنوز داده‌ای برای نمودار ثبت نشده' }) {
  const ref = useRef(); const [w, setW] = useState(560); const [hov, setHov] = useState(null);
  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(Math.max(200, e[0].contentRect.width)));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const padT = 14, padB = 22, padX = 6;
  if (!points || points.length < 2) {
    return html`<div ref=${ref} style=${`height:${height}px;display:grid;place-items:center;font-size:12px;opacity:.75;text-align:center;padding:0 20px`}>${emptyText}</div>`;
  }
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min *= 0.98; max *= 1.02; if (min === max) { min -= 1; max += 1; } }
  const pad = (max - min) * 0.12; min -= pad; max += pad;
  const n = points.length;
  const X = (i) => padX + i / (n - 1) * (w - padX * 2);
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);
  const line = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.value).toFixed(1)).join(' ');
  const longSpan = points.length > 1 && (new Date(points[n - 1].date) - new Date(points[0].date)) / 86400000 > 120;
  const estN = points.findIndex((p) => !p.est);
  const estEnd = estN === -1 ? n - 1 : estN;
  const estLine = estEnd > 0 ? points.slice(0, estEnd + 1).map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.value).toFixed(1)).join(' ') : null;
  const realLine = estEnd < n - 1 ? points.slice(estEnd).map((p, i) => (i ? 'L' : 'M') + X(i + estEnd).toFixed(1) + ' ' + Y(p.value).toFixed(1)).join(' ') : null;
  const area = line + ` L${X(n - 1).toFixed(1)} ${height - padB} L${X(0).toFixed(1)} ${height - padB} Z`;
  const id = 'ag' + Math.round(Math.random() * 1e6);
  const ticks = [0, Math.floor((n - 1) / 2), n - 1];
  const sc = stroke || color;
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.round((x - padX) / (w - padX * 2) * (n - 1));
    setHov(Math.max(0, Math.min(n - 1, i)));
  };
  return html`<div ref=${ref} style="position:relative" onMouseMove=${onMove} onMouseLeave=${() => setHov(null)}>
    <svg class="chart" width=${w} height=${height} style="display:block;overflow:visible;direction:ltr">
      <defs><linearGradient id=${id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color=${color} stop-opacity=${onDark ? '.45' : '.28'} /><stop offset="1" stop-color=${color} stop-opacity="0" /></linearGradient></defs>
      <g class="grid">${[0.25, 0.5, 0.75].map((f) => html`<line x1="0" x2=${w} y1=${padT + f * (height - padT - padB)} y2=${padT + f * (height - padT - padB)} style=${onDark ? 'stroke:rgba(255,255,255,.12)' : ''} />`)}</g>
      <path d=${area} fill=${`url(#${id})`} />
      ${estLine && html`<path d=${estLine} fill="none" stroke=${sc} stroke-width="2" stroke-dasharray="4 4" opacity=".75" stroke-linejoin="round" />`}
      ${realLine && html`<path d=${realLine} fill="none" stroke=${sc} stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />`}
      ${ticks.map((i) => html`<text x=${X(i)} y=${height - 5} text-anchor=${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>${fmtJ(points[i].date, longSpan ? 'my' : 'dm')}</text>`)}
      ${hov !== null && html`<g><line x1=${X(hov)} x2=${X(hov)} y1=${padT} y2=${height - padB} stroke=${onDark ? 'rgba(255,255,255,.4)' : 'var(--line-2)'} />
        <circle cx=${X(hov)} cy=${Y(points[hov].value)} r="4.5" fill=${onDark ? '#fff' : 'var(--surface)'} stroke=${sc} stroke-width="2.5" /></g>`}
    </svg>
    ${hov !== null && html`<div class="tip" style=${`left:${X(hov)}px;top:${Y(points[hov].value) - 6}px`}><span class="priv">${fmt(points[hov].value)}</span>، ${fmtJ(points[hov].date, 'dm')}${points[hov].est ? '، بازسازی‌شده' : ''}</div>`}
  </div>`;
}

export function BackfillButton({ st, label = 'ساخت نمودار از قیمت‌های گذشته', cls = 'btn', days = 365 }) {
  const b = st.meta.backfill;
  const running = b?.state === 'running' && Date.now() - (b.at || 0) < 120000;
  const run = async () => {
    const r = await send('backfill', { days });
    toast(r?.ok ? `تاریخچه ${num(r.added)} روز بازسازی شد` : (r?.error || 'بازسازی انجام نشد'));
  };
  return html`<button class=${cls} onClick=${run} disabled=${running}>
    <${Icon} n=${running ? 'refresh' : 'history'} cls=${'sm' + (running ? ' spin' : '')} />${running ? `در حال دریافت قیمت‌های گذشته… ${num(b.done)}/${num(b.total)}` : label}</button>`;
}


export { money, pct, num, fmtJ, todayIso, isoToJ };

/* ---------------- «این عدد از کجا آمد؟» ---------------- */
function ExplainLine({ l, s }) {
  let v;
  if (l.k === 'money') v = html`<${Money} v=${l.v} s=${s} sign=${!!l.sign} />`;
  else if (l.k === 'usd') v = html`<span class="num ltr">$${num(l.v, 2)}</span>`;
  else if (l.k === 'qty') v = html`<span class="num">${num(l.v, 'auto')} ${l.unit || ''}</span>`;
  else if (l.k === 'pct') v = html`<span class="num ltr">${pct(l.v, { sign: !!l.sign })}</span>`;
  else if (l.k === 'date') v = html`<span>${fmtJ(l.v)}</span>`;
  else if (l.k === 'num') v = html`<span class="num">${num(l.v, 'auto')}${l.unit ? ' ' + l.unit : ''}</span>`;
  else v = html`<span>${l.v}</span>`;
  const sub = l.sub && typeof l.sub === 'object' && 'pct' in l.sub ? html`<span class="ltr">(${pct(l.sub.pct)})</span>` : l.sub ? (l.subK === 'date' ? fmtJ(l.sub) : l.sub) : '';
  return html`<div class=${'xl' + (l.total ? ' total' : '') + (l.strong ? ' strong' : '')}>
    <span class="t">${l.color && html`<i style=${'background:' + l.color}></i>`}${l.t}${l.at ? html`<span class="xs muted">، ${timeOrDate(l.at)}</span>` : ''}</span>
    <span class="v">${v}${sub ? html` <span class="xs muted">${sub}</span>` : ''}</span></div>`;
}
const timeOrDate = (ms) => (new Date().toDateString() === new Date(ms).toDateString() ? `ساعت ${timeHM(ms)}` : fmtJ(isoFromMs(ms), 'dm'));
const isoFromMs = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Small «؟» button: opens a breakdown of how a number was calculated. `get()` returns {lines, formula, notes, drivers?}. */
export function Explain({ get, s, title = 'این عدد از کجا آمد؟', ask, light = false }) {
  const [pos, setPos] = useState(null);
  const btn = useRef();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e) => { if (!e.target.closest?.('.xpop') && !btn.current?.contains(e.target)) setPos(null); };
    const esc = (e) => e.key === 'Escape' && setPos(null);
    const off = (e) => { if (e?.target?.closest?.('.xpop')) return; setPos(null); }; // scrolling inside the popover keeps it open
    const t = setTimeout(() => document.addEventListener('mousedown', close), 0);
    addEventListener('keydown', esc); addEventListener('resize', off); document.addEventListener('scroll', off, true);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', close); removeEventListener('keydown', esc); removeEventListener('resize', off); document.removeEventListener('scroll', off, true); };
  }, [pos]);
  const toggle = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (pos) return setPos(null);
    setData(get());
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 24);
    const right = Math.min(Math.max(12, innerWidth - r.right - 8), innerWidth - w - 12);
    const below = innerHeight - r.bottom > 280 || r.top < 300;
    setPos({ right, w, top: below ? r.bottom + 6 : null, bottom: below ? null : innerHeight - r.top + 6 });
  };
  return html`<span class="xwrap" onClick=${(e) => e.stopPropagation()}>
    <button type="button" ref=${btn} class=${'xbtn' + (light ? ' light' : '') + (pos ? ' on' : '')} title=${title} aria-label=${title} onClick=${toggle}><${Icon} n="help" cls="sm" /></button>
    ${pos && data && html`<div class="xpop" role="dialog" style=${`right:${pos.right}px;width:${pos.w}px;${pos.top !== null ? `top:${pos.top}px` : `bottom:${pos.bottom}px`}`}>
      <div class="xh"><span class="sb small">${title}</span><button class="btn icon sm ghost" onClick=${() => setPos(null)}><${Icon} n="x" cls="sm" /></button></div>
      ${data.formula && html`<div class="xf">${data.formula}</div>`}
      <div class="xls">${data.lines.map((l) => html`<${ExplainLine} l=${l} s=${s} />`)}</div>
      ${data.drivers?.length > 0 && html`<div class="xs muted sb" style="margin:8px 0 2px">بیشترین اثر بازار</div><div class="xls">${data.drivers.map((l) => html`<${ExplainLine} l=${l} s=${s} />`)}</div>`}
      ${(data.notes || []).map((n) => html`<div class="xs muted" style="margin-top:6px">${n}</div>`)}
      ${ask && html`<div style="margin-top:10px"><${AskBtn} q=${ask} label="از دستیار بپرس" /></div>`}
    </div>`}
  </span>`;
}

/** «بپرس»: opens the assistant with a question about this spot, already sent. */
export function AskBtn({ q, label = 'بپرس', cls = '', title }) {
  return html`<a class=${'askbtn ' + cls} href=${'#/assistant?ask=' + encodeURIComponent(q)} title=${title || q} onClick=${(e) => e.stopPropagation()}><${Icon} n="sparkles" cls="sm" />${label ? html`<span>${label}</span>` : ''}</a>`;
}
