import { isoFromDate } from '../lib/jalali.js';
import { html, render, useState, useEffect, useMemo, useStore, useTick, Icon, Toasts, send, toast, Money, Delta, Seg, money, num, pct, fmtJ, AreaChart, StackBar, Ava, StatusPill, refLabel, Markdown, BackfillButton, Explain, AskBtn } from './components.js';
import * as I from '../lib/insights.js';
import * as E from '../lib/engine.js';
import { CAT, EXPOSURES } from '../lib/catalog.js';
import { ago, timeHM, signed } from '../lib/format.js';
import { todayIso } from '../lib/jalali.js';
import { act } from './actions.js';
import { AssetsPage } from './pages/assets.js';
import { AssetEditor } from './pages/editor.js';
import { MarketPage } from './pages/market.js';
import { AutomationPage } from './pages/automation.js';
import { AnalysisPage } from './pages/analysis.js';
import { SettingsPage, WelcomePage } from './pages/settings.js';
import { AssistantPage } from './pages/assistant.js';
import { CapturePage } from './pages/capture.js';
import * as U from '../lib/update.js';

const ROUTES = [
  { id: 'overview', t: 'نمای کلی', icon: 'overview' },
  { id: 'assets', t: 'دارایی‌ها', icon: 'assets' },
  { id: 'assistant', t: 'دستیار هوشمند', icon: 'sparkles' },
  { id: 'market', t: 'بازار و قیمت‌ها', icon: 'market' },
  { id: 'automation', t: 'خودکارسازی', icon: 'automation' },
  { id: 'analysis', t: 'تحلیل و سناریو', icon: 'analysis' },
  { id: 'settings', t: 'تنظیمات', icon: 'settings' },
];
const HIDDEN = { welcome: 'خوش آمدید', capture: 'ثبت از صفحه' };

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { page: path || 'overview', q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

/* ------------------------------ Overview ------------------------------ */
function denomValue(net, denom, rates) {
  if (denom === 'usd') return rates.usd ? net / rates.usd : null;
  if (denom === 'gold') return rates.gold ? net / rates.gold : null;
  if (denom === 'coin') return rates.coin ? net / rates.coin : null;
  return net;
}
function DenomText({ v, denom, s }) {
  if (v === null || v === undefined) return html`<span>—</span>`;
  if (denom === 'money') {
    return html`<${Money} v=${v} s=${s} compact=${s.compact} unit=${false} /><span class="u">${s.currency === 'rial' ? 'ریال' : 'تومان'}</span>`;
  }
  const unit = denom === 'usd' ? 'دلار' : denom === 'gold' ? 'گرم طلای ۱۸' : 'سکه امامی';
  const d = denom === 'usd' ? 0 : Math.abs(v) >= 100 ? 0 : 1;
  return html`<span class="money"><span class="n"><span class="ltr">${num(v, d)}</span></span></span><span class="u">${unit}</span>`;
}

function Hero({ st, pf, s }) {
  const [range, setRange] = useState(90);
  const denom = s.denom || 'money';
  const rates = E.denomRates(st.quotes);
  const net = denomValue(pf.net, denom, rates);
  const series = E.seriesFrom(st.snapshots, denom, range);
  // the chips show what the market did (new money, transfers and records are left out — same as «چرا تغییر کرد»)
  const moves = useMemo(() => [1, 7, 30].map((d) => I.marketMove(st, pf, d)), [st.assets, st.quotes, st.snapshots, st.events, pf]);
  const periods = [['امروز', moves[0]], ['۷ روز', moves[1]], ['۳۰ روز', moves[2]]];
  const fmt = (v) => (denom === 'money' ? money(v, s, { compact: true }) : num(v, denom === 'usd' ? 0 : 1) + (denom === 'usd' ? ' دلار' : denom === 'gold' ? ' گرم' : ' سکه'));
  const hasEst = series.some((p) => p.est);
  return html`<section class="hero">
    <div style="position:relative;z-index:1;display:flex;flex-direction:column">
      <div class="row between"><span class="lbl row" style="gap:4px">ارزش خالص دارایی‌ها<${Explain} light s=${s} get=${() => I.explainNet(pf)} ask="ارزش خالص دارایی‌هایم از چه بخش‌هایی تشکیل شده و کدام بخش بیشترین وزن را دارد؟" /></span>
        <${Seg} value=${denom} onChange=${(v) => act.setSettings({ denom: v })} options=${[['money', s.currency === 'rial' ? 'ریال' : 'تومان'], ['usd', 'دلار'], ['gold', 'طلا'], ['coin', 'سکه']]} /></div>
      <div class="big num"><${DenomText} v=${net} denom=${denom} s=${s} /></div>
      ${denom === 'money' && s.compact && html`<div class="full num"><${Money} v=${pf.net} s=${s} /></div>`}
      <div class="chg">${periods.map(([t, d], i) => html`<div class="box"><span class="row" style="gap:2px">${t}<${Explain} light s=${s} title=${`تغییر ${t} از کجا آمد؟`} get=${() => I.explainChange(st, [1, 7, 30][i], pf)} /></span><b title="اثر قیمت بازار؛ پولی که اضافه یا جابه‌جا کردی جدا حساب شده"><${Delta} p=${d?.pct} showAbs=${false} /></b>
        <span class="xs" style="opacity:.75">${d && isFinite(d.abs) ? html`<${Money} v=${d.abs} s=${s} compact sign unit=${false} />` : '—'}</span>
        ${d && Math.abs(d.moved) >= 10 && html`<span class="xs" style="opacity:.6" title="تغییر کل ارزش خالص، با پول جدید و جابه‌جایی‌ها">کل <${Money} v=${d.total} s=${s} compact sign unit=${false} /></span>`}</div>`)}</div>
      <div class="equiv" style="margin-top:auto;padding-top:14px">
        ${denom !== 'usd' && rates.usd && html`<span>≈ <b class="money"><span class="n"><span class="ltr">${num(pf.net / rates.usd)}</span></span></b> دلار</span>`}
        ${denom !== 'gold' && rates.gold && html`<span>≈ <b class="money"><span class="n"><span class="ltr">${num(pf.net / rates.gold, 1)}</span></span></b> گرم طلای ۱۸</span>`}
        ${denom !== 'money' && html`<span>≈ <b><${Money} v=${pf.net} s=${s} compact /></b></span>`}
        ${pf.debt > 0 && html`<span>بدهی: <b><${Money} v=${pf.debt} s=${s} compact /></b></span>`}
      </div>
    </div>
    <div class="chart-area">
      <div class="row between" style="margin-bottom:6px"><span class="lbl">روند ارزش خالص${denom !== 'money' ? ' (بر حسب ' + E.DENOMS[denom].name + ')' : ''}${hasEst ? ' (خط‌چین = تخمینی)' : ''}</span>
        <${Seg} value=${range} onChange=${setRange} options=${[[7, '۷ روز'], [30, '۱ ماه'], [90, '۳ ماه'], [365, '۱ سال'], [0, 'همه']]} /></div>
      ${series.length >= 2 ? html`<${AreaChart} points=${series} height=${178} fmt=${fmt} color="#5ADCF0" stroke="#fff" onDark />`
        : html`<div style="height:178px;display:grid;place-items:center;text-align:center"><div><div style="opacity:.8;font-size:13px;margin-bottom:10px">نمودار از امروز خودکار پر می‌شود — یا همین حالا گذشته را بازسازی کن.</div><${BackfillButton} st=${st} cls="btn" /></div></div>`}
    </div>
  </section>`;
}

function WhyChanged({ st, pf, s, open }) {
  const [days, setDays] = useState(1);
  const at = useMemo(() => E.attribution(st.assets, st.quotes, s, st.snapshots, st.events, days, todayIso(), pf), [st.assets, st.quotes, st.snapshots, st.events, pf, days]);
  const label = { 1: 'از دیروز', 7: 'در ۷ روز گذشته', 30: 'در ۳۰ روز گذشته' }[days];
  const askQ = { 1: 'چرا ارزش دارایی‌هایم امروز تغییر کرد؟ اثر قیمت بازار را از واریز و برداشت جدا کن.', 7: 'ارزش دارایی‌هایم در ۷ روز گذشته چرا تغییر کرد؟ اثر بازار و پول جابه‌جاشده را جدا توضیح بده.', 30: 'ارزش دارایی‌هایم در ۳۰ روز گذشته چرا تغییر کرد؟ اثر بازار و پول جابه‌جاشده را جدا توضیح بده.' }[days];
  const head = html`<div class="card-h"><h3><${Icon} n="sparkles" cls="sm" />چرا تغییر کرد؟</h3><div class="row" style="gap:8px"><${AskBtn} q=${askQ} label="توضیح بده" /><${Seg} value=${days} onChange=${setDays} options=${[[1, 'امروز'], [7, '۷ روز'], [30, '۳۰ روز']]} /></div></div>`;
  if (!at) return html`<div class="card">${head}<div class="empty small" style="padding:18px"><div style="margin-bottom:10px">برای این دوره هنوز عکس‌فوری ذخیره نشده.</div><${BackfillButton} st=${st} /></div></div>`;
  const up = at.total >= 0;
  const drivers = at.cats.filter((c) => Math.abs(c.market) >= 1);
  const top = drivers[0];
  const bars = [...drivers.slice(0, 6).map((c) => ({ name: c.name, v: c.market, color: c.color })), ...(Math.abs(at.external) >= 1 ? [{ name: 'واریز و برداشت', v: at.external, color: 'var(--accent)' }] : []), ...(Math.abs(at.edits) >= 1 ? [{ name: 'ثبت و ویرایش دستی', v: at.edits, color: 'var(--faint)' }] : [])];
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.v)));
  const flowDominant = Math.abs(at.external + at.edits) > Math.abs(at.market);
  return html`<div class="card">${head}
    <div class="why">
      <div>
        <div class="lead">ارزش خالص ${label} <b class=${up ? 'pos' : 'neg'}><span class="ltr">${pct(at.pct)}</span></b> (<${Money} v=${at.total} s=${s} compact sign />) ${up ? 'بالا رفت' : 'پایین آمد'}.
          ${flowDominant ? ' بیشترِ آن از پولی بود که جابه‌جا یا ثبت شد، نه تغییر قیمت.' : top ? html` بیشترین اثر را <b>${top.name}</b> داشت (<${Money} v=${top.market} s=${s} compact sign />).` : ''}
          ${at.est ? html`<div class="xs muted">مبنای مقایسه بازسازی‌شده است.</div>` : ''}</div>
        <div class="split">
          <div class="pcell"><span class="n">اثر قیمت بازار</span><span class=${'v ' + (at.market >= 0 ? 'pos' : 'neg')}><${Money} v=${at.market} s=${s} compact sign /></span></div>
          <div class="pcell"><span class="n">واریز و برداشت</span><span class="v"><${Money} v=${at.external} s=${s} compact sign /></span></div>
          ${Math.abs(at.edits) >= 1 && html`<div class="pcell"><span class="n">ثبت و ویرایش دستی</span><span class="v"><${Money} v=${at.edits} s=${s} compact sign /></span></div>`}
        </div>
      </div>
      <div class="wbars">${bars.length ? bars.map((b) => html`<div class="wbar"><span class="ellipsis sb">${b.name}</span>
        <div class="wt" dir="ltr"><b style=${`${b.v >= 0 ? 'left:50%' : `left:${50 - Math.abs(b.v) / max * 50}%`};width:${Math.max(1.5, Math.abs(b.v) / max * 50)}%;background:${b.v >= 0 ? 'var(--pos)' : 'var(--neg)'}`}></b></div>
        <span class=${'wv ' + (b.v >= 0 ? 'pos' : 'neg')}><${Money} v=${b.v} s=${s} compact sign unit=${false} /></span></div>`)
        : html`<div class="muted small">تغییر محسوسی ثبت نشده.</div>`}</div>
    </div>
  </div>`;
}

function Kpis({ st, pf, s }) {
  const ex = pf.byExposure; const g = pf.gross || 1;
  const hard = g - (ex.rial || 0);
  const exItems = Object.entries(EXPOSURES).map(([k, v]) => ({ name: v.name, color: v.color, value: ex[k] || 0 }));
  const liq = pf.byLiquidity;
  const auto = E.monthlyAuto(st.assets, st.flows);
  let autoVal = 0;
  for (const r of pf.rows) if (!r.cat.liability && (r.status === 'live' || r.status === 'auto' || r.status === 'matured' || r.status === 'delayed' || (r.source !== 'manual' && r.status === 'error'))) autoVal += r.value;
  return html`<div class="kpis">
    <div class="kpi"><span class="t"><${Icon} n="shield" cls="sm" />دارایی ضدتورمی</span>
      <span class="v num">${pf.gross > 0 ? pct(hard / g, { sign: false }) : '—'}</span><${StackBar} items=${exItems} height=${6} />
      <span class="s">طلا ${pct((ex.gold || 0) / g, { sign: false })}، ارز ${pct(((ex.fx || 0) + (ex.crypto || 0)) / g, { sign: false })}، سهام ${pct((ex.equity || 0) / g, { sign: false })}</span></div>
    <div class="kpi"><span class="t"><${Icon} n="droplet" cls="sm" />نقدشوندگی بالا</span>
      <span class="v num">${pf.gross > 0 ? pct(liq.high / g, { sign: false }) : '—'}</span>
      <${StackBar} items=${[{ name: 'بالا', value: liq.high, color: '#14BCDB' }, { name: 'متوسط', value: liq.mid, color: '#8E70FF' }, { name: 'پایین', value: liq.low, color: '#D946A8' }]} height=${6} />
      <span class="s">قابل نقد در چند روز: <${Money} v=${liq.high} s=${s} compact /></span></div>
    <div class="kpi"><span class="t"><${Icon} n="zap" cls="sm" />درآمد خودکار ماهانه</span>
      <span class="v"><${Money} v=${auto.interest + auto.inflow} s=${s} compact /></span>
      <span class="s">سود <${Money} v=${auto.interest} s=${s} compact unit=${false} />، ورودی‌ها <${Money} v=${auto.inflow} s=${s} compact unit=${false} /></span></div>
    <div class="kpi"><span class="t"><${Icon} n="live" cls="sm" />به‌روزرسانی خودکار</span>
      <span class="v num">${pf.gross > 0 ? pct(autoVal / g, { sign: false }) : '—'}</span>
      <${StackBar} items=${[{ name: 'خودکار', value: autoVal, color: '#0E9F6E' }, { name: 'دستی', value: g - autoVal, color: 'var(--line-2)' }]} height=${6} />
      <span class="s">از ارزش دارایی‌ها خودکار به‌روز می‌شود</span></div>
  </div>`;
}

function Allocation({ pf, s }) {
  const cats = pf.cats.filter((c) => !c.liability);
  const g = pf.gross || 1;
  const exps = Object.entries(pf.byExposure).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...cats.map((c) => c.value), 1);
  return html`<div class="card">
    <div class="card-h"><h3>ترکیب دارایی‌ها</h3><span class="sub">${num(cats.length)} دسته</span></div>
    ${cats.length ? html`
      <div class="exp-strip">${exps.map(([k, v]) => html`<i title=${EXPOSURES[k]?.name} style=${`flex:${v};background:${EXPOSURES[k]?.color}`}></i>`)}</div>
      <div class="exp-legend">${exps.map(([k, v]) => html`<span><i style=${'background:' + EXPOSURES[k]?.color}></i>${EXPOSURES[k]?.name} <b class="num">${pct(v / g, { sign: false, digits: 0 })}</b></span>`)}</div>
      <div class="alloc2">${cats.map((c) => html`<a class="ar" href=${'#/assets?cat=' + c.id}>
        <span class="an"><i style=${'background:' + c.color}></i><span class="ellipsis">${c.name}</span></span>
        <span class="at"><b style=${`width:${c.value / max * 100}%;background:${c.color}`}></b></span>
        <span class="av num"><${Money} v=${c.value} s=${s} compact unit=${false} /></span>
        <span class="ap num">${pct(c.share, { sign: false })}</span></a>`)}</div>`
      : html`<div class="empty">هنوز دارایی‌ای ثبت نشده</div>`}
  </div>`;
}

const BOARD = [['tgju', 'geram18'], ['tgju', 'sekee'], ['tgju', 'price_dollar_rl'], ['tgju', 'price_eur'], ['nobitex', 'usdt'], ['nobitex', 'btc']];
function PriceBoard({ st, s }) {
  return html`<div class="card">
    <div class="card-h"><h3>قیمت‌های کلیدی <span class="sub">به ${s.currency === 'rial' ? 'ریال' : 'تومان'}</span></h3><a class="small" href="#/market">همه قیمت‌ها ←</a></div>
    <div class="prices">${BOARD.map(([p, k]) => {
      const q = st.quotes[`${p}:${k}`];
      return html`<div class="pcell"><span class="n"><span class="ellipsis">${refLabel({ provider: p, key: k })}</span><${Delta} p=${q?.changePct} showAbs=${false} /></span>
        <span class="v"><${Money} v=${q?.price || null} s=${s} unit=${false} /></span>
        <span class="xs faint">${q ? (q.price > 0 ? (q.approx ? 'تقریبی، ' : '') + timeHM(q.at) : html`<span class="neg">${q.error}</span>`) : 'در انتظار دریافت'}</span></div>`;
    })}</div>
  </div>`;
}

function WeeklyCard({ st }) {
  const r = (st.reports || [])[0];
  const [busy, setBusy] = useState(false);
  const make = async () => { setBusy(true); const res = await send('weekly', { force: true }); setBusy(false); if (!res?.ok) toast(res?.error || 'ساخت گزارش ممکن نشد'); };
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="file" cls="sm" />گزارش هفتگی</h3>${r ? html`<span class="sub">${fmtJ(isoFromDate(new Date(r.createdAt)))}، ${r.by === 'ai' ? 'هوش مصنوعی' : 'خودکار'}</span>` : ''}</div>
    ${r ? html`<div class="report" style="max-height:230px;overflow:hidden;mask-image:linear-gradient(to bottom,#000 75%,transparent)"><${Markdown} text=${r.text} /></div>
      <div class="row" style="margin-top:8px"><a class="btn sm" href="#/assistant?tab=reports">خواندن کامل</a><button class="btn sm ghost" onClick=${make} disabled=${busy}><${Icon} n="refresh" cls=${'sm' + (busy ? ' spin' : '')} />ساخت دوباره</button></div>`
      : html`<div class="empty small" style="padding:16px">هر جمعه عصر یک گزارش کوتاه از تغییرات هفته ساخته می‌شود.<div style="margin-top:10px"><button class="btn sm primary" onClick=${make} disabled=${busy}>${busy ? 'در حال ساخت…' : 'ساخت گزارش این هفته'}</button></div></div>`}
  </div>`;
}

function Upcoming({ st, pf, s, open }) {
  const up = E.upcoming(st.assets, st.flows, 14).slice(0, 5);
  const att = pf.attention.slice(0, 5);
  const byId = Object.fromEntries(st.assets.map((a) => [a.id, a]));
  return html`<div class="card">
    <div class="card-h"><h3>نیازمند توجه و پیش رو</h3><span class="sub">۱۴ روز آینده</span></div>
    <div class="list">
      ${att.map((r) => html`<div class="it" style="cursor:pointer" onClick=${() => open(r.asset)}>
        <${Ava} cat=${r.asset.category} size=${32} />
        <div class="grow"><div class="sb ellipsis">${r.asset.name}</div><div class="xs muted">${r.status === 'stale' ? `آخرین به‌روزرسانی ${ago(r.at)}` : r.error || 'قیمت آنلاین قدیمی است'}</div></div>
        <${StatusPill} status=${r.status} /></div>`)}
      ${up.map((e) => html`<div class="it">
        <span class="ava" style="background:var(--accent-soft);color:var(--accent)"><${Icon} n=${e.kind === 'interest' ? 'percent' : e.kind === 'maturity' ? 'clock' : e.kind === 'loan' ? 'calendar' : 'repeat'} /></span>
        <div class="grow"><div class="sb ellipsis">${e.title}</div><div class="xs muted">${fmtJ(e.date)}${e.toId && byId[e.toId] && e.toId !== e.assetId ? '، به ' + byId[e.toId].name : ''}${e.estimate ? '، تخمینی' : ''}</div></div>
        <span class="small sb"><${Money} v=${e.amount} s=${s} compact /></span></div>`)}
      ${!att.length && !up.length && html`<div class="empty"><div class="ico"><${Icon} n="check" /></div>همه‌چیز به‌روز است و رویدادی در دو هفته آینده نیست.</div>`}
    </div>
  </div>`;
}

function Overview(ctx) {
  useTick(10000);
  const { st, pf, s, open } = ctx;
  if (!st.assets.length) return html`<${WelcomePage} ...${ctx} inline />`;
  return html`<div class="page">
    <${Hero} st=${st} pf=${pf} s=${s} />
    <${WhyChanged} st=${st} pf=${pf} s=${s} open=${open} />
    <${Kpis} st=${st} pf=${pf} s=${s} />
    <div class="grid-ov"><${Allocation} pf=${pf} s=${s} /><${PriceBoard} st=${st} s=${s} /></div>
    <div class="grid-ov"><${Upcoming} st=${st} pf=${pf} s=${s} open=${open} /><${WeeklyCard} st=${st} /></div>
  </div>`;
}

/* ------------------------------ Shell ------------------------------ */
function StatusChip({ st }) {
  const m = st.meta; const errs = m.errCount || 0;
  const running = m.running && Date.now() - (m.runStartedAt || 0) < 90000;
  const title = errs ? Object.entries(m.errors || {}).slice(0, 8).map(([k, v]) => `${refLabel({ provider: k.split(':')[0], key: k.split(':')[1] })}: ${v}`).join('\n') : '';
  return html`<a class="status" title=${title} href="#/market">
    ${running ? html`<${Icon} n="refresh" cls="sm spin" />در حال دریافت قیمت‌ها…` : html`
      <span style=${`width:7px;height:7px;border-radius:50%;background:${!m.lastOk ? 'var(--faint)' : errs ? 'var(--warn)' : 'var(--pos)'}`}></span>
      ${m.lastRun ? `به‌روزرسانی ${ago(m.lastRun)}` : 'هنوز به‌روز نشده'}${errs ? html`، <span class="warn">${num(errs)} قیمت دریافت نشد</span>` : ''}`}
  </a>`;
}

const verFa = (v) => String(v || '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
/** New files in the install folder: a refresh applies them; this banner covers an already-open page. */
function UpdateBanner() {
  const [v, setV] = useState(null);
  useEffect(() => {
    const onMsg = (m) => { if (m?.type === 'update-available') setV(m.version); };
    chrome.runtime.onMessage.addListener(onMsg);
    const onVis = async () => { if (document.visibilityState === 'visible') setV(await U.pendingVersion()); };
    document.addEventListener('visibilitychange', onVis);
    (async () => {
      const { updateState: u } = await chrome.storage.local.get('updateState');
      if (u?.done && !u.shown && u.from && u.from !== u.to && u.to === chrome.runtime.getManifest().version && Date.now() - u.at < 3 * 60000) {
        toast(`دارا به نسخه ${verFa(u.to)} به‌روز شد`);
        chrome.storage.local.set({ updateState: { ...u, shown: true } });
      }
    })();
    return () => { chrome.runtime.onMessage.removeListener(onMsg); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!v) return null;
  return html`<div class="update-bar"><${Icon} n="sparkles" cls="sm" /><span class="grow">نسخه تازه دارا (${verFa(v)}) آماده است. با تازه‌سازی صفحه اعمال می‌شود و داده‌ها دست نمی‌خورد.</span>
    <button class="btn sm primary" onClick=${() => U.applyUpdate(location.href)}>به‌روزرسانی</button></div>`;
}

function App() {
  const st = useStore();
  const [route, setRoute] = useState(parseHash());
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useTick(30000);
  useEffect(() => {
    const h = () => setRoute(parseHash());
    addEventListener('hashchange', h);
    const k = (e) => {
      if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'د') { e.preventDefault(); setEditing({}); }
      if (e.key === '/') { e.preventDefault(); document.querySelector('.search input')?.focus(); }
    };
    addEventListener('keydown', k);
    send('automate');
    return () => { removeEventListener('hashchange', h); removeEventListener('keydown', k); };
  }, []);
  // «دارایی جدید» from the popup opens the add form here
  useEffect(() => { if (route.q.new) { setEditing({}); history.replaceState(null, '', '#/' + route.page); } }, [route.q.new]);
  const pf = useMemo(() => (st ? E.portfolio(st.assets, st.quotes, st.settings) : null), [st?.assets, st?.quotes, st?.settings, Math.floor(Date.now() / 30000)]);
  const todayMove = useMemo(() => (st && pf ? I.marketMove(st, pf, 1) : null), [st?.assets, st?.quotes, st?.snapshots, st?.events, pf]);
  if (!st) return html`<div style="display:grid;place-items:center;height:100vh" class="muted">در حال بارگذاری…</div>`;
  const s = st.settings;
  const open = (asset, preset) => setEditing({ asset, preset });
  const ctx = { st, pf, s, open, route, q, setQ };
  const refresh = async () => { setBusy(true); const r = await send('refresh'); setBusy(false); toast(r?.ok ? (r.errors ? `قیمت‌ها به‌روز شد؛ ${num(r.errors)} قیمت دریافت نشد` : 'همه قیمت‌ها به‌روز شد') : 'به‌روزرسانی انجام نشد'); };
  const page = route.page;
  const cur = ROUTES.find((r) => r.id === page) || { t: HIDDEN[page] || 'دارا' };
  const attention = pf.attention.length;
  const themeNext = { auto: 'light', light: 'dark', dark: 'auto' }[s.theme];
  return html`<div class="shell">
    <aside class="side">
      <div class="brand"><div class="logo"><${Icon} n="layers" /></div><div><div class="name">دارا</div><div class="tag">مدیریت هوشمند دارایی</div></div></div>
      <nav class="nav">${ROUTES.map((r) => html`<a href=${'#/' + r.id} class=${page === r.id ? 'on' : ''} title=${r.t} aria-label=${r.t} aria-current=${page === r.id ? 'page' : undefined}><${Icon} n=${r.icon} />${r.t}${r.id === 'assets' && attention ? html`<span class="count num">${num(attention)}</span>` : ''}</a>`)}</nav>
      <div class="foot">
        <div class="row between"><span class="muted">ارزش خالص</span><span class="b"><${Money} v=${pf.net} s=${s} compact /></span></div>
        <div class="row between xs" style="margin-top:4px"><span class="muted">امروز (بازار)</span><${Delta} p=${todayMove?.pct} showAbs=${false} /></div>
      </div>
    </aside>
    <main class="main">
      <${UpdateBanner} />
      <div class="topbar">
        <h1>${cur.t}</h1>
        <span class="grow"></span>
        ${page === 'assets' && html`<label class="search"><${Icon} n="search" cls="sm" /><input class="input" placeholder="جست‌وجوی دارایی، بانک، نماد…" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>`}
        <${StatusChip} st=${st} />
        <button class="btn icon" title="به‌روزرسانی قیمت‌ها" onClick=${refresh} disabled=${busy}><${Icon} n="refresh" cls=${busy ? 'spin' : ''} /></button>
        <button class="btn icon" title=${s.privacy ? 'نمایش مبالغ' : 'پنهان‌کردن مبالغ'} onClick=${() => act.setSettings({ privacy: !s.privacy })}><${Icon} n=${s.privacy ? 'eyeOff' : 'eye'} /></button>
        <button class="btn icon" title="تغییر تم" onClick=${() => act.setSettings({ theme: themeNext })}><${Icon} n=${s.theme === 'dark' ? 'moon' : s.theme === 'light' ? 'sun' : 'monitor'} /></button>
        <button class="btn primary" onClick=${() => setEditing({})}><${Icon} n="plus" />دارایی جدید</button>
      </div>
      ${page === 'overview' && html`<${Overview} ...${ctx} />`}
      ${page === 'assets' && html`<${AssetsPage} ...${ctx} />`}
      ${page === 'assistant' && html`<${AssistantPage} ...${ctx} />`}
      ${page === 'market' && html`<${MarketPage} ...${ctx} />`}
      ${page === 'automation' && html`<${AutomationPage} ...${ctx} />`}
      ${page === 'analysis' && html`<${AnalysisPage} ...${ctx} />`}
      ${page === 'settings' && html`<${SettingsPage} ...${ctx} />`}
      ${page === 'welcome' && html`<${WelcomePage} ...${ctx} />`}
      ${page === 'capture' && html`<${CapturePage} ...${ctx} />`}
    </main>
    ${editing && html`<${AssetEditor} st=${st} s=${s} asset=${editing.asset} preset=${editing.preset} onClose=${() => setEditing(null)} />`}
    <${Toasts} />
  </div>`;
}

if (await U.checkOnLoad()) document.getElementById('app').innerHTML = '<div style="display:grid;place-items:center;height:100vh;color:#8C93A8">در حال نصب نسخه جدید دارا…</div>';
else render(html`<${App} />`, document.getElementById('app'));
