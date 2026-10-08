import { html, useState, useEffect, useMemo, useRef, Icon, Seg, Toggle, Money, toast, send, num, fmtJ, Ava, hasChrome, refLabel, BackfillButton } from '../components.js';
import * as store from '../../lib/store.js';
import * as E from '../../lib/engine.js';
import { parseDelimited, toCSV } from '../../lib/importer.js';
import * as SM from '../../lib/sheetmap.js';
import { readXlsx } from '../../lib/xlsx.js';
import * as AI from '../../lib/ai.js';
import * as BK from '../../lib/backup.js';
import { PROVIDERS, CAT, CATEGORIES } from '../../lib/catalog.js';
import { uid } from '../../lib/format.js';
import { todayIso, addDaysIso } from '../../lib/jalali.js';
import { act } from '../actions.js';
import { AIConnections } from './aiconn.js';
import * as U from '../../lib/update.js';
import { CHANGELOG, compareVersions } from '../../lib/changelog.js';
import { ago } from '../../lib/format.js';

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/* ---------------- import panel (shared by welcome & settings) ---------------- */
// Any spreadsheet: pick (file, pasted cells or a Google Sheet link) → we read the columns → the owner checks the
// list (and the columns, only when we're unsure) → add. Dara's own export and the JSON backup keep working as before.

/** a text file as UTF-8 (or UTF-16 with its mark), or as Windows Arabic/Persian (cp1256) when that is what Excel saved */
function decodeText(buf) {
  const b = new Uint8Array(buf);
  // Excel's «Unicode Text» is UTF-16 with a byte-order mark
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, ''); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('windows-1256').decode(b); } catch { return new TextDecoder('utf-8').decode(b); }
}
/** the sheet most likely to hold the assets: the one with the most rows that carry a number */
const bestSheet = (sheets) => sheets.map((sh, i) => [i, sh.rows.filter((r) => r.some((v) => SM.isNumCell(v))).length]).sort((a, b) => b[1] - a[1])[0][0];
const WHY = { title: 'از عنوان ستون‌ها', prices: 'با قیمت‌های امروز سنجیده شد', ai: 'به تشخیص هوش مصنوعی', you: '', guess: 'مطمئن نیستیم؛ نگاهی بینداز' };

function MapGrid({ rows, map, onRole }) {
  const cols = Array.from({ length: map.ncol }, (_, i) => i).filter((i) => rows.some((r, k) => k > map.headerRow && String(r[i] ?? '').trim()));
  const sample = rows.slice(map.headerRow + 1).filter((r) => r.some((v) => String(v).trim())).slice(0, 4);
  return html`<div class="imp-grid-wrap"><table class="imp-grid">
    <thead><tr>${cols.map((i) => html`<th class=${map.roles[i] === 'ignore' ? 'off' : ''}>
      <select class=${'imp-role' + (map.roles[i] === 'ignore' ? '' : ' on')} value=${map.roles[i]} aria-label=${'ستون ' + num(i + 1)} onChange=${(e) => onRole(i, e.target.value)}>
        ${SM.ROLES.map(([r, n]) => html`<option value=${r}>${r === 'ignore' ? '— ' + n : n}</option>`)}</select>
      <div class="imp-h">${map.headers[i] || html`<span class="faint">ستون ${num(i + 1)}</span>`}</div></th>`)}</tr></thead>
    <tbody>${sample.map((r) => html`<tr>${cols.map((i) => html`<td class=${map.roles[i] === 'ignore' ? 'off' : ''}>${r[i] || ''}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

function ImportPanel({ st, s, onDone, compact }) {
  const [src, setSrc] = useState(null);       // { label, sheets: [{ name, rows }], si } | { backup, assets, notes, label }
  const [cfg, setCfg] = useState(null);       // SM.readSheet() of the current sheet, plus the owner's edits
  const [cats, setCats] = useState({});       // row index → category, chosen in the list
  const [edit, setEdit] = useState(false);    // the column editor is open
  const [how, setHow] = useState(null);       // 'paste' | 'link'
  const [paste, setPaste] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [aiState, setAiState] = useState('');  // '' | 'running' | error text
  const [showOut, setShowOut] = useState(false);
  const [locked, setLocked] = useState(null); // { env, label, pw, err }: a backup with a password, waiting for it
  const lockRef = useRef(null); lockRef.current = locked?.env || null;
  const unlock = async () => {
    const env = locked.env, label = locked.label;
    setBusy(true);
    try { const obj = await BK.decrypt(env, locked.pw); if (lockRef.current === env) { setLocked(null); fromText(JSON.stringify(obj), label); } }
    catch (e) { if (lockRef.current === env) setLocked((l) => (l && l.env === env ? { ...l, err: e.message || 'باز کردن فایل ممکن نشد' } : l)); }
    setBusy(false);
  };
  const quotes = st?.quotes || {};
  const conns = st?.ai ? AI.orderedConnections(st.ai) : [];
  const hasAssets = !!st?.assets?.some((a) => !a.archived);

  const reset = () => { setSrc(null); setCfg(null); setCats({}); setEdit(false); setAiState(''); setShowOut(false); };
  const openSheet = (sheets, si, label) => {
    const r = SM.readSheet(sheets[si].rows, { quotes });
    setSrc({ label, sheets, si }); setCfg(r); setCats({}); setAiState(''); setShowOut(false);
    const m = r.map; const t = (role) => m.how[m.roles.indexOf(role)] === 'title';
    const sure = r.kind === 'dara' || (!m.missing.length && m.headerRow >= 0 && t('name') && (t('value') || (t('quantity') && t('price'))));
    setEdit(!sure);
  };
  const fromText = (text, label) => {
    if (/^\s*[\[{]/.test(text)) {
      let obj;
      try { obj = JSON.parse(text); } catch { return toast('این فایل JSON خراب است و خوانده نشد'); }
      if (BK.isLocked(obj)) { setLocked({ env: obj, label, pw: '', err: '' }); return; } // a backup with a password: ask for it
      const chk = store.checkBackup(obj);
      if (!chk.ok) return toast(chk.error);
      setSrc({ label, backup: obj, assets: store.cleanList('assets', obj.data.assets), notes: chk.dropped ? [`${num(chk.dropped)} ردیف ناقص یا خراب کنار گذاشته شد.`] : [] });
      return;
    }
    const rows = parseDelimited(text);
    if (!rows.some((r) => r.some((v) => String(v).trim()))) return toast('چیزی برای خواندن پیدا نشد');
    openSheet([{ name: label, rows }], 0, label);
  };
  const fromFile = async (f) => {
    if (!f) return;
    setBusy(true);
    try {
      const buf = await f.arrayBuffer(); const b = new Uint8Array(buf.slice(0, 4));
      if (/\.xlsx?$/i.test(f.name) || (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf)) {
        const wb = await readXlsx(buf);
        openSheet(wb.sheets, bestSheet(wb.sheets), f.name);
      } else if (BK.isGzip(new Uint8Array(buf.slice(0, 2)))) fromText(await BK.gunzip(new Uint8Array(buf)), f.name); // a large automatic backup
      else fromText(decodeText(buf), f.name);
    } catch (e) { toast(e.message || 'خواندن فایل ممکن نشد'); }
    setBusy(false);
  };
  const fromLink = async () => {
    const m = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/); if (!m) return toast('لینک گوگل‌شیت معتبر نیست');
    const gid = (link.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
    setBusy(true);
    try {
      if (hasChrome && chrome.permissions) {
        const ok = await chrome.permissions.request({ origins: ['https://docs.google.com/*', 'https://*.googleusercontent.com/*'] });
        if (!ok) throw new Error('اجازه دسترسی به گوگل‌شیت داده نشد');
      }
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`, { credentials: 'include' });
      if (!r.ok) throw new Error('دریافت شیت ممکن نشد (HTTP ' + r.status + ')');
      const text = await r.text();
      if (text.trim().startsWith('<')) throw new Error('شیت خصوصی است؛ در همین مرورگر وارد حساب گوگل شو یا فایل را دانلود و اینجا رها کن');
      fromText(text, 'گوگل‌شیت');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };

  const rows = src?.sheets ? src.sheets[src.si].rows : null;
  const map = cfg?.map;
  const ready = cfg && (cfg.kind === 'dara' || !map.missing.length);
  const items = useMemo(() => {
    if (!rows || !ready) return [];
    return cfg.kind === 'dara' ? SM.applyDara(rows, cfg.headerRow, { unit: cfg.unit, catOverride: cats }) : SM.applyMapping(rows, map, { unit: cfg.unit, catOverride: cats });
  }, [rows, cfg, cats]);
  const assets = useMemo(() => (src?.backup ? src.assets : items.filter((x) => x.asset).map((x) => x.asset)), [src, items]);
  const left = items.filter((x) => !x.asset);
  const pf = useMemo(() => (assets.length ? E.portfolio(assets, {}, s) : null), [assets]);
  const rowOf = pf ? Object.fromEntries(pf.rows.map((r) => [r.asset.id, r])) : {};

  const setRole = (i, role) => setCfg({ ...cfg, kind: 'map', map: SM.setRole(map, i, role) });
  const setTitles = (on) => {
    const first = rows.findIndex((r) => r.some((v) => String(v).trim()));
    const m = SM.guessMapping(rows, { quotes, headerRow: on ? first : -1 });
    setCfg({ ...cfg, kind: 'map', headerRow: m.headerRow, map: m, unit: m.unit, unitWhy: m.unitWhy }); setCats({});
  };
  const askAI = async () => {
    setAiState('running');
    try {
      const res = await AI.extract({ ai: st.ai, system: SM.aiMappingSystem(), prompt: SM.aiMappingPrompt(rows, map, { privacy: st.ai.privacy, mask: AI.maskSensitive }), maxTokens: 900 });
      const m = SM.parseAiMapping(res.json, map);
      setCfg({ ...cfg, kind: 'map', map: m, unit: m.unit, unitWhy: m.unitWhy });
      setCats((c) => ({ ...SM.aiCatOverrides(rows, m), ...c }));
      setAiState('');
      toast(m.missing.length ? 'هوش مصنوعی هم همه ستون‌ها را پیدا نکرد؛ بقیه را خودت مشخص کن' : 'ستون‌ها تشخیص داده شد؛ فهرست را نگاه کن');
    } catch (e) { setAiState(e.message || 'ارتباط با هوش مصنوعی ممکن نشد'); }
  };

  const commit = async (mode) => {
    try {
      let count = assets.length;
      if (src.backup) { const r = await store.importBackup(src.backup, { merge: mode === 'merge' }); if (mode === 'merge') count = r.added ?? count; }
      else {
        await store.snapshotBeforeImport();
        await store.mutate(['assets', 'meta'], (st2) => {
          // codes stay unique: imported rows that clash with an existing code get the next free one
          let n = Math.max(+st2.meta.lastCode || 0, ...st2.assets.map((x) => +(/^A-(\d+)$/.exec(x.code || '') || [])[1] || 0));
          const keep = mode === 'replace' ? [] : st2.assets;
          const used = new Set(keep.map((x) => x.code));
          const later = new Set(assets.map((a) => a.code).filter(Boolean));
          const next = () => { let c; do c = 'A-' + String(++n).padStart(3, '0'); while (used.has(c) || later.has(c)); return c; };
          const add = assets.map((a) => { if (!a.code || used.has(a.code)) a = { ...a, code: next() }; used.add(a.code); return a; });
          st2.assets = keep.concat(add); st2.meta = { ...st2.meta, lastCode: n };
        });
      }
      await act.setSettings({ onboarded: true });
      send('refresh');
      toast(count ? `${num(count)} دارایی وارد شد؛ قیمت‌های آنلاین در حال دریافت است…` : 'همه این دارایی‌ها از قبل بودند؛ چیزی اضافه نشد',
        { label: 'برگشت', fn: async () => { try { await store.undoImport(); toast('داده‌های قبل از ورود برگشت'); } catch (e) { toast(e.message); } } });
      reset(); onDone && onDone();
    } catch (e) { toast(e.message || 'ورود اطلاعات انجام نشد'); }
  };

  if (locked) return html`<div class="col imp" style="gap:12px">
    <div class="imp-src"><span class="imp-file"><${Icon} n="lock" cls="sm" /><span class="ellipsis">${locked.label}</span></span><span class="grow"></span>
      <button class="btn ghost sm" onClick=${() => setLocked(null)}>فایل دیگر</button></div>
    <div class="field"><label>این پشتیبان رمز دارد</label>
      <div class="row" style="gap:8px"><input class="input" type="password" autoFocus placeholder="رمز پشتیبان" value=${locked.pw}
        onInput=${(e) => setLocked({ ...locked, pw: e.target.value, err: '' })} onKeyDown=${(e) => e.key === 'Enter' && locked.pw && unlock()} />
        <button class="btn primary" disabled=${!locked.pw || busy} onClick=${unlock}>${busy ? 'در حال باز کردن…' : 'باز کردن'}</button></div>
      ${locked.err && html`<span class="err-msg">${locked.err}</span>`}</div>
  </div>`;

  /* step 1: pick */
  if (!src) return html`<div class="col imp" style="gap:12px">
    <label class=${'imp-drop' + (drag ? ' on' : '') + (busy ? ' busy' : '')}
      onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)}
      onDrop=${(e) => { e.preventDefault(); setDrag(false); fromFile(e.dataTransfer.files?.[0]); }}>
      <span class="imp-drop-ic"><${Icon} n=${busy ? 'refresh' : 'upload'} cls=${busy ? 'spin' : ''} /></span>
      <span class="imp-drop-t">${busy ? 'در حال خواندن…' : html`فایل را اینجا رها کن یا <span class="imp-link">انتخاب کن</span>`}</span>
      <span class="imp-drop-d">اکسل، CSV یا پشتیبان دارا — با هر چیدمان و هر عنوانی برای ستون‌ها</span>
      <input type="file" hidden accept=".xlsx,.csv,.tsv,.txt,.json,.gz,text/csv,text/plain,application/json,application/gzip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange=${(e) => { fromFile(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
    <div class="imp-or">
      <button class=${'chip' + (how === 'paste' ? ' on' : '')} onClick=${() => setHow(how === 'paste' ? null : 'paste')}><${Icon} n="copy" cls="sm" />چسباندن از اکسل</button>
      ${!compact && html`<button class=${'chip' + (how === 'link' ? ' on' : '')} onClick=${() => setHow(how === 'link' ? null : 'link')}><${Icon} n="link" cls="sm" />لینک گوگل‌شیت</button>`}
    </div>
    ${how === 'paste' && html`<div class="col" style="gap:8px">
      <textarea class="input imp-paste" autoFocus placeholder="سلول‌ها را در اکسل یا گوگل‌شیت انتخاب و کپی کن، بعد اینجا بچسبان"
        value=${paste} onInput=${(e) => setPaste(e.target.value)}
        onPaste=${(e) => { const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); setPaste(t); fromText(t, 'سلول‌های چسبانده‌شده'); } }}></textarea>
      <div class="row"><button class="btn primary" disabled=${!paste.trim()} onClick=${() => fromText(paste, 'سلول‌های چسبانده‌شده')}>ادامه</button></div></div>`}
    ${how === 'link' && html`<div class="row"><input class="input" autoFocus placeholder="لینک گوگل‌شیت را اینجا بگذار…" value=${link} onInput=${(e) => setLink(e.target.value)} />
      <button class="btn" disabled=${busy || !link} onClick=${fromLink}><${Icon} n=${busy ? 'refresh' : 'download'} cls=${busy ? 'sm spin' : 'sm'} />دریافت</button></div>`}
  </div>`;

  /* step 2: check and add */
  const roleCols = map ? map.roles.map((r, i) => [r, i]).filter(([r]) => r !== 'ignore') : [];
  return html`<div class="col imp" style="gap:14px">
    <div class="imp-src">
      <span class="imp-file"><${Icon} n="file" cls="sm" /><span class="ellipsis">${src.label}</span></span>
      ${src.sheets?.length > 1 && html`<select class="input imp-sheet" value=${src.si} aria-label="برگه" onChange=${(e) => openSheet(src.sheets, +e.target.value, src.label)}>
        ${src.sheets.map((sh, i) => html`<option value=${i}>${sh.name}</option>`)}</select>`}
      <span class="grow"></span>
      <button class="btn ghost sm" onClick=${reset}>فایل دیگر</button>
    </div>

    ${cfg && html`<div class="imp-sec">
      ${cfg.kind === 'dara'
        ? html`<div class="imp-line"><${Icon} n="circleCheck" cls="sm pos" /><span>قالب خود دارا شناخته شد</span></div>`
        : !edit
          ? html`<div class="imp-line"><${Icon} n="circleCheck" cls="sm pos" /><span class="grow">${roleCols.map(([r, i], k) => html`${k ? '، ' : ''}${SM.ROLE_NAME[r]} <span class="muted">از «${map.headers[i] || 'ستون ' + num(i + 1)}»</span>`)}</span>
              <button class="imp-link" onClick=${() => setEdit(true)}>تغییر ستون‌ها</button></div>`
          : html`<div class="col" style="gap:10px">
              <div class="row wrap" style="gap:12px"><b class="small grow">هر ستون چه چیزی است؟</b>
                <label class="row xs muted" style="gap:6px"><${Toggle} on=${map.headerRow >= 0} onChange=${setTitles} title="جدول سطر عنوان دارد" />سطر عنوان دارد</label>
                ${!map.missing.length && html`<button class="imp-link small" onClick=${() => setEdit(false)}>تمام</button>`}</div>
              <${MapGrid} rows=${rows} map=${map} onRole=${setRole} />
              ${map.missing.length > 0 && html`<div class="callout warn"><${Icon} n="info" cls="sm" /><div>برای ادامه، ستون ${map.missing.includes('name') ? '«نام دارایی»' : ''}${map.missing.length > 1 ? ' و ' : ''}${map.missing.includes('value') ? '«ارزش» (یا «مقدار» و «قیمت هر واحد»)' : ''} را از فهرست بالای ستون‌ها انتخاب کن.</div></div>`}
              ${conns.length > 0 && html`<div class="row wrap" style="gap:8px">
                <button class="btn sm" disabled=${aiState === 'running'} onClick=${askAI}><${Icon} n=${aiState === 'running' ? 'refresh' : 'sparkles'} cls=${aiState === 'running' ? 'sm spin' : 'sm'} />${aiState === 'running' ? 'در حال تشخیص…' : 'تشخیص با هوش مصنوعی'}</button>
                <span class="xs muted">${st.ai.privacy === 'percent' ? 'فقط عنوان‌ها و چند سطر نمونه، بدون هیچ عددی فرستاده می‌شود' : 'عنوان‌ها و چند سطر نمونه فرستاده می‌شود'}</span></div>
                ${aiState && aiState !== 'running' && html`<div class="xs neg">${aiState}</div>`}`}
            </div>`}
      <div class="imp-line"><span class="small">مبالغ به</span>
        <${Seg} value=${cfg.unit} onChange=${(v) => setCfg({ ...cfg, unit: v, unitWhy: 'you' })} options=${[['toman', 'تومان'], ['rial', 'ریال']]} />
        <span class=${'xs ' + (cfg.unitWhy === 'guess' ? 'warn' : 'muted')}>${WHY[cfg.unitWhy] || ''}</span></div>
    </div>`}

    ${(src.backup || ready) && (assets.length
      ? html`<div class="col" style="gap:10px">
        <div class="imp-total"><span><b>${num(assets.length)} دارایی</b>${src.backup ? ' از پشتیبان دارا' : ''}</span><span class="muted">ارزش خالص</span><b class="num"><${Money} v=${pf.net} s=${s} /></b></div>
        ${src.notes?.map((n) => html`<div class="xs muted">• ${n}</div>`)}
        <div class="imp-list">${(src.backup ? assets.map((a) => ({ asset: a, cat: a.category, i: a.id, fixed: true })) : items.filter((x) => x.asset)).map((x) => {
          const r = rowOf[x.asset.id]; if (!r) return null;
          const a = x.asset;
          return html`<div class="imp-it" key=${x.i}><${Ava} cat=${a.category} size=${30} />
            <span class="grow" style="min-width:0"><span class="sb ellipsis">${a.name}</span>
              <span class="xs muted">${a.custodian && a.custodian !== a.name ? a.custodian + ' · ' : ''}${a.mode === 'units' ? `${num(a.quantity, 4)} ${a.unit || ''} · ${a.price?.source === 'market' ? 'قیمت آنلاین: ' + refLabel(a.price.ref) : 'قیمت دستی'}` : a.mode === 'rate' ? 'نرخ ثابت' : 'مانده'}${a.review ? ' · ⚠ ' + a.review : ''}${x.note ? ' · ' + x.note : ''}</span></span>
            ${x.fixed ? html`<span class="xs muted">${r.cat.short}</span>` : html`<select class="imp-cat" value=${x.cat} aria-label=${'دسته ' + a.name} onChange=${(e) => setCats({ ...cats, [x.i]: e.target.value })}>
              ${CATEGORIES.map((c) => html`<option value=${c.id}>${c.short}</option>`)}</select>`}
            <span class="small num imp-v"><${Money} v=${r.signedValue} s=${s} compact /></span></div>`;
        })}</div>
        ${left.length > 0 && html`<div class="xs muted"><button class="imp-link" onClick=${() => setShowOut(!showOut)}>${num(left.length)} ردیف وارد نمی‌شود</button>
          ${showOut && html`<div class="col" style="gap:2px;margin-top:6px">${left.map((x) => html`<div>• «${x.name}»: ${x.skipped === 'total' ? 'سطر جمع است' : x.note || 'مبلغی ندارد'}</div>`)}</div>`}</div>`}
        <div class="row wrap">
          ${src.backup
            ? html`<button class="btn primary" onClick=${() => commit('replace')}>جایگزینی همه داده‌ها با این پشتیبان</button><button class="btn" onClick=${() => commit('merge')}>افزودن به داده‌های فعلی</button>`
            : hasAssets
              ? html`<button class="btn primary" onClick=${() => commit('merge')}>افزودن ${num(assets.length)} دارایی</button><button class="btn" title="دارایی‌های فعلی کنار می‌روند؛ تا چند ثانیه با «برگشت» قابل بازگشت است" onClick=${() => commit('replace')}>جایگزینی دارایی‌های فعلی</button>`
              : html`<button class="btn primary" onClick=${() => commit('replace')}>وارد کردن ${num(assets.length)} دارایی</button>`}
          <span class="grow"></span><button class="btn ghost" onClick=${reset}>انصراف</button></div>
      </div>`
      : html`<div class="callout warn"><${Icon} n="info" cls="sm" /><div>در این ${src.sheets?.length > 1 ? 'برگه' : 'فایل'} ردیفی که دارایی باشد پیدا نشد${left.length ? `؛ ${num(left.length)} ردیف مبلغ نداشت` : ''}. ${cfg?.kind === 'map' && !edit ? html`<button class="imp-link" onClick=${() => setEdit(true)}>ستون‌ها را بررسی کن</button>` : ''}</div></div>`)}
  </div>`;
}

/* ---------------- sample data ---------------- */
function sampleData() {
  const now = Date.now(); const t = todayIso();
  const bank = { id: uid('a'), code: 'A-001', name: 'بانک نمونه', custodian: 'حساب جاری', category: 'bank', mode: 'balance', balance: 850_000_000, balanceAt: now, liquidity: 'high', createdAt: now, updatedAt: now };
  return [
    bank,
    { id: uid('a'), code: 'A-002', name: 'طلای آب‌شده', custodian: 'پلتفرم طلای آنلاین', category: 'gold_online', mode: 'units', quantity: 12.5, unit: 'گرم', price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, adjustPct: -1, factor: 1 }, liquidity: 'mid', costBasis: 2_400_000_000, createdAt: now, updatedAt: now },
    { id: uid('a'), code: 'A-003', name: 'ربع سکه', custodian: 'صندوق امانات', category: 'gold', mode: 'units', quantity: 3, unit: 'عدد', price: { source: 'market', ref: { provider: 'tgju', key: 'rob' } }, liquidity: 'mid', createdAt: now, updatedAt: now },
    { id: uid('a'), code: 'A-004', name: 'دلار نقد', custodian: 'خانه', category: 'fx', mode: 'units', quantity: 1200, unit: 'دلار', price: { source: 'market', ref: { provider: 'tgju', key: 'price_dollar_rl' } }, liquidity: 'high', createdAt: now, updatedAt: now },
    { id: uid('a'), code: 'A-005', name: 'سپرده کوتاه‌مدت', custodian: 'بانک نمونه', category: 'fixed', mode: 'rate', rate: { principal: 3_000_000_000, annualPct: 23, start: addDaysIso(t, -40), mode: 'payout', payoutTo: bank.id, lastPayout: E.prevMonthlyOnOrBefore(addDaysIso(t, -40), t) }, liquidity: 'high', createdAt: now, updatedAt: now },
    { id: uid('a'), code: 'A-006', name: 'تتر', custodian: 'صرافی', category: 'crypto', mode: 'units', quantity: 900, unit: 'USDT', price: { source: 'market', ref: { provider: 'nobitex', key: 'usdt' } }, liquidity: 'high', createdAt: now, updatedAt: now },
  ];
}

/* ---------------- welcome ---------------- */
export function WelcomePage({ st, s, open, inline }) {
  const [step, setStep] = useState(null);
  return html`<div class="page" style="max-width:920px">
    <section class="hero" style="grid-template-columns:1fr;min-height:0">
      <div style="position:relative;z-index:1">
        <div class="lbl">به دارا خوش آمدی</div>
        <div style="font-size:26px;font-weight:800;margin:6px 0 8px">همه دارایی‌هایت، همیشه به‌روز — بدون ورود دستی قیمت</div>
        <div style="opacity:.85;max-width:640px">قیمت طلا، سکه، ارز، بورس، صندوق و رمزارز خودکار دریافت می‌شود؛ سپرده و درآمد ثابت هر روز رشد می‌کند؛ حقوق و قسط هر ماه خودش ثبت می‌شود. همه داده‌ها فقط روی همین مرورگر می‌ماند.</div>
      </div>
    </section>
    <div class="grid3">
      <button class="card mode" style="padding:18px" onClick=${() => { act.setSettings({ onboarded: true }); open(null); }}><span class="ava" style="background:var(--pos-bg);color:var(--pos)"><${Icon} n="plus" /></span><span class="mt" style="font-size:15px;margin-top:8px">شروع از صفر</span><span class="md">اولین دارایی را دستی اضافه کن</span></button>
      <button class="card mode" style="padding:18px" onClick=${() => setStep('import')}><span class="ava" style="background:var(--accent-soft);color:var(--accent)"><${Icon} n="file" /></span><span class="mt" style="font-size:15px;margin-top:8px">ورود از گوگل‌شیت یا اکسل</span><span class="md">اکسل با هر چیدمانی، CSV، گوگل‌شیت یا پشتیبان دارا</span></button>
      ${!st.assets.length && html`<button class="card mode" style="padding:18px" onClick=${async () => { await store.locked(async () => { const { assets } = await store.load('assets'); if (!assets?.length) await store.save({ assets: sampleData() }); }); await act.setSettings({ onboarded: true }); send('refresh'); toast('داده نمونه بارگذاری شد'); location.hash = '#/overview'; }}><span class="ava" style="background:var(--warn-bg);color:var(--warn)"><${Icon} n="sparkles" /></span><span class="mt" style="font-size:15px;margin-top:8px">دیدن با داده نمونه</span><span class="md">برای آشنایی؛ بعداً از تنظیمات پاک کن</span></button>`}
    </div>
    ${step === 'import' && html`<div class="card"><div class="card-h"><h3>ورود اطلاعات</h3></div><${ImportPanel} st=${st} s=${s} onDone=${() => (location.hash = '#/overview')} /></div>`}
  </div>`;
}

/* ---------------- automatic backups ---------------- */
const KEEP_NOTE = { all: 'هیچ فایلی پاک نمی‌شود.', smart: 'همه فایل‌های چهار هفته اخیر، یکی از هر ماه برای یک سال گذشته، و یکی از هر سال برای همیشه.', last: 'فقط ۸ فایل آخر می‌ماند.' };
function BackupCard({ st, s }) {
  const cfg = BK.backupSettings(s);
  const meta = st.meta.backup || {};
  const files = meta.files || [];
  const [vault, setVault] = useState(undefined);
  useEffect(() => { if (hasChrome) chrome.storage.local.get('vault').then((r) => setVault(r.vault || null)); else setVault(null); }, []);
  const [pw, setPw] = useState(null);
  const [busy, setBusy] = useState(false);
  const setCfg = async (p) => { await act.setSettings({ backup: { ...cfg, ...p } }); send('backupCheck'); };
  const said = (r) => (!r?.ok ? r?.error || 'پشتیبان ساخته نشد' : r.pending ? 'کروم پرسید فایل کجا ذخیره شود؛ پنجره دانلود را ببین' : r.saved ? `پشتیبان ذخیره شد: ${r.saved}` : 'پشتیبان به‌روز است');
  const now = async () => { setBusy(true); const r = await send('backupNow'); setBusy(false); toast(said(r)); };
  const plain = (meta.files || []).filter((f) => !f.locked && !f.pending);
  const purge = async () => {
    setBusy(true); const r = await send('backupPurgePlain'); setBusy(false);
    toast(r?.ok ? (r.left ? `${num(r.removed)} فایل پاک شد؛ ${num(r.left)} فایل جابه‌جا شده بود و دست نخورد` : `${num(r.removed)} پشتیبان بدون رمز پاک شد`) : r?.error || 'پاک کردن ممکن نشد');
  };
  const savePw = async () => {
    if (pw.a.length < BK.PASSWORD_MIN) return toast(`رمز دست‌کم ${num(BK.PASSWORD_MIN)} حرف باشد`);
    if (pw.a !== pw.b) return toast('دو رمز یکی نیستند');
    setBusy(true);
    try {
      const v = await BK.makeKey(pw.a); await chrome.storage.local.set({ vault: { ...v, setAt: Date.now() } }); setVault(v); setPw(null);
      const r = await send('backupNow'); // a locked copy right away
      toast(r?.ok && r.saved ? 'رمز گذاشته شد و یک پشتیبان رمزدار ساخته شد' : 'رمز گذاشته شد؛ پشتیبان‌های بعدی رمز دارند');
    }
    catch (e) { toast(e.message || 'گذاشتن رمز ممکن نشد'); }
    setBusy(false);
  };
  const dropPw = async () => { await chrome.storage.local.remove('vault'); setVault(null); toast('پشتیبان‌های بعدی بدون رمز ساخته می‌شوند'); };
  return html`<div class="card" id="backup"><div class="card-h"><h3><${Icon} n="history" cls="sm" />پشتیبان خودکار</h3>
      <span class="sub">${meta.lastAt ? `آخرین پشتیبان ${ago(meta.lastAt)}` : cfg.freq === 'off' ? 'خاموش' : 'هنوز پشتیبانی ساخته نشده'}</span></div>
    <div class="xs muted" style="margin-bottom:4px">یک فایل در پوشه دانلود، داخل <b>Dara-Backups</b>؛ حتی اگر داده‌های مرورگر پاک شود یا دارا حذف شود، این فایل می‌ماند.</div>
    ${meta.error && cfg.freq !== 'off' && html`<div class="callout warn" style="margin:8px 0"><${Icon} n="alert" cls="sm" /><div>آخرین تلاش ناموفق بود${meta.errorAt ? ` (${ago(meta.errorAt)})` : ''}: ${meta.error}</div></div>`}
    <${Row} t="هر چند وقت"><${Seg} value=${cfg.freq} onChange=${(v) => setCfg({ freq: v })} options=${[['daily', 'روزانه'], ['weekly', 'هفتگی'], ['off', 'خاموش']]} /></${Row}>
    ${cfg.freq !== 'off' && html`
      <${Row} t="فایل‌های قدیمی" d=${KEEP_NOTE[cfg.keep] || ''}><${Seg} value=${cfg.keep} onChange=${(v) => setCfg({ keep: v })} options=${[['all', 'همه بمانند'], ['smart', 'هوشمند'], ['last', '۸ تای آخر']]} /></${Row}>
      <${Row} t="رمز" d=${vault ? 'پشتیبان‌های تازه رمز دارند و بدون رمز باز نمی‌شوند. هر فایل با همان رمزی باز می‌شود که موقع ساختنش داشت.' : 'اگر پوشه دانلود با فضای ابری (گوگل‌درایو، آی‌کلاد، دراپ‌باکس) همگام است، برایش رمز بگذار.'}>
        ${vault ? html`<span class="small pos row" style="gap:4px"><${Icon} n="lock" cls="sm" />با رمز</span><button class="btn sm" onClick=${() => setPw({ a: '', b: '' })}>تغییر</button><button class="btn sm ghost" onClick=${dropPw}>برداشتن</button>`
          : html`<button class="btn sm" disabled=${vault === undefined} onClick=${() => setPw({ a: '', b: '' })}><${Icon} n="lock" cls="sm" />گذاشتن رمز</button>`}</${Row}>
      ${vault && plain.length > 0 && !pw && html`<div class="callout warn" style="margin:10px 0"><${Icon} n="alert" cls="sm" /><div class="grow">${num(plain.length)} پشتیبان قبلی بدون رمز ساخته شده و هنوز در پوشه است.
        <div style="margin-top:6px"><button class="btn sm" disabled=${busy} onClick=${purge}>پاک کردن پشتیبان‌های بدون رمز</button></div></div></div>`}
      ${pw && html`<div class="col" style="gap:10px;padding:12px 0;border-bottom:1px solid var(--line)">
        <div class="calc-in two" style="max-width:none">
          <div class="field"><label>رمز</label><input class="input" type="password" autoFocus value=${pw.a} onInput=${(e) => setPw({ ...pw, a: e.target.value })} /></div>
          <div class="field"><label>تکرار رمز</label><input class="input" type="password" value=${pw.b} onInput=${(e) => setPw({ ...pw, b: e.target.value })} onKeyDown=${(e) => e.key === 'Enter' && savePw()} /></div></div>
        <div class="callout warn"><${Icon} n="alert" cls="sm" /><div>اگر رمز را فراموش کنی، فایل‌های رمزدار به هیچ روشی باز نمی‌شوند؛ جایی امن یادداشتش کن. رمز روی همین کامپیوتر نگه داشته می‌شود تا پشتیبان خودکار ساخته شود؛ پس از این به بعد، فایلی که از این کامپیوتر بیرون برود (فضای ابری، فلش، ایمیل) بدون رمز خواندنی نیست. رمز دست‌کم ${num(BK.PASSWORD_MIN)} حرف؛ هرچه بلندتر، امن‌تر.</div></div>
        <div class="row"><button class="btn primary" disabled=${busy} onClick=${savePw}>ذخیره رمز</button><button class="btn ghost" onClick=${() => setPw(null)}>انصراف</button></div>
      </div>`}`}
    <div class="row wrap" style="margin-top:12px;gap:10px"><button class="btn" disabled=${busy} onClick=${now}><${Icon} n=${busy ? 'refresh' : 'download'} cls=${busy ? 'sm spin' : 'sm'} />همین الان پشتیبان بگیر</button>
      <span class="xs muted grow">فقط وقتی کروم باز است ساخته می‌شود و اگر از آخرین پشتیبان چیزی عوض نشده باشد، فایل تکراری نمی‌سازد. برای برگرداندن، فایل را در «ورود اطلاعات» پایین همین صفحه رها کن.</span></div>
  </div>`;
}

/* ---------------- settings ---------------- */
function Row({ t, d, children }) {
  return html`<div class="row between" style="padding:12px 0;border-bottom:1px solid var(--line);gap:16px"><div><div class="sb">${t}</div>${d && html`<div class="xs muted">${d}</div>`}</div><div class="row">${children}</div></div>`;
}

const faVer = (v) => String(v || '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** Settings → «نسخه و به‌روزرسانی»: is this the latest version? What changed? */
function UpdateCard({ s }) {
  const cur = hasChrome ? chrome.runtime.getManifest().version : '0.0.0';
  const [state, setState] = useState(null); // {kind: latest|ready|remote|error, v?, url?, msg?, at}
  const [busy, setBusy] = useState(false);
  const [adv, setAdv] = useState(false);
  const [url, setUrl] = useState(s.updateUrl || '');
  const [older, setOlder] = useState(false);
  const run = async (remote, perm) => {
    setBusy(true);
    try {
      // 1) new files already in the install folder (how updates arrive today)
      const disk = hasChrome ? await U.diskVersion() : null;
      if (disk && compareVersions(disk, cur) > 0) return setState({ kind: 'ready', v: disk, at: Date.now() });
      // 2) optional public address that announces the latest version (for a published release)
      const u = (s.updateUrl || '').trim();
      if (remote && u) {
        if (!(await perm)) throw new Error('برای بررسی از این آدرس، اجازه دسترسی لازم است');
        const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
        if (!r.ok) throw new Error(`آدرس بررسی نسخه جواب نداد (${r.status})`);
        const j = JSON.parse(await r.text());
        if (j.version && compareVersions(j.version, cur) > 0) return setState({ kind: 'remote', v: j.version, url: j.url || j.download || null, at: Date.now() });
      }
      setState({ kind: 'latest', at: Date.now() });
    } catch (e) { setState({ kind: 'error', msg: e.message, at: Date.now() }); }
    finally { setBusy(false); act.setSettings({ lastUpdateCheck: Date.now() }); }
  };
  useEffect(() => { run(false); }, []);
  const check = () => {
    const u = (s.updateUrl || '').trim();
    let perm = Promise.resolve(true);
    if (u && hasChrome && chrome.permissions) { try { perm = chrome.permissions.request({ origins: [new URL(u).origin + '/*'] }).catch(() => false); } catch { perm = Promise.resolve(false); } }
    run(true, perm);
  };
  const saveUrl = () => { const v = url.trim(); if (v && !/^https:\/\//.test(v)) return toast('آدرس باید با https:// شروع شود'); act.setSettings({ updateUrl: v }); toast(v ? 'آدرس بررسی نسخه ذخیره شد' : 'آدرس بررسی نسخه حذف شد'); };
  const notes = CHANGELOG.find((c) => c.v === cur);
  const past = CHANGELOG.filter((c) => compareVersions(c.v, cur) < 0);
  const pill = !state ? null
    : state.kind === 'latest' ? html`<span class="pill live"><${Icon} n="check" cls="sm" />آخرین نسخه را داری</span>`
    : state.kind === 'ready' || state.kind === 'remote' ? html`<span class="pill warn">نسخه ${faVer(state.v)} آماده است</span>`
    : html`<span class="pill">بررسی انجام نشد</span>`;
  return html`<div class="card" id="version"><div class="card-h"><h3><${Icon} n="sparkles" cls="sm" />نسخه و به‌روزرسانی</h3>${pill}</div>
    <div class="row between" style="gap:16px;flex-wrap:wrap">
      <div><div class="sb">نسخه نصب‌شده: <span class="num">${faVer(cur)}</span></div>
        <div class="xs muted">${s.lastUpdateCheck ? `آخرین بررسی ${ago(s.lastUpdateCheck)}. ` : ''}دارا هر دقیقه هم خودش بررسی می‌کند؛ نسخه جدید با تازه‌سازی صفحه نصب می‌شود و داده‌ها دست نمی‌خورد.</div></div>
      <div class="row" style="gap:8px">
        ${state?.kind === 'ready' && html`<button class="btn primary" onClick=${() => U.applyUpdate(location.href)}><${Icon} n="download" cls="sm" />نصب نسخه ${faVer(state.v)}</button>`}
        ${state?.kind === 'remote' && state.url && html`<a class="btn primary" href=${state.url} target="_blank" rel="noopener"><${Icon} n="download" cls="sm" />دریافت نسخه ${faVer(state.v)}</a>`}
        <button class="btn" onClick=${check} disabled=${busy}><${Icon} n="refresh" cls=${'sm' + (busy ? ' spin' : '')} />${busy ? 'در حال بررسی…' : 'بررسی نسخه جدید'}</button>
      </div>
    </div>
    ${state?.kind === 'ready' && html`<div class="callout" style="margin-top:10px"><${Icon} n="info" cls="sm" /><div>فایل‌های نسخه ${faVer(state.v)} در پوشه دارا هست. «نصب» را بزن یا صفحه را تازه کن.</div></div>`}
    ${state?.kind === 'remote' && html`<div class="callout" style="margin-top:10px"><${Icon} n="info" cls="sm" /><div>نسخه ${faVer(state.v)} منتشر شده. فایلش را بگیر و روی همان پوشه‌ای بریز که دارا از آن نصب شده؛ بعد صفحه را تازه کن.</div></div>`}
    ${state?.kind === 'error' && html`<div class="callout err" style="margin-top:10px"><${Icon} n="circleX" cls="sm" /><div>${state.msg}</div></div>`}
    ${notes && html`<hr class="sep" /><div class="sb small" style="margin-bottom:6px">تازه‌های نسخه ${faVer(cur)}</div>
      <ul class="changelog">${notes.items.map((t) => html`<li>${t}</li>`)}</ul>`}
    ${past.length > 0 && html`<button class="btn sm ghost" style="margin-top:6px" onClick=${() => setOlder(!older)}><${Icon} n="chevronDown" cls="sm" />${older ? 'بستن نسخه‌های قبلی' : 'نسخه‌های قبلی'}</button>
      ${older && past.map((c) => html`<div class="xs sb" style="margin-top:8px">نسخه ${faVer(c.v)}</div><ul class="changelog xs">${c.items.map((t) => html`<li>${t}</li>`)}</ul>`)}`}
    <div style="margin-top:8px"><button class="btn sm ghost" onClick=${() => setAdv(!adv)}><${Icon} n="settings" cls="sm" />پیشرفته</button></div>
    ${adv && html`<div class="col" style="gap:6px;margin-top:6px">
      <div class="xs muted">اگر دارا را از جایی منتشر می‌کنی، آدرس یک فایل JSON بده که آخرین نسخه را اعلام کند، مثلاً <span class="ltr latin">{"version":"1.4.0","url":"https://…/dara.zip"}</span>. بدون این آدرس، بررسی فقط روی پوشه نصب انجام می‌شود.</div>
      <div class="row" style="gap:6px"><input class="input ltr latin" placeholder="https://example.com/dara/latest.json" value=${url} onInput=${(e) => setUrl(e.target.value)} /><button class="btn sm" onClick=${saveUrl}>ذخیره</button></div>
    </div>`}
  </div>`;
}

export function SettingsPage({ st, pf, s }) {
  const set = (p) => act.setSettings(p);
  const backup = async () => { const b = await store.exportBackup(); download(`dara-backup-${todayIso()}.json`, JSON.stringify(b, null, 1)); };
  const csv = () => download(`dara-assets-${todayIso()}.csv`, toCSV(pf.rows), 'text/csv;charset=utf-8');
  const wipe = async () => {
    if (!confirm('همه دارایی‌ها، تاریخچه و تنظیمات پاک شود؟ قبلش از «پشتیبان‌گیری» استفاده کن. (فایل‌های پشتیبانی که در پوشه دانلود هستند دست نمی‌خورند.)')) return;
    await store.clearAll(); toast('همه داده‌ها پاک شد'); location.hash = '#/welcome'; location.reload();
  };
  const ver = hasChrome ? chrome.runtime.getManifest().version : 'dev';
  return html`<div class="page" style="max-width:900px">
    <div class="card"><div class="card-h"><h3><${Icon} n="eye" cls="sm" />نمایش</h3></div>
      <${Row} t="واحد نمایش مبالغ" d="همه مبالغ داخلی به ریال ذخیره می‌شوند"><${Seg} value=${s.currency} onChange=${(v) => set({ currency: v })} options=${[['toman', 'تومان'], ['rial', 'ریال']]} /></${Row}>
      <${Row} t="ارقام"><${Seg} value=${s.digits} onChange=${(v) => set({ digits: v })} options=${[['fa', '۱۲۳ فارسی'], ['en', '123 لاتین']]} /></${Row}>
      <${Row} t="اعداد بزرگ خلاصه" d="مثلاً ۶٫۲۶ میلیارد به‌جای عدد کامل در سربرگ‌ها"><${Toggle} title="اعداد بزرگ خلاصه" on=${s.compact} onChange=${(v) => set({ compact: v })} /></${Row}>
      <${Row} t="تم"><${Seg} value=${s.theme} onChange=${(v) => set({ theme: v })} options=${[['auto', 'خودکار'], ['light', 'روشن'], ['dark', 'تیره']]} /></${Row}>
      <${Row} t="حالت حریم خصوصی" d="مبالغ تار می‌شوند (با نگه‌داشتن ماوس نمایش داده می‌شوند)؛ مناسب اشتراک صفحه"><${Toggle} title="حالت حریم خصوصی" on=${s.privacy} onChange=${(v) => set({ privacy: v })} /></${Row}>
      <${Row} t="نشان روی آیکون افزونه"><${Seg} value=${s.badge} onChange=${(v) => set({ badge: v })} options=${[['change', 'تغییر امروز ٪'], ['gold', 'گرم طلا (میلیون تومان)'], ['usd', 'دلار (هزار تومان)'], ['none', 'هیچ']]} /></${Row}>
    </div>

    <${AIConnections} st=${st} />

    <div class="card"><div class="card-h"><h3><${Icon} n="refresh" cls="sm" />به‌روزرسانی خودکار</h3></div>
      <${Row} t="فاصله دریافت قیمت‌ها"><${Seg} value=${s.refreshMinutes} onChange=${(v) => set({ refreshMinutes: v })} options=${[[15, '۱۵ دقیقه'], [30, '۳۰ دقیقه'], [60, '۱ ساعت'], [180, '۳ ساعت']]} /></${Row}>
      ${Object.entries(PROVIDERS).map(([k, p]) => html`<${Row} t=${p.title}><${Toggle} title=${p.title} on=${s.providers[k] !== false} onChange=${(v) => set({ providers: { ...s.providers, [k]: v } })} /></${Row}>`)}
      <${Row} t="یادآوری قیمت‌های دستی" d="بعد از این مدت، دارایی «نیاز به به‌روزرسانی» می‌شود"><${Seg} value=${s.remindDays.price} onChange=${(v) => set({ remindDays: { ...s.remindDays, price: v } })} options=${[[3, '۳ روز'], [7, '۱ هفته'], [30, '۱ ماه']]} /></${Row}>
      <${Row} t="یادآوری مانده حساب‌ها"><${Seg} value=${s.remindDays.balance} onChange=${(v) => set({ remindDays: { ...s.remindDays, balance: v } })} options=${[[7, '۱ هفته'], [30, '۱ ماه'], [90, '۳ ماه']]} /></${Row}>
    </div>

    <div class="card"><div class="card-h"><h3><${Icon} n="bell" cls="sm" />اعلان‌ها</h3></div>
      ${[['interest', 'واریز سود ماهانه'], ['flows', 'اعمال جریان‌های تکراری'], ['alerts', 'هشدارهای قیمت و حباب'], ['stale', 'یادآوری دارایی‌هایی که مدتی به‌روز نشده‌اند']].map(([k, t]) => html`<${Row} t=${t}><${Toggle} title=${t} on=${s.notify[k]} onChange=${(v) => set({ notify: { ...s.notify, [k]: v } })} /></${Row}>`)}
    </div>

    <${BackupCard} st=${st} s=${s} />

    <div class="card"><div class="card-h"><h3><${Icon} n="download" cls="sm" />داده‌ها</h3><span class="sub">${num(st.assets.length)} دارایی، ${num(Object.keys(st.snapshots).length)} روز تاریخچه</span></div>
      <div class="row wrap" style="margin-bottom:14px"><button class="btn" onClick=${backup}><${Icon} n="download" cls="sm" />پشتیبان‌گیری کامل (JSON)</button><button class="btn" onClick=${csv}><${Icon} n="file" cls="sm" />خروجی اکسل (CSV)</button></div>
      <div class="row between" style="padding:4px 0 14px;gap:16px"><div><div class="sb">بازسازی تاریخچه ۱ سال گذشته</div>
        <div class="xs muted">${st.meta.backfill?.state === 'done' ? `آخرین بار ${num(st.meta.backfill.added)} روز ساخته شد. ` : ''}${st.meta.backfill?.state === 'error' ? html`<span class="neg">${st.meta.backfill.error}. </span>` : ''}از قیمت‌های گذشته tgju و TSETMC و تراکنش‌های ثبت‌شده؛ مانده‌ها و قیمت‌های دستی ثابت فرض می‌شوند (خط‌چین در نمودار).</div></div>
        <${BackfillButton} st=${st} label="بازسازی" /></div>
      <div class="sb small" style="margin-bottom:8px">ورود اطلاعات</div>
      <${ImportPanel} st=${st} s=${s} />
      <hr class="sep" />
      <div class="row between"><div><div class="sb neg">پاک‌کردن همه داده‌ها</div><div class="xs muted">غیرقابل برگشت</div></div><button class="btn danger" onClick=${wipe}><${Icon} n="trash" cls="sm" />پاک‌کردن</button></div>
    </div>

    <${UpdateCard} s=${s} />

    <div class="card"><div class="card-h"><h3><${Icon} n="lock" cls="sm" />حریم خصوصی و درباره</h3><span class="sub num">نسخه ${ver}</span></div>
      <div class="small ink2" style="line-height:2">همه اطلاعات دارایی‌ها فقط در حافظه همین مرورگر (chrome.storage) ذخیره می‌شود و به هیچ سروری ارسال نمی‌شود. دارا فقط قیمت‌های عمومی را از tgju، TSETMC، فیپیران و نوبیتکس می‌خواند. برای انتقال به دستگاه دیگر از پشتیبان JSON استفاده کن.</div>
    </div>
  </div>`;
}
