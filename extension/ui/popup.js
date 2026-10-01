import { html, render, useState, useMemo, useStore, useTick, Icon, Money, Delta, Seg, StackBar, StatusPill, send, num, money, pct, Toasts, toast, refLabel } from './components.js';
import * as E from '../lib/engine.js';
import { ago, parseNum } from '../lib/format.js';
import { act } from './actions.js';
import * as U from '../lib/update.js';

const PRICES = [['tgju', 'geram18'], ['tgju', 'sekee'], ['tgju', 'nim'], ['tgju', 'price_dollar_rl'], ['tgju', 'price_eur'], ['nobitex', 'usdt'], ['nobitex', 'btc']];
const openApp = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html' + hash) });
async function captureCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return toast('صفحه‌ای پیدا نشد');
  const r = await send('capture', { tabId: tab.id });
  if (!r?.ok) toast(r?.error || 'خواندن صفحه ممکن نشد'); else window.close();
}

function QuickRow({ r, s }) {
  const a = r.asset; const k = s.currency === 'rial' ? 1 : 10;
  const cur = a.mode === 'balance' ? r.value : r.unitPrice;
  const [txt, setTxt] = useState('');
  const save = async () => {
    const v = parseNum(txt); if (!isFinite(v) || v < 0) return;
    if (a.mode === 'balance') await act.patchAsset(a.id, { balance: v * k, balanceAt: Date.now() });
    else await act.patchAsset(a.id, { price: { ...a.price, value: v * k, updatedAt: Date.now() } });
    setTxt(''); toast(`«${a.name}» به‌روز شد`); send('badge');
  };
  return html`<div class="pp-row">
    <div class="grow" style="min-width:0"><div class="sb ellipsis">${a.name}</div><div class="xs muted">${a.mode === 'balance' ? 'مانده' : 'قیمت واحد'}: <${Money} v=${cur} s=${s} unit=${false} />، ${ago(r.at)}</div></div>
    ${r.status === 'stale' && html`<${StatusPill} status="stale" />`}
    <input class="input num-in qin" placeholder="مقدار جدید" value=${txt} onInput=${(e) => setTxt(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    <button class="btn icon sm" disabled=${!txt} onClick=${save}><${Icon} n="check" cls="sm" /></button>
  </div>`;
}

function Popup() {
  const st = useStore();
  const [tab, setTab] = useState('prices');
  const [busy, setBusy] = useState(false);
  useTick(15000);
  const pf = useMemo(() => (st ? E.portfolio(st.assets, st.quotes, st.settings) : null), [st, Math.floor(Date.now() / 15000)]);
  if (!st) return html`<div class="pp muted">…</div>`;
  const s = st.settings;
  const rates = E.denomRates(st.quotes);
  const d1 = E.changeSince(st.snapshots, 1, pf.net) || { abs: pf.dayChange, pct: pf.dayChangePct };
  const cats = pf.cats.filter((c) => !c.liability);
  const manual = pf.rows.filter((r) => r.asset.mode === 'balance' || (r.asset.mode === 'units' && r.asset.price?.source !== 'market'))
    .sort((a, b) => (b.status === 'stale') - (a.status === 'stale') || b.value - a.value);
  const refresh = async () => { setBusy(true); const r = await send('refresh'); setBusy(false); toast(r?.ok ? 'قیمت‌ها به‌روز شد' : 'خطا در به‌روزرسانی'); };
  const att = pf.attention.length;
  const big = money(pf.net, s, { compact: s.compact, unit: false });

  if (!st.assets.length) return html`<div class="pp">
    <div class="pp-h"><span class="logo"><${Icon} n="layers" /></span><span class="nm grow">دارا</span></div>
    <div class="pp-hero"><div class="l">به دارا خوش آمدی</div><div style="font-size:17px;font-weight:800;margin:6px 0">دارایی‌هایت را یک‌بار وارد کن؛ بقیه‌اش خودکار است.</div>
      <button class="btn" style="margin-top:8px" onClick=${() => openApp('#/welcome')}>شروع</button></div>
  </div>`;

  return html`<div class="pp">
    <div class="pp-h">
      <span class="logo"><${Icon} n="layers" /></span><span class="nm grow">دارا</span>
      <button class="btn icon sm ghost" title=${s.privacy ? 'نمایش مبالغ' : 'پنهان‌کردن مبالغ'} onClick=${() => act.setSettings({ privacy: !s.privacy })}><${Icon} n=${s.privacy ? 'eyeOff' : 'eye'} cls="sm" /></button>
      <button class="btn icon sm ghost" title="به‌روزرسانی قیمت‌ها" onClick=${refresh} disabled=${busy}><${Icon} n="refresh" cls=${'sm' + (busy ? ' spin' : '')} /></button>
      <button class="btn sm" onClick=${() => openApp('#/overview')}><${Icon} n="overview" cls="sm" />داشبورد</button>
    </div>

    <div class="pp-hero">
      <div class="l">ارزش خالص دارایی‌ها</div>
      <div class="v num"><span class="money"><span class="n">${big}</span></span><span class="u">${s.currency === 'rial' ? 'ریال' : 'تومان'}</span></div>
      ${s.compact && html`<div class="f num money"><span class="n">${money(pf.net, s)}</span></div>`}
      <div class="r">
        <span>امروز <${Delta} p=${d1.pct} abs=${d1.abs} s=${s} /></span>
        ${rates.usd && html`<span>≈ <b class="money"><span class="n">${num(pf.net / rates.usd)}</span></b> دلار</span>`}
        ${rates.gold && html`<span>≈ <b class="money"><span class="n">${num(pf.net / rates.gold, 1)}</span></b> گرم طلا</span>`}
      </div>
    </div>

    <div class="pp-card">
      <${StackBar} items=${cats.map((c) => ({ name: c.name, value: c.value, color: c.color }))} height=${8} />
      <div class="pp-leg">${cats.slice(0, 6).map((c) => html`<span><i style=${'background:' + c.color}></i>${c.short} <b class="num">${pct(c.share, { sign: false, digits: 0 })}</b></span>`)}</div>
    </div>

    <button class="btn" style="justify-content:flex-start" onClick=${captureCurrent} title="موجودی‌های همین صفحه (بانک، کارگزاری، طلای آنلاین، صرافی) را بخوان"><${Icon} n="scan" cls="sm" />ثبت موجودی از این صفحه<span class="grow"></span><span class="xs muted">${st.ai.connections?.length ? 'با هوش مصنوعی' : 'دستی'}</span></button>
    ${att > 0 && html`<button class="callout warn" style="border:0;cursor:pointer;text-align:right" onClick=${() => setTab('quick')}><${Icon} n="alert" cls="sm" /><div><b class="num">${num(att)}</b> دارایی نیاز به به‌روزرسانی دارد — به‌روزرسانی سریع</div></button>`}

    <div class="pp-tabs"><${Seg} value=${tab} onChange=${setTab} options=${[['prices', 'قیمت‌های لحظه‌ای'], ['quick', `به‌روزرسانی سریع (${num(manual.length)})`]]} /></div>

    <div class="pp-card" style="padding:4px 12px">
      ${tab === 'prices' && PRICES.map(([p, k]) => {
        const q = st.quotes[`${p}:${k}`];
        return html`<div class="pp-row"><span class="grow sb">${refLabel({ provider: p, key: k })}</span>
          <span class="num"><${Money} v=${q?.price || null} s=${s} /></span>
          <span style="width:62px;text-align:left" class="small"><${Delta} p=${q?.changePct} showAbs=${false} /></span></div>`;
      })}
      ${tab === 'quick' && (manual.length ? manual.slice(0, 8).map((r) => html`<${QuickRow} key=${r.asset.id} r=${r} s=${s} />`) : html`<div class="empty small">همه دارایی‌ها خودکار به‌روز می‌شوند 🎉</div>`)}
    </div>

    <div class="pp-f">
      <span>${st.meta.lastRun ? 'آخرین به‌روزرسانی ' + ago(st.meta.lastRun) : 'در انتظار اولین به‌روزرسانی'}${st.meta.errCount ? html`، <span class="warn">${num(st.meta.errCount)} خطا</span>` : ''}</span>
      <a href="#" onClick=${(e) => { e.preventDefault(); openApp('#/assets'); }}>همه دارایی‌ها ←</a>
    </div>
    <${Toasts} />
  </div>`;
}

if (await U.checkOnLoad()) document.getElementById('app').innerHTML = '<div class="pp muted">در حال نصب نسخه جدید…</div>';
else render(html`<${Popup} />`, document.getElementById('app'));
