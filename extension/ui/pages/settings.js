import { html, useState, useEffect, Icon, Seg, Toggle, Money, toast, send, num, fmtJ, Ava, hasChrome, refLabel, BackfillButton } from '../components.js';
import * as store from '../../lib/store.js';
import * as E from '../../lib/engine.js';
import { importCSVText, toCSV } from '../../lib/importer.js';
import { PROVIDERS, CAT } from '../../lib/catalog.js';
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
const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file, 'utf-8'); });

/* ---------------- import panel (shared by welcome & settings) ---------------- */
function ImportPanel({ s, onDone, compact }) {
  const [unit, setUnit] = useState('rial');
  const [res, setRes] = useState(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const parse = (text) => {
    try {
      if (text.trim().startsWith('{')) {
        const obj = JSON.parse(text);
        setRes({ backup: obj, assets: obj.data?.assets || [], notes: [] });
      } else setRes(importCSVText(text, { unit }));
    } catch (e) { toast(e.message); }
  };
  const onFile = async (e) => { const f = e.target.files?.[0]; if (!f) return; parse(await readFile(f)); e.target.value = ''; };
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
      if (text.trim().startsWith('<')) throw new Error('شیت خصوصی است؛ در همین مرورگر وارد حساب گوگل شو یا فایل CSV را دانلود و اینجا بارگذاری کن');
      parse(text);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const commit = async (mode) => {
    if (res.backup) { await store.importBackup(res.backup, { merge: mode === 'merge' }); }
    else if (mode === 'replace') await store.save({ assets: res.assets });
    else await store.update('assets', (l) => l.concat(res.assets));
    await act.setSettings({ onboarded: true });
    send('refresh');
    toast(`${num(res.assets.length)} دارایی وارد شد؛ قیمت‌های آنلاین در حال دریافت است…`);
    setRes(null); onDone && onDone();
  };
  const pf = res ? E.portfolio(res.assets, {}, s) : null;
  return html`<div class="col" style="gap:12px">
    ${!res && html`
      <div class="row wrap">
        <label class="btn primary"><${Icon} n="upload" />انتخاب فایل CSV یا پشتیبان JSON<input type="file" accept=".csv,.json,text/csv,application/json" hidden onChange=${onFile} /></label>
        <span class="small muted">واحد مبالغ فایل CSV:</span><${Seg} value=${unit} onChange=${setUnit} options=${[['rial', 'ریال'], ['toman', 'تومان']]} />
      </div>
      ${!compact && html`<div class="row"><input class="input" placeholder="یا لینک گوگل‌شیت را اینجا بگذار…" value=${link} onInput=${(e) => setLink(e.target.value)} />
        <button class="btn" disabled=${busy || !link} onClick=${fromLink}><${Icon} n=${busy ? 'refresh' : 'link'} cls=${busy ? 'sm spin' : 'sm'} />دریافت</button></div>`}
      <div class="xs muted">ستون‌هایی مثل «دسته دارایی»، «نام دارایی»، «محل نگهداری»، «مقدار»، «قیمت هر واحد» و «ارزش روز» خودکار شناسایی می‌شوند؛ طلا، سکه، دلار، یورو، رمزارز و صندوق‌های طلا به منبع قیمت آنلاین وصل می‌شوند.</div>`}
    ${res && html`<div class="col" style="gap:10px">
      <div class="callout"><${Icon} n="check" cls="sm" /><div><b>${num(res.assets.length)} دارایی</b> شناسایی شد، ارزش کل <b><${Money} v=${pf.net} s=${s} /></b>${res.backup ? ' (فایل پشتیبان دارا)' : ''}</div></div>
      ${res.notes.map((n) => html`<div class="xs muted">• ${n}</div>`)}
      <div class="picker"><div class="scroll" style="max-height:300px">${pf.rows.map((r) => html`<div class="opt"><${Ava} cat=${r.asset.category} size=${26} />
        <span class="grow"><span class="sb">${r.asset.name}</span> <span class="xs muted">${r.asset.custodian !== r.asset.name ? r.asset.custodian || '' : ''}</span>
          <div class="xs muted">${r.cat.short}، ${r.asset.mode === 'units' ? (r.asset.price?.source === 'market' ? 'قیمت آنلاین: ' + refLabel(r.asset.price.ref) : 'قیمت دستی') : r.asset.mode === 'rate' ? 'نرخ ثابت' : 'مانده'}${r.asset.review ? '، ⚠ ' + r.asset.review : ''}</div></span>
        <span class="small num"><${Money} v=${r.signedValue} s=${s} compact /></span></div>`)}</div></div>
      <div class="row"><button class="btn primary" onClick=${() => commit('replace')}>جایگزینی دارایی‌های فعلی</button><button class="btn" onClick=${() => commit('merge')}>افزودن به دارایی‌های فعلی</button><span class="grow"></span><button class="btn ghost" onClick=${() => setRes(null)}>انصراف</button></div>
    </div>`}
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
    { id: uid('a'), code: 'A-005', name: 'سپرده کوتاه‌مدت', custodian: 'بانک نمونه', category: 'fixed', mode: 'rate', rate: { principal: 3_000_000_000, annualPct: 23, start: addDaysIso(t, -40), mode: 'payout', payoutTo: bank.id }, liquidity: 'high', createdAt: now, updatedAt: now },
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
      <button class="card mode" style="padding:18px" onClick=${() => setStep('import')}><span class="ava" style="background:var(--accent-soft);color:var(--accent)"><${Icon} n="file" /></span><span class="mt" style="font-size:15px;margin-top:8px">ورود از گوگل‌شیت یا اکسل</span><span class="md">فایل CSV، لینک گوگل‌شیت یا پشتیبان دارا</span></button>
      <button class="card mode" style="padding:18px" onClick=${() => { act.setSettings({ onboarded: true }); open(null); }}><span class="ava" style="background:var(--pos-bg);color:var(--pos)"><${Icon} n="plus" /></span><span class="mt" style="font-size:15px;margin-top:8px">شروع از صفر</span><span class="md">اولین دارایی را دستی اضافه کن</span></button>
      <button class="card mode" style="padding:18px" onClick=${async () => { await store.save({ assets: sampleData() }); await act.setSettings({ onboarded: true }); send('refresh'); toast('داده نمونه بارگذاری شد'); location.hash = '#/overview'; }}><span class="ava" style="background:var(--warn-bg);color:var(--warn)"><${Icon} n="sparkles" /></span><span class="mt" style="font-size:15px;margin-top:8px">دیدن با داده نمونه</span><span class="md">برای آشنایی؛ بعداً از تنظیمات پاک کن</span></button>
    </div>
    ${step === 'import' && html`<div class="card"><div class="card-h"><h3>ورود اطلاعات</h3></div><${ImportPanel} s=${s} onDone=${() => (location.hash = '#/overview')} /></div>`}
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
    if (!confirm('همه دارایی‌ها، تاریخچه و تنظیمات پاک شود؟ قبلش از «پشتیبان‌گیری» استفاده کن.')) return;
    await store.clearAll(); toast('همه داده‌ها پاک شد'); location.hash = '#/welcome'; location.reload();
  };
  const ver = hasChrome ? chrome.runtime.getManifest().version : 'dev';
  return html`<div class="page" style="max-width:900px">
    <${UpdateCard} s=${s} />
    <div class="card"><div class="card-h"><h3><${Icon} n="eye" cls="sm" />نمایش</h3></div>
      <${Row} t="واحد نمایش مبالغ" d="همه مبالغ داخلی به ریال ذخیره می‌شوند"><${Seg} value=${s.currency} onChange=${(v) => set({ currency: v })} options=${[['toman', 'تومان'], ['rial', 'ریال']]} /></${Row}>
      <${Row} t="ارقام"><${Seg} value=${s.digits} onChange=${(v) => set({ digits: v })} options=${[['fa', '۱۲۳ فارسی'], ['en', '123 لاتین']]} /></${Row}>
      <${Row} t="اعداد بزرگ خلاصه" d="مثلاً ۶٫۲۶ میلیارد به‌جای عدد کامل در سربرگ‌ها"><${Toggle} on=${s.compact} onChange=${(v) => set({ compact: v })} /></${Row}>
      <${Row} t="تم"><${Seg} value=${s.theme} onChange=${(v) => set({ theme: v })} options=${[['auto', 'خودکار'], ['light', 'روشن'], ['dark', 'تیره']]} /></${Row}>
      <${Row} t="حالت حریم خصوصی" d="مبالغ تار می‌شوند (با نگه‌داشتن ماوس نمایش داده می‌شوند)؛ مناسب اشتراک صفحه"><${Toggle} on=${s.privacy} onChange=${(v) => set({ privacy: v })} /></${Row}>
      <${Row} t="نشان روی آیکون افزونه"><${Seg} value=${s.badge} onChange=${(v) => set({ badge: v })} options=${[['change', 'تغییر امروز ٪'], ['gold', 'طلا (م.ت)'], ['usd', 'دلار (ه.ت)'], ['none', 'هیچ']]} /></${Row}>
    </div>

    <${AIConnections} st=${st} />

    <div class="card"><div class="card-h"><h3><${Icon} n="refresh" cls="sm" />به‌روزرسانی خودکار</h3></div>
      <${Row} t="فاصله دریافت قیمت‌ها"><${Seg} value=${s.refreshMinutes} onChange=${(v) => set({ refreshMinutes: v })} options=${[[15, '۱۵ دقیقه'], [30, '۳۰ دقیقه'], [60, '۱ ساعت'], [180, '۳ ساعت']]} /></${Row}>
      ${Object.entries(PROVIDERS).map(([k, p]) => html`<${Row} t=${p.title}><${Toggle} on=${s.providers[k] !== false} onChange=${(v) => set({ providers: { ...s.providers, [k]: v } })} /></${Row}>`)}
      <${Row} t="یادآوری قیمت‌های دستی" d="بعد از این مدت، دارایی «نیاز به به‌روزرسانی» می‌شود"><${Seg} value=${s.remindDays.price} onChange=${(v) => set({ remindDays: { ...s.remindDays, price: v } })} options=${[[3, '۳ روز'], [7, '۱ هفته'], [30, '۱ ماه']]} /></${Row}>
      <${Row} t="یادآوری مانده حساب‌ها"><${Seg} value=${s.remindDays.balance} onChange=${(v) => set({ remindDays: { ...s.remindDays, balance: v } })} options=${[[7, '۱ هفته'], [30, '۱ ماه'], [90, '۳ ماه']]} /></${Row}>
    </div>

    <div class="card"><div class="card-h"><h3><${Icon} n="bell" cls="sm" />اعلان‌ها</h3></div>
      ${[['interest', 'واریز سود درآمد ثابت'], ['flows', 'اعمال جریان‌های تکراری'], ['alerts', 'هشدارهای قیمت'], ['stale', 'یادآوری دارایی‌های قدیمی (هر ۳ روز)']].map(([k, t]) => html`<${Row} t=${t}><${Toggle} on=${s.notify[k]} onChange=${(v) => set({ notify: { ...s.notify, [k]: v } })} /></${Row}>`)}
    </div>

    <div class="card"><div class="card-h"><h3><${Icon} n="download" cls="sm" />داده‌ها</h3><span class="sub">${num(st.assets.length)} دارایی، ${num(Object.keys(st.snapshots).length)} روز تاریخچه</span></div>
      <div class="row wrap" style="margin-bottom:14px"><button class="btn" onClick=${backup}><${Icon} n="download" cls="sm" />پشتیبان‌گیری کامل (JSON)</button><button class="btn" onClick=${csv}><${Icon} n="file" cls="sm" />خروجی اکسل (CSV)</button></div>
      <div class="row between" style="padding:4px 0 14px;gap:16px"><div><div class="sb">بازسازی تاریخچه ۱ سال گذشته</div>
        <div class="xs muted">${st.meta.backfill?.state === 'done' ? `آخرین بار ${num(st.meta.backfill.added)} روز ساخته شد. ` : ''}${st.meta.backfill?.state === 'error' ? html`<span class="neg">${st.meta.backfill.error}. </span>` : ''}از قیمت‌های گذشته tgju و TSETMC و تراکنش‌های ثبت‌شده؛ مانده‌ها و قیمت‌های دستی ثابت فرض می‌شوند (خط‌چین در نمودار).</div></div>
        <${BackfillButton} st=${st} label="بازسازی" /></div>
      <div class="sb small" style="margin-bottom:8px">ورود اطلاعات</div>
      <${ImportPanel} s=${s} />
      <hr class="sep" />
      <div class="row between"><div><div class="sb neg">پاک‌کردن همه داده‌ها</div><div class="xs muted">غیرقابل برگشت</div></div><button class="btn danger" onClick=${wipe}><${Icon} n="trash" cls="sm" />پاک‌کردن</button></div>
    </div>

    <div class="card"><div class="card-h"><h3><${Icon} n="lock" cls="sm" />حریم خصوصی و درباره</h3><span class="sub num">نسخه ${ver}</span></div>
      <div class="small ink2" style="line-height:2">همه اطلاعات دارایی‌ها فقط در حافظه همین مرورگر (chrome.storage) ذخیره می‌شود و به هیچ سروری ارسال نمی‌شود. دارا فقط قیمت‌های عمومی را از tgju، TSETMC، فیپیران و نوبیتکس می‌خواند. برای انتقال به دستگاه دیگر از پشتیبان JSON استفاده کن.</div>
    </div>
  </div>`;
}
