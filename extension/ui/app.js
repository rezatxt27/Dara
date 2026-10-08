import { isoFromDate } from '../lib/jalali.js';
import { html, render, useState, useEffect, useMemo, useStore, useTick, Icon, Toasts, send, toast, Money, Delta, Seg, money, num, pct, fmtJ, AreaChart, StackBar, Ava, StatusPill, refLabel, Markdown, BackfillButton, Explain, AskBtn } from './components.js';
import * as I from '../lib/insights.js';
import * as E from '../lib/engine.js';
import * as BB from '../lib/bubble.js';
import { CAT, EXPOSURES } from '../lib/catalog.js';
import { ago, timeHM, signed } from '../lib/format.js';
import { todayIso } from '../lib/jalali.js';
import { act } from './actions.js';
import { AssetsPage } from './pages/assets.js';
import { AssetEditor } from './pages/editor.js';
import { MarketPage } from './pages/market.js';
import { AutomationPage } from './pages/automation.js';
import { AnalysisPage } from './pages/analysis.js';
import { CalcPage } from './pages/calc.js';
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
  { id: 'calc', t: 'ماشین‌حساب‌ها', icon: 'calculator' },
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
      <div class="chg">${periods.map(([t, d], i) => html`<div class="box"><span class="row" style="gap:2px">${t}<${Explain} light s=${s} title=${`تغییر ${t} از کجا آمد؟`} get=${() => I.explainChange(st, [1, 7, 30][i], pf)} /></span><b title="تغییر قیمت‌ها و سودها؛ پولی که اضافه، برداشت یا جابه‌جا کردی جدا حساب شده"><${Delta} p=${d?.pct} showAbs=${false} /></b>
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
  const label = { 1: 'از دیروز تا حالا', 7: 'در ۷ روز گذشته', 30: 'در ۳۰ روز گذشته' }[days];
  const askQ = { 1: 'چرا ارزش دارایی‌هایم امروز تغییر کرد؟ اثر قیمت بازار را از واریز و برداشت جدا کن.', 7: 'ارزش دارایی‌هایم در ۷ روز گذشته چرا تغییر کرد؟ اثر بازار و پول جابه‌جاشده را جدا توضیح بده.', 30: 'ارزش دارایی‌هایم در ۳۰ روز گذشته چرا تغییر کرد؟ اثر بازار و پول جابه‌جاشده را جدا توضیح بده.' }[days];
  const head = html`<div class="card-h"><h3><${Icon} n="sparkles" cls="sm" />چرا تغییر کرد؟</h3><div class="row" style="gap:8px"><${AskBtn} q=${askQ} label="توضیح بده" /><${Seg} value=${days} onChange=${setDays} options=${[[1, 'امروز'], [7, '۷ روز'], [30, '۳۰ روز']]} /></div></div>`;
  if (!at) return html`<div class="card">${head}<div class="empty small" style="padding:18px"><div style="margin-bottom:10px">برای این دوره هنوز عکس‌فوری ذخیره نشده.</div><${BackfillButton} st=${st} /></div></div>`;
  // lead with the same number as the «امروز» chip: what prices and interest did (money moved or recorded is told apart)
  // (when the last saved day is older than the period — the browser was closed — say from when, honestly)
  const lead = at.from < E.addDaysIso(todayIso(), -days) ? `از ${fmtJ(at.from, 'dm')} تا حالا` : label;
  const ret = at.market; const up = ret >= 0; const base = Math.abs(at.base) || 0;
  const moved = at.total - at.market;
  const drivers = at.cats.filter((c) => Math.abs(c.price) >= 1).sort((a, b) => Math.abs(b.price) - Math.abs(a.price));
  const top = drivers[0];
  const bars = [...drivers.slice(0, 6).map((c) => ({ name: c.name, v: c.price, color: c.color })),
    ...(Math.abs(at.interest) >= 1 ? [{ name: 'سود (سپرده، حساب، وام)', v: at.interest }] : []),
    ...(Math.abs(at.external) >= 1 ? [{ name: 'واریز و برداشت', v: at.external }] : []),
    ...(Math.abs(at.edits) >= 1 ? [{ name: 'ثبت و ویرایش دستی', v: at.edits }] : [])];
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.v)));
  // the coins' part of this period: how much was gold (ounce × dollar) and how much their bubble
  const split = BB.coinMoveSplit(at, st.quotes);
  const showSplit = split && Math.abs(split.total) >= 1 && Math.abs(split.bubble) >= Math.max(1, Math.abs(split.total) * 0.05);
  return html`<div class="card">${head}
    <div class="why">
      <div>
        <div class="lead">${lead} قیمت‌ها و سودها دارایی‌ات را <b class=${up ? 'pos' : 'neg'}><span class="ltr">${pct(base ? ret / base : 0)}</span></b> (<${Money} v=${ret} s=${s} compact sign />) ${up ? 'بیشتر' : 'کمتر'} کردند.
          ${top ? html` بیشترین اثر قیمت را <b>${top.name}</b> داشت (<${Money} v=${top.price} s=${s} compact sign />).` : ''}
          ${Math.abs(moved) >= 10 ? html`<div class="small muted" style="margin-top:4px">جدا از آن، <${Money} v=${moved} s=${s} compact sign /> پول جابه‌جا یا ثبت شد؛ پس کل ارزش خالص <${Money} v=${at.total} s=${s} compact sign /> عوض شد.</div>` : ''}
          ${showSplit ? html`<div class="small muted" style="margin-top:4px" title="تقریبی: قیمت سکه، انس و دلار در لحظه‌های کمی متفاوت ثبت می‌شوند">از این، سکه‌هایت <${Money} v=${split.total} s=${s} compact sign />: <${Money} v=${split.gold} s=${s} compact sign /> از قیمت طلا و <b class=${split.bubble >= 0 ? 'pos' : 'neg'}><${Money} v=${split.bubble} s=${s} compact sign /></b> از ${split.bubble >= 0 ? 'بزرگ‌تر شدن' : 'کوچک‌تر شدن'} حباب.</div>` : ''}
          ${at.est ? html`<div class="xs muted">مبنای مقایسه بازسازی‌شده است.</div>` : ''}</div>
        <div class="split">
          <div class="pcell"><span class="n">تغییر قیمت</span><span class=${'v ' + (at.price >= 0 ? 'pos' : 'neg')}><${Money} v=${at.price} s=${s} compact sign /></span></div>
          <div class="pcell"><span class="n">سود</span><span class=${'v ' + (at.interest >= 0 ? 'pos' : 'neg')}><${Money} v=${at.interest} s=${s} compact sign /></span></div>
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

/** Four cards, each a number, what it means, and the next step. Logic: lib/insights.js (inflationCard, liquidityCard,
 *  incomeCard, attentionItems). */
function Kpis({ st, pf, s, open }) {
  const inf = I.inflationCard(st, pf), liq = I.liquidityCard(pf), inc = I.incomeCard(st);
  const att = I.attentionItems(st, pf);
  const attN = att.reduce((t, it) => t + (it.n || 1), 0);
  const [allAtt, setAllAtt] = useState(false);
  const p0 = (x) => pct(x, { sign: false, digits: 0 });
  const pts = (d) => { const v = Math.abs(d * 100); return v < 0.5 ? null : `${num(v, v < 10 ? 1 : 0).replace(/[.٫]0$/, '')} واحد ${d > 0 ? 'بیشتر' : 'کمتر'} از ماه پیش`; };
  let autoVal = 0;
  for (const r of pf.rows) if (!r.cat.liability && (r.status === 'live' || r.status === 'auto' || r.status === 'matured' || r.status === 'delayed' || (r.source !== 'manual' && r.status === 'error'))) autoVal += r.value;
  const g = pf.gross || 1;
  const badge = (tone, text) => html`<span class=${'kb ' + tone}>${text}</span>`;
  const goAtt = (it) => (it.assetId ? open(st.assets.find((a) => a.id === it.assetId)) : (location.hash = it.href));
  const tierColor = { high: '#14BCDB', mid: '#8E70FF', low: 'var(--line-2)' };
  return html`<div class="kpis ov">
    <div class="kpi">
      <div class="kh"><span class="t"><${Icon} n="shield" cls="sm" />محافظت در برابر تورم</span>
        ${inf?.status === 'ok' ? badge('pos', 'در حد هدف') : inf?.status === 'near' ? badge('warn', 'نزدیک هدف') : inf?.status === 'below' ? badge('warn', `${num(Math.ceil((inf.target - inf.share) * 100 - 1e-9))} واحد زیر هدف`) : ''}</div>
      ${inf ? html`
        <div class="kv"><span class="v num">${p0(inf.share)}</span>${inf.delta !== null && html`<span class=${'kd ' + (pts(inf.delta) ? (inf.delta > 0 ? 'pos' : 'neg') : 'muted')}>${pts(inf.delta) || 'تقریباً بدون تغییر از ماه پیش'}</span>`}</div>
        <div class="kbar">
          <div class="segs">${[...inf.parts, { key: 'rial', name: 'ریالی (بی‌محافظ)', color: 'var(--line-2)', value: inf.unprotectedShare * pf.gross, share: inf.unprotectedShare }].filter((x) => x.share > 0)
            .map((x) => html`<i title=${`${x.name}: ${p0(x.share)}`} style=${`flex:${x.share};background:${x.color}`}></i>`)}</div>
          ${inf.target !== null && html`<span class="tgt" style=${`right:${inf.target * 100}%`} title="هدف از «تخصیص هدف» در تحلیل"></span><span class="tgl" style=${`right:${inf.target * 100}%`}>هدف ${p0(inf.target)}</span>`}
        </div>
        <div class="klg">${inf.parts.slice(0, 4).map((x) => html`<span><i style=${`background:${x.color}`}></i>${x.name} ${p0(x.share)}</span>`)}</div>
        <div class="kf">${inf.unprotected.length ? html`<b>بی‌محافظ ${p0(inf.unprotectedShare)}:</b> ${inf.unprotected.slice(0, 2).map((u) => `${u.name} ${p0(u.share)}`).join(' و ')}${inf.unprotected.length > 2 ? ' و …' : ''}` : 'همه دارایی‌ها در برابر تورم محافظت شده‌اند'}</div>`
      : html`<span class="v">—</span>`}
    </div>

    <div class="kpi">
      <div class="kh"><span class="t"><${Icon} n="droplet" cls="sm" />نقدشوندگی</span></div>
      ${liq ? html`
        <div class="kv"><span class="v num">${p0(liq.share)}</span><span class="kd muted">در چند روز نقد می‌شود</span></div>
        <div class="kbar"><div class="segs">${['high', 'mid', 'low'].map((k) => liq.tiers[k]).map((t, i) => t.share > 0 && html`<i title=${`${t.name}: ${money(t.value, s, { compact: true })}${t.names.length ? ' — ' + t.names.join('، ') : ''}`} style=${`flex:${t.share};background:${tierColor[['high', 'mid', 'low'][i]]}`}></i>`)}</div></div>
        <div class="klg">${['high', 'mid', 'low'].map((k) => html`<span title=${liq.tiers[k].names.join('، ')}><i style=${`background:${tierColor[k]}`}></i>${liq.tiers[k].name} ${p0(liq.tiers[k].share)}</span>`)}</div>
        <div class="kf"><b>اگر پول لازم شد:</b> <${Money} v=${liq.high} s=${s} compact /> در چند روز در دسترس است</div>`
      : html`<span class="v">—</span>`}
    </div>

    <div class="kpi">
      <div class="kh"><span class="t"><${Icon} n="zap" cls="sm" />درآمد خودکار ماهانه</span></div>
      ${inc.total > 0 || inc.next ? html`
        <div class="kv">${inc.total > 0 ? html`<span class="v"><${Money} v=${inc.total} s=${s} compact /></span><span class="kd muted">در ماه</span>` : html`<span class="v">—</span><span class="kd muted">سود یا درآمد تکراری ثبت نشده</span>`}</div>
        <div class="klg">${inc.interest > 0 && html`<span><i style="background:var(--accent)"></i>سود <${Money} v=${inc.interest} s=${s} compact unit=${false} /></span>`}${inc.inflow > 0 && html`<span><i style="background:var(--cyan)"></i>درآمد تکراری <${Money} v=${inc.inflow} s=${s} compact unit=${false} /></span>`}</div>
        <div class="kf">${inc.next ? html`<b>واریز بعدی ${fmtJ(inc.next.date)}:</b> ${inc.next.title}، <${Money} v=${inc.next.amount} s=${s} compact />${inc.next.estimate ? ' (تقریبی)' : ''}` : 'در ۴۵ روز آینده واریز خودکاری ثبت نشده'}</div>`
      : html`<span class="v">—</span><div class="kf">سود سپرده‌ها و درآمدهای تکراری را در <a href="#/automation">خودکارسازی</a> ثبت کن تا اینجا حساب شود.</div>`}
    </div>

    <div class=${'kpi' + (att.length ? ' hot' : '')}>
      <div class="kh"><span class="t"><${Icon} n="bell" cls="sm" />نیاز به توجه</span>${att.length ? html`<span class="kb solid num">${num(attN)} مورد</span>` : badge('pos', 'مرتب')}</div>
      ${att.length ? html`<div class="katt">${(allAtt ? att : att.slice(0, 3)).map((it) => html`<button class="ka" onClick=${() => goAtt(it)}><i class=${it.tone}></i><span class="grow">${it.text}</span><${Icon} n="chevronLeft" cls="sm" /></button>`)}
          ${att.length > 3 && html`<button class="kmore" onClick=${() => setAllAtt(!allAtt)}>${allAtt ? 'کمتر' : `و ${num(att.length - 3)} مورد دیگر`}</button>`}</div>`
        : html`<div class="kf" style="border:0;padding:0;margin:0">همه‌چیز به‌روز است و در هفته پیش رو قسط یا سررسیدی نیست.</div>`}
      <div class="kf"><div class="kmini"><i style=${`width:${Math.round(autoVal / g * 100)}%`}></i></div>${p0(autoVal / g)} ارزش دارایی‌ها خودکار به‌روز می‌شود</div>
    </div>
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
        <span class="an"><i style=${'background:' + c.color}></i><span class="ellipsis">${c.short || c.name}</span></span>
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
      <div class="row" style="margin-top:8px"><a class="btn sm" href="#/assistant?tab=reports">خواندن کامل</a><button class="btn sm ghost" onClick=${make} disabled=${busy}><${Icon} n="refresh" cls=${'sm' + (busy ? ' spin' : '')} />ساخت گزارش</button></div>`
      : html`<div class="empty small" style="padding:16px">هر جمعه عصر یک گزارش کوتاه از تغییرات هفته ساخته می‌شود.<div style="margin-top:10px"><button class="btn sm primary" onClick=${make} disabled=${busy}>${busy ? 'در حال ساخت…' : 'ساخت گزارش'}</button></div></div>`}
  </div>`;
}

/** What's coming in the next 14 days. Things to act on are in the «نیاز به توجه» card above. */
function Upcoming({ st, s }) {
  const up = E.upcoming(st.assets, st.flows, 14).slice(0, 6);
  const byId = Object.fromEntries(st.assets.map((a) => [a.id, a]));
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="calendar" cls="sm" />پیش رو</h3><span class="sub">۱۴ روز آینده</span></div>
    <div class="list">
      ${up.map((e) => html`<div class="it">
        <span class="ava" style="background:var(--accent-soft);color:var(--accent)"><${Icon} n=${e.kind === 'interest' ? 'percent' : e.kind === 'maturity' ? 'clock' : e.kind === 'loan' ? 'calendar' : 'repeat'} /></span>
        <div class="grow"><div class="sb ellipsis">${e.title}</div><div class="xs muted">${fmtJ(e.date)}${e.toId && byId[e.toId] && e.toId !== e.assetId ? '، به ' + byId[e.toId].name : ''}${e.estimate ? '، تخمینی' : ''}</div></div>
        <span class="small sb"><${Money} v=${e.amount} s=${s} compact /></span></div>`)}
      ${!up.length && html`<div class="empty"><div class="ico"><${Icon} n="check" /></div>در دو هفته آینده رویداد خودکاری نیست.</div>`}
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
    <${Kpis} st=${st} pf=${pf} s=${s} open=${open} />
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
    onVis(); // loaded with another Dara tab open: the update waits for a click here instead of closing that tab
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
  return html`<div class="update-bar"><${Icon} n="sparkles" cls="sm" /><span class="grow">نسخه تازه دارا (${verFa(v)}) آماده است. اگر چیزی در حال نوشتنش نیستی، «به‌روزرسانی» را بزن؛ صفحه‌های باز دارا دوباره باز می‌شوند و داده‌ها دست نمی‌خورد.</span>
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
      // a form or dialog is already open: its keys belong to it (never swap the asset being edited for a blank one)
      if (document.querySelector('.drawer, .modal, .scrim')) return;
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
        <div class="row between xs" style="margin-top:4px"><span class="muted" title="تغییر قیمت‌ها و سودها؛ پول جابه‌جاشده حساب نشده">امروز</span><${Delta} p=${todayMove?.pct} showAbs=${false} /></div>
      </div>
    </aside>
    <main class="main">
      <${UpdateBanner} />
      <div class="topbar">
        <h1>${cur.t}</h1>
        <span class="grow"></span>
        ${page === 'assets' && html`<label class="search"><${Icon} n="search" cls="sm" /><input class="input" placeholder="جست‌وجوی دارایی، بانک، نماد…" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>`}
        <span class="topstatus"><${StatusChip} st=${st} /></span>
        <button class="btn icon" title="به‌روزرسانی قیمت‌ها" onClick=${refresh} disabled=${busy}><${Icon} n="refresh" cls=${busy ? 'spin' : ''} /></button>
        <button class="btn icon" title=${s.privacy ? 'نمایش مبالغ' : 'پنهان‌کردن مبالغ'} onClick=${() => act.setSettings({ privacy: !s.privacy })}><${Icon} n=${s.privacy ? 'eyeOff' : 'eye'} /></button>
        <button class="btn icon" title="تغییر تم" onClick=${() => act.setSettings({ theme: themeNext })}><${Icon} n=${s.theme === 'dark' ? 'moon' : s.theme === 'light' ? 'sun' : 'monitor'} /></button>
        <button class="btn primary newbtn" aria-label="دارایی جدید" onClick=${() => setEditing({})}><${Icon} n="plus" /><span class="t">دارایی جدید</span></button>
      </div>
      ${page === 'overview' && html`<${Overview} ...${ctx} />`}
      ${page === 'assets' && html`<${AssetsPage} ...${ctx} />`}
      ${page === 'assistant' && html`<${AssistantPage} ...${ctx} />`}
      ${page === 'market' && html`<${MarketPage} ...${ctx} />`}
      ${page === 'automation' && html`<${AutomationPage} ...${ctx} />`}
      ${page === 'analysis' && html`<${AnalysisPage} ...${ctx} />`}
      ${page === 'calc' && html`<${CalcPage} ...${ctx} />`}
      ${page === 'settings' && html`<${SettingsPage} ...${ctx} />`}
      ${page === 'welcome' && html`<${WelcomePage} ...${ctx} />`}
      ${page === 'capture' && html`<${CapturePage} ...${ctx} />`}
    </main>
    ${editing && html`<${AssetEditor} key=${editing.asset?.id || "new"} st=${st} s=${s} asset=${editing.asset} preset=${editing.preset} onClose=${() => setEditing(null)} />`}
    <${Toasts} />
  </div>`;
}

if (await U.checkOnLoad()) document.getElementById('app').innerHTML = '<div style="display:grid;place-items:center;height:100vh;color:#8C93A8">در حال نصب نسخه جدید دارا…</div>';
else render(html`<${App} />`, document.getElementById('app'));
