import { html, render, useState, useMemo, useStore, useTick, Icon, Money, Delta, Seg, StackBar, StatusPill, send, num, money, pct, Toasts, toast, refLabel } from './components.js';
import * as I from '../lib/insights.js';
import * as E from '../lib/engine.js';
import { ago, parseNum, groupTyping, getDigits } from '../lib/format.js';
import { act } from './actions.js';
import { ProposalCard } from './proposals.js';
import * as AI from '../lib/ai.js';
import * as A from '../lib/assistant.js';
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
  const unit = s.currency === 'rial' ? 'ریال' : 'تومان';
  const save = async () => {
    const v = parseNum(txt);
    if (!isFinite(v) || v < 0) return toast('یک عدد مثبت بنویس؛ مثلاً ۱۲ میلیون و ۵۰۰ هزار');
    if (a.mode === 'balance') await act.patchAsset(a.id, { balance: v * k, balanceAt: Date.now() });
    else await act.patchAsset(a.id, { price: { ...a.price, value: v * k, updatedAt: Date.now() } });
    setTxt(''); toast(`«${a.name}» به‌روز شد`); send('badge');
  };
  // live thousands separators (amounts typed in words stay as typed)
  const onIn = (e) => { const v = e.target.value; setTxt(/[آ-ی]/.test(v) ? v : (getDigits() === 'fa' ? groupTyping(v).replace(/,/g, '٬') : groupTyping(v))); };
  const ph = a.mode === 'balance' ? (E.APPRAISED.has(a.category) ? `ارزش جدید (${unit})` : `مانده جدید (${unit})`) : `قیمت هر واحد (${unit})`;
  return html`<div class="pp-row">
    <div class="grow" style="min-width:0"><div class="sb ellipsis" title=${a.name}>${r.status === 'stale' && html`<span class="warn" title="مدتی به‌روز نشده">● </span>`}${a.name}</div><div class="xs muted">${a.mode === 'balance' ? 'مانده' : 'قیمت واحد'}: <${Money} v=${cur} s=${s} unit=${false} />، ${ago(r.at)}</div></div>
    <input class="input num-in qin" placeholder=${ph} title=${ph} value=${txt} onInput=${onIn} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    <button class="btn icon sm" disabled=${!txt} onClick=${save}><${Icon} n="check" cls="sm" /></button>
  </div>`;
}

/** «ثبت با یک جمله»: one sentence → reviewed changes, applied only after confirmation. */
function QuickEntry({ st, s }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null); // {proposals, problems, question}
  const conns = AI.orderedConnections(st.ai);
  const go = async () => {
    const t = text.trim(); if (!t || busy) return;
    if (!conns.length) { toast('برای ثبت با یک جمله، اول یک اتصال هوش مصنوعی اضافه کن'); openApp('#/settings'); return; }
    setBusy(true); setRes(null);
    try {
      const r = await AI.extract({ ai: st.ai, system: A.quickSystem(), prompt: A.quickPrompt(t, st.assets), maxTokens: 900 });
      const out = A.quickProposals(r.json, st.assets, st.quotes);
      if (!out.proposals.length && !out.problems.length && !out.question) out.question = 'از این جمله تغییری پیدا نشد؛ مثلاً بنویس «۲ گرم طلا خریدم گرمی ۲۵ میلیون از حساب الف».';
      setRes(out);
    } catch (e) { setRes({ proposals: [], problems: [e.message], question: null }); }
    setBusy(false);
  };
  const setStatus = (id, status) => setRes((r) => {
    const proposals = r.proposals.map((p) => (p.id === id ? { ...p, status } : p));
    if (proposals.every((p) => p.status)) setTimeout(() => { setRes(null); setText(''); }, 1200);
    return { ...r, proposals };
  });
  return html`<div class="pp-quick">
    <div class="row" style="gap:6px">
      <input class="input" placeholder="ثبت با یک جمله: «۲ گرم طلا خریدم گرمی ۲۵ میلیون»" value=${text} disabled=${busy}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && go()} />
      <button class="btn icon sm primary" title="بررسی" disabled=${!text.trim() || busy} onClick=${go}><${Icon} n=${busy ? 'refresh' : 'sparkles'} cls=${'sm' + (busy ? ' spin' : '')} /></button>
    </div>
    ${res && html`<div class="col" style="gap:6px;margin-top:4px">
      ${res.proposals.map((p) => html`<${ProposalCard} key=${p.id} p=${p} st=${st} s=${s} onStatus=${(stt) => setStatus(p.id, stt)} />`)}
      ${res.problems.map((m) => html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>${m}</div></div>`)}
      ${res.question && html`<div class="callout"><${Icon} n="info" cls="sm" /><div>${res.question}</div></div>`}
    </div>`}
    ${!res && !busy && html`<div class="xs faint" style="margin-top:4px">${conns.length ? 'قبل از ثبت، تغییر را برای تأیید نشانت می‌دهد. فقط نام دارایی‌ها فرستاده می‌شود، نه مبلغ‌ها.' : 'برای این قابلیت یک اتصال هوش مصنوعی لازم است.'}</div>`}
  </div>`;
}

function Popup() {
  const st = useStore();
  const [tab, setTab] = useState('prices');
  const [busy, setBusy] = useState(false);
  useTick(15000);
  const pf = useMemo(() => (st ? E.portfolio(st.assets, st.quotes, st.settings) : null), [st?.assets, st?.quotes, st?.settings, Math.floor(Date.now() / 15000)]);
  if (!st) return html`<div class="pp muted">…</div>`;
  const s = st.settings;
  const rates = E.denomRates(st.quotes);
  const d1 = I.marketMove(st, pf, 1) || { abs: pf.dayChange, pct: pf.dayChangePct };
  const cats = pf.cats.filter((c) => !c.liability);
  const manual = pf.rows.filter((r) => r.asset.mode === 'balance' || (r.asset.mode === 'units' && r.asset.price?.source !== 'market'))
    .sort((a, b) => (b.status === 'stale') - (a.status === 'stale') || b.value - a.value);
  const refresh = async () => { setBusy(true); const r = await send('refresh'); setBusy(false); toast(r?.ok ? 'قیمت‌ها به‌روز شد' : 'خطا در به‌روزرسانی'); };
  const att = pf.attention.length;

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
      <button class="btn icon sm ghost" title="دارایی جدید" aria-label="دارایی جدید" onClick=${() => openApp('#/assets?new=1')}><${Icon} n="plus" cls="sm" /></button>
      <button class="btn sm" onClick=${() => openApp('#/overview')}><${Icon} n="overview" cls="sm" />داشبورد</button>
    </div>

    <div class="pp-hero">
      <div class="l">ارزش خالص دارایی‌ها</div>
      <div class="v num"><${Money} v=${pf.net} s=${s} compact=${s.compact} unit=${false} /><span class="u">${s.currency === 'rial' ? 'ریال' : 'تومان'}</span></div>
      ${s.compact && html`<div class="f num"><${Money} v=${pf.net} s=${s} /></div>`}
      <div class="r">
        <span title="اثر قیمت بازار؛ پول جدید جدا حساب شده">امروز <${Delta} p=${d1.pct} abs=${d1.abs} s=${s} /></span>
        ${rates.usd && html`<span>≈ <b class="money"><span class="n"><span class="ltr">${num(pf.net / rates.usd)}</span></span></b> دلار</span>`}
        ${rates.gold && html`<span>≈ <b class="money"><span class="n"><span class="ltr">${num(pf.net / rates.gold, 1)}</span></span></b> گرم طلا</span>`}
      </div>
    </div>

    <div class="pp-card">
      <${StackBar} items=${cats.map((c) => ({ name: c.name, value: c.value, color: c.color }))} height=${8} />
      <div class="pp-leg">${cats.slice(0, 6).map((c) => html`<span><i style=${'background:' + c.color}></i>${c.short} <b class="num">${pct(c.share, { sign: false, digits: 0 })}</b></span>`)}</div>
    </div>

    <${QuickEntry} st=${st} s=${s} />
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
