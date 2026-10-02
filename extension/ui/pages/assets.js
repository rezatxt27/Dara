import { isoFromDate, todayIso } from '../../lib/jalali.js';
import { html, useState, useMemo, useRef, useEffect, Icon, Money, Delta, Ava, StatusPill, refLabel, providerName, Modal, NumField, MoneyField, Seg, AreaChart, toast, send, num, pct, fmtJ, money, Explain, AskBtn } from '../components.js';
import * as I from '../../lib/insights.js';
import { CATEGORIES, CAT, EXPOSURES, LIQUIDITY } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import { ago, parseNum, groupTyping, getDigits, toEnDigits } from '../../lib/format.js';
import { act } from '../actions.js';

/** Quantity column for an installment loan: installment amount and progress. */
function loanCell(a, s) {
  const ls = E.loanState(a.loan);
  if (ls.done) return html`<span class="muted">${num(ls.n)} قسط</span>`;
  return html`<div><span class="muted">قسط: </span><${Money} v=${ls.next.payment} s=${s} compact unit=${false} /></div><div class="xs muted">${num(ls.paid)} از ${num(ls.n)} پرداخت شده</div>`;
}

/** Search text: Arabic ي/ك as Persian, digits as Latin, no case, no half-spaces. */
const norm = (x) => toEnDigits(String(x ?? '')).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\u200f\u200e]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function SourceLine({ r }) {
  const a = r.asset;
  if (a.mode === 'loan') {
    const ls = E.loanState(a.loan);
    return html`<div class="src"><${Icon} n="calendar" cls="sm" />${ls.done ? 'تسویه شده' : `قسطی ${num(+a.loan.annualPct || 0, 2)}٪، قسط بعدی ${fmtJ(ls.next.date, 'dm')}`}</div>`;
  }
  if (a.mode === 'rate' && r.status === 'matured') return html`<div class="src warn"><${Icon} n="alert" cls="sm" />سررسید ${fmtJ(a.rate.maturity)}</div>`;
  if (a.mode === 'rate') return html`<div class="src"><${Icon} n="percent" cls="sm" />روزشمار ${num(a.rate?.annualPct, 2)}٪، ${a.rate?.mode === 'payout' ? 'سود ماهانه' : a.rate?.mode === 'compound' ? 'مرکب' : 'ساده'}</div>`;
  if (a.mode === 'balance') return html`<div class="src"><${Icon} n=${a.interest?.on ? 'percent' : 'edit'} cls="sm" />${a.interest?.on ? `مانده + سود روزشمار ${num(a.interest.annualPct, 2)}٪` : 'مانده دستی'}، ${ago(r.at)}</div>`;
  if (a.price?.source === 'market') {
    const ref = a.price.ref || {};
    const pending = ref.provider === 'tsetmc' && !ref.key;
    return html`<div class="src" title=${r.error || r.note || ''}><${Icon} n=${r.status === 'error' ? 'wifi' : 'live'} cls="sm" />${providerName(ref.provider)}، ${refLabel(ref)}${a.price.adjustPct ? html` <span class="ltr">(${a.price.adjustPct > 0 ? '+' : ''}${num(a.price.adjustPct, 2)}٪)</span>` : ''}${pending ? '، در انتظار شناسایی نماد' : ''}${r.note ? html`، <span class="approx" title=${r.note}>${r.quote?.approx ? 'تقریبی' : r.note}</span>` : ''}</div>`;
  }
  return html`<div class="src"><${Icon} n="edit" cls="sm" />قیمت دستی، ${ago(r.at)}</div>`;
}

/** Click-to-edit money cell for manual prices & balances (live separators, Enter to save, Esc to cancel) */
function InlineMoney({ value, s, onSave, children }) {
  const [ed, setEd] = useState(false);
  const [txt, setTxt] = useState('');
  const k = s.currency === 'rial' ? 1 : 10;
  const ref = useRef();
  const sep = (g) => (getDigits() === 'fa' ? g.replace(/,/g, '٬') : g);
  useEffect(() => { if (ed) { ref.current?.focus(); ref.current?.select(); } }, [ed]);
  if (!ed) return html`<span class="editable" title="برای ویرایش کلیک کن" onClick=${(e) => { e.stopPropagation(); setTxt(sep(groupTyping(String(Math.round(value / k))))); setEd(true); }}>${children}</span>`;
  const commit = () => { const v = parseNum(txt); if (isFinite(v) && v >= 0 && Math.round(v * k) !== Math.round(value)) onSave(v * k); setEd(false); };
  return html`<input ref=${ref} class="input num-in" style="height:30px;width:160px" value=${txt} onClick=${(e) => e.stopPropagation()}
    onInput=${(e) => setTxt(sep(groupTyping(e.target.value)))} onKeyDown=${(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEd(false); }} onBlur=${commit} />`;
}

function TradeModal({ st, s, asset, onClose }) {
  const unitPrice = E.unitPriceOf(asset, st.quotes).price;
  const [side, setSide] = useState('buy');
  const [qty, setQty] = useState(null);
  const [price, setPrice] = useState(unitPrice || null);
  const cashes = st.assets.filter((a) => a.mode === 'balance' && a.category === 'bank' && !a.archived);
  const [cashId, setCashId] = useState('');
  const amount = (qty || 0) * (price || 0);
  const tooMuch = side === 'sell' && qty > (+asset.quantity || 0) + 1e-9;
  const cash = cashes.find((c) => c.id === cashId);
  const short = side === 'buy' && cash && amount > (+cash.balance || 0) + 0.5;
  const save = async () => {
    if (!(qty > 0) || !(price > 0)) return toast('مقدار و قیمت را وارد کن');
    if (tooMuch) return toast('مقدار فروش بیشتر از موجودی است');
    await act.trade({ assetId: asset.id, side, qty, price, cashId: cashId || null });
    toast(`${side === 'buy' ? 'خرید' : 'فروش'} ثبت شد`); onClose();
  };
  return html`<${Modal} title=${`خرید یا فروش — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" onClick=${save}>ثبت</button>`}>
    <${Seg} value=${side} onChange=${setSide} options=${[['buy', 'خرید'], ['sell', 'فروش']]} />
    <div class="grid2"><${NumField} label=${`مقدار (${asset.unit || 'واحد'})`} value=${qty} onInput=${setQty} autoFocus err=${tooMuch} hint=${side === 'sell' ? `موجودی: ${num(asset.quantity, 'auto')}` : ''} />
    <${MoneyField} label="قیمت هر واحد" rial=${price} onRial=${setPrice} s=${s} prev=${unitPrice} /></div>
    <div class="field"><label>${side === 'buy' ? 'پرداخت از حساب' : 'واریز به حساب'} (اختیاری)</label>
      <select class="input" value=${cashId} onChange=${(e) => setCashId(e.target.value)}><option value="">— ثبت نشود —</option>${cashes.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
      ${short && html`<span class="hint warn">مانده این حساب (<${Money} v=${cash.balance} s=${s} />) کافی نیست؛ اگر ثبت کنی منفی می‌شود.</span>`}</div>
    <div class="preview"><span class="muted">مبلغ معامله</span><span class="v"><${Money} v=${amount} s=${s} /></span></div>
  </${Modal}>`;
}

function AdjustModal({ s, asset, onClose }) {
  const [dir, setDir] = useState('in'); const [amt, setAmt] = useState(null); const [note, setNote] = useState('');
  const liab = CAT[asset.category]?.liability;
  const rate = asset.mode === 'rate';
  const cur = rate ? E.rateValue(asset.rate) : +asset.balance || 0; // what could be withdrawn today
  const tooMuch = dir === 'out' && !liab && amt > cur + 0.5;
  const save = async () => {
    if (!(amt > 0)) return toast('مبلغ را وارد کن');
    if (tooMuch && rate) return toast('برداشت بیشتر از ارزش فعلی است');
    await act.adjust({ assetId: asset.id, delta: dir === 'in' ? amt : -amt, note }); toast('ثبت شد'); onClose();
  };
  return html`<${Modal} title=${`${rate ? 'افزایش یا برداشت اصل' : 'واریز یا برداشت'} — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" onClick=${save}>ثبت</button>`}>
    <${Seg} value=${dir} onChange=${setDir} options=${[['in', liab ? 'پرداخت بدهی' : 'واریز'], ['out', liab ? 'افزایش بدهی' : 'برداشت']]} />
    <${MoneyField} label="مبلغ" rial=${amt} onRial=${setAmt} s=${s} autoFocus />
    <div class=${'xs ' + (tooMuch ? 'neg' : 'muted')}>${rate ? 'ارزش فعلی' : liab ? 'مانده بدهی' : 'مانده فعلی'}: <${Money} v=${cur} s=${s} />${rate ? '. سود مبلغ جدید از امروز حساب می‌شود.' : ''}</div>
    <div class="field"><label>توضیح (اختیاری)</label><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="مثلاً: واریز حقوق مهر" /></div>
  </${Modal}>`;
}

/** Extra payment or early settlement of an installment loan (or an extra repayment received on one you gave). */
function LoanPayModal({ st, s, asset, onClose }) {
  const liab = !!CAT[asset.category]?.liability;
  const ls = E.loanState(asset.loan, todayIso(), Date.now());
  const accounts = st.assets.filter((x) => x.id !== asset.id && !x.archived && (x.mode === 'balance' || x.mode === 'rate') && !CAT[x.category]?.liability);
  const [kind, setKind] = useState('part'); const [amt, setAmt] = useState(null);
  const [acc, setAcc] = useState(asset.loan.account && accounts.some((x) => x.id === asset.loan.account) ? asset.loan.account : '');
  const pay = kind === 'all' ? ls.value : amt || 0;
  const tooMuch = pay > ls.value + 0.5;
  // what the schedule looks like afterwards (same installment, fewer installments)
  const after = useMemo(() => {
    if (!(pay > 0) || tooMuch || kind === 'all') return null;
    const c = structuredClone(asset); E.loanRebase(c, ls.value - pay); return E.loanState(c.loan, todayIso());
  }, [pay, kind]);
  const accObj = accounts.find((x) => x.id === acc);
  const short = liab && accObj && pay > (E.valueOf(accObj, st.quotes, s).value || 0) + 0.5;
  const save = async () => {
    if (!(pay > 0)) return toast('مبلغ را وارد کن');
    if (tooMuch) return toast(liab ? 'بیشتر از مانده وام است' : 'بیشتر از مانده طلب است');
    const amount = kind === 'all' ? E.loanState(asset.loan, todayIso(), Date.now()).value : amt; // settlement: to this very moment
    const note = kind === 'all' ? `تسویه «${asset.name}»` : `${liab ? 'پرداخت اضافه' : 'دریافت اضافه'} «${asset.name}»`;
    if (accObj) await act.transfer(liab ? { fromId: accObj.id, toId: asset.id, amount, note } : { fromId: asset.id, toId: accObj.id, amount, note });
    else await act.adjust({ assetId: asset.id, delta: liab ? amount : -amount, note });
    toast(kind === 'all' ? 'تسویه ثبت شد' : 'ثبت شد'); onClose();
  };
  return html`<${Modal} title=${`${liab ? 'پرداخت اضافه یا تسویه' : 'دریافت اضافه یا تسویه'} — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" onClick=${save}>ثبت</button>`}>
    <${Seg} value=${kind} onChange=${setKind} options=${[['part', liab ? 'پرداخت بخشی از وام' : 'دریافت بخشی از طلب'], ['all', 'تسویه کامل']]} />
    ${kind === 'part' ? html`<${MoneyField} label="مبلغ" rial=${amt} onRial=${setAmt} s=${s} autoFocus err=${tooMuch} />`
      : html`<div class="preview"><span class="muted">مبلغ تسویه امروز (مانده اصل + سود روزهای گذشته)</span><span class="v"><${Money} v=${ls.value} s=${s} /></span></div>`}
    <div class="field"><label>${liab ? 'از حساب' : 'به حساب'} (اختیاری)</label>
      <select class="input" value=${acc} onChange=${(e) => setAcc(e.target.value)}><option value="">— ثبت نشود —</option>${accounts.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
      ${short && html`<span class="hint warn">مانده این حساب کافی نیست؛ اگر ثبت کنی منفی می‌شود.</span>`}</div>
    <div class=${'xs ' + (tooMuch ? 'neg' : 'muted')}>مانده امروز: <${Money} v=${ls.value} s=${s} />${after ? html`. بعد از این، قسط همان <${Money} v=${after.A} s=${s} compact /> می‌ماند و ${num(after.n - after.paid)} قسط باقی می‌ماند.` : ''}</div>
  </${Modal}>`;
}

/** Full installment table: paid ones greyed out. */
function LoanSchedule({ asset, s }) {
  const ls = E.loanState(asset.loan);
  return html`<div class="sched"><table class="tbl small">
    <thead><tr><th>#</th><th>تاریخ</th><th class="n">قسط</th><th class="n">سود</th><th class="n">اصل</th><th class="n">مانده</th></tr></thead>
    <tbody>${ls.rows.map((x) => html`<tr class=${x.k < ls.paid ? 'paid' : x.k === ls.paid ? 'next' : ''}>
      <td class="num">${num(x.k + 1)}</td><td>${fmtJ(x.date, 'dm')} <span class="xs muted">${fmtJ(x.date).split(' ').pop()}</span></td>
      <td class="n"><${Money} v=${x.payment} s=${s} unit=${false} /></td><td class="n"><${Money} v=${x.interest} s=${s} unit=${false} /></td>
      <td class="n"><${Money} v=${x.principal} s=${s} unit=${false} /></td><td class="n"><${Money} v=${x.balance} s=${s} unit=${false} /></td></tr>`)}</tbody></table></div>`;
}

/** New appraisal of a house, car or private shares. By default a market move; or part of it bought or sold. */
function ValueModal({ s, asset, onClose }) {
  const [v, setV] = useState(null); const [why, setWhy] = useState('reval');
  const save = async () => {
    if (!(v >= 0) || v === null) return toast('ارزش جدید را وارد کن');
    await act.patchAsset(asset.id, { balance: v, balanceAt: Date.now() }, { reval: why === 'reval' });
    toast('ارزش جدید ثبت شد'); onClose();
  };
  return html`<${Modal} title=${`ارزش جدید — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" onClick=${save}>ثبت</button>`}>
    <${MoneyField} label="ارزش امروز" rial=${v} onRial=${setV} s=${s} autoFocus prev=${asset.balance} />
    <div class="field"><label>چرا تغییر کرد؟</label><${Seg} value=${why} onChange=${setWhy} options=${[['reval', 'قیمت بازارش عوض شد'], ['money', 'بخشی را خریدم یا فروختم']]} />
      <span class="hint">${why === 'reval' ? 'در «چرا تغییر کرد» و بازده واقعی، سود یا زیان بازار حساب می‌شود.' : 'پول واردشده یا خارج‌شده حساب می‌شود، نه سود.'}</span></div>
  </${Modal}>`;
}

/* ---------------- expanded row ---------------- */
function Expanded({ st, r, s, pf, open, onModal }) {
  const a = r.asset;
  const isMarket = a.mode === 'units' && a.price?.source === 'market' && a.price.ref?.key;
  const [view, setView] = useState('value');
  const [sched, setSched] = useState(false);
  const ls = a.mode === 'loan' ? E.loanState(a.loan) : null;
  const [priceSeries, setPriceSeries] = useState(null);
  const valueSeries = useMemo(() => Object.keys(st.snapshots).sort().slice(-180).map((d) => ({ date: d, value: Math.abs(st.snapshots[d].v?.[a.id] ?? NaN), est: !!st.snapshots[d].est })).filter((p) => isFinite(p.value)), [st.snapshots, a.id]);
  useEffect(() => {
    if (view !== 'price' || !isMarket || priceSeries) return;
    send('history', { ref: a.price.ref, days: 120 }).then((res) => {
      const adj = (1 + (+a.price.adjustPct || 0) / 100) * (+a.price.factor || 1);
      setPriceSeries(res?.ok ? (res.points || []).map(([d, v]) => ({ date: d, value: v * adj })) : []);
    });
  }, [view]);
  const evs = st.events.filter((e) => !e.undone && (e.toId === a.id || e.fromId === a.id || e.changes?.some((c) => c.assetId === a.id))).slice(0, 5);
  const series = view === 'price' ? priceSeries : valueSeries;
  const facts = [
    ['منبع ارزش', a.mode === 'units' ? (isMarket ? `${providerName(a.price.ref.provider)}، ${refLabel(a.price.ref)}` : 'قیمت دستی') : a.mode === 'rate' ? 'سود روزشمار' : a.mode === 'loan' ? 'جدول اقساط (خودکار)' : 'مانده دستی'],
    ['آخرین به‌روزرسانی', r.status === 'auto' ? 'هر لحظه (خودکار)' : r.status === 'matured' ? `سررسید ${fmtJ(a.rate.maturity)}` : r.at ? `${fmtJ(isoFromDate(new Date(r.at)))}، ${ago(r.at)}` : '—'],
    ...(a.mode === 'units' ? [['مقدار', `${num(a.quantity, 'auto')} ${a.unit || ''}`], ['قیمت واحد', html`<${Money} v=${r.unitPrice} s=${s} />`]] : []),
    ...(a.mode === 'rate' ? [['اصل', html`<${Money} v=${a.rate.principal} s=${s} />`], ['سود روزانه', html`<${Money} v=${E.rateDaily(a.rate, r.value)} s=${s} />`]] : []),
    ...(a.interest?.on ? [['سود روزشمار انباشته', html`<${Money} v=${r.accrued} s=${s} />`]] : []),
    ...(ls && !ls.done ? [['مبلغ قسط', html`<${Money} v=${ls.next.payment} s=${s} />`], ['قسط بعدی', `${fmtJ(ls.next.date)} (${num(ls.paid + 1)} از ${num(ls.n)})`],
      ['سود باقی‌مانده تا آخر', html`<${Money} v=${ls.rows.slice(ls.paid).reduce((t, x) => t + x.interest, 0) - ls.accrued} s=${s} compact />`],
      [CAT[a.category]?.liability ? 'پرداخت از' : 'واریز به', a.loan.account ? (st.assets.find((x) => x.id === a.loan.account)?.name || 'حساب حذف‌شده') : 'ثبت نمی‌شود']] : []),
    ...(r.pnl !== null ? [['سود / زیان', html`<span class=${r.pnl >= 0 ? 'pos' : 'neg'}><${Money} v=${r.pnl} s=${s} compact sign /> <span class="ltr">(${pct(r.ret)})</span></span>`]] : []),
    ['سهم از کل', r.cat.liability ? '—' : pct(r.value / (pf.gross || 1), { sign: false })],
    ['مواجهه / نقدشوندگی', `${EXPOSURES[r.exposure]?.name || '—'}، ${LIQUIDITY[a.liquidity || r.cat.liquidity]}`],
  ];
  return html`<div class="xpanel-wrap"><div class="xpanel">
    <div class="card flat" style="padding:14px">
      <div class="row between" style="margin-bottom:6px"><span class="sb small row" style="gap:4px">${view === 'price' ? 'قیمت واحد (۱۲۰ روز)' : html`${r.cat.liability ? 'مانده این بدهی' : 'ارزش این دارایی'}: <${Money} v=${r.value} s=${s} compact /><${Explain} s=${s} get=${() => I.explainAsset(a, st.quotes, s)} ask=${`ارزش «${a.name}» دقیقاً چطور حساب شده؟ با ابزار explain_value توضیح بده.`} />`}</span>
        ${isMarket && html`<${Seg} value=${view} onChange=${setView} options=${[['value', 'ارزش'], ['price', 'قیمت']]} />`}</div>
      ${series === null ? html`<div class="muted small" style="height:150px;display:grid;place-items:center">در حال دریافت…</div>`
        : html`<${AreaChart} points=${series} height=${150} fmt=${(v) => money(v, s, { compact: true })} color=${r.cat.color} emptyText="هنوز تاریخچه‌ای برای این دارایی ثبت نشده" />`}
    </div>
    <div class="col">
      <div class="xfacts">${facts.map(([k, v]) => html`<div class="pcell"><span class="n">${k}</span><span class="small sb">${v}</span></div>`)}</div>
      ${r.error && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>${r.error}</div></div>`}
      ${a.note && html`<div class="xs muted">${a.note}</div>`}
      ${evs.length > 0 && html`<div class="list">${evs.map((e) => html`<div class="it" style="padding:6px 2px"><span class="xs muted" style="width:70px">${fmtJ(e.date, 'dm')}</span><span class="grow small">${e.title}</span>${e.amount ? html`<span class="xs"><${Money} v=${e.amount} s=${s} compact /></span>` : ''}</div>`)}</div>`}
      <div class="row wrap">
        <button class="btn sm primary" onClick=${() => open(a)}><${Icon} n="edit" cls="sm" />ویرایش</button>
        ${a.mode === 'units' && html`<button class="btn sm" onClick=${() => onModal({ t: 'trade', a })}><${Icon} n="swap" cls="sm" />خرید یا فروش</button>`}
        ${a.mode === 'balance' && (E.APPRAISED.has(a.category) && !a.interest?.on
          ? html`<button class="btn sm" onClick=${() => onModal({ t: 'value', a })}><${Icon} n="edit" cls="sm" />ثبت ارزش جدید</button>`
          : html`<button class="btn sm" onClick=${() => onModal({ t: 'adjust', a })}><${Icon} n="swap" cls="sm" />${r.cat.liability ? 'پرداخت یا افزایش بدهی' : 'واریز یا برداشت'}</button>`)}
        ${a.mode === 'rate' && html`<button class="btn sm" onClick=${() => onModal({ t: 'adjust', a })}><${Icon} n="swap" cls="sm" />افزایش یا برداشت اصل</button>`}
        ${ls && !ls.done && html`<button class="btn sm" onClick=${() => onModal({ t: 'loanpay', a })}><${Icon} n="swap" cls="sm" />${r.cat.liability ? 'پرداخت اضافه یا تسویه' : 'دریافت اضافه یا تسویه'}</button>`}
        ${ls && html`<button class="btn sm ghost" onClick=${() => setSched(!sched)} aria-expanded=${sched}><${Icon} n="calendar" cls="sm" />جدول اقساط</button>`}
        <${AskBtn} q=${`درباره «${a.name}» توضیح بده: ارزشش چطور حساب شده، اخیراً چرا تغییر کرده و چه ریسکی در پرتفوی من دارد؟`} label="درباره‌اش بپرس" />
        <span class="grow"></span>
        <button class="btn sm ghost danger" onClick=${() => act.deleteAsset(a.id)}><${Icon} n="trash" cls="sm" />حذف</button>
      </div>
    </div>
  </div>
    ${sched && ls && html`<${LoanSchedule} asset=${a} s=${s} />`}</div>`;
}

export function AssetsPage({ st, pf, s, open, route, q }) {
  const [cat, setCat] = useState(route.q.cat || 'all');
  const [group, setGroup] = useState('cat');
  const [sort, setSort] = useState('value');
  const [onlyAtt, setOnlyAtt] = useState(route.q.f === 'attention');
  const [modal, setModal] = useState(null);
  const [openId, setOpenId] = useState(null);
  useEffect(() => { if (route.q.cat) setCat(route.q.cat); if (route.q.f === 'attention') setOnlyAtt(true); }, [route.q.cat, route.q.f]);

  const present = CATEGORIES.filter((c) => pf.rows.some((r) => r.cat.id === c.id));
  const attN = pf.attention.length;
  // A filter whose chip has disappeared (last asset of that kind deleted, nothing needs attention) must not stay on.
  const fCat = cat === 'all' || present.some((c) => c.id === cat) ? cat : 'all';
  const fAtt = onlyAtt && attN > 0;
  useEffect(() => { if (fCat !== cat) setCat('all'); if (onlyAtt && !fAtt) setOnlyAtt(false); }, [fCat, fAtt]);
  const term = norm(q);
  let rows = pf.rows.filter((r) => (fCat === 'all' || r.asset.category === fCat) && (!fAtt || E.needsAttention(r.status)) &&
    (!term || [r.asset.name, r.asset.custodian, r.asset.code, r.asset.note, r.cat.name, r.cat.short, r.asset.unit, r.asset.price?.ref?.symbol, r.asset.price?.ref?.label, r.asset.price?.ref?.name, r.asset.price?.ref?.sym].some((x) => norm(x).includes(term))));
  const sorter = { value: (a, b) => Math.abs(b.value) - Math.abs(a.value), name: (a, b) => a.asset.name.localeCompare(b.asset.name, 'fa'), change: (a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange), updated: (a, b) => (a.at || 0) - (b.at || 0) }[sort];
  rows = rows.slice().sort(sorter);
  const groups = [];
  if (group === 'none') groups.push({ key: 'all', title: null, rows });
  else {
    const m = new Map();
    const NONE = '\u0000';
    for (const r of rows) { const k = group === 'cat' ? r.cat.id : (norm(r.asset.custodian) ? String(r.asset.custodian).trim().replace(/\s+/g, ' ') : NONE); const kk = group === 'cat' ? k : norm(k); if (!m.has(kk)) m.set(kk, { title: k, rows: [] }); m.get(kk).rows.push(r); }
    for (const [k, g] of m) {
      const c = group === 'cat' ? CAT[k] : null;
      // A bank holding both a deposit and a loan nets out; the share of total counts only what is owned.
      groups.push({ key: k, title: c ? c.name : g.title === NONE ? 'محل نگهداری ثبت نشده' : g.title, icon: g.title === NONE ? 'box' : 'bank', cat: c, rows: g.rows,
        total: g.rows.reduce((x, r) => x + (c ? r.value : r.signedValue), 0), owned: g.rows.reduce((x, r) => x + (r.cat.liability ? 0 : r.value), 0) });
    }
    groups.sort((a, b) => (a.cat?.liability ? 1 : 0) - (b.cat?.liability ? 1 : 0) || (a.key === NONE) - (b.key === NONE) || b.total - a.total);
  }

  return html`<div class="page">
    <div class="row wrap between">
      <div class="row wrap" style="gap:6px">
        <button class=${'chip' + (fCat === 'all' ? ' on' : '')} onClick=${() => setCat('all')}>همه <span class="num muted">${num(pf.rows.length)}</span></button>
        ${present.map((c) => html`<button class=${'chip' + (fCat === c.id ? ' on' : '')} onClick=${() => setCat(c.id)}><span class="dot" style=${'background:' + c.color}></span>${c.short}</button>`)}
        ${attN > 0 && html`<button class=${'chip' + (fAtt ? ' on' : '')} onClick=${() => setOnlyAtt(!fAtt)} style="color:var(--warn)"><${Icon} n="alert" cls="sm" />نیاز به توجه <span class="num">${num(attN)}</span></button>`}
      </div>
      <div class="row">
        <${Seg} value=${group} onChange=${setGroup} options=${[['cat', 'دسته'], ['cust', 'محل نگهداری'], ['none', 'بدون گروه']]} />
        <select class="input" style="width:160px;height:34px" value=${sort} onChange=${(e) => setSort(e.target.value)}>
          <option value="value">مرتب: ارزش</option><option value="change">مرتب: تغییر امروز</option><option value="name">مرتب: نام</option><option value="updated">مرتب: قدیمی‌ترین به‌روزرسانی</option>
        </select>
      </div>
    </div>
    <div class="card" style="padding:6px 6px 2px">
      ${rows.length ? html`<table class="tbl">
        <thead><tr><th>دارایی</th><th class="n">مقدار</th><th class="n">قیمت واحد</th><th class="n">ارزش روز</th><th class="n">امروز</th><th class="n">سود / زیان</th><th>وضعیت</th><th></th></tr></thead>
        <tbody>${groups.map((g) => html`
          ${g.title && html`<tr class="grp"><td colspan="3"><span class="row">${g.cat ? html`<span class="dot" style=${`width:9px;height:9px;border-radius:3px;background:${g.cat.color}`}></span>` : html`<${Icon} n=${g.icon} cls="sm" />`}${g.title}<span class="muted xs num">${num(g.rows.length)} مورد${!g.cat?.liability && pf.gross && g.owned ? '، ' + pct(g.owned / pf.gross, { sign: false }) + ' از کل' : ''}</span></span></td>
            <td class="n num"><${Money} v=${g.cat?.liability ? -g.total : g.total} s=${s} compact /></td><td colspan="4"></td></tr>`}
          ${g.rows.map((r) => {
            const a = r.asset; const liab = r.cat.liability; const isOpen = openId === a.id;
            const share = !liab && pf.gross ? r.value / pf.gross : 0;
            const manualPrice = a.mode === 'units' && a.price?.source !== 'market';
            return html`<tr class=${'r' + (isOpen ? ' open' : '')} style="cursor:pointer" onClick=${() => setOpenId(isOpen ? null : a.id)} aria-expanded=${isOpen}>
              <td><div class="row" style="gap:10px"><${Ava} cat=${a.category} size=${34} /><div style="min-width:0">
                <div class="sb ellipsis" style="max-width:240px">${a.name}${a.review ? html` <span title=${a.review} class="warn"><${Icon} n="info" cls="sm" /></span>` : ''}</div>
                <div class="xs muted ellipsis" style="max-width:240px">${[(a.custodian || '').trim() !== a.name ? (a.custodian || '').trim() : '', a.code].filter(Boolean).join('، ')}</div></div></div></td>
              <td class="n num small">${a.mode === 'units' ? html`${num(a.quantity, 'auto')} <span class="muted">${a.unit || ''}</span>` : a.mode === 'rate' ? html`<span class="muted">اصل: </span><${Money} v=${a.rate?.principal} s=${s} compact unit=${false} />` : a.mode === 'loan' ? loanCell(a, s) : html`<span class="muted">—</span>`}</td>
              <td class="n small">${a.mode === 'units' ? html`${manualPrice ? html`<${InlineMoney} value=${r.unitPrice} s=${s} onSave=${(v) => act.patchAsset(a.id, { price: { ...a.price, value: v, updatedAt: Date.now() } })}><${Money} v=${r.unitPrice} s=${s} unit=${false} /></${InlineMoney}>` : html`<${Money} v=${r.unitPrice} s=${s} unit=${false} />`}` : ''}<${SourceLine} r=${r} /></td>
              <td class="n"><div class="sb">${a.mode === 'balance' && !a.interest?.on ? html`<${InlineMoney} value=${r.value} s=${s} onSave=${(v) => act.patchAsset(a.id, { balance: v, balanceAt: Date.now() })}><${Money} v=${liab ? -r.value : r.value} s=${s} /></${InlineMoney}>` : html`<${Money} v=${liab ? -r.value : r.value} s=${s} />`}</div>
                ${!liab && html`<div class="share-bar" title=${pct(share, { sign: false })}><i style=${`width:${Math.min(100, share * 100 * 2)}%;background:${r.cat.color}`}></i></div>`}</td>
              <td class="n small">${Math.abs(r.dayChange) >= 1 ? html`<${Money} v=${r.dayChange} s=${s} compact sign unit=${false} cls=${r.dayChange > 0 ? 'pos' : 'neg'} />` : html`<span class="faint">—</span>`}</td>
              <td class="n small">${r.pnl !== null ? html`<div class=${r.pnl >= 0 ? 'pos' : 'neg'}><${Money} v=${r.pnl} s=${s} compact sign unit=${false} /></div><div class="xs"><${Delta} p=${r.ret} showAbs=${false} /></div>` : html`<span class="faint">—</span>`}</td>
              <td><${StatusPill} status=${r.status} title=${r.error || ''} /><div class="xs faint" style="margin-top:3px">${a.mode === 'loan' && r.status === 'auto' ? 'قسط ' + fmtJ(E.loanState(a.loan).next.date, 'dm') : r.status === 'auto' ? 'هر لحظه' : r.status === 'matured' ? fmtJ(a.rate.maturity, 'dm') : r.at ? ago(r.at) : '—'}</div></td>
              <td onClick=${(e) => e.stopPropagation()}><div class="row" style="gap:2px;justify-content:flex-end">
                <button class="btn icon sm ghost acts" title="ویرایش" onClick=${() => open(a)}><${Icon} n="edit" cls="sm" /></button>
                <button class="btn icon sm ghost" title=${isOpen ? 'بستن جزئیات' : 'جزئیات'} onClick=${() => setOpenId(isOpen ? null : a.id)}><${Icon} n="chevronDown" cls="sm chev" /></button>
              </div></td>
            </tr>
            ${isOpen && html`<tr class="xrow"><td colspan="8"><${Expanded} st=${st} r=${r} s=${s} pf=${pf} open=${open} onModal=${setModal} /></td></tr>`}`;
          })}`)}
        </tbody>
        <tfoot><tr><td class="b" style="padding:14px 12px">جمع ${fCat !== 'all' || fAtt || term ? 'فیلترشده' : 'ارزش خالص'}</td><td colspan="2"></td>
          <td class="n b" style="padding:14px 12px"><${Money} v=${rows.reduce((x, r) => x + r.signedValue, 0)} s=${s} /></td>
          <td class="n small" style="padding:14px 12px"><${Money} v=${rows.reduce((x, r) => x + r.dayChange, 0)} s=${s} compact sign /></td><td colspan="3"></td></tr></tfoot>
      </table>` : html`<div class="empty"><div class="ico"><${Icon} n="assets" /></div>${pf.rows.length ? 'موردی با این فیلتر پیدا نشد.' : 'هنوز دارایی‌ای ثبت نشده.'}
        <div class="row" style="margin-top:10px;justify-content:center">${pf.rows.length > 0 && (fCat !== 'all' || fAtt) && html`<button class="btn" onClick=${() => { setCat('all'); setOnlyAtt(false); }}>نمایش همه</button>`}<button class="btn primary" onClick=${() => open(null)}><${Icon} n="plus" />افزودن دارایی</button></div></div>`}
    </div>
    <div class="xs muted row"><${Icon} n="info" cls="sm" />برای دیدن جزئیات روی هر ردیف بزن. قیمت دستی یا مانده را همان‌جا با کلیک ویرایش کن. میانبرها: <span class="kbd">N</span> دارایی جدید، <span class="kbd">/</span> جست‌وجو</div>
    ${modal?.t === 'trade' && html`<${TradeModal} st=${st} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'adjust' && html`<${AdjustModal} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'value' && html`<${ValueModal} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'loanpay' && html`<${LoanPayModal} st=${st} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
  </div>`;
}
