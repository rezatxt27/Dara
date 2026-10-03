import { isoFromDate, todayIso } from '../../lib/jalali.js';
import { html, useOnce, useState, useMemo, useRef, useEffect, Icon, Money, Delta, Ava, StatusPill, refLabel, providerName, Modal, NumField, MoneyField, JDateField, Seg, AreaChart, toast, send, num, pct, fmtJ, money, Explain, AskBtn } from '../components.js';
import * as I from '../../lib/insights.js';
import { CATEGORIES, CAT, EXPOSURES, LIQUIDITY } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import { ago, parseNum, groupTyping, getDigits, toEnDigits, hasWords } from '../../lib/format.js';
import { act, doneToast } from '../actions.js';

/** Quantity column for an installment loan: installment amount and progress. */
function loanCell(a, s) {
  const ls = E.loanState(a.loan);
  if (ls.done) return html`<span class="muted">${num(ls.n + ls.before)} قسط</span>`;
  return html`<div><span class="muted">قسط: </span><${Money} v=${ls.next.payment} s=${s} compact unit=${false} /></div><div class="xs muted">${num(ls.paid + ls.before)} از ${num(ls.n + ls.before)} پرداخت شده</div>`;
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
  if (a.mode === 'balance') return html`<div class="src"><${Icon} n=${a.interest?.on ? 'percent' : 'edit'} cls="sm" />${a.interest?.on ? `مانده + سود روزشمار ${num(a.interest.annualPct, 2)}٪` : E.APPRAISED.has(a.category) ? 'برآورد دستی' : 'مانده دستی'}، ${ago(r.at)}</div>`;
  if (a.price?.source === 'market') {
    const ref = a.price.ref || {};
    const pending = ref.provider === 'tsetmc' && !ref.key;
    return html`<div class="src" title=${r.error || r.note || ''}><${Icon} n=${r.status === 'error' ? 'wifi' : 'live'} cls="sm" />${providerName(ref.provider)}، ${refLabel(ref)}${a.price.adjustPct ? html` <span class="ltr">(${a.price.adjustPct > 0 ? '+' : ''}${num(a.price.adjustPct, 2)}٪)</span>` : ''}${pending ? '، در انتظار شناسایی نماد' : ''}${r.note ? html`، <span class="approx" title=${r.note}>${r.quote?.approx ? 'تقریبی' : r.note}</span>` : ''}</div>`;
  }
  return html`<div class="src"><${Icon} n="edit" cls="sm" />قیمت دستی، ${ago(r.at)}</div>`;
}

/** «ثبت شد» — or, when the new number is ~10× off, a warning about the zeros (both with undo). */
const savedMsg = (v, prev, ok) => { const r = prev > 0 && v > 0 ? v / prev : 1; return r >= 8 || r <= 1 / 8 ? `ثبت شد؛ حدود ${num(r >= 8 ? r : 1 / r)} برابر ${r >= 8 ? 'بیشتر' : 'کمتر'} از قبل است. اگر صفرها اشتباه است «برگشت» را بزن` : ok; };

/** Click-to-edit money cell for manual prices & balances (live separators, Enter to save, Esc to cancel) */
function InlineMoney({ value, s, onSave, children }) {
  const [ed, setEd] = useState(false);
  const [txt, setTxt] = useState('');
  const k = s.currency === 'rial' ? 1 : 10;
  const ref = useRef();
  const sep = (g) => (getDigits() === 'fa' ? g.replace(/,/g, '٬') : g);
  useEffect(() => { if (ed) { ref.current?.focus(); ref.current?.select(); } }, [ed]);
  const [start, setStart] = useState('');
  if (!ed) return html`<span class="editable" title="برای ویرایش کلیک کن" onClick=${(e) => { e.stopPropagation(); const t0 = sep(groupTyping(String(Math.round(value / k)))); setTxt(t0); setStart(t0); setEd(true); }}>${children}</span>`;
  // leaving the field without typing a different number changes nothing (no rounding of rials into a fake edit)
  const commit = () => { const v = parseNum(txt); if (txt !== start && isFinite(v) && v >= 0 && Math.round(v) !== Math.round(parseNum(start))) onSave(v * k); setEd(false); };
  return html`<input ref=${ref} class="input num-in" style="height:30px;width:160px" value=${txt} onClick=${(e) => e.stopPropagation()}
    onInput=${(e) => setTxt(hasWords(e.target.value) ? e.target.value : sep(groupTyping(e.target.value)))} onKeyDown=${(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEd(false); }} onBlur=${commit} />`;
}

function TradeModal({ st, s, asset, onClose }) {
  const [saving, once] = useOnce();
  const unitPrice = E.unitPriceOf(asset, st.quotes).price;
  const [side, setSide] = useState('buy');
  const [qty, setQty] = useState(null);
  const [price, setPrice] = useState(unitPrice || null);
  const cashes = E.cashAccounts(st.assets, { except: asset.id }); // the same accounts every other money form offers
  const [cashId, setCashId] = useState('');
  const amount = (qty || 0) * (price || 0);
  const tooMuch = side === 'sell' && qty > (+asset.quantity || 0) + 1e-9;
  const cash = cashes.find((c) => c.id === cashId);
  const short = side === 'buy' && cash && amount > (+cash.balance || 0) + 0.5;
  const save = async () => {
    if (!(qty > 0) || !(price > 0)) return toast('مقدار و قیمت را وارد کن');
    if (tooMuch) return toast('مقدار فروش بیشتر از موجودی است');
    const ev = await act.trade({ assetId: asset.id, side, qty, price, cashId: cashId || null });
    doneToast(`${side === 'buy' ? 'خرید' : 'فروش'} ثبت شد`, ev); onClose();
  };
  const q1 = (+asset.quantity || 0) + (side === 'buy' ? 1 : -1) * (qty || 0);
  return html`<${Modal} title=${`خرید یا فروش — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" disabled=${saving} onClick=${() => once(save)}>${side === 'buy' ? 'ثبت خرید' : 'ثبت فروش'}</button>`}>
    <${Seg} value=${side} onChange=${setSide} options=${[['buy', 'خرید'], ['sell', 'فروش']]} />
    <div class="grid2"><${NumField} label=${`مقدار (${asset.unit || 'واحد'})`} value=${qty} onInput=${setQty} autoFocus err=${tooMuch} hint=${side === 'sell' ? `موجودی: ${num(asset.quantity, 'auto')}` : ''} />
    <${MoneyField} label="قیمت هر واحد" rial=${price} onRial=${setPrice} s=${s} prev=${unitPrice} /></div>
    <div class="field"><label>${side === 'buy' ? 'پرداخت از حساب' : 'واریز به حساب'} (اختیاری)</label>
      <select class="input" value=${cashId} onChange=${(e) => setCashId(e.target.value)}><option value="">— ثبت نشود —</option>${cashes.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
      ${short && html`<span class="hint warn">مانده این حساب (<${Money} v=${cash.balance} s=${s} />) کافی نیست؛ اگر ثبت کنی منفی می‌شود.</span>`}</div>
    <div class="preview outcome"><div class="row between"><span class="muted">مبلغ معامله</span><span class="v"><${Money} v=${amount} s=${s} /></span></div>
      ${qty > 0 && !tooMuch && html`<div class="row between small"><span class="muted">بعد از این</span><span class="sb">${num(q1, 'auto')} ${asset.unit || ''}${cash ? html` · مانده «${cash.name}»: <${Money} v=${(+cash.balance || 0) + (side === 'buy' ? -amount : amount)} s=${s} compact />` : ''}</span></div>`}</div>
  </${Modal}>`;
}

function AdjustModal({ s, asset, onClose }) {
  const [saving, once] = useOnce();
  const [dir, setDir] = useState('in'); const [amt, setAmt] = useState(null); const [note, setNote] = useState('');
  const liab = CAT[asset.category]?.liability;
  const rate = asset.mode === 'rate';
  const cur = rate ? E.rateValue(asset.rate) : +asset.balance || 0; // what could be withdrawn today
  // an interest-bearing account: its accrued interest isn't in the balance yet (shown apart, like in the table)
  const accrued = !rate && asset.interest?.on ? E.balanceInterestLive(asset, todayIso(), Date.now()).accrued : 0;
  // can't take out more than is there, or pay a debt below zero
  const tooMuch = amt > cur + 0.5 && ((dir === 'out' && !liab) || (dir === 'in' && liab));
  const save = async () => {
    if (!(amt > 0)) return toast('مبلغ را وارد کن');
    if (tooMuch && rate) return toast('برداشت بیشتر از ارزش فعلی است');
    if (tooMuch && liab) return toast('بیشتر از مانده بدهی است');
    const ev = await act.adjust({ assetId: asset.id, delta: dir === 'in' ? amt : -amt, note }); doneToast('ثبت شد', ev); onClose();
  };
  const label = liab ? (dir === 'in' ? 'ثبت پرداخت' : 'ثبت افزایش بدهی') : dir === 'in' ? 'ثبت واریز' : 'ثبت برداشت';
  const after = cur + (liab ? -1 : 1) * (dir === 'in' ? 1 : -1) * (amt || 0);
  return html`<${Modal} title=${`${rate ? 'افزایش یا برداشت اصل' : 'واریز یا برداشت'} — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" disabled=${saving} onClick=${() => once(save)}>${label}</button>`}>
    <${Seg} value=${dir} onChange=${setDir} options=${[['in', liab ? 'پرداخت بدهی' : 'واریز'], ['out', liab ? 'افزایش بدهی' : 'برداشت']]} />
    <${MoneyField} label="مبلغ" rial=${amt} onRial=${setAmt} s=${s} autoFocus />
    <div class="preview outcome"><div class="row between small"><span class="muted">${rate ? 'ارزش امروز' : liab ? 'مانده بدهی' : 'مانده حساب'}</span><${Money} v=${cur} s=${s} /></div>
      ${accrued >= 1 && html`<div class="row between xs"><span class="muted">+ سود جمع‌شده این ماه (روز واریز اضافه می‌شود)</span><${Money} v=${accrued} s=${s} /></div>`}
      ${amt > 0 && html`<div class="row between"><span class="muted">بعد از این</span><span class=${'big ' + (tooMuch ? 'neg' : '')}><${Money} v=${after} s=${s} /></span></div>`}
      ${rate && html`<span class="xs muted">سود مبلغ جدید از همین امروز حساب می‌شود.</span>`}</div>
    <div class="field"><label>توضیح (اختیاری)</label><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="مثلاً: واریز حقوق مهر" /></div>
  </${Modal}>`;
}

/** Extra payment or early settlement of an installment loan (or an extra repayment received on one you gave). */
function LoanPayModal({ st, s, asset, onClose }) {
  const [saving, once] = useOnce();
  const liab = !!CAT[asset.category]?.liability;
  const ls = E.loanState(asset.loan, todayIso(), Date.now());
  const accounts = E.cashAccounts(st.assets, { except: asset.id, keep: [asset.loan.account].filter(Boolean) });
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
    let ev;
    // settlement: what is owed at the moment it's recorded (an installment that fell meanwhile is counted first)
    if (kind === 'all') ev = await act.settleLoan({ loanId: asset.id, accountId: accObj?.id || null });
    else {
      const note = `${liab ? 'پرداخت اضافه' : 'دریافت اضافه'} «${asset.name}»`;
      ev = accObj ? await act.transfer(liab ? { fromId: accObj.id, toId: asset.id, amount: amt, note } : { fromId: asset.id, toId: accObj.id, amount: amt, note })
        : await act.adjust({ assetId: asset.id, delta: liab ? amt : -amt, note });
    }
    doneToast(kind === 'all' ? 'تسویه ثبت شد' : 'ثبت شد', ev); onClose();
  };
  return html`<${Modal} title=${`${liab ? 'پرداخت اضافه یا تسویه' : 'دریافت اضافه یا تسویه'} — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" disabled=${saving} onClick=${() => once(save)}>${kind === 'all' ? 'ثبت تسویه' : liab ? 'ثبت پرداخت' : 'ثبت دریافت'}</button>`}>
    <${Seg} value=${kind} onChange=${setKind} options=${[['part', liab ? 'پرداخت بخشی از وام' : 'دریافت بخشی از طلب'], ['all', 'تسویه کامل']]} />
    ${kind === 'part' ? html`<${MoneyField} label="مبلغ" rial=${amt} onRial=${setAmt} s=${s} autoFocus err=${tooMuch} />`
      : html`<div class="preview"><span class="muted">مبلغ تسویه امروز (مانده اصل + سود این ماه تا امروز)</span><span class="v"><${Money} v=${ls.value} s=${s} /></span></div>`}
    <div class="field"><label>${liab ? 'از حساب' : 'به حساب'} (اختیاری)</label>
      <select class="input" value=${acc} onChange=${(e) => setAcc(e.target.value)}><option value="">— ثبت نشود —</option>${accounts.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
      ${short && html`<span class="hint warn">مانده این حساب کافی نیست؛ اگر ثبت کنی منفی می‌شود.</span>`}</div>
    <div class="preview outcome"><div class="row between small"><span class=${tooMuch ? 'neg' : 'muted'}>مانده امروز</span><${Money} v=${ls.value} s=${s} /></div>
      ${ls.accrued >= 1 && html`<div class="xs muted">مانده اصل <${Money} v=${ls.owed} s=${s} /> + سود این ماه تا امروز <${Money} v=${ls.accrued} s=${s} /></div>`}
      ${after && html`<div class="big">بعد از این: ${num(after.n - after.paid)} قسط می‌ماند (به‌جای ${num(ls.n - ls.paid)})</div><span class="xs muted">قسط ماهانه همان <${Money} v=${after.A} s=${s} compact /> می‌ماند؛ فقط تعداد قسط‌ها کم می‌شود.</span>`}
      ${kind === 'all' && html`<span class="xs muted">بعد از ثبت، این ${liab ? 'وام' : 'طلب'} «تسویه شده» می‌شود و قسط دیگری ثبت نمی‌شود.</span>`}</div>
  </${Modal}>`;
}

/** Full installment table: paid ones greyed out. */
function LoanSchedule({ asset, s }) {
  const ls = E.loanState(asset.loan);
  return html`<div class="sched"><div class="xs muted" style="padding:6px 10px">مبالغ به ${s.currency === 'rial' ? 'ریال' : 'تومان'}</div><table class="tbl small">
    <thead><tr><th>#</th><th>تاریخ</th><th class="n">قسط</th><th class="n">سود</th><th class="n">اصل</th><th class="n">مانده</th></tr></thead>
    <tbody>${ls.rows.map((x) => html`<tr class=${x.k < ls.paid ? 'paid' : x.k === ls.paid ? 'next' : ''}>
      <td class="num">${x.k < ls.paid ? html`<${Icon} n="check" cls="sm" />` : num(x.k + 1 + ls.before)}</td><td>${fmtJ(x.date, 'dm')} <span class="xs muted">${fmtJ(x.date).split(' ').pop()}</span></td>
      <td class="n"><${Money} v=${x.payment} s=${s} unit=${false} /></td><td class="n"><${Money} v=${x.interest} s=${s} unit=${false} /></td>
      <td class="n"><${Money} v=${x.principal} s=${s} unit=${false} /></td><td class="n"><${Money} v=${x.balance} s=${s} unit=${false} /></td></tr>`)}</tbody></table></div>`;
}

/** New appraisal of a house, car or private shares. By default a market move; or part of it bought or sold. */
function ValueModal({ s, asset, onClose }) {
  const [saving, once] = useOnce();
  const [v, setV] = useState(null); const [why, setWhy] = useState('reval');
  const save = async () => {
    if (!(v >= 0) || v === null) return toast('ارزش جدید را وارد کن');
    const ev = await act.patchAsset(asset.id, { balance: v, balanceAt: Date.now() }, { reval: why === 'reval' });
    doneToast('ارزش جدید ثبت شد', ev); onClose();
  };
  const b0 = +asset.balance || 0;
  return html`<${Modal} title=${`ارزش جدید — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" disabled=${saving} onClick=${() => once(save)}>ثبت ارزش</button>`}>
    <div class="preview outcome"><div class="row between small"><span class="muted">ارزش قبلی${asset.balanceAt ? ` (${ago(asset.balanceAt)})` : ''}</span><${Money} v=${b0} s=${s} /></div>
      ${v > 0 && b0 > 0 && html`<div class="row between small"><span class="muted">تغییر</span><b class=${v >= b0 ? 'pos' : 'neg'}><span class="ltr">${pct(v / b0 - 1)}</span></b></div>`}</div>
    <${MoneyField} label="ارزش امروز" rial=${v} onRial=${setV} s=${s} autoFocus prev=${asset.balance} />
    <div class="field"><label>چرا تغییر کرد؟</label><${Seg} value=${why} onChange=${setWhy} options=${[['reval', 'قیمت بازارش عوض شد'], ['money', 'بخشی را خریدم یا فروختم']]} />
      <span class="hint">${why === 'reval' ? 'در «چرا تغییر کرد» و بازده واقعی، سود یا زیان بازار حساب می‌شود.' : 'پول واردشده یا خارج‌شده حساب می‌شود، نه سود.'}</span></div>
  </${Modal}>`;
}

/** A deposit past its maturity: move it all to an account (and close it), or renew it. */
function MaturedModal({ st, s, asset, onClose }) {
  const [saving, once] = useOnce();
  const liab = !!CAT[asset.category]?.liability;
  const accounts = E.cashAccounts(st.assets, { except: asset.id, keep: [asset.rate.payoutTo].filter((x) => x && x !== 'self') });
  const [kind, setKind] = useState(accounts.length ? 'move' : 'renew');
  const [acc, setAcc] = useState(asset.rate.payoutTo && accounts.some((x) => x.id === asset.rate.payoutTo) ? asset.rate.payoutTo : accounts[0]?.id || '');
  const [mat, setMat] = useState(null); const [rate, setRate] = useState(asset.rate.annualPct);
  const v = E.valueOf(asset, st.quotes, s).value;
  const save = async () => {
    if (kind === 'move') { if (!acc) return toast(liab ? 'حساب پرداخت را انتخاب کن' : 'حساب مقصد را انتخاب کن'); doneToast(liab ? 'تسویه شد' : 'به حساب منتقل شد', await act.closeDeposit({ assetId: asset.id, accountId: acc })); }
    else { if (mat && mat <= todayIso()) return toast('سررسید جدید باید بعد از امروز باشد'); doneToast('تمدید شد', await act.renewDeposit({ assetId: asset.id, maturity: mat, annualPct: rate })); }
    onClose();
  };
  return html`<${Modal} title=${`سررسید — ${asset.name}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" disabled=${saving} onClick=${() => once(save)}>${kind === 'move' ? (liab ? 'پرداخت و تسویه' : 'انتقال و بستن') : 'ثبت تمدید'}</button>`}>
    <div class="preview outcome"><div class="row between"><span class="muted">${liab ? 'مبلغ بدهی در سررسید' : 'ارزش در سررسید'}</span><span class="big"><${Money} v=${v} s=${s} cls=${liab ? 'debt' : ''} /></span></div></div>
    <${Seg} value=${kind} onChange=${setKind} options=${[...(accounts.length ? [['move', liab ? 'پرداخت از حساب' : 'انتقال به حساب']] : []), ['renew', liab ? 'تمدید' : 'تمدید سپرده']]} />
    ${kind === 'move' ? html`<div class="field"><label>${liab ? 'از حساب' : 'به حساب'}</label><select class="input" value=${acc} onChange=${(e) => setAcc(e.target.value)}>${accounts.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
        <span class="hint">${liab ? 'همه مبلغ از این حساب کم می‌شود و بدهی بسته می‌شود؛ ارزش خالص تغییری نمی‌کند.' : 'همه مبلغ به این حساب می‌رود و سپرده بسته می‌شود؛ ارزش خالص تغییری نمی‌کند.'}</span></div>`
      : html`<div class="grid2"><${JDateField} label="سررسید جدید (اختیاری)" iso=${mat} onIso=${setMat} allowEmpty hint="خالی = بدون سررسید" />
        <${NumField} label="نرخ سود جدید" suffix="٪" value=${rate} onInput=${setRate} digits=${2} /></div>
        <span class="hint">${liab ? 'مبلغ امروز، اصل جدید می‌شود و سود از امروز با نرخ جدید حساب می‌شود.' : 'ارزش امروز، اصل سپرده جدید می‌شود و سود از امروز با نرخ جدید حساب می‌شود.'}</span>`}
  </${Modal}>`;
}

/* ---------------- expanded row ---------------- */
function Expanded({ st, r, s, pf, open, onModal }) {
  const a = r.asset;
  const isMarket = a.mode === 'units' && a.price?.source === 'market' && a.price.ref?.key;
  const [view, setView] = useState('value');
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
  // installments are in the schedule; the short list shows everything else
  const evs = st.events.filter((e) => !e.undone && e.kind !== 'loan' && (e.toId === a.id || e.fromId === a.id || e.changes?.some((c) => c.assetId === a.id))).slice(0, 5);
  const series = view === 'price' ? priceSeries : valueSeries;
  const loan = a.mode === 'loan';
  const showChart = !loan && (isMarket || valueSeries.length >= 2);
  const facts = loan ? [] : [
    ['منبع ارزش', a.mode === 'units' ? (isMarket ? `${providerName(a.price.ref.provider)}، ${refLabel(a.price.ref)}` : 'قیمت دستی') : a.mode === 'rate' ? 'سود روزشمار' : E.APPRAISED.has(a.category) ? 'برآورد دستی' : a.interest?.on ? 'مانده دستی + سود خودکار' : 'مانده دستی'],
    [r.status === 'matured' ? 'سررسید' : 'آخرین به‌روزرسانی', r.status === 'auto' ? 'هر لحظه (خودکار)' : r.status === 'matured' ? fmtJ(a.rate.maturity) : r.at ? `${fmtJ(isoFromDate(new Date(r.at)))}، ${ago(r.at)}` : '—'],
    ...(a.mode === 'units' ? [['مقدار', `${num(a.quantity, 'auto')} ${a.unit || ''}`], ['قیمت واحد', html`<${Money} v=${r.unitPrice} s=${s} />`]] : []),
    ...(a.mode === 'rate' ? [['اصل', html`<${Money} v=${a.rate.principal} s=${s} />`], ['سود روزانه', html`<${Money} v=${E.rateDaily(a.rate, r.value)} s=${s} />`]] : []),
    ...(a.interest?.on ? [['سود جمع‌شده (هنوز واریز نشده)', html`<${Money} v=${r.accrued} s=${s} />`]] : []),
    ...(r.pnl !== null ? [['سود / زیان', html`<span class=${r.pnl >= 0 ? 'pos' : 'neg'}><${Money} v=${r.pnl} s=${s} compact sign /> <span class="ltr">(${pct(r.ret)})</span></span>`]] : []),
    ...(r.cat.liability ? [] : [['سهم از کل', pct(r.value / (pf.gross || 1), { sign: false })], ['ارزشش وابسته به / سرعت نقد شدن', `${EXPOSURES[r.exposure]?.name || '—'}، ${LIQUIDITY[a.liquidity || r.cat.liquidity]}`]]),
  ];
  if (loan) {
    const liabL = r.cat.liability;
    facts.push([liabL ? 'مانده بدهی امروز' : 'مانده طلب امروز', html`<${Money} v=${r.value} s=${s} cls=${liabL ? 'debt' : ''} />${!ls.done && ls.accrued >= 1 ? html`<div class="xs muted">اصل <${Money} v=${ls.owed} s=${s} compact /> + سود این ماه تا امروز <${Money} v=${ls.accrued} s=${s} compact /></div>` : ''}`]);
    if (ls.done) facts.push(['وضعیت', 'تسویه شده']);
    else facts.push(['قسط ماهانه', html`<${Money} v=${ls.next.payment} s=${s} />`], ['قسط بعدی', `${fmtJ(ls.next.date)} (${num(ls.paid + ls.before + 1)} از ${num(ls.n + ls.before)})`],
      ['سود باقی‌مانده تا آخر', html`<${Money} v=${ls.rows.slice(ls.paid).reduce((t, x) => t + x.interest, 0) - ls.accrued} s=${s} compact />`],
      [liabL ? 'قسط‌ها از' : 'قسط‌ها به', a.loan.account ? (st.assets.find((x) => x.id === a.loan.account)?.name || 'حساب حذف‌شده') : 'ثبت نمی‌شود']);
  }
  const mainAct = a.mode === 'units' ? ['trade', 'swap', 'خرید یا فروش']
    : r.status === 'matured' ? ['matured', 'clock', r.cat.liability ? 'تسویه یا تمدید' : 'انتقال یا تمدید']
    : a.mode === 'rate' ? ['adjust', 'swap', 'افزایش یا برداشت اصل']
    : loan ? (ls.done ? null : ['loanpay', 'swap', r.cat.liability ? 'پرداخت اضافه یا تسویه' : 'دریافت اضافه یا تسویه'])
    : E.APPRAISED.has(a.category) && !a.interest?.on ? ['value', 'target', 'ثبت ارزش جدید']
    : ['adjust', 'swap', r.cat.liability ? 'پرداخت یا افزایش بدهی' : 'واریز یا برداشت'];
  return html`<div class="xpanel-wrap"><div class=${'xpanel' + (showChart || loan ? '' : ' solo')}>
    ${loan && html`<div class="card flat" style="padding:0;overflow:hidden">
      ${!ls.done && html`<div style="padding:12px 14px 0"><div class="row between small"><span class="sb">${num(ls.paid + ls.before)} از ${num(ls.n + ls.before)} قسط پرداخت شد</span><span class="muted">${pct((ls.paid + ls.before) / (ls.n + ls.before), { sign: false, digits: 0 })}</span></div>
        <div class="progress" style="margin-top:6px"><i style=${`width:${Math.round((ls.paid + ls.before) / (ls.n + ls.before) * 100)}%;background:${r.cat.color}`}></i></div></div>`}
      <${LoanSchedule} asset=${a} s=${s} /></div>`}
    ${showChart && html`<div class="card flat" style="padding:14px">
      <div class="row between" style="margin-bottom:6px"><span class="sb small row" style="gap:4px">${view === 'price' ? 'قیمت واحد (۱۲۰ روز)' : html`${r.cat.liability ? 'مانده بدهی امروز' : 'ارزش امروز'}: <${Money} v=${r.value} s=${s} compact /><${Explain} s=${s} get=${() => I.explainAsset(a, st.quotes, s)} ask=${`ارزش «${a.name}» دقیقاً چطور حساب شده؟ با ابزار explain_value توضیح بده.`} />`}</span>
        ${isMarket && html`<${Seg} value=${view} onChange=${setView} options=${[['value', 'ارزش'], ['price', 'قیمت']]} />`}</div>
      ${series === null ? html`<div class="muted small" style="height:150px;display:grid;place-items:center">در حال دریافت…</div>`
        : html`<${AreaChart} points=${series} height=${150} fmt=${(v) => money(v, s, { compact: true })} color=${r.cat.color} emptyText="هنوز تاریخچه‌ای برای این دارایی ثبت نشده" />`}
    </div>`}
    <div class="col">
      ${!showChart && !loan && html`<div class="sb small row" style="gap:4px">${r.cat.liability ? 'مانده بدهی امروز' : 'ارزش امروز'}: <${Money} v=${r.value} s=${s} /><${Explain} s=${s} get=${() => I.explainAsset(a, st.quotes, s)} ask=${`ارزش «${a.name}» دقیقاً چطور حساب شده؟ با ابزار explain_value توضیح بده.`} /></div>`}
      ${r.status === 'matured' && html`<div class="callout warn"><${Icon} n="clock" cls="sm" /><div>${r.cat.liability ? 'سررسید شده؛ با «تسویه یا تمدید» آن را از یک حساب بپرداز یا تمدیدش کن.' : 'سررسید شده و دیگر سود نمی‌گیرد؛ با «انتقال یا تمدید» آن را به حساب ببر یا تمدیدش کن.'}</div></div>`}
      <div class="xfacts">${facts.map(([k, v]) => html`<div class="pcell"><span class="n">${k}</span><span class="small sb">${v}</span></div>`)}</div>
      ${r.error && r.status !== 'matured' && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>${r.error}</div></div>`}
      ${a.note && html`<div class="xs muted">${a.note}</div>`}
      ${evs.length > 0 && html`<div class="list">${evs.map((e) => html`<div class="it" style="padding:6px 2px"><span class="xs muted" style="width:70px">${fmtJ(e.date, 'dm')}</span><span class="grow small">${e.title}</span>${e.amount ? html`<span class="xs"><${Money} v=${e.amount} s=${s} compact /></span>` : ''}</div>`)}</div>`}
      <div class="row wrap">
        ${mainAct && html`<button class="btn sm primary" onClick=${() => onModal({ t: mainAct[0], a })}><${Icon} n=${mainAct[1]} cls="sm" />${mainAct[2]}</button>`}
        <button class="btn sm" onClick=${() => open(a)}><${Icon} n="edit" cls="sm" />ویرایش</button>
        <${AskBtn} q=${`درباره «${a.name}» توضیح بده: ارزشش چطور حساب شده، اخیراً چرا تغییر کرده و چه ریسکی در پرتفوی من دارد؟`} label="درباره‌اش بپرس" />
        <span class="grow"></span>
        <button class="btn sm ghost danger" onClick=${() => act.deleteAsset(a.id)}><${Icon} n="trash" cls="sm" />حذف</button>
      </div>
    </div>
  </div></div>`;
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
  // paid-off loans and closed items go to the end of their group
  const settled = (r) => (r.asset.mode === 'loan' && E.loanState(r.asset.loan).done ? 1 : 0);
  rows = rows.slice().sort((a, b) => settled(a) - settled(b) || sorter(a, b));
  const hasPnl = rows.some((r) => r.pnl !== null);
  const groups = [];
  if (group === 'none') groups.push({ key: 'all', title: null, rows });
  else {
    const m = new Map();
    const NONE = '\u0000';
    for (const r of rows) { const k = group === 'cat' ? r.cat.id : (norm(r.asset.custodian) ? String(r.asset.custodian).trim().replace(/\s+/g, ' ') : NONE); const kk = group === 'cat' ? k : norm(k); if (!m.has(kk)) m.set(kk, { title: k, rows: [] }); m.get(kk).rows.push(r); }
    for (const [k, g] of m) {
      const c = group === 'cat' ? CAT[k] : null;
      // A bank holding both a deposit and a loan nets out; the share of total counts only what is owned.
      groups.push({ key: k, title: c ? c.short : g.title === NONE ? 'محل نگهداری ثبت نشده' : g.title, icon: g.title === NONE ? 'box' : 'bank', cat: c, rows: g.rows,
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
      ${rows.length ? html`<table class="tbl assets">
        <thead><tr><th>دارایی</th><th class="n c-qty">مقدار</th><th class="n c-price">قیمت واحد</th><th class="n">ارزش امروز</th><th class="n c-today">امروز</th>${hasPnl && html`<th class="n c-pnl">سود / زیان</th>`}<th class="c-status">وضعیت</th><th></th></tr></thead>
        <tbody>${groups.map((g) => html`
          ${g.title && html`<tr class="grp"><td colspan="2"><span class="row">${g.cat ? html`<span class="dot" style=${`width:9px;height:9px;border-radius:3px;background:${g.cat.color}`}></span>` : html`<${Icon} n=${g.icon} cls="sm" />`}${g.title}<span class="muted xs num">${num(g.rows.length)} مورد${!g.cat?.liability && pf.gross && g.owned ? '، ' + pct(g.owned / pf.gross, { sign: false }) + ' از کل' : ''}</span></span></td><td class="c-price"></td>
            <td class="n num"><${Money} v=${g.total} s=${s} compact cls=${g.cat?.liability || g.total < 0 ? 'debt' : ''} /></td><td colspan=${hasPnl ? 4 : 3}></td></tr>`}
          ${g.rows.map((r) => {
            const a = r.asset; const liab = r.cat.liability; const isOpen = openId === a.id;
            const share = !liab && pf.gross ? r.value / pf.gross : 0;
            const manualPrice = a.mode === 'units' && a.price?.source !== 'market';
            return html`<tr class=${'r' + (isOpen ? ' open' : '') + (settled(r) ? ' settled' : '')} style="cursor:pointer" tabindex="0" onClick=${() => setOpenId(isOpen ? null : a.id)}
              onKeyDown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpenId(isOpen ? null : a.id); } }} aria-expanded=${isOpen}>
              <td><div class="row" style="gap:10px"><${Ava} cat=${a.category} size=${34} /><div style="min-width:0">
                <div class="sb ellipsis" style="max-width:240px">${a.name}${a.review ? html` <span title=${a.review} class="warn"><${Icon} n="info" cls="sm" /></span>` : ''}</div>
                <div class="xs muted ellipsis" style="max-width:240px">${(a.custodian || '').trim() !== a.name ? (a.custodian || '').trim() : ''}</div><div class="src-narrow"><${SourceLine} r=${r} /></div></div></div></td>
              <td class="n num small c-qty">${a.mode === 'units' ? html`<span class="priv">${num(a.quantity, 'auto')}</span> <span class="muted">${a.unit || ''}</span>` : a.mode === 'rate' ? html`<span class="muted">اصل: </span><${Money} v=${a.rate?.principal} s=${s} compact unit=${false} />` : a.mode === 'loan' ? loanCell(a, s) : html`<span class="muted">—</span>`}</td>
              <td class="n small c-price">${a.mode === 'units' ? html`${manualPrice ? html`<${InlineMoney} value=${r.unitPrice} s=${s} onSave=${async (v) => doneToast(savedMsg(v, r.unitPrice, 'قیمت ثبت شد'), await act.patchAsset(a.id, { price: { ...a.price, value: v, updatedAt: Date.now() } }))}><${Money} v=${r.unitPrice} s=${s} unit=${false} /></${InlineMoney}>` : html`<${Money} v=${r.unitPrice} s=${s} unit=${false} />`}` : ''}<${SourceLine} r=${r} /></td>
              <td class="n"><div class="sb">${a.mode === 'balance' && !a.interest?.on ? html`<${InlineMoney} value=${r.value} s=${s} onSave=${async (v) => doneToast(savedMsg(v, r.value, 'ثبت شد'), await act.patchAsset(a.id, { balance: v, balanceAt: Date.now() }))}><${Money} v=${r.value} s=${s} cls=${liab ? 'debt' : ''} /></${InlineMoney}>` : html`<${Money} v=${r.value} s=${s} cls=${liab ? 'debt' : ''} />`}</div>
                ${!liab && html`<div class="share-bar" title=${pct(share, { sign: false })}><i style=${`width:${Math.min(100, share * 100 * 2)}%;background:${r.cat.color}`}></i></div>`}</td>
              <td class="n small c-today">${Math.abs(r.dayChange) >= 1 ? html`<${Money} v=${r.dayChange} s=${s} compact sign unit=${false} cls=${r.dayChange > 0 ? 'pos' : 'neg'} />` : html`<span class="faint">—</span>`}</td>
              ${hasPnl && html`<td class="n small c-pnl">${r.pnl !== null ? html`<div class=${r.pnl >= 0 ? 'pos' : 'neg'}><${Money} v=${r.pnl} s=${s} compact sign unit=${false} /></div><div class="xs"><${Delta} p=${r.ret} showAbs=${false} /></div>` : html`<span class="faint">—</span>`}</td>`}
              <td class="c-status"><${StatusPill} status=${r.status} at=${r.at} title=${r.error || ''} /><div class="xs faint" style="margin-top:3px">${a.mode === 'loan' && r.status === 'auto' ? 'قسط ' + fmtJ(E.loanState(a.loan).next.date, 'dm') : r.status === 'auto' ? 'هر لحظه' : r.status === 'matured' ? fmtJ(a.rate.maturity, 'dm') : r.at ? ago(r.at) : '—'}</div></td>
              <td onClick=${(e) => e.stopPropagation()}><div class="row" style="gap:2px;justify-content:flex-end">
                <button class="btn icon sm ghost acts" title="ویرایش" onClick=${() => open(a)}><${Icon} n="edit" cls="sm" /></button>
                <button class="btn icon sm ghost" title=${isOpen ? 'بستن جزئیات' : 'جزئیات'} onClick=${() => setOpenId(isOpen ? null : a.id)}><${Icon} n="chevronDown" cls="sm chev" /></button>
              </div></td>
            </tr>
            ${isOpen && html`<tr class="xrow"><td colspan=${hasPnl ? 8 : 7}><${Expanded} st=${st} r=${r} s=${s} pf=${pf} open=${open} onModal=${setModal} /></td></tr>`}`;
          })}`)}
        </tbody>
        <tfoot><tr><td class="b" style="padding:14px 12px">جمع ${fCat !== 'all' || fAtt || term ? 'فیلترشده' : 'ارزش خالص'}</td><td class="c-qty"></td><td class="c-price"></td>
          <td class="n b" style="padding:14px 12px"><${Money} v=${rows.reduce((x, r) => x + r.signedValue, 0)} s=${s} /></td>
          <td class="n small c-today" style="padding:14px 12px"><${Money} v=${rows.reduce((x, r) => x + r.dayChange, 0)} s=${s} compact sign /></td><td colspan=${hasPnl ? 3 : 2}></td></tr></tfoot>
      </table>` : html`<div class="empty"><div class="ico"><${Icon} n="assets" /></div>${pf.rows.length ? 'موردی با این فیلتر پیدا نشد.' : 'هنوز دارایی‌ای ثبت نشده.'}
        <div class="row" style="margin-top:10px;justify-content:center">${pf.rows.length > 0 && (fCat !== 'all' || fAtt) && html`<button class="btn" onClick=${() => { setCat('all'); setOnlyAtt(false); }}>نمایش همه</button>`}<button class="btn primary" onClick=${() => open(null)}><${Icon} n="plus" />افزودن دارایی</button></div></div>`}
    </div>
    <div class="xs muted row"><${Icon} n="info" cls="sm" />برای دیدن جزئیات روی هر ردیف بزن. قیمت دستی یا مانده را همان‌جا با کلیک ویرایش کن. میانبرها: <span class="kbd">N</span> دارایی جدید، <span class="kbd">/</span> جست‌وجو</div>
    ${modal?.t === 'trade' && html`<${TradeModal} st=${st} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'adjust' && html`<${AdjustModal} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'value' && html`<${ValueModal} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'loanpay' && html`<${LoanPayModal} st=${st} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'matured' && html`<${MaturedModal} st=${st} s=${s} asset=${modal.a} onClose=${() => setModal(null)} />`}
  </div>`;
}
