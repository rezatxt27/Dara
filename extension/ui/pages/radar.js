// «رادار فرصت‌ها»: what in the stock market and among funds is worth a look today — each card says why it showed up and
// what to check before deciding. Not advice: fixed rules, plain numbers, the other side always shown. Logic: lib/radar.js.
import { html, useState, useEffect, useMemo, Icon, Seg, Modal, NumField, AskBtn, toast, send, num, fmtJ, money, useRadar } from '../components.js';
import * as RD from '../../lib/radar.js';
import * as I from '../../lib/insights.js';
import { act } from '../actions.js';

const ORDER = ['negBubble', 'goldBubble', 'fixedBeat', 'momentum12', 'momentum3', 'volume', 'cheap', 'nearLow', 'topFund'];
const SIG_D = {
  momentum12: 'پرمعامله‌هایی که در ۱۲ ماه گذشته جزو ۱۰٪ پربازده بازار بوده‌اند.',
  momentum3: 'پرمعامله‌هایی که در ۳ ماه گذشته جزو ۱۰٪ پربازده بازار بوده‌اند.',
  volume: 'امروز دست‌کم ۳ برابر معمول معامله شده‌اند؛ دلیلش را در خبرها و اطلاعیه‌های شرکت ببین.',
  cheap: 'P/E آن‌ها کمتر از ۶۰٪ میانهٔ هم‌گروه‌های سودده است.',
  nearLow: 'تا ۱۰٪ بالای کمترین قیمت سال، ولی هنوز سودده.',
  negBubble: 'قیمت بازار کمتر از ارزش دارایی‌های صندوق (NAV ابطال).',
  goldBubble: 'صندوق‌های طلای پرمعامله با کمترین حباب (قیمت در برابر NAV همان روز).',
  fixedBeat: 'صندوق‌های درآمد ثابت با سابقهٔ یک‌ساله که از سپرده بیشتر داده‌اند.',
  topFund: 'بیشترین بازدهی ۱۲ ماه در هر نوع صندوق (با سابقهٔ دست‌کم یک سال).',
};
const PRESETS = [
  { name: 'صندوق طلا با حباب زیر ۱٪', kind: 'fund', ftype: 5, conds: [{ f: 'bubble', op: '<=', v: 1 }] },
  { name: 'سهم با P/E زیر ۵', kind: 'stock', conds: [{ f: 'pe', op: '<=', v: 5 }, { f: 'pe', op: '>=', v: 0.1 }] },
  { name: 'درآمد ثابت بالای ۳۰٪', kind: 'fund', ftype: 4, conds: [{ f: 'y1', op: '>=', v: 30 }] },
  { name: '۳۰٪ زیر سقف سال', kind: 'stock', conds: [{ f: 'fromHigh', op: '<=', v: -30 }, { f: 'pe', op: '>=', v: 0.1 }] },
];
const pctTxt = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x * 100), d)}٪`);

export function RadarPage({ st, s, openPrice, route }) {
  const radar = useRadar();
  const user = st.radarUser;
  const [tab, setTab] = useState(route?.q?.tab || 'today');
  const [only, setOnly] = useState('all');
  const [run, setRun] = useState(null); // { pending, total } while gathering
  const [editRule, setEditRule] = useState(null);
  const fmt = (v) => money(v, s, { compact: true });
  const day = radar?.day || null;

  // while this page is open, keep gathering the year's prices (busiest stocks first) instead of waiting for the alarm
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 40 && alive; i++) {
        if (document.visibilityState !== 'visible') { await new Promise((r) => setTimeout(r, 3000)); continue; }
        const r = await send('radar', { batch: 40 });
        if (!alive) return;
        setRun(r?.ok ? r : { error: r?.error });
        if (!r?.ok || !r.pending || r.off) break;
      }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (day && user.seenDay !== day) act.setRadarUser({ seenDay: day }); }, [day]);

  const depositPct = I.defaultDepositPct(st);
  const built = useMemo(() => (radar?.day ? RD.buildCards(radar, { depositPct, money: fmt }) : null), [radar, s.currency, depositPct]);
  const before = new Set(radar?.results?.day === day ? radar.results.before || [] : []);
  const isNew = (c) => before.size > 0 && !before.has(RD.cardKey(c));
  const marked = new Set(user.marks.map((m) => m.id));
  const mark = (c) => act.toggleRadarMark(c, RD.priceOf(radar, c.id), day).then(() => toast(marked.has(c.id) ? 'از پیگیری برداشته شد' : 'به پیگیری اضافه شد'));
  const pending = run?.pending ?? (radar ? Object.values(radar.stocks || {}).filter((r) => r.need > 0).length : 0);
  const total = run?.total ?? Object.keys(radar?.stocks || {}).length;
  const year = run?.year ?? (radar ? Object.values(radar.stocks || {}).filter((r) => r.need >= 60).length : 0);
  const force = async () => { setRun({ busy: true }); const r = await send('radar', { force: true, batch: 40 }); setRun(r?.ok ? r : { error: r?.error }); if (!r?.ok) toast(r?.error || 'بررسی انجام نشد'); };

  const head = html`<div class="card rd-top">
    <div class="row between wrap" style="gap:10px">
      <div><div class="row" style="gap:8px"><h3 style="margin:0"><${Icon} n="radar" cls="sm" />رادار فرصت‌ها</h3>${day && html`<span class="sub">جلسهٔ ${fmtJ(day)}</span>`}</div>
        <div class="xs muted" style="margin-top:4px">هر روز بعد از بسته شدن بازار، کل بورس و فرابورس و همهٔ صندوق‌ها با قاعده‌های ثابت گشته می‌شوند.</div></div>
      <div class="row" style="gap:6px">
        <${Seg} value=${tab} onChange=${setTab} options=${[['today', 'امروز'], ['rules', `قاعده‌های من${user.rules.length ? ` (${num(user.rules.length)})` : ''}`], ['marks', `پیگیری${user.marks.length ? ` (${num(user.marks.length)})` : ''}`]]} />
        <button class="btn icon ghost" title="بررسی دوباره" aria-label="بررسی دوباره" disabled=${run?.busy} onClick=${force}><${Icon} n="refresh" cls=${run?.busy ? 'sm spin' : 'sm'} /></button>
      </div>
    </div>
    ${pending > 0 && total > 0 && html`<div class="rd-prog"><div class="row between xs"><span>${year > 0 ? 'در حال جمع کردن قیمت‌های یک سال' : 'در حال گرفتن قیمت‌های پایانی جلسه'}: ${num(total - pending)} از ${num(total)} نماد</span><span class="muted">${run && !run.error ? 'تا این صفحه باز است ادامه دارد' : 'در پس‌زمینه ادامه دارد'}</span></div>
      <div class="progress"><i style=${`width:${Math.round(((total - pending) / total) * 100)}%;background:var(--accent)`}></i></div>
      <div class="xs muted">تا کامل شود، کارت‌های سهام فقط برای نمادهای آماده ساخته می‌شوند.</div></div>`}
    ${radar?.waitFor && day && radar.waitFor > day && html`<div class="xs muted" style="margin-top:8px">قیمت‌های پایانی جلسهٔ ${fmtJ(radar.waitFor)} هنوز کامل منتشر نشده (معمولاً بعد از ساعت ۱۳:۳۰ و گاهی دیرتر)؛ تا آن موقع کارت‌ها از جلسهٔ ${fmtJ(day)} هستند و خودکار به‌روز می‌شوند.</div>`}
    ${(run?.error || radar?.error) && html`<div class="callout warn" style="margin-top:10px"><${Icon} n="info" cls="sm" /><div>${run?.error || radar.error}</div></div>`}
    <div class="xs muted rd-note">این‌ها پیشنهاد خرید یا فروش نیستند؛ فهرست چیزهایی است که با قاعده‌های بالا ارزش بررسی دارند. بازدهی گذشته تضمینی برای آینده نیست.</div>
  </div>`;

  if (radar === null) return html`<div class="page">${head}</div>`;
  if (!day) return html`<div class="page">${head}<div class="card"><div class="empty small" style="padding:24px">
    ${run?.off ? 'رادار در تنظیمات خاموش است.' : run && !run.error ? 'در حال اولین بررسی بازار…' : 'هنوز بررسی‌ای انجام نشده. اولین بررسی بعد از بسته شدن بازار، یا همین حالا:'}
    <div style="margin-top:12px"><button class="btn primary" disabled=${run?.busy} onClick=${force}><${Icon} n="radar" cls="sm" />بررسی بازار</button></div></div></div></div>`;

  return html`<div class="page">${head}
    ${tab === 'today' && html`<div class="row wrap" style="gap:6px">${[['all', 'همه'], ['stock', 'سهام'], ['fund', 'صندوق‌ها']].map(([k, t]) => html`<button class=${'chip' + (only === k ? ' on' : '')} onClick=${() => setOnly(k)}>${t}</button>`)}</div>
      ${ORDER.map((sig) => {
        const list = built.cards.filter((c) => c.sig === sig && (only === 'all' || c.kind === only));
        if (!list.length) return null;
        return html`<section class="rd-sec"><div class="rd-sec-h"><h4>${RD.SIGNALS[sig].t}</h4><span class="xs muted">${SIG_D[sig]}</span></div>
          <div class="rd-grid">${list.map((c) => html`<${Card} c=${c} isNew=${isNew(c)} marked=${marked.has(c.id)} onMark=${() => mark(c)} openPrice=${openPrice} />`)}</div></section>`;
      })}
      ${!built.cards.filter((c) => only === 'all' || c.kind === only).length && html`<div class="card"><div class="empty small">امروز چیزی از این قاعده‌ها رد نشد.</div></div>`}`}
    ${tab === 'rules' && html`<${Rules} radar=${radar} user=${user} openPrice=${openPrice} onEdit=${setEditRule} />`}
    ${tab === 'marks' && html`<${Marks} radar=${radar} user=${user} s=${s} openPrice=${openPrice} />`}
    ${editRule && html`<${RuleModal} rule=${editRule} sectors=${radar.sectors || {}} onClose=${() => setEditRule(null)} />`}
  </div>`;
}

function Card({ c, isNew, marked, onMark, openPrice }) {
  const q = c.kind === 'stock' ? `نماد «${c.sym}» (${c.name}) امروز در رادار دارا آمده. با عددهای همین امروزش توضیح بده چرا، و چه چیزهایی را باید پیش از تصمیم بررسی کنم. توصیهٔ خرید یا فروش نکن.`
    : `صندوق «${c.name}» امروز در رادار دارا آمده. با عددهای همین امروزش توضیح بده چرا، و چه چیزهایی را باید پیش از تصمیم بررسی کنم. توصیهٔ خرید یا فروش نکن.`;
  return html`<article class="card rd-card">
    <div class="row between" style="gap:8px;align-items:flex-start">
      <button class="rd-name" onClick=${() => openPrice(c.ref)} title="نمودار و کارنامه">
        <span class="row" style="gap:6px"><b>${c.sym || c.name}</b>${isNew && html`<span class="pill live">تازه</span>`}</span>
        <span class="xs muted ellipsis">${c.sym ? c.name + '، ' : ''}${c.sub}</span></button>
      <button class=${'btn icon sm ghost' + (marked ? ' on' : '')} title=${marked ? 'برداشتن از پیگیری' : 'افزودن به پیگیری'} aria-label=${marked ? 'برداشتن از پیگیری' : 'افزودن به پیگیری'} aria-pressed=${marked ? 'true' : 'false'} onClick=${onMark}><${Icon} n=${marked ? 'circleCheck' : 'plus'} cls="sm" /></button>
    </div>
    <div class="rd-why"><span class="xs sb">چرا دیده شد</span>${c.why.map((t) => html`<div class="small">${t}</div>`)}</div>
    <div class="rd-check"><span class="xs sb">پیش از تصمیم ببین</span>${c.check.map((t) => html`<div class="xs">${t}</div>`)}</div>
    <div class="row" style="gap:6px;margin-top:auto"><button class="btn sm ghost" onClick=${() => openPrice(c.ref)}><${Icon} n="chart" cls="sm" />نمودار و کارنامه</button><span class="grow"></span><${AskBtn} q=${q} label="از دستیار بپرس" /></div>
  </article>`;
}

function Rules({ radar, user, openPrice, onEdit }) {
  const [open, setOpen] = useState(null);
  const hits = useMemo(() => Object.fromEntries(user.rules.map((r) => [r.id, RD.runRule(radar, r)])), [radar, user.rules]);
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="filter" cls="sm" />قاعده‌های من</h3><button class="btn sm primary" onClick=${() => onEdit({ kind: 'stock', name: '', conds: [{ f: 'pe', op: '<=', v: 6 }], notify: true })}><${Icon} n="plus" cls="sm" />قاعدهٔ تازه</button></div>
    <div class="xs muted" style="margin-bottom:10px">فیلترهای خودت. هر روز بعد از بازار اجرا می‌شوند و اگر بخواهی، نماد تازه‌ای که از فیلتر رد شود خبرت می‌کنند. فقط نمادهای پرمعامله حساب می‌شوند.</div>
    ${!user.rules.length && html`<div class="col" style="gap:8px"><span class="small">شروع سریع:</span><div class="row wrap" style="gap:6px">${PRESETS.map((p) => html`<button class="chip" onClick=${() => onEdit({ ...p, notify: true })}>${p.name}</button>`)}</div></div>`}
    <div class="list">${user.rules.map((r) => {
      const h = hits[r.id] || [];
      return html`<div class="it" style="flex-direction:column;align-items:stretch;gap:6px">
        <div class="row" style="gap:8px">
          <button class="rd-name grow" onClick=${() => setOpen(open === r.id ? null : r.id)} aria-expanded=${open === r.id ? 'true' : 'false'}><b>${r.name}</b><span class="xs muted">${ruleText(r)}</span></button>
          <span class="pill">${num(h.length)} ${r.kind === 'fund' ? 'صندوق' : 'نماد'}</span>
          <button class="btn icon sm ghost" title=${r.notify ? 'خبرم نکن' : 'خبرم کن'} aria-label=${r.notify ? 'خاموش کردن اعلان' : 'روشن کردن اعلان'} aria-pressed=${r.notify ? 'true' : 'false'} onClick=${() => act.saveRadarRule({ ...r, notify: !r.notify })}><${Icon} n="bell" cls=${r.notify ? 'sm' : 'sm faint'} /></button>
          <button class="btn icon sm ghost" title="ویرایش" aria-label=${'ویرایش ' + r.name} onClick=${() => onEdit(r)}><${Icon} n="edit" cls="sm" /></button>
          <button class="btn icon sm ghost danger" title="حذف" aria-label=${'حذف ' + r.name} onClick=${() => act.deleteRadarRule(r.id)}><${Icon} n="trash" cls="sm" /></button>
        </div>
        ${open === r.id && html`<div class="rd-hits">${h.length ? h.slice(0, 30).map((x) => html`<button class="rd-hit" onClick=${() => openPrice(x.ref)}><b>${x.sym || x.name}</b><span class="xs muted ellipsis">${x.sym ? x.name : ''}</span><span class="xs num">${hitLine(r.kind, x.m)}</span></button>`)
          : html`<div class="xs muted">امروز نمادی از این فیلتر رد نشد.</div>`}</div>`}
      </div>`;
    })}</div>
  </div>`;
}
const hitLine = (kind, m) => (kind === 'stock' ? `P/E ${m.pe !== null ? num(m.pe, 1) : '—'}، ۳ ماه ${pctTxt(m.ret91)}، ۱۲ ماه ${pctTxt(m.ret365)}` : `۱۲ ماه ${pctTxt(m.y1)}، ۳ ماه ${pctTxt(m.m3)}${m.bubble !== null ? `، حباب ${pctTxt(m.bubble, 1)}` : ''}`);
function ruleText(r) {
  const F = RD.FIELDS[r.kind];
  return [r.kind === 'fund' && r.ftype ? `صندوق ${RD.FUND_KIND[r.ftype] || ''}` : r.kind === 'fund' ? 'همهٔ صندوق‌ها' : 'سهام',
    ...r.conds.map((c) => `${F[c.f]?.t} ${c.op === '<=' ? 'حداکثر' : 'حداقل'} ${num(+c.v, 2)}${F[c.f]?.pct ? '٪' : ''}`)].join('، ');
}

function RuleModal({ rule, sectors, onClose }) {
  const [r, setR] = useState(() => structuredClone(rule));
  const F = RD.FIELDS[r.kind];
  const setCond = (i, patch) => setR({ ...r, conds: r.conds.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setKind = (kind) => setR({ ...r, kind, ftype: undefined, sector: undefined, conds: [{ f: Object.keys(RD.FIELDS[kind])[0], op: '>=', v: 0 }] });
  const ok = r.name.trim() && RD.validRule(r);
  const save = async () => { if (!ok) return; await act.saveRadarRule({ ...r, name: r.name.trim() }); toast(r.notify ? 'قاعده ذخیره شد؛ اگر نماد تازه‌ای از آن رد شد خبرت می‌کنیم' : 'قاعده ذخیره شد'); onClose(); };
  return html`<${Modal} title=${rule.id ? 'ویرایش قاعده' : 'قاعدهٔ تازه'} onClose=${onClose} footer=${html`<button class="btn primary" disabled=${!ok} onClick=${save}>ذخیره</button><button class="btn ghost" onClick=${onClose}>انصراف</button>`}>
    <div class="field"><label>نام</label><input class="input" value=${r.name} placeholder="مثلاً صندوق طلای ارزان" onInput=${(e) => setR({ ...r, name: e.target.value })} /></div>
    <div class="field"><label>روی چه چیزی</label><${Seg} value=${r.kind} onChange=${setKind} options=${[['stock', 'سهام'], ['fund', 'صندوق']]} /></div>
    ${r.kind === 'fund' && html`<div class="field"><label>نوع صندوق</label><select class="input" value=${r.ftype || ''} onChange=${(e) => setR({ ...r, ftype: e.target.value ? +e.target.value : undefined })}>
      <option value="">همه</option>${Object.entries(RD.FUND_KIND).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></div>`}
    ${r.kind === 'stock' && html`<div class="field"><label>گروه صنعت</label><select class="input" value=${r.sector || ''} onChange=${(e) => setR({ ...r, sector: e.target.value || undefined })}>
      <option value="">همهٔ گروه‌ها</option>${Object.entries(sectors).filter(([, t]) => !/حذف شده|اوراق|صندوق/.test(t)).sort((a, b) => a[1].localeCompare(b[1], 'fa')).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></div>`}
    <div class="col" style="gap:8px"><span class="small sb">شرط‌ها (همه باید برقرار باشند)</span>
      ${r.conds.map((c, i) => html`<div class="row" style="gap:6px">
        <select class="input" style="flex:2" aria-label="معیار" value=${c.f} onChange=${(e) => setCond(i, { f: e.target.value })}>${Object.entries(F).map(([k, x]) => html`<option value=${k}>${x.t}</option>`)}</select>
        <select class="input" style="flex:1" aria-label="مقایسه" value=${c.op} onChange=${(e) => setCond(i, { op: e.target.value })}><option value=">=">حداقل</option><option value="<=">حداکثر</option></select>
        <div style="flex:1"><${NumField} value=${c.v} onInput=${(v) => setCond(i, { v })} suffix=${F[c.f]?.pct ? '٪' : ''} digits=${2} allowNegative /></div>
        ${r.conds.length > 1 && html`<button class="btn icon sm ghost" aria-label="حذف شرط" onClick=${() => setR({ ...r, conds: r.conds.filter((_, k) => k !== i) })}><${Icon} n="x" cls="sm" /></button>`}
      </div>`)}
      ${r.conds.length < 4 && html`<button class="btn sm ghost" style="align-self:flex-start" onClick=${() => setR({ ...r, conds: [...r.conds, { f: Object.keys(F)[0], op: '>=', v: 0 }] })}><${Icon} n="plus" cls="sm" />شرط دیگر</button>`}
      <span class="xs muted">${r.kind === 'stock' ? 'بازدهی‌ها و فاصله از سقف و کف به درصدند؛ «فاصله از بالاترین سال» منفی است (مثلاً −۳۰ یعنی ۳۰٪ زیر سقف).' : 'بازدهی‌ها به درصدند و از فیپیران می‌آیند؛ حباب فقط برای صندوق‌های قابل معامله.'}</span>
    </div>
    <label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" checked=${!!r.notify} onChange=${(e) => setR({ ...r, notify: e.target.checked })} />وقتی نماد تازه‌ای از این فیلتر رد شد خبرم کن</label>
  </${Modal}>`;
}

function Marks({ radar, user, s, openPrice }) {
  if (!user.marks.length) return html`<div class="card"><div class="empty small" style="padding:20px">روی ➕ هر کارت بزن تا اینجا ببینی از آن روز به بعد چه کرده.</div></div>`;
  return html`<div class="card"><div class="card-h"><h3><${Icon} n="target" cls="sm" />پیگیری</h3><span class="sub">تغییر قیمت از روزی که نشانش کردی</span></div>
    <div class="list">${user.marks.map((m) => {
      const ch = RD.changeSince(radar, m.id, m.day, m.price);
      return html`<div class="it"><button class="rd-name grow" onClick=${() => m.ref && openPrice(m.ref)}><b>${m.sym || m.name}</b><span class="xs muted">${m.sym ? m.name + '، ' : ''}نشان‌شده ${m.day ? fmtJ(m.day) : ''}</span></button>
        <span class=${'small num ' + (ch > 0 ? 'pos' : ch < 0 ? 'neg' : '')}>${ch === null ? '—' : pctTxt(ch, 1)}</span>
        <button class="btn icon sm ghost" aria-label=${'برداشتن ' + (m.sym || m.name)} title="برداشتن" onClick=${() => act.toggleRadarMark(m)}><${Icon} n="x" cls="sm" /></button></div>`;
    })}</div>
    <div class="xs muted" style="margin-top:8px">قیمت سهام تعدیل‌شده است؛ برای صندوق‌های غیربورسی NAV ابطال.</div></div>`;
}
