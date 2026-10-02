import { html, useState, useEffect, useMemo, Icon, Drawer, Seg, NumField, MoneyField, JDateField, Money, Ava, Toggle, send, toast, refLabel, num, pct, fmtJ, money } from '../components.js';
import { CryptoPicker } from '../pickers.js';
import { CATEGORIES, CAT, TGJU, TGJU_BY_KEY, NOBITEX_BY_KEY, LIQUIDITY, METAL_PRESETS } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import { todayIso, addJMonthsIso } from '../../lib/jalali.js';
import { uid } from '../../lib/format.js';
import { act, doneToast } from '../actions.js';

const MODES = [
  { id: 'units', t: 'تعداد × قیمت', d: 'طلا، سکه، ارز، سهام، صندوق، رمزارز', icon: 'coin' },
  { id: 'balance', t: 'مانده / ارزش کل', d: 'حساب بانکی، ملک، خودرو، طلب، بدهی', icon: 'bank' },
  { id: 'rate', t: 'سود با نرخ ثابت', d: 'سپرده، درآمد ثابت، شراکت؛ رشد خودکار روزانه', icon: 'percent' },
  { id: 'loan', t: 'قسطی', d: 'وام بانکی یا قرضی که ماهانه قسط دارد؛ مانده خودکار کم می‌شود', icon: 'calendar' },
];
/** Installments make sense for what you owe or are owed. */
const LOAN_CATS = new Set(['debt', 'receivable']);
/** The valuation methods that make sense for each kind of asset (first = default). Others are hidden. */
const METHODS = { bank: ['balance'], debt: ['loan', 'balance', 'rate'], receivable: ['loan', 'rate', 'balance'], fixed: ['rate', 'units', 'balance'],
  property: ['balance'], private: ['units', 'balance'], other: ['balance', 'units', 'rate'] };
const methodsFor = (cat, cur) => { const m = METHODS[cat] || ['units', 'balance']; return m.includes(cur) ? m : [...m, cur]; };
const NAME_HINT = { bank: 'مثلاً: حساب کوتاه‌مدت', fixed: 'مثلاً: سپرده یک‌ساله', gold_online: 'مثلاً: طلای آب‌شده', gold: 'مثلاً: سکه امامی', metal: 'مثلاً: نقره',
  fx: 'مثلاً: دلار نقد', stock: 'مثلاً: صندوق طلا', crypto: 'مثلاً: تتر', private: 'مثلاً: سهام شرکت', property: 'مثلاً: آپارتمان یا خودرو',
  receivable: 'مثلاً: طلب از دوست', other: 'مثلاً: وسیله قیمتی', debt: 'مثلاً: وام مسکن' };
const blankLoan = () => ({ amount: null, annualPct: null, months: null, firstDue: addJMonthsIso(todayIso(), 1), installment: null, account: '' });

const DEFAULT_REF = { metal: { provider: 'tgju', key: 'silver_999' }, gold_online: { provider: 'tgju', key: 'geram18' }, gold: { provider: 'tgju', key: 'geram18' }, fx: { provider: 'tgju', key: 'price_dollar_rl' }, crypto: { provider: 'nobitex', key: 'usdt' }, stock: { provider: 'tsetmc', key: '' }, fixed: { provider: 'fipiran', key: '' } };
const DEFAULT_UNIT = { metal: 'گرم', gold_online: 'گرم', gold: 'گرم', fx: 'دلار', crypto: 'USDT', stock: 'سهم', private: 'سهم', fixed: 'واحد' };

/** The natural unit of a price source: «هر گرم» → گرم, a coin → its symbol, a stock → سهم. */
export function unitFor(ref) {
  if (!ref) return '';
  if (ref.provider === 'tgju') { const u = TGJU_BY_KEY[ref.key]?.unit || ''; return u.replace(/^هر\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim(); }
  if (ref.provider === 'nobitex') return String(NOBITEX_BY_KEY[ref.key]?.sym || ref.sym || ref.key || '').toUpperCase();
  if (ref.provider === 'tsetmc') return 'سهم';
  if (ref.provider === 'fipiran') return 'واحد';
  return '';
}
const AUTO_UNITS = new Set(['', 'واحد', ...Object.values(DEFAULT_UNIT)]);

function blank(cat = 'bank') {
  const c = CAT[cat];
  return { id: uid('a'), name: '', category: cat, custodian: '', code: '', liquidity: c.liquidity, note: '', mode: c.defaultMode,
    quantity: null, unit: DEFAULT_UNIT[cat] || 'واحد',
    price: { source: DEFAULT_REF[cat] ? 'market' : 'manual', value: null, ref: DEFAULT_REF[cat] ? { ...DEFAULT_REF[cat] } : null, adjustPct: 0, factor: 1 },
    balance: null, rate: { principal: null, annualPct: null, start: todayIso(), mode: 'payout', payoutTo: 'self', maturity: null }, loan: blankLoan(), costBasis: null,
    ...(cat === 'debt' ? { mode: 'loan' } : {}) };
}

/* ---------------- market source picker ---------------- */
function SourcePicker({ st, s, price, setPrice, cat }) {
  const ref = price.ref || { provider: 'tgju', key: '' };
  const setRef = (r) => setPrice({ ...price, ref: r });
  const [q, setQ] = useState(ref.provider === 'tsetmc' ? (ref.symbol || '') : '');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const search = async (text = q) => {
    if (!text.trim() && ref.provider === 'tsetmc') return;
    setLoading(true); setErr('');
    const r = await send('search', { provider: ref.provider, q: text });
    setLoading(false);
    if (r?.ok) setRes(r.items); else { setRes([]); setErr(r?.error || 'جست‌وجو انجام نشد'); }
  };
  useEffect(() => { setRes(null); setErr(''); if (ref.provider === 'fipiran') search(''); }, [ref.provider]);
  const prov = ref.provider;
  return html`<div class="col" style="gap:10px">
    <${Seg} value=${prov} onChange=${(p) => setRef({ provider: p, key: p === 'tgju' ? 'geram18' : p === 'nobitex' ? 'usdt' : '', field: p === 'tsetmc' ? 'close' : p === 'fipiran' ? 'cancelNav' : undefined })}
      options=${[['tgju', 'طلا، سکه و ارز'], ['tsetmc', 'سهام و صندوق بورسی'], ['fipiran', 'صندوق‌های سرمایه‌گذاری'], ['nobitex', 'رمزارز']]} />
    ${prov === 'tgju' && html`<div class="picker"><div class="scroll">${TGJU.map((t) => {
      const qv = st.quotes['tgju:' + t.key];
      return html`<div class=${'opt' + (ref.key === t.key ? ' on' : '')} onClick=${() => setRef({ provider: 'tgju', key: t.key })}>
        <span class="grow sb">${t.name} <span class="xs muted">${t.unit}</span></span>
        <span class="small num">${qv?.price ? (t.usd ? '$' + num(qv.price, 2) : html`<${Money} v=${qv.price} s=${s} />`) : ''}</span>
        ${ref.key === t.key && html`<${Icon} n="check" cls="sm" />`}</div>`;
    })}</div></div>`}
    ${prov === 'nobitex' && html`<${CryptoPicker} st=${st} s=${s} autoFocus=${false} isOn=${(r) => r.key === ref.key} onPick=${(r) => setRef(r)} />
      ${ref.key && html`<div class="callout"><${Icon} n="check" cls="sm" /><div>انتخاب‌شده: <b>${refLabel(ref)}</b></div></div>`}`}
    ${(prov === 'tsetmc' || prov === 'fipiran') && html`<div class="col" style="gap:8px">
      <div class="row"><input class="input" placeholder=${prov === 'tsetmc' ? 'نماد را بنویس: فولاد، خودرو، شستا، کهربا…' : 'نام صندوق: فیروزه، آگاه…'} value=${q}
        onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && (e.preventDefault(), search())} />
        <button type="button" class="btn" onClick=${() => search()} disabled=${loading}><${Icon} n=${loading ? 'refresh' : 'search'} cls=${loading ? 'sm spin' : 'sm'} />جست‌وجو</button></div>
      ${ref.key && html`<div class="callout"><${Icon} n="check" cls="sm" /><div>انتخاب‌شده: <b>${refLabel(ref)}</b> ${ref.name && ref.name !== ref.label ? html`<span class="muted">— ${ref.name}</span>` : ''}</div></div>`}
      ${!ref.key && ref.symbol && html`<div class="callout warn"><${Icon} n="info" cls="sm" /><div>نماد «${ref.symbol}» هنوز شناسایی نشده؛ جست‌وجو کن و از فهرست انتخاب کن (یا در به‌روزرسانی بعدی خودکار شناسایی می‌شود).</div></div>`}
      ${err && html`<div class="callout err"><${Icon} n="wifi" cls="sm" /><div>${err}. ${prov === 'tsetmc' ? 'سایت TSETMC گاهی از خارج ایران یا با VPN پاسخ نمی‌دهد.' : ''}</div></div>`}
      ${res && html`<div class="picker"><div class="scroll">${res.length ? res.map((it) => prov === 'tsetmc'
        ? html`<div class=${'opt' + (ref.key === it.insCode ? ' on' : '')} onClick=${() => setRef({ provider: 'tsetmc', key: it.insCode, symbol: it.symbol, label: it.symbol, name: it.name, field: ref.field || 'close' })}>
            <span class="grow"><span class="sb">${it.symbol}</span> <span class="xs muted">${it.name}</span></span><span class="xs muted">${it.market}${it.active ? '' : '، غیرفعال'}</span></div>`
        : html`<div class=${'opt' + (ref.key === it.regNo ? ' on' : '')} onClick=${() => setRef({ provider: 'fipiran', key: it.regNo, label: it.name, name: it.name, field: ref.field || 'cancelNav' })}>
            <span class="grow"><span class="sb">${it.name}</span> <span class="xs muted">${it.type}</span></span><span class="small num"><${Money} v=${it.cancelNav} s=${s} /></span></div>`)
        : html`<div class="opt muted">نتیجه‌ای پیدا نشد</div>`}</div></div>`}
      ${prov === 'tsetmc' && html`<div class="row"><span class="lbl">قیمت مبنا</span><${Seg} value=${ref.field || 'close'} onChange=${(f) => setRef({ ...ref, field: f })} options=${[['close', 'قیمت پایانی'], ['last', 'آخرین معامله'], ['nav', 'NAV ابطال (ETF)']]} /></div>`}
      ${prov === 'fipiran' && html`<div class="row"><span class="lbl">قیمت مبنا</span><${Seg} value=${ref.field || 'cancelNav'} onChange=${(f) => setRef({ ...ref, field: f })} options=${[['cancelNav', 'NAV ابطال'], ['issueNav', 'NAV صدور'], ['statisticalNav', 'NAV آماری']]} /></div>`}
    </div>`}
  </div>`;
}

/* ---------------- main editor ---------------- */
export function AssetEditor({ st, s, asset, preset, onClose }) {
  const isNew = !asset;
  const [a, setA] = useState(() => {
    const base = asset ? structuredClone(asset) : blank(preset?.category || 'bank');
    if (!base.price) base.price = { source: 'manual', value: null, ref: null, adjustPct: 0, factor: 1 };
    if (!base.rate) base.rate = { principal: null, annualPct: null, start: todayIso(), mode: 'payout', payoutTo: 'self', maturity: null };
    if (!base.loan) base.loan = blankLoan();
    if (preset?.mode) {
      // "automate this" suggestion: carry over current value
      const v = E.valueOf(base, st.quotes, s).value;
      if (preset.mode === 'rate' && base.mode !== 'rate') base.rate.principal = v;
      if (preset.mode === 'loan' && base.mode !== 'loan') base.loan.amount = v || null;
      if (preset.mode === 'units' && preset.source === 'market') { base.price.source = 'market'; base.price.ref = base.price.ref || { ...(DEFAULT_REF[base.category] || { provider: 'tgju', key: 'geram18' }) }; }
      base.mode = preset.mode;
    }
    return base;
  });
  const [adv, setAdv] = useState(!!(a.price?.adjustPct || (a.price?.factor && a.price.factor !== 1)));
  const [preview, setPreview] = useState({ loading: false, q: null, err: null });
  const set = (patch) => setA((x) => ({ ...x, ...patch }));
  // Picking another price source also fixes the unit label, unless the owner typed their own unit.
  const [autoName, setAutoName] = useState(null);
  const setPrice = (p) => setA((x) => {
    const price = { ...x.price, ...p };
    let unit = x.unit; let name = x.name;
    // an empty name (or one we filled in) follows the picked price source
    if (p.ref?.key && E.quoteId(p.ref) !== E.quoteId(x.price.ref || {}) && (!x.name.trim() || x.name === autoName)) { name = refLabel(p.ref); setAutoName(name); }
    if (p.ref && p.ref.key && E.quoteId(p.ref) !== E.quoteId(x.price.ref || {}) && (+price.factor || 1) === 1 && (AUTO_UNITS.has(unit || '') || unit === unitFor(x.price.ref))) unit = unitFor(p.ref) || unit;
    if (p.ref && E.quoteId(p.ref) !== E.quoteId(x.price.ref || {})) delete price.last; // the old source's last price
    return { ...x, price, unit, name };
  });
  const setRate = (p) => setA((x) => ({ ...x, rate: { ...x.rate, ...p } }));
  const setLoan = (p) => setA((x) => ({ ...x, loan: { ...x.loan, ...p } }));
  const [fund, setFund] = useState({ on: false, accountId: '', amount: null });
  const cat = CAT[a.category];

  const pickCat = (id) => {
    const c = CAT[id];
    setA((x) => {
      const n = { ...x, category: id, liquidity: c.liquidity };
      if (n.mode === 'loan' && !LOAN_CATS.has(id)) n.mode = c.defaultMode;
      if (isNew) {
        n.mode = methodsFor(id, null)[0] || c.defaultMode; n.unit = DEFAULT_UNIT[id] || x.unit;
        if (DEFAULT_REF[id]) n.price = { ...x.price, source: 'market', ref: { ...DEFAULT_REF[id] } }; else n.price = { ...x.price, source: 'manual' };
      }
      return n;
    });
  };

  // Live preview of market price
  const refKey = a.mode === 'units' && a.price.source === 'market' && a.price.ref?.key ? E.quoteId(a.price.ref) : null;
  useEffect(() => {
    if (!refKey) { setPreview({ loading: false, q: null, err: null }); return; }
    const stored = st.quotes[refKey];
    if (stored?.price && !stored.error && Date.now() - (stored.fetchedAt || 0) < 15 * 60000) { setPreview({ loading: false, q: stored, err: null }); return; }
    let alive = true;
    setPreview({ loading: true, q: stored || null, err: null });
    send('quote', { ref: a.price.ref }).then((r) => { if (alive) setPreview({ loading: false, q: r?.quote || stored || null, err: r?.quote ? null : (r?.error || 'دریافت قیمت ممکن نشد') }); });
    return () => { alive = false; };
  }, [refKey]);

  const quotes = preview.q && refKey ? { ...st.quotes, [refKey]: preview.q } : st.quotes;
  const val = useMemo(() => E.valueOf({ ...a, quantity: +a.quantity || 0 }, quotes, s), [a, quotes]);
  const balanceTargets = st.assets.filter((x) => x.id !== a.id && !x.archived && (x.mode === 'balance' || x.mode === 'rate') && !CAT[x.category]?.liability);

  const appraised = E.APPRAISED.has(a.category) && a.mode === 'balance' && asset?.mode === 'balance';
  const balChanged = !isNew && a.balance !== null && +a.balance !== +asset?.balance;
  const [why, setWhy] = useState('reval');
  const L = a.loan || blankLoan();
  const plan = a.mode === 'loan' && +L.amount > 0 && +L.months >= 1 ? E.loanState({ ...L, installment: +L.installment || null }, todayIso()) : null;
  const liabCat = !!cat.liability;
  // «where did the money come from?» (new assets only): the account's balance and the amount moved
  const fundAcc = fund.on ? balanceTargets.find((x) => x.id === fund.accountId) : null;
  // a loan already being repaid (or a deposit already running) got its money long ago — only new ones are funded now
  const fundOk = a.mode === 'loan' ? !plan || plan.paid === 0 : true;
  const fundDefault = a.mode === 'loan' ? +L.amount || 0 : a.mode === 'rate' ? +a.rate.principal || 0 : Math.abs(val.value) || 0;
  const fundAmt = fund.amount ?? fundDefault;
  const fundShort = fundAcc && !liabCat && fundAmt > (E.valueOf(fundAcc, st.quotes, s).value || 0) + 0.5;
  // what's missing or wrong, by field (shown in red on the field itself after a save attempt)
  const bad = {};
  if (!a.name.trim()) bad.name = 'نام دارایی';
  if (a.mode === 'units' && !(+a.quantity > 0) && !(!isNew && a.quantity !== null && +a.quantity === 0)) bad.qty = 'مقدار';
  if (a.mode === 'units' && a.price.source === 'manual' && !(+a.price.value > 0)) bad.price = 'قیمت واحد';
  if (a.mode === 'units' && a.price.source === 'market' && !a.price.ref?.key && !a.price.ref?.symbol) bad.src = 'منبع قیمت';
  if (a.mode === 'balance' && !(isFinite(+a.balance) && a.balance !== null)) bad.balance = 'مبلغ';
  if (a.mode === 'balance' && a.interest?.on && !(+a.interest.annualPct > 0)) bad.irate = 'نرخ سود روزشمار';
  if (a.mode === 'rate') {
    if (!(+a.rate.principal > 0)) bad.rprin = 'اصل سرمایه';
    if (a.rate.annualPct === null || a.rate.annualPct === '' || !(+a.rate.annualPct >= 0)) bad.rpct = 'نرخ سود';
    if (!a.rate.start) bad.rstart = 'تاریخ شروع';
    if (a.rate.maturity && a.rate.start && a.rate.maturity <= a.rate.start) bad.rmat = 'سررسید (باید بعد از شروع باشد)';
  }
  if (a.mode === 'loan') {
    if (!(+L.amount > 0)) bad.lamount = 'مبلغ وام';
    if (!(+L.months >= 1)) bad.lmonths = 'تعداد اقساط';
    if (L.annualPct === null || L.annualPct === '' || !(+L.annualPct >= 0)) bad.lpct = 'نرخ سود (برای بدون سود: صفر)';
    if (!L.firstDue) bad.lfirst = 'تاریخ اولین قسط';
    if (L.start && L.firstDue && L.start >= L.firstDue) bad.lstart = 'تاریخ دریافت وام (باید قبل از اولین قسط باشد)';
    if (+L.installment > 0 && +L.amount > 0 && +L.installment <= +L.amount * (+L.annualPct || 0) / 1200) bad.linst = 'مبلغ قسط (کمتر از سود ماهانه است)';
  }
  if (isNew && fundOk && fund.on && !fundAcc) bad.facc = liabCat ? 'حسابی که پول وام به آن رفت' : 'حسابی که پول از آن آمد';
  if (isNew && fundOk && fund.on && !(fundAmt > 0)) bad.famt = 'مبلغ';
  const errors = Object.values(bad);
  const [tried, setTried] = useState(false);
  const E_ = (k) => tried && !!bad[k];

  const save = async () => {
    if (errors.length) {
      setTried(true);
      toast(errors.length === 1 ? `«${errors[0]}» را کامل یا درست کن` : 'چند خانه خالی یا نادرست مانده؛ با رنگ قرمز مشخص شده‌اند');
      setTimeout(() => { const el = document.querySelector('.drawer .input.err, .drawer .err-msg'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (el?.focus) el.focus({ preventScroll: true }); }, 30);
      return;
    }
    const out = structuredClone(a);
    out.name = out.name.trim(); out.custodian = (out.custodian || '').trim().replace(/\s+/g, ' ');
    if (out.mode === 'units') {
      out.quantity = +out.quantity;
      if (out.price.source === 'manual') out.price.updatedAt = (asset?.price?.value === out.price.value && asset?.price?.updatedAt) || Date.now();
      if (out.price.source === 'market' && preview.q?.price) out.price.last = { price: val.unitPrice, at: Date.now() };
    }
    if (out.mode === 'balance') {
      out.balance = +out.balance; if (asset?.balance !== out.balance) out.balanceAt = Date.now();
      if (out.interest?.on) out.interest = { ...out.interest, annualPct: +out.interest.annualPct, accrued: +out.interest.accrued || 0 };
    }
    if (out.mode === 'rate') { out.rate.principal = +out.rate.principal; out.rate.annualPct = +out.rate.annualPct; if (asset?.rate?.start !== out.rate.start) delete out.rate.lastPayout; }
    if (out.mode === 'loan') out.loan = { ...out.loan, amount: +out.loan.amount, annualPct: +out.loan.annualPct, months: Math.round(+out.loan.months), installment: +out.loan.installment > 0 ? +out.loan.installment : null, account: out.loan.account || null };
    delete out.review;
    if (out.mode === 'loan') { out.loan.start = out.loan.start || null; if (!out.loan.start) delete out.loan.start; }
    const ev = await act.saveAsset(out, {
      orig: asset || null,
      ...(appraised && balChanged ? { reval: why === 'reval' } : {}),
      ...(isNew && fundOk && fund.on && fundAcc && fundAmt > 0 ? { fund: { accountId: fundAcc.id, amount: fundAmt } } : {}),
    });
    doneToast(isNew ? 'دارایی اضافه شد' : 'ذخیره شد', ev);
    onClose();
  };

  const r = a.rate;
  const nextPay = a.mode === 'rate' && r.mode === 'payout' && r.start ? E.nextMonthlyAfter(r.start, r.start > todayIso() ? r.start : todayIso()) : null;

  return html`<${Drawer} title=${isNew ? 'افزودن دارایی' : 'ویرایش دارایی'} onClose=${onClose} icon=${html`<${Ava} cat=${a.category} size=${32} />`}
    footer=${html`
      <button class="btn primary" onClick=${save}><${Icon} n="check" />${isNew ? 'افزودن' : 'ذخیره تغییرات'}</button>
      <button class="btn" onClick=${onClose}>انصراف</button>
      <span class="grow"></span>
      ${!isNew && html`<button class="btn danger" onClick=${() => { act.deleteAsset(a.id); onClose(); }}><${Icon} n="trash" cls="sm" />حذف</button>`}`}>

    <div class="sec"><div class="st"><${Icon} n="layers" cls="sm" />دسته‌بندی</div>
      <div class="catgrid">${CATEGORIES.map((c) => html`<button type="button" class=${'catbtn' + (a.category === c.id ? ' on' : '')} onClick=${() => pickCat(c.id)}><${Ava} cat=${c.id} size=${24} /><span class="ellipsis">${c.short}</span></button>`)}</div>
    </div>

    <div class="sec"><div class="st"><${Icon} n="edit" cls="sm" />مشخصات</div>
      <div class="field"><label>نام دارایی</label><input class=${'input' + (E_('name') ? ' err' : '')} autoFocus=${isNew} value=${a.name} onInput=${(e) => set({ name: e.target.value })} placeholder=${NAME_HINT[a.category] || 'مثلاً: …'} aria-invalid=${E_('name') ? 'true' : undefined} />
        ${E_('name') && html`<span class="err-msg">یک نام کوتاه بنویس</span>`}</div>
      <div class=${cat.liability ? '' : 'grid2'}>
        <div class="field"><label>${cat.liability ? 'بانک یا طلبکار' : 'محل نگهداری / بانک / کارگزاری'}</label><input class="input" value=${a.custodian || ''} onInput=${(e) => set({ custodian: e.target.value })} placeholder=${cat.liability ? 'مثلاً: نام بانک' : 'مثلاً: نام بانک یا کارگزاری'} /></div>
        ${!cat.liability && html`<div class="field"><label>سرعت نقد شدن</label><${Seg} value=${a.liquidity} onChange=${(v) => set({ liquidity: v })} options=${Object.entries(LIQUIDITY)} /></div>`}
      </div>
    </div>

    <div class="sec"><div class="st"><${Icon} n="zap" cls="sm" />روش ارزش‌گذاری و به‌روزرسانی</div>
      ${methodsFor(a.category, a.mode).length > 1 && html`<div class="modes">${MODES.filter((m) => methodsFor(a.category, a.mode).includes(m.id)).map((m) => html`<button type="button" class=${'mode' + (a.mode === m.id ? ' on' : '')} onClick=${() => setA((x) => {
          if (x.mode === m.id) return x;
          // carry the current value over, so switching method doesn't start from an empty form
          const cur = Math.abs(val.value) > 0 ? Math.round(val.value) : null;
          const n = { ...x, mode: m.id };
          if (m.id === 'balance' && (x.balance === null || x.balance === undefined)) n.balance = cur;
          if (m.id === 'rate' && !(+x.rate?.principal > 0)) n.rate = { ...x.rate, principal: cur };
          if (m.id === 'loan' && !(+x.loan?.amount > 0)) n.loan = { ...(x.loan || blankLoan()), amount: cur };
          if (m.id === 'units' && x.price.source === 'manual' && !(+x.price.value > 0) && cur && !(+x.quantity > 0)) { n.quantity = 1; n.price = { ...x.price, value: cur }; }
          return n;
        })}>
        <span class="mt"><${Icon} n=${m.icon} cls="sm" />${m.id === 'loan' ? (liabCat ? 'وام قسطی' : 'طلب قسطی') : m.t}</span><span class="md">${m.id === 'loan' && !liabCat ? 'قرضی که داده‌ای و ماهانه قسطش را می‌گیری' : m.d}</span></button>`)}</div>`}

      ${a.mode === 'units' && html`
        <div class="grid2">
          <${NumField} label="مقدار / تعداد" value=${a.quantity} onInput=${(v) => set({ quantity: v })} err=${E_('qty')} />
          <div class="field"><label>واحد</label><input class="input" value=${a.unit || ''} onInput=${(e) => set({ unit: e.target.value })} placeholder="گرم، عدد، سهم، دلار…" /></div>
        </div>
        <div class="row between"><span class="lbl">منبع قیمت</span><${Seg} value=${a.price.source} onChange=${(v) => setPrice({ source: v, ref: v === 'market' ? (a.price.ref || { ...(DEFAULT_REF[a.category] || { provider: 'tgju', key: 'geram18' }) }) : a.price.ref,
            ...(v === 'manual' && !(+a.price.value > 0) && val.unitPrice > 0 ? { value: Math.round(val.unitPrice) } : {}) })}
          options=${[['market', 'قیمت آنلاین خودکار'], ['manual', 'ورود دستی']]} /></div>
        ${a.price.source === 'market' && a.category === 'metal' && html`<div class="field"><label>انتخاب سریع فلز</label><div class="row wrap" style="gap:6px">${METAL_PRESETS.map((m) => {
          const on = a.price.ref?.key === m.ref.key && Math.abs((+a.price.factor || 1) - m.factor) < 1e-9;
          return html`<button type="button" class=${'chip' + (on ? ' on' : '')} title=${m.hint} onClick=${() => setA((x) => ({ ...x, name: x.name || m.name, unit: m.unit, price: { ...x.price, source: 'market', ref: { ...m.ref }, factor: m.factor } }))}>${m.name} <span class="xs muted">(${m.unit})</span></button>`;
        })}</div><span class="hint">قیمت مس و پلاتین جهانی است و با نرخ دلار بازار آزاد به ${s.currency === 'rial' ? 'ریال' : 'تومان'} تبدیل می‌شود.</span></div>`}
        ${a.price.source === 'market' ? html`
          <${SourcePicker} st=${st} s=${s} price=${a.price} setPrice=${setPrice} cat=${a.category} />
          <button type="button" class="btn ghost sm" style="align-self:flex-start" onClick=${() => setAdv(!adv)}><${Icon} n="chevronDown" cls="sm" />تنظیم اختلاف قیمت و ضریب</button>
          ${adv && html`<div class="grid2">
            <${NumField} label="اختلاف با قیمت مرجع (٪)" value=${a.price.adjustPct} onInput=${(v) => setPrice({ adjustPct: v || 0 })} hint="مثلاً کارمزد فروش پلتفرم −۱٫۵" />
            <${NumField} label="ضریب" value=${a.price.factor} onInput=${(v) => setPrice({ factor: v || 1 })} hint="مثلاً عیار ۷۵۰÷۷۴۰ یا وزن هر سکه" />
          </div>`}`
        : html`<${MoneyField} label="قیمت هر واحد" rial=${a.price.value} onRial=${(v) => setPrice({ value: v })} s=${s} prev=${asset?.price?.value} err=${E_('price')} />`}
        ${E_('src') && html`<span class="err-msg">از فهرست بالا یک منبع قیمت انتخاب کن (یا «ورود دستی»)</span>`}
      `}

      ${a.mode === 'balance' && html`
        <${MoneyField} label=${cat.liability ? 'مانده بدهی' : a.category === 'bank' ? 'مانده حساب' : 'ارزش فعلی'} rial=${a.balance} onRial=${(v) => set({ balance: v })} s=${s} autoFocus=${!isNew} prev=${asset?.balance} err=${E_('balance')} />
        ${appraised && balChanged && html`<div class="field"><label>چرا ارزش تغییر کرد؟</label><${Seg} value=${why} onChange=${setWhy} options=${[['reval', 'قیمت بازارش عوض شد'], ['money', 'بخشی را خریدم یا فروختم']]} />
          <span class="hint">${why === 'reval' ? 'سود یا زیان بازار حساب می‌شود.' : 'پول واردشده یا خارج‌شده حساب می‌شود، نه سود.'}</span></div>`}
        ${!cat.liability && ['bank', 'fixed', 'receivable', 'other'].includes(a.category) && html`<div class="sec" style="padding:12px;gap:10px;background:var(--surface-2)">
          <div class="row between"><div><div class="sb small">سود روزشمار روی همین مانده</div><div class="xs muted">برای حساب‌های کوتاه‌مدت بانکی: سود هر روز روی مانده همان روز حساب و ماهانه واریز می‌شود.</div></div>
            <${Toggle} on=${!!a.interest?.on} onChange=${(v) => set({ interest: v ? { basis: 365, payDay: 1, ...(a.interest || {}), on: true, since: todayIso(), lastAccrual: null, accrued: 0 } : { ...(a.interest || {}), on: false } })} /></div>
          ${a.interest?.on && html`<div class="grid2">
            <${NumField} label="نرخ سود سالانه" suffix="٪" value=${a.interest.annualPct} onInput=${(v) => set({ interest: { ...a.interest, annualPct: v } })} digits=${2} err=${E_('irate')} />
            <div class="field"><label>روز واریز سود در ماه</label><select class="input" value=${a.interest.payDay ?? 1} onChange=${(e) => set({ interest: { ...a.interest, payDay: +e.target.value } })}>
              ${Array.from({ length: 30 }, (_, i) => i + 1).map((d) => html`<option value=${d}>${num(d)}ام</option>`)}<option value="0">آخر ماه</option></select></div>
          </div>
          ${+a.interest.annualPct > 0 && +a.balance > 0 && html`<div class="grid3">
            <div class="pcell"><span class="n">سود هر روز</span><span class="v"><${Money} v=${+a.balance * a.interest.annualPct / 100 / 365} s=${s} compact /></span></div>
            <div class="pcell"><span class="n">سود ماهانه (تقریبی)</span><span class="v"><${Money} v=${+a.balance * a.interest.annualPct / 100 / 12} s=${s} compact /></span></div>
            <div class="pcell"><span class="n">انباشته تا الان</span><span class="v"><${Money} v=${val.accrued} s=${s} compact /></span></div>
          </div>`}`}
        </div>`}
        ${(a.category === 'fixed' || a.category === 'receivable') && !a.interest?.on && html`<div class="callout"><${Icon} n="sparkles" cls="sm" /><div>اگر اصل ثابت است و سود مشخصی دارد، روش «سود با نرخ ثابت» را انتخاب کن تا ارزشش روزشمار رشد کند.</div></div>`}
        <div class="xs muted">${LOAN_CATS.has(a.category) ? 'اگر قسط ماهانه دارد، روش «قسطی» را انتخاب کن تا مانده و قسط‌ها خودکار حساب شوند.' : 'برای حقوق یا اجاره که هر ماه این مانده را تغییر می‌دهد، در صفحه «خودکارسازی» یک جریان تکراری بساز.'}</div>
      `}

      ${a.mode === 'rate' && html`
        <div class="grid2">
          <${MoneyField} label=${cat.liability ? 'اصل بدهی' : 'اصل سرمایه'} rial=${r.principal} onRial=${(v) => setRate({ principal: v })} s=${s} err=${E_('rprin')} />
          <${NumField} label="نرخ سود سالانه" suffix="٪" value=${r.annualPct} onInput=${(v) => setRate({ annualPct: v })} digits=${2} err=${E_('rpct')} />
        </div>
        <div class="field"><label>نحوه محاسبه سود</label>
          <${Seg} value=${r.mode} onChange=${(v) => setRate({ mode: v })} options=${[['payout', 'روزشمار + واریز ماهانه'], ['compound', 'روزشمار مرکب'], ['simple', 'روزشمار ساده']]} />
          <span class="hint">${r.mode === 'payout' ? 'مثل سپرده بانکی: سود هر روز حساب می‌شود (اصل × نرخ ÷ ۳۶۵) و هر ماه در همان روزِ تاریخ شروع واریز می‌شود.' : r.mode === 'compound' ? 'مثل صندوق درآمد ثابت: ارزش هر روز با نرخ سالانه رشد مرکب می‌کند.' : 'مثل شراکت یا قرض: سود هر روز به‌صورت خطی اضافه می‌شود و مرکب نمی‌شود.'}</span>
        </div>
        <div class="grid2">
          <${JDateField} label="تاریخ شروع" iso=${r.start} onIso=${(v) => setRate({ start: v })} err=${E_('rstart')} />
          <${JDateField} label="تاریخ سررسید (اختیاری)" iso=${r.maturity} onIso=${(v) => setRate({ maturity: v })} allowEmpty hint="خالی = بدون سررسید" err=${E_('rmat')} />
        </div>
        ${E_('rmat') && html`<span class="err-msg">تاریخ سررسید باید بعد از تاریخ شروع باشد.</span>`}
        ${r.mode !== 'compound' && html`<div class="field"><label>مبنای روزشمار</label><${Seg} value=${String(r.basis || 365)} onChange=${(v) => setRate({ basis: v === 'actual' ? 'actual' : +v })} options=${[['365', '۳۶۵ روز'], ['actual', 'طول واقعی سال شمسی'], ['360', '۳۶۰ روز']]} /></div>`}
        ${r.mode === 'payout' && html`<div class="field"><label>واریز سود به</label>
          <select class="input" value=${r.payoutTo || 'self'} onChange=${(e) => setRate({ payoutTo: e.target.value })}>
            <option value="self">همین دارایی (سود روی اصل اضافه شود)</option>
            ${balanceTargets.map((x) => html`<option value=${x.id}>${x.name}${x.custodian && x.custodian !== x.name ? ' — ' + x.custodian : ''}</option>`)}
          </select></div>`}
        ${+r.principal > 0 && +r.annualPct > 0 && html`<div class="grid3">
          <div class="pcell"><span class="n">سود روزانه</span><span class="v"><${Money} v=${E.rateDaily(r, val.value)} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">سود ماهانه</span><span class="v"><${Money} v=${E.rateMonthly(r, val.value)} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">${r.mode === 'payout' ? 'واریز بعدی' : 'سود سالانه'}</span><span class="v">${r.mode === 'payout' && nextPay ? fmtJ(nextPay, 'dm') : html`<${Money} v=${r.principal * r.annualPct / 100} s=${s} compact />`}</span></div>
        </div>`}
      `}

      ${a.mode === 'loan' && html`
        <div class="grid2">
          <${MoneyField} label=${liabCat ? 'مبلغ وام' : 'مبلغ قرض'} rial=${L.amount} onRial=${(v) => setLoan({ amount: v })} s=${s} err=${E_('lamount')} />
          <${NumField} label="نرخ سود سالانه" suffix="٪" value=${L.annualPct} onInput=${(v) => setLoan({ annualPct: v })} digits=${2} hint="بدون سود: صفر؛ قرض‌الحسنه: کارمزد، مثلاً ۴" err=${E_('lpct')} />
        </div>
        <div class="grid2">
          <${NumField} label="تعداد اقساط (ماهانه)" value=${L.months} onInput=${(v) => setLoan({ months: v ? Math.round(v) : null })} digits=${0} err=${E_('lmonths')} />
          <${JDateField} label="تاریخ اولین قسط" iso=${L.firstDue} onIso=${(v) => setLoan({ firstDue: v })} err=${E_('lfirst')} />
        </div>
        <${JDateField} label=${liabCat ? 'تاریخ دریافت وام (اختیاری)' : 'تاریخ پرداخت قرض (اختیاری)'} iso=${L.start || null} onIso=${(v) => setLoan({ start: v })} allowEmpty err=${E_('lstart')}
          hint="اگر تا اولین قسط بیش از یک ماه فاصله دارد (دوره تنفس)، سود این فاصله هم حساب می‌شود. خالی = یک ماه قبل از اولین قسط" />
        <div class="grid2">
          <${MoneyField} err=${E_('linst')} label="مبلغ هر قسط (اختیاری)" rial=${L.installment} onRial=${(v) => setLoan({ installment: v })} s=${s} hint=${plan && !(+L.installment > 0) ? `خالی بگذار تا طبق فرمول بانک حساب شود: ${money(plan.A, s)}` : 'اگر بانک عدد دیگری گفته، همان را بنویس'} />
          <div class="field"><label>${liabCat ? 'قسط‌ها از کدام حساب کم شود؟' : 'قسط‌ها به کدام حساب واریز شود؟'}</label>
            <select class="input" value=${L.account || ''} onChange=${(e) => setLoan({ account: e.target.value })}>
              <option value="">— ثبت نشود —</option>${balanceTargets.map((x) => html`<option value=${x.id}>${x.name}${x.custodian && x.custodian !== x.name ? ' — ' + x.custodian : ''}</option>`)}
            </select></div>
        </div>
        <div class="callout"><${Icon} n="info" cls="sm" /><div>${liabCat ? 'وامی را که از قبل داری' : 'قرضی را که از قبل داده‌ای'} هم همین‌جا ثبت کن: یا مبلغ و تاریخ اولین قسط اصلی را بنویس تا قسط‌های گذشته پرداخت‌شده حساب شوند، یا مانده فعلی، تعداد قسط‌های باقی‌مانده و تاریخ قسط بعدی را.</div></div>
        ${plan && html`<div class="grid3">
          <div class="pcell"><span class="n">قسط ماهانه</span><span class="v"><${Money} v=${plan.A} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">جمع سود کل دوره</span><span class="v"><${Money} v=${plan.totalInterest} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">${plan.done ? 'وضعیت' : 'قسط بعدی'}</span><span class="v">${plan.done ? 'تسویه شده' : `${fmtJ(plan.next.date, 'dm')} (${num(plan.paid + 1)} از ${num(plan.n)})`}</span></div>
        </div>
        ${plan.rows.length && Math.abs(plan.rows[plan.rows.length - 1].payment - plan.A) > Math.max(plan.A * 0.5, 1) && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>با این مبلغ قسط، قسط آخر <${Money} v=${plan.rows[plan.rows.length - 1].payment} s=${s} /> می‌شود. مبلغ قسط یا تعداد اقساط را بررسی کن.</div></div>`}`}
      `}

      <div class="preview">
        <div><div class="xs muted">${a.mode === 'loan' ? (liabCat ? 'مانده بدهی امروز' : 'مانده طلب امروز') : 'ارزش فعلی'}</div><div class="v"><${Money} v=${val.value} s=${s} cls=${cat.liability ? 'debt' : ''} /></div>
          ${a.mode === 'units' && html`<div class="xs muted num">${num(+a.quantity || 0, 'auto')} ${a.unit || ''} × <${Money} v=${val.unitPrice} s=${s} /></div>`}</div>
        <div style="text-align:left">
          ${a.mode === 'units' && a.price.source === 'market' && html`${preview.loading ? html`<span class="pill"><${Icon} n="refresh" cls="sm spin" />دریافت قیمت…</span>` : preview.q?.price ? html`<span class="pill live"><i class="blink"></i>قیمت زنده</span>` : html`<span class="pill error" title=${preview.err || ''}>قیمت دریافت نشد</span>`}
            ${preview.q?.changePct ? html`<div class="xs" style="margin-top:4px">امروز <span class=${preview.q.changePct >= 0 ? 'pos' : 'neg'}>${pct(preview.q.changePct)}</span></div>` : ''}`}
          ${a.mode === 'rate' && html`<span class="pill auto">رشد خودکار</span>`}
          ${a.mode === 'loan' && html`<span class="pill auto">قسط‌ها خودکار</span>`}
        </div>
      </div>
      ${a.mode === 'units' && a.price.source === 'market' && preview.err && !preview.q?.price && html`<div class="callout warn"><${Icon} n="wifi" cls="sm" /><div>${preview.err}. ذخیره کن؛ در به‌روزرسانی بعدی دوباره تلاش می‌شود${a.price.value ? ' و تا آن موقع آخرین قیمت شناخته‌شده استفاده می‌شود' : ''}.</div></div>`}
    </div>

    ${isNew && fundOk && balanceTargets.length > 0 && html`<div class="sec"><div class="st"><${Icon} n="swap" cls="sm" />${liabCat ? 'پول این وام کجا رفت؟' : 'پولش از کجا آمد؟'}</div>
      <${Seg} value=${fund.on ? 'acc' : 'none'} onChange=${(v) => setFund((f) => ({ ...f, on: v === 'acc', accountId: f.accountId || (v === 'acc' && balanceTargets.length === 1 ? balanceTargets[0].id : f.accountId) }))}
        options=${liabCat ? [['none', 'ثبت نشود'], ['acc', 'به حسابم واریز شد']] : [['none', 'از قبل داشتم'], ['acc', 'از حسابم پرداختم']]} />
      ${fund.on && html`<div class="grid2">
        <div class="field"><label>${liabCat ? 'واریز به حساب' : 'پرداخت از حساب'}</label><select class=${'input' + (E_('facc') ? ' err' : '')} value=${fund.accountId} onChange=${(e) => setFund((f) => ({ ...f, accountId: e.target.value }))}>
          <option value="">— انتخاب کن —</option>${balanceTargets.map((x) => html`<option value=${x.id}>${x.name}${x.custodian && x.custodian !== x.name ? ' — ' + x.custodian : ''}</option>`)}</select></div>
        <${MoneyField} label=${liabCat ? 'مبلغ واریزشده' : 'مبلغ پرداختی'} rial=${fundAmt || null} onRial=${(v) => setFund((f) => ({ ...f, amount: v }))} s=${s} err=${E_('famt')} hint=${liabCat ? '' : a.mode === 'rate' ? '' : 'اگر با کارمزد یا قیمتی غیر از قیمت روز خریدی، مبلغ واقعی را بنویس؛ همین به‌عنوان قیمت خرید ثبت می‌شود'} />
      </div>
      ${fundShort && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>مانده «${fundAcc.name}» کافی نیست؛ اگر ثبت کنی منفی می‌شود.</div></div>`}`}
      <span class="hint">${fund.on ? (liabCat ? 'مبلغ به آن حساب اضافه می‌شود؛ ارزش خالص تغییری نمی‌کند.' : 'مبلغ از آن حساب کم می‌شود؛ پول تازه یا سود حساب نمی‌شود.') : (liabCat ? 'اگر پول وام به حسابی رفته که در دارا ثبت کرده‌ای، انتخابش کن.' : 'اگر همین حالا با پول یکی از حساب‌هایت خریدی، انتخابش کن تا از آن کم شود.')}</span>
    </div>`}

    <div class="sec"><div class="st"><${Icon} n="target" cls="sm" />جزئیات بیشتر (اختیاری)</div>
      ${!cat.liability && a.mode !== 'rate' && a.mode !== 'loan' && html`<div class="grid2">
        ${isNew && fund.on ? html`<div class="field"><label>قیمت خرید</label><span class="hint">همان مبلغ پرداختی ثبت می‌شود.</span></div>` : html`<${MoneyField} label="قیمت خرید کل (اختیاری)" rial=${a.costBasis} onRial=${(v) => set({ costBasis: v })} s=${s} hint="برای محاسبه سود و زیان" />`}
        ${(a.mode === 'balance' || a.price.source === 'manual') ? html`<div class="field"><label>یادآوری به‌روزرسانی</label>
          <select class="input" value=${a.remindDays ?? ''} onChange=${(e) => set({ remindDays: e.target.value === '' ? null : +e.target.value })}>
            <option value="">پیش‌فرض (${num(E.remindDaysFor({ ...a, remindDays: null }, s))} روز)</option><option value="1">هر روز</option><option value="7">هر هفته</option><option value="30">هر ماه</option><option value="90">هر سه ماه</option><option value="0">هرگز</option>
          </select></div>` : html`<div></div>`}
      </div>`}
      ${a.mode !== 'loan' && html`<${JDateField} label="تاریخ خرید / شروع نگهداری" iso=${a.since || null} onIso=${(v) => set({ since: v })} allowEmpty hint="برای بازسازی دقیق‌تر تاریخچه؛ خالی یعنی از قبل داشته‌ای" />`}
      <div class="field"><label>یادداشت</label><textarea class="input" rows="2" value=${a.note || ''} onInput=${(e) => set({ note: e.target.value })} placeholder="شماره حساب، لینک منبع، توضیحات…"></textarea></div>
    </div>
  </${Drawer}>`;
}
