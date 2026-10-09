import { html, useState, useEffect, useMemo, useRef, Tip, Icon, Drawer, Seg, NumField, MoneyField, JDateField, Money, Ava, Toggle, send, toast, refLabel, num, pct, fmtJ, money } from '../components.js';
import { CryptoPicker } from '../pickers.js';
import { CATEGORIES, CAT, TGJU, TGJU_BY_KEY, NOBITEX_BY_KEY, LIQUIDITY, METAL_PRESETS, GOLD_PRESETS } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import { todayIso, addJMonthsIso } from '../../lib/jalali.js';
import { uid } from '../../lib/format.js';
import { act, doneToast } from '../actions.js';
import { CAT_GUIDE, CAT_SWITCH, modeDesc, L as LT, T, methodTip } from '../tips.js';

const QUICK = { metal: { label: 'انتخاب سریع فلز', list: METAL_PRESETS }, gold: { label: 'چه چیزی داری؟', list: GOLD_PRESETS } };

const MODES = [
  { id: 'units', t: 'تعداد × قیمت', icon: 'coin' },
  { id: 'balance', t: 'مانده / ارزش کل', icon: 'bank' },
  { id: 'rate', t: 'سود با نرخ ثابت', icon: 'percent' },
  { id: 'loan', t: 'قسطی', d: 'وام بانکی یا قرضی که ماهانه قسط دارد؛ مانده خودکار کم می‌شود', icon: 'calendar' },
];
/** Installments make sense for what you owe or are owed. */
const LOAN_CATS = new Set(['debt', 'receivable']);
/** The valuation methods that make sense for each kind of asset (first = default). Others are hidden. */
const METHODS = { bank: ['balance'], debt: ['loan', 'balance', 'rate'], receivable: ['balance', 'loan', 'rate'], fixed: ['rate', 'units', 'balance'],
  property: ['balance'], private: ['units', 'balance'], other: ['balance', 'units', 'rate'] };
const methodsFor = (cat, cur) => { const m = METHODS[cat] || ['units', 'balance']; return m.includes(cur) ? m : [...m, cur]; };
const NAME_HINT = { bank: 'مثلاً: حساب کوتاه‌مدت', fixed: 'مثلاً: سپرده یک‌ساله', gold_online: 'مثلاً: طلای آب‌شده', gold: 'مثلاً: سکه امامی', metal: 'مثلاً: نقره',
  fx: 'مثلاً: دلار نقد', stock: 'مثلاً: صندوق طلا', crypto: 'مثلاً: تتر', private: 'مثلاً: سهام شرکت', property: 'مثلاً: آپارتمان یا خودرو',
  receivable: 'مثلاً: طلب از دوست', other: 'مثلاً: وسیله قیمتی', debt: 'مثلاً: وام مسکن' };
const blankLoan = () => ({ amount: null, annualPct: null, months: null, firstDue: addJMonthsIso(todayIso(), 1), installment: null, account: '' });

const DEFAULT_REF = { metal: { provider: 'tgju', key: 'silver_999' }, gold_online: { provider: 'tgju', key: 'geram18' }, gold: { provider: 'tgju', key: '' }, fx: { provider: 'tgju', key: 'price_dollar_rl' }, crypto: { provider: 'nobitex', key: 'usdt' }, stock: { provider: 'tsetmc', key: '' }, fixed: { provider: 'fipiran', key: '' } };
const DEFAULT_UNIT = { metal: 'گرم', gold_online: 'گرم', gold: 'عدد', fx: 'دلار', crypto: 'USDT', stock: 'سهم', private: 'سهم', fixed: 'واحد' };

/** The natural unit of a price source: «هر گرم» → گرم, a coin → its symbol, a stock → سهم. */
export function unitFor(ref) {
  if (!ref) return '';
  if (ref.provider === 'tgju') { const u = TGJU_BY_KEY[ref.key]?.unit || ''; return u.replace(/^هر\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim(); }
  if (ref.provider === 'nobitex') return String(NOBITEX_BY_KEY[ref.key]?.sym || ref.sym || ref.key || '').toUpperCase();
  if (ref.provider === 'tsetmc') return 'سهم';
  if (ref.provider === 'fipiran') return 'واحد';
  return '';
}
const AUTO_UNITS = new Set(['', 'واحد', 'عدد', ...Object.values(DEFAULT_UNIT)]);

// a bank deposit pays its interest into a bank account (that's how banks do it): the only one, or — with several — the
// owner picks; interest stays in the asset itself only when there's no account, or for other kinds (a loan to a friend)
const defaultPayout = (assets, cat) => { const banks = E.cashAccounts(assets).filter((x) => x.category === 'bank'); return banks.length === 1 ? banks[0].id : cat === 'fixed' && banks.length > 1 ? '' : 'self'; };

function blank(cat = 'bank') {
  const c = CAT[cat];
  return { id: uid('a'), name: '', category: cat, custodian: '', code: '', liquidity: c.liquidity, note: '', mode: c.defaultMode,
    quantity: null, unit: DEFAULT_UNIT[cat] || 'واحد',
    price: { source: DEFAULT_REF[cat] ? 'market' : 'manual', value: null, ref: DEFAULT_REF[cat] ? { ...DEFAULT_REF[cat] } : null, adjustPct: 0, factor: 1 },
    balance: null, rate: { principal: null, annualPct: null, start: todayIso(), mode: 'payout', payoutTo: 'self', maturity: null }, loan: blankLoan(), costBasis: null,
    ...(cat === 'debt' ? { mode: 'loan' } : {}) };
}

/* ---------------- market source picker ---------------- */
function SourcePicker({ st, s, price, setPrice, cat, adv }) {
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
        <span class="small num">${qv?.price ? (t.usd ? '$' + num(qv.price, 2) : html`<${Money} v=${qv.price} s=${s} />`) : html`<span class="xs faint">فعلاً قیمت ندارد</span>`}</span>
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
      ${err && html`<div class="callout err"><${Icon} n="wifi" cls="sm" /><div>${err}. ${prov === 'tsetmc' ? 'سایت TSETMC گاهی از خارج ایران یا با VPN پاسخ نمی‌دهد.' : 'سایت فیپیران گاهی با VPN یا از خارج ایران پاسخ نمی‌دهد؛ دوباره «جست‌وجو» را بزن.'}</div></div>`}
      ${res && html`<div class="picker"><div class="scroll">${res.length ? res.map((it) => prov === 'tsetmc'
        ? html`<div class=${'opt' + (ref.key === it.insCode ? ' on' : '')} onClick=${() => setRef({ provider: 'tsetmc', key: it.insCode, symbol: it.symbol, label: it.symbol, name: it.name, field: ref.field || 'close' })}>
            <span class="grow"><span class="sb">${it.symbol}</span> <span class="xs muted">${it.name}</span></span><span class="xs muted">${it.market}${it.active ? '' : '، غیرفعال'}</span></div>`
        : html`<div class=${'opt' + (ref.key === (it.key || it.regNo) ? ' on' : '')} onClick=${() => setRef({ provider: 'fipiran', key: it.key || it.regNo, label: it.name, name: it.name, field: ref.field || 'cancelNav' })}>
            <span class="grow"><span class="sb">${it.name}</span> <span class="xs muted">${it.type}</span></span><span class="small num"><${Money} v=${it.cancelNav} s=${s} /></span></div>`)
        : html`<div class="opt muted">نتیجه‌ای پیدا نشد</div>`}</div></div>`}
      ${prov === 'tsetmc' && (adv || (ref.field && ref.field !== 'close')) && html`<div class="row"><span class="lbl">قیمت مبنا</span><${Seg} value=${ref.field || 'close'} onChange=${(f) => setRef({ ...ref, field: f })} options=${[['close', 'قیمت پایانی'], ['last', 'آخرین معامله'], ['nav', 'NAV ابطال (ETF)']]} /></div>`}
      ${prov === 'fipiran' && (adv || (ref.field && ref.field !== 'cancelNav')) && html`<div class="row"><span class="lbl">${LT('قیمت مبنا', 'nav')}</span><${Seg} value=${ref.field || 'cancelNav'} onChange=${(f) => setRef({ ...ref, field: f })} options=${[['cancelNav', 'NAV ابطال'], ['issueNav', 'NAV صدور'], ['statisticalNav', 'NAV آماری']]} /></div>`}
    </div>`}
  </div>`;
}

/* ---------------- main editor ---------------- */
export function AssetEditor({ st, s, asset, preset, onClose }) {
  const isNew = !asset;
  const [a, setA] = useState(() => {
    // a draft from a calculator (e.g. «ثبت به‌عنوان دارایی» on a gold invoice) fills the new asset; the owner still reviews it
    // an edited sample row is the owner's now: it no longer goes with «پاک‌کردن داده نمونه»
    const base = asset ? (({ sample, ...x }) => x)(structuredClone(asset)) : { ...blank(preset?.category || 'bank'), ...(preset?.draft || {}) };
    if (!base.price) base.price = { source: 'manual', value: null, ref: null, adjustPct: 0, factor: 1 };
    if (!base.rate) base.rate = { principal: null, annualPct: null, start: todayIso(), mode: 'payout', payoutTo: 'self', maturity: null };
    if (!base.loan) base.loan = blankLoan();
    // a new deposit pays its interest into the only bank account, if there is exactly one (that's how banks do it)
    if (!asset && base.mode === 'rate' && (base.rate.payoutTo || 'self') === 'self') base.rate.payoutTo = defaultPayout(st.assets, base.category);
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
  const [rAdv, setRAdv] = useState(!!(a.rate?.basis && a.rate.basis !== 365));
  // closing with unsaved input asks first (a click outside or Escape shouldn't throw typing away)
  // a calculator's draft is input the owner hasn't saved yet: closing it asks too
  const initial = useRef(null); if (initial.current === null) initial.current = preset?.draft ? '' : JSON.stringify(a);
  const [askClose, setAskClose] = useState(false);
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
  const dirty = JSON.stringify(a) !== initial.current || fund.on;
  const requestClose = () => (dirty && !askClose ? setAskClose(true) : onClose());

  const pickCat = (id) => {
    const c = CAT[id];
    setA((x) => {
      const n = { ...x, category: id, liquidity: c.liquidity };
      if (n.mode === 'loan' && !LOAN_CATS.has(id)) n.mode = c.defaultMode;
      if (isNew) {
        n.mode = methodsFor(id, null)[0] || c.defaultMode; n.unit = DEFAULT_UNIT[id] || x.unit;
        if (DEFAULT_REF[id]) n.price = { ...x.price, source: 'market', ref: { ...DEFAULT_REF[id] } }; else n.price = { ...x.price, source: 'manual' };
        // moving between «بانک» and «درآمد ثابت» keeps what was already typed (amount and rate)
        if (n.mode === 'rate' && !(+x.rate?.principal > 0) && +x.balance > 0) n.rate = { ...x.rate, principal: +x.balance, ...(x.rate?.annualPct == null && +x.interest?.annualPct > 0 ? { annualPct: +x.interest.annualPct } : {}) };
        if (n.mode === 'balance' && (x.balance === null || x.balance === undefined) && +x.rate?.principal > 0) n.balance = +x.rate.principal;
        if (n.mode === 'rate' && (n.rate?.payoutTo || 'self') === 'self') n.rate = { ...(n.rate || x.rate), payoutTo: defaultPayout(st.assets, id) };
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
  const balanceTargets = E.cashAccounts(st.assets, { except: a.id, keep: [asset?.rate?.payoutTo, asset?.loan?.account].filter((x) => x && x !== 'self') });

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
  // a purchase is paid at what it cost when that's known (a gold invoice's total), otherwise at today's value
  const fundDefault = a.mode === 'loan' ? +L.amount || 0 : a.mode === 'rate' ? +a.rate.principal || 0 : a.mode === 'units' && +a.costBasis > 0 ? +a.costBasis : Math.abs(val.value) || 0;
  const fundAmt = fund.amount ?? fundDefault;
  const fundShort = fundAcc && !liabCat && fundAmt > (E.valueOf(fundAcc, st.quotes, s).value || 0) + 0.5;
  const [dbad, setDbad] = useState({});
  const dB = (k) => (b) => setDbad((d) => (!!d[k] === b ? d : { ...d, [k]: b }));
  // what's missing or wrong, by field (shown in red on the field itself after a save attempt)
  const bad = {};
  if (!a.name.trim()) bad.name = cat.liability ? 'نام بدهی' : 'نام دارایی';
  if (a.mode === 'units' && !(+a.quantity > 0) && !(!isNew && a.quantity !== null && +a.quantity === 0)) bad.qty = 'مقدار';
  if (a.mode === 'units' && a.price.source === 'manual' && !(+a.price.value > 0)) bad.price = 'قیمت واحد';
  if (a.mode === 'units' && a.price.source === 'market' && !a.price.ref?.key && !a.price.ref?.symbol) bad.src = 'منبع قیمت';
  if (a.mode === 'balance' && !(isFinite(+a.balance) && a.balance !== null)) bad.balance = 'مبلغ';
  else if (a.mode === 'balance' && +a.balance < 0 && a.category !== 'bank') bad.balance = cat.liability ? 'مانده بدهی (عدد مثبت بنویس)' : 'مبلغ (منفی نمی‌شود)';
  if (a.mode === 'balance' && a.interest?.on && !(+a.interest.annualPct > 0)) bad.irate = 'نرخ سود روزشمار';
  if (a.mode === 'rate') {
    if (!(+a.rate.principal > 0)) bad.rprin = 'اصل سرمایه';
    if (a.rate.annualPct === null || a.rate.annualPct === '' || !(+a.rate.annualPct >= 0)) bad.rpct = 'نرخ سود';
    if (!a.rate.start) bad.rstart = 'تاریخ شروع';
    if (a.rate.maturity && a.rate.start && a.rate.maturity <= a.rate.start) bad.rmat = 'سررسید (باید بعد از شروع باشد)';
    if (a.rate.mode === 'payout' && !cat.liability && a.rate.payoutTo === '') bad.payto = 'حسابی که سود به آن واریز می‌شود';
  }
  if (a.mode === 'loan') {
    if (!(+L.amount > 0)) bad.lamount = 'مبلغ وام';
    if (!(+L.months >= 1)) bad.lmonths = 'تعداد اقساط';
    else if (+L.months > 600) bad.lmonths = 'تعداد اقساط (حداکثر ۶۰۰)';
    if (L.annualPct === null || L.annualPct === '' || !(+L.annualPct >= 0)) bad.lpct = 'نرخ سود (برای بدون سود: صفر)';
    if (!L.firstDue) bad.lfirst = 'تاریخ اولین قسط';
    if (L.start && L.firstDue && L.start >= L.firstDue) bad.lstart = 'تاریخ دریافت وام (باید قبل از اولین قسط باشد)';
    if (+L.installment > 0 && +L.amount > 0 && +L.installment <= +L.amount * (+L.annualPct || 0) / 1200) bad.linst = 'مبلغ قسط (کمتر از سود ماهانه است)';
  }
  if (isNew && fundOk && fund.on && !fundAcc) bad.facc = liabCat ? 'حسابی که پول وام به آن رفت' : 'حسابی که پول از آن آمد';
  if (isNew && fundOk && fund.on && !(fundAmt > 0)) bad.famt = 'مبلغ';
  // a date typed but not valid (the field keeps the text; the stored date would silently be the old one)
  for (const [k, on, label] of [['rstart', a.mode === 'rate', 'تاریخ شروع'], ['rmat', a.mode === 'rate', 'تاریخ سررسید'], ['lfirst', a.mode === 'loan', 'تاریخ اولین قسط'],
    ['lstart', a.mode === 'loan', 'تاریخ دریافت وام'], ['since', a.mode !== 'loan', 'تاریخ خرید']]) if (on && dbad[k]) bad[k] = label + ' (تاریخ نادرست)';
  const errors = Object.values(bad);
  const [tried, setTried] = useState(false);
  // after a save attempt: the field turns red and says, in a few words, what's needed
  const MSG = { qty: 'مقدار را بنویس', price: 'قیمت هر واحد را بنویس', balance: 'مبلغ را بنویس (صفر هم قبول است)', irate: 'نرخ سود را بنویس', rprin: 'مبلغ را بنویس',
    rpct: 'نرخ سود را بنویس؛ اگر سود ندارد، صفر', lamount: 'مبلغ را بنویس', lmonths: 'تعداد قسط‌ها را بنویس', lpct: 'نرخ سود را بنویس؛ بدون سود: صفر', famt: 'مبلغ را بنویس' };
  const E_ = (k) => (tried && bad[k] ? (bad[k].includes('(') ? bad[k].replace(/^[^(]*\(|\)$/g, '') : MSG[k] || true) : false);

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
    // paid from an account: the cost is what was paid («همان مبلغ پرداختی ثبت می‌شود»)
    if (isNew && fundOk && fund.on && fundAcc && fundAmt > 0 && out.mode === 'units' && !E.isLiability(out)) out.costBasis = Math.round(fundAmt);
    if (out.mode === 'loan') { out.loan.start = out.loan.start || null; if (!out.loan.start) delete out.loan.start; }
    const ev = await act.saveAsset(out, {
      orig: asset || null,
      ...(appraised && balChanged ? { reval: why === 'reval' } : {}),
      ...(isNew && fundOk && fund.on && fundAcc && fundAmt > 0 ? { fund: { accountId: fundAcc.id, amount: fundAmt } } : {}),
    });
    doneToast(isNew ? `«${out.name}» اضافه شد${out.mode === 'rate' || out.mode === 'loan' || out.interest?.on ? '؛ سود و قسط‌هایش در «خودکارسازی» دیده می‌شود' : ''}` : 'ذخیره شد', ev);
    onClose();
  };

  const r = a.rate;
  const nextPay = a.mode === 'rate' && r.mode === 'payout' && r.start ? E.nextMonthlyAfter(r.start, r.start > todayIso() ? r.start : todayIso()) : null;

  return html`<${Drawer} title=${isNew ? (cat.liability ? 'افزودن بدهی' : 'افزودن دارایی') : (cat.liability ? 'ویرایش بدهی' : 'ویرایش دارایی')} onClose=${requestClose} icon=${html`<${Ava} cat=${a.category} size=${32} />`}
    footer=${askClose ? html`
      <span class="grow sb small">تغییرات ذخیره نشده‌اند. بسته شود؟</span>
      <button class="btn primary" onClick=${() => setAskClose(false)}>ادامه ویرایش</button>
      <button class="btn danger" onClick=${onClose}>بستن بدون ذخیره</button>` : html`
      <button class="btn primary" onClick=${save}><${Icon} n="check" />${isNew ? 'افزودن' : 'ذخیره تغییرات'}</button>
      <button class="btn" onClick=${requestClose}>انصراف</button>
      <span class="grow"></span>
      ${!isNew && html`<button class="btn danger" onClick=${() => { act.deleteAsset(a.id); onClose(); }}><${Icon} n="trash" cls="sm" />حذف</button>`}`}>

    <div class="sec"><div class="st"><${Icon} n="layers" cls="sm" />دسته‌بندی${T('cat')}</div>
      <div class="catgrid">${CATEGORIES.flatMap((c, i) => (c.liability && !CATEGORIES[i - 1]?.liability ? [html`<div class="catsep">بدهی‌ها</div>`, c] : [c])).map((c) => c.id === undefined ? c : html`<button type="button" class=${'catbtn' + (a.category === c.id ? ' on' : '')} title=${CAT_GUIDE[c.id]} aria-pressed=${a.category === c.id ? 'true' : 'false'} onClick=${() => pickCat(c.id)}><${Ava} cat=${c.id} size=${24} /><span class="ellipsis">${c.short}</span></button>`)}</div>
      <div class="catguide"><span><b>${cat.short}:</b> ${CAT_GUIDE[a.category]}</span>
        ${isNew && CAT_SWITCH[a.category] && html`<span class="cswitch">${CAT_SWITCH[a.category].q} <button type="button" class="linkbtn" onClick=${() => pickCat(CAT_SWITCH[a.category].to)}>${CAT_SWITCH[a.category].btn}</button></span>`}</div>
    </div>

    <div class="sec"><div class="st"><${Icon} n="edit" cls="sm" />مشخصات</div>
      <div class="field"><label>${LT(cat.liability ? 'نام بدهی' : 'نام دارایی', 'name')}</label><input class=${'input' + (E_('name') ? ' err' : '')} autoFocus=${isNew} value=${a.name} onInput=${(e) => set({ name: e.target.value })} placeholder=${NAME_HINT[a.category] || 'مثلاً: …'} aria-invalid=${E_('name') ? 'true' : undefined} />
        ${E_('name') && html`<span class="err-msg">یک نام کوتاه بنویس</span>`}</div>
      <div class=${cat.liability ? '' : 'grid2'}>
        <div class="field"><label>${LT(cat.liability ? 'بانک یا طلبکار' : a.category === 'receivable' ? 'بدهکار (چه کسی؟)' : 'محل نگهداری / بانک / کارگزاری', 'custodian')}</label><input class="input" value=${a.custodian || ''} onInput=${(e) => set({ custodian: e.target.value })} placeholder=${cat.liability ? 'مثلاً: نام بانک' : a.category === 'receivable' ? 'مثلاً: علی' : 'مثلاً: نام بانک یا کارگزاری'} /></div>
        ${!cat.liability && html`<div class="field"><label>${LT('سرعت نقد شدن', 'liquidity')}</label><${Seg} value=${a.liquidity} onChange=${(v) => set({ liquidity: v })} options=${Object.entries(LIQUIDITY)} /></div>`}
      </div>
    </div>

    <div class="sec"><div class="st"><${Icon} n="zap" cls="sm" />ارزشش را چطور حساب کنیم؟${methodsFor(a.category, a.mode).length > 1 ? html`<${Tip} title="کدام روش؟" text=${methodTip(a.category, methodsFor(a.category, a.mode), liabCat)} />` : ''}</div>
      ${methodsFor(a.category, a.mode).length > 1 && html`<div class="modes">${methodsFor(a.category, a.mode).map((id, mi) => MODES.find((m) => m.id === id)).filter(Boolean).map((m, mi) => html`<button type="button" class=${'mode' + (a.mode === m.id ? ' on' : '')} onClick=${() => setA((x) => {
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
        <span class="mt"><${Icon} n=${m.icon} cls="sm" />${m.id === 'loan' ? (liabCat ? 'وام قسطی' : 'طلب قسطی') : m.t}${mi === 0 && isNew ? html`<span class="badge-sug">پیشنهادی</span>` : ''}</span><span class="md">${m.id === 'loan' ? (liabCat ? m.d : 'قرضی که داده‌ای و ماهانه قسطش را می‌گیری') : modeDesc(a.category, m.id)}</span></button>`)}</div>`}

      ${a.mode === 'units' && html`
        <div class="grid2">
          <${NumField} label=${LT('مقدار / تعداد', 'qty')} value=${a.quantity} onInput=${(v) => set({ quantity: v })} err=${E_('qty')} />
          <div class="field"><label>${LT('واحد', 'unit')}</label><input class="input" value=${a.unit || ''} onInput=${(e) => set({ unit: e.target.value })} placeholder="گرم، عدد، سهم، دلار…" /></div>
        </div>
        <div class="row between"><span class="lbl">${LT('منبع قیمت', 'psrc')}</span><${Seg} value=${a.price.source} onChange=${(v) => setPrice({ source: v, ref: v === 'market' ? (a.price.ref || { ...(DEFAULT_REF[a.category] || { provider: 'tgju', key: 'geram18' }) }) : a.price.ref,
            ...(v === 'manual' && !(+a.price.value > 0) && val.unitPrice > 0 ? { value: Math.round(val.unitPrice) } : {}) })}
          options=${[['market', 'قیمت آنلاین خودکار'], ['manual', 'ورود دستی']]} /></div>
        ${a.price.source === 'market' && QUICK[a.category] && html`<div class="field"><label>${QUICK[a.category].label}</label><div class="row wrap" style="gap:6px">${QUICK[a.category].list.map((m) => {
          const on = a.price.ref?.key === m.ref.key && Math.abs((+a.price.factor || 1) - m.factor) < 1e-9;
          return html`<button type="button" class=${'chip' + (on ? ' on' : '')} title=${m.hint} aria-pressed=${on ? 'true' : 'false'} onClick=${() => setA((x) => ({ ...x, name: x.name.trim() && x.name !== autoName ? x.name : m.name, unit: m.unit, price: { ...x.price, source: 'market', ref: { ...m.ref }, factor: m.factor } }))}>${m.name} <span class="xs muted">(${m.unit})</span></button>`;
        })}</div>${a.category === 'metal' ? html`<span class="hint">قیمت مس و پلاتین جهانی است و با نرخ دلار بازار آزاد به ${s.currency === 'rial' ? 'ریال' : 'تومان'} تبدیل می‌شود.</span>` : ''}</div>`}
        ${a.category === 'gold' && /سکه/.test(a.name) && /گرم|مثقال/.test(a.unit || '') && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>این قیمت برای هر ${a.unit} است؛ اگر سکه داری، نوع سکه را از بالا انتخاب کن تا قیمت هر عدد حساب شود.</div></div>`}
        ${a.price.source === 'market' ? html`
          <${SourcePicker} st=${st} s=${s} price=${a.price} setPrice=${setPrice} cat=${a.category} adv=${adv} />
          <div class="row" style="gap:2px"><button type="button" class="btn ghost sm" aria-expanded=${adv ? 'true' : 'false'} onClick=${() => setAdv(!adv)}><${Icon} n="chevronDown" cls="sm" />تنظیمات پیشرفته (معمولاً لازم نیست)</button>${T('adjust')}</div>
          ${adv && html`<div class="grid2">
            <${NumField} label="اختلاف با قیمت مرجع (٪)" value=${a.price.adjustPct} onInput=${(v) => setPrice({ adjustPct: v || 0 })} hint="مثلاً کارمزد فروش پلتفرم −۱٫۵" />
            <${NumField} label="ضریب" value=${a.price.factor} onInput=${(v) => setPrice({ factor: v || 1 })} hint="مثلاً عیار ۷۵۰÷۷۴۰ یا وزن هر سکه" />
          </div>`}`
        : html`<${MoneyField} label="قیمت هر واحد" rial=${a.price.value} onRial=${(v) => setPrice({ value: v })} s=${s} prev=${asset?.price?.value} err=${E_('price')} />`}
        ${E_('src') && html`<span class="err-msg">${a.category === 'gold' ? 'نوع سکه یا طلا را از بالا انتخاب کن (یا «ورود دستی»)' : 'از فهرست بالا یک منبع قیمت انتخاب کن (یا «ورود دستی»)'}</span>`}
      `}

      ${a.mode === 'balance' && html`
        <${MoneyField} label=${LT(cat.liability ? 'مانده بدهی' : a.category === 'bank' ? 'مانده حساب' : 'ارزش امروز', 'balance')} rial=${a.balance} onRial=${(v) => set({ balance: v })} s=${s} autoFocus=${!isNew} prev=${asset?.balance} err=${E_('balance')}
          hint=${a.interest?.on ? 'همان عددی که اپ بانک نشان می‌دهد؛ سودِ جمع‌شده این ماه جدا حساب و روز واریز اضافه می‌شود' : ''} />
        ${appraised && balChanged && html`<div class="field"><label>چرا ارزش تغییر کرد؟</label><${Seg} value=${why} onChange=${setWhy} options=${[['reval', 'قیمت بازارش عوض شد'], ['money', 'بخشی را خریدم یا فروختم']]} />
          <span class="hint">${why === 'reval' ? 'سود یا زیان بازار حساب می‌شود.' : 'پول واردشده یا خارج‌شده حساب می‌شود، نه سود.'}</span></div>`}
        ${!cat.liability && (a.category === 'bank' || asset?.interest?.on) && html`<div class="sec" style="padding:12px;gap:10px;background:var(--surface-2)">
          <div class="row between"><div><div class="sb small">${LT('این حساب سود ماهانه می‌دهد', 'interest')}</div><div class="xs muted">برای حساب کوتاه‌مدت: سود هر روز روی مانده همان روز حساب و ماهی یک بار به همین حساب واریز می‌شود.</div></div>
            <${Toggle} title="این حساب سود ماهانه می‌دهد" on=${!!a.interest?.on} onChange=${(v) => set({ interest: v ? { basis: 365, payDay: 0, ...(a.interest || {}), on: true, since: todayIso(), sinceMs: Date.now(), lastAccrual: null, accrued: 0 } : { ...(a.interest || {}), on: false } })} /></div>
          ${a.interest?.on && html`<div class="grid2">
            <${NumField} label=${LT(r.mode === 'compound' ? 'بازده مؤثر سالانه' : 'نرخ سود سالانه', 'rpct')} suffix="٪" value=${a.interest.annualPct} onInput=${(v) => set({ interest: { ...a.interest, annualPct: v } })} digits=${2} err=${E_('irate')} />
            <div class="field"><label>${LT('روز واریز سود', 'payDay')}</label><select class="input" value=${a.interest.payDay ?? 1} onChange=${(e) => set({ interest: { ...a.interest, payDay: +e.target.value } })}>
              <option value="0">آخر هر ماه</option>${Array.from({ length: 30 }, (_, i) => i + 1).map((d) => html`<option value=${d}>روز ${num(d)} هر ماه</option>`)}</select>
              <span class="hint">همان روزی که بانک سود را می‌ریزد؛ اگر نمی‌دانی، آخر ماه.</span></div>
          </div>
          ${+a.interest.annualPct > 0 && +a.balance > 0 && html`<div class="grid2">
            <div class="pcell"><span class="n">سود هر روز</span><span class="v"><${Money} v=${+a.balance * a.interest.annualPct / 100 / 365} s=${s} compact /></span></div>
            <div class="pcell"><span class="n">سود ماهانه (تقریبی)</span><span class="v"><${Money} v=${+a.balance * a.interest.annualPct / 100 / 12} s=${s} compact /></span></div>
          </div>`}`}
        </div>`}
        ${(a.category === 'fixed' || a.category === 'receivable') && !a.interest?.on && html`<div class="callout"><${Icon} n="sparkles" cls="sm" /><div>اگر اصل ثابت است و سود مشخصی دارد، روش «سود با نرخ ثابت» را انتخاب کن تا ارزشش روزشمار رشد کند.</div></div>`}
        <div class="xs muted">${LOAN_CATS.has(a.category) ? 'اگر قسط ماهانه دارد، روش «قسطی» را انتخاب کن تا مانده و قسط‌ها خودکار حساب شوند.' : 'برای حقوق یا اجاره که هر ماه این مانده را تغییر می‌دهد، در صفحه «خودکارسازی» یک جریان تکراری بساز.'}</div>
      `}

      ${a.mode === 'rate' && html`
        <div class="grid2">
          <${MoneyField} label=${LT(cat.liability ? 'اصل بدهی' : 'اصل سرمایه', 'principal')} rial=${r.principal} onRial=${(v) => setRate({ principal: v })} s=${s} err=${E_('rprin')} />
          <${NumField} label=${LT(r.mode === 'compound' ? 'بازده مؤثر سالانه' : 'نرخ سود سالانه', 'rpct')} suffix="٪" value=${r.annualPct} onInput=${(v) => setRate({ annualPct: v })} digits=${2} err=${E_('rpct')} />
        </div>
        ${!isNew && asset?.mode === 'rate' && asset.rate?.start && asset.rate.start < todayIso() && r.start === asset.rate.start && (+r.annualPct !== +asset.rate.annualPct || r.mode !== asset.rate.mode || (r.basis || 365) !== (asset.rate.basis || 365)) && html`<div class="callout"><${Icon} n="info" cls="sm" /><div>شرایط جدید از امروز حساب می‌شود؛ سودی که تا امروز گرفته‌ای همان می‌ماند.</div></div>`}
        <div class="field"><label>${LT('نحوه محاسبه سود', 'rmode')}</label>
          <${Seg} value=${r.mode} onChange=${(v) => setRate({ mode: v })} options=${[['payout', 'سود ماهانه واریز می‌شود'], ['compound', 'سود روی اصل جمع می‌شود'], ['simple', 'سود ساده']]} />
          <span class="hint">${r.mode === 'payout' ? 'مثل سپرده بانکی: هر ماه، در همان روزِ تاریخ شروع، سودِ یک ماه واریز می‌شود.' : r.mode === 'compound' ? 'سود برداشت نمی‌شود و روی سودهای قبلی هم سود می‌آید. نرخ را به‌صورت «بازده سالانه» بنویس (اگر بانک گفته ۲۴٪ با سود ماهانه مرکب، حدود ۲۶٫۸٪ می‌شود).' : 'مثل شراکت یا قرض با سود: سود هر روز ثابت اضافه می‌شود و روی سود، سود حساب نمی‌شود.'}</span>
        </div>
        <div class="grid2">
          <${JDateField} label=${LT('تاریخ شروع', 'start')} iso=${r.start} onIso=${(v) => setRate({ start: v })} err=${E_('rstart')} onBad=${dB('rstart')} />
          <${JDateField} label=${LT('تاریخ سررسید (اختیاری)', 'maturity')} iso=${r.maturity} onIso=${(v) => setRate({ maturity: v })} allowEmpty hint="خالی = بدون سررسید" err=${E_('rmat')} onBad=${dB('rmat')} />
        </div>
        ${E_('rmat') && !dbad.rmat && html`<span class="err-msg">تاریخ سررسید باید بعد از تاریخ شروع باشد.</span>`}
        ${r.mode !== 'compound' && !rAdv && html`<button type="button" class="btn ghost sm" style="align-self:flex-start" onClick=${() => setRAdv(true)}><${Icon} n="chevronDown" cls="sm" />تنظیمات پیشرفته (معمولاً لازم نیست)</button>`}
        ${r.mode !== 'compound' && rAdv && html`<div class="field"><label>${LT('مبنای روزشمار', 'basis')}</label><${Seg} value=${String(r.basis || 365)} onChange=${(v) => setRate({ basis: v === 'actual' ? 'actual' : +v })} options=${[['365', '۳۶۵ روز'], ['actual', 'طول واقعی سال شمسی'], ...(+r.basis === 360 ? [['360', '۳۶۰ روز']] : [])]} /></div>`}
        ${r.mode === 'payout' && html`<div class="field"><label>${LT('واریز سود به', 'payoutTo')}</label>
          <select class=${'input' + (E_('payto') ? ' err' : '')} value=${r.payoutTo ?? 'self'} onChange=${(e) => setRate({ payoutTo: e.target.value })}>
            ${r.payoutTo === '' && html`<option value="">— انتخاب کن —</option>`}
            <option value="self">همین دارایی (سود روی اصل اضافه شود)</option>
            ${balanceTargets.map((x) => html`<option value=${x.id}>${x.name}${x.custodian && x.custodian !== x.name ? ' — ' + x.custodian : ''}</option>`)}
          </select>${E_('payto') ? html`<span class="err-msg">سود سپرده‌های بانکی معمولاً به یک حساب کوتاه‌مدت واریز می‌شود؛ همان را انتخاب کن.</span>` : (r.payoutTo || 'self') === 'self' && balanceTargets.length > 0 && html`<span class="hint">اگر بانک سود را به حساب کوتاه‌مدتت می‌ریزد، همان حساب را انتخاب کن.</span>`}</div>`}
        ${+r.principal > 0 && +r.annualPct > 0 && html`<div class="grid3">
          <div class="pcell"><span class="n">سود روزانه</span><span class="v"><${Money} v=${E.rateDaily(r, val.value)} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">سود ماهانه</span><span class="v"><${Money} v=${E.rateMonthly(r, val.value)} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">${r.mode === 'payout' ? 'واریز بعدی' : 'سود سالانه'}</span><span class="v">${r.mode === 'payout' && nextPay ? fmtJ(nextPay, 'dm') : html`<${Money} v=${r.principal * r.annualPct / 100} s=${s} compact />`}</span></div>
        </div>`}
      `}

      ${a.mode === 'loan' && html`
        <div class="grid2">
          <${MoneyField} label=${LT(liabCat ? 'مبلغ وام' : 'مبلغ قرض', 'lamount')} rial=${L.amount} onRial=${(v) => setLoan({ amount: v })} s=${s} err=${E_('lamount')} />
          <${NumField} label=${LT('نرخ سود سالانه', 'lpct')} suffix="٪" value=${L.annualPct} onInput=${(v) => setLoan({ annualPct: v })} digits=${2} hint="بدون سود: صفر؛ قرض‌الحسنه: کارمزد، مثلاً ۴" err=${E_('lpct')} />
        </div>
        <div class="grid2">
          <${NumField} label=${LT('تعداد اقساط (ماهانه)', 'lmonths')} value=${L.months} onInput=${(v) => setLoan({ months: v ? Math.round(v) : null })} digits=${0} err=${E_('lmonths')} />
          <${JDateField} label=${LT('تاریخ اولین قسط', 'lfirst')} iso=${L.firstDue} onIso=${(v) => setLoan({ firstDue: v })} err=${E_('lfirst')} onBad=${dB('lfirst')} />
        </div>
        <${JDateField} label=${LT(liabCat ? 'تاریخ دریافت وام (اختیاری)' : 'تاریخ پرداخت قرض (اختیاری)', 'lstart')} iso=${L.start || null} onIso=${(v) => setLoan({ start: v })} allowEmpty err=${E_('lstart')} onBad=${dB('lstart')}
          hint="اگر تا اولین قسط بیش از یک ماه فاصله دارد (دوره تنفس)، سود این فاصله هم حساب می‌شود. خالی = یک ماه قبل از اولین قسط" />
        <div class="grid2">
          <${MoneyField} err=${E_('linst')} label=${LT('مبلغ هر قسط (اختیاری)', 'linst')} rial=${L.installment} onRial=${(v) => setLoan({ installment: v })} s=${s} hint=${plan && !(+L.installment > 0) ? `خالی بگذار تا طبق فرمول بانک حساب شود: ${money(plan.A, s)}` : 'اگر بانک عدد دیگری گفته، همان را بنویس'} />
          <div class="field"><label>${LT(liabCat ? 'قسط‌ها از کدام حساب کم شود؟' : 'قسط‌ها به کدام حساب واریز شود؟', 'lacc')}</label>
            <select class="input" value=${L.account || ''} onChange=${(e) => setLoan({ account: e.target.value })}>
              <option value="">— ثبت نشود —</option>${balanceTargets.map((x) => html`<option value=${x.id}>${x.name}${x.custodian && x.custodian !== x.name ? ' — ' + x.custodian : ''}</option>`)}
            </select></div>
        </div>
        ${asset?.loan?.paused && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>حسابی که قسط‌ها ${liabCat ? 'از آن کم' : 'به آن واریز'} می‌شد حذف شده؛ قسط‌ها دیگر به حسابی وصل نیست. حساب دیگری انتخاب کن (یا «ثبت نشود») و ذخیره کن.</div></div>`}
        <div class="callout"><${Icon} n="info" cls="sm" /><div>${liabCat ? 'وامی را که از قبل داری' : 'قرضی را که از قبل داده‌ای'} هم همین‌جا ثبت کن: یا مبلغ و تاریخ اولین قسط اصلی را بنویس تا قسط‌های گذشته پرداخت‌شده حساب شوند، یا مانده فعلی، تعداد قسط‌های باقی‌مانده و تاریخ قسط بعدی را.</div></div>
        ${plan && html`<div class="grid3">
          <div class="pcell"><span class="n">قسط ماهانه</span><span class="v"><${Money} v=${plan.A} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">جمع سود کل دوره</span><span class="v"><${Money} v=${plan.totalInterest} s=${s} compact /></span></div>
          <div class="pcell"><span class="n">${plan.done ? 'وضعیت' : 'قسط بعدی'}</span><span class="v">${plan.done ? 'تسویه شده' : `${fmtJ(plan.next.date, 'dm')} (${num(plan.paid + 1)} از ${num(plan.n)})`}</span></div>
        </div>
        ${plan.rows.length && Math.abs(plan.rows[plan.rows.length - 1].payment - plan.A) > Math.max(plan.A * 0.5, 1) && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>با این مبلغ قسط، قسط آخر <${Money} v=${plan.rows[plan.rows.length - 1].payment} s=${s} /> می‌شود. مبلغ قسط یا تعداد اقساط را بررسی کن.</div></div>`}`}
      `}

      <div class="preview">
        <div><div class="xs muted">${a.mode === 'loan' ? (liabCat ? 'مانده بدهی امروز' : 'مانده طلب امروز') : a.mode === 'balance' && a.interest?.on && val.accrued > 0 ? 'ارزش امروز (مانده + سود انباشته)' : a.mode === 'rate' ? 'ارزش امروز (اصل + سود تا امروز)' : 'ارزش امروز'}</div><div class="v">${!val.value && isNew ? html`<span class="muted">—</span>` : html`<${Money} v=${val.value} s=${s} cls=${cat.liability ? 'debt' : ''} />`}</div>
          ${!val.value && isNew && html`<div class="xs muted">بعد از نوشتن مبلغ، ارزش اینجا دیده می‌شود.</div>`}
          ${a.mode === 'units' && html`<div class="xs muted num">${num(+a.quantity || 0, 'auto')} ${a.unit || ''} × <${Money} v=${val.unitPrice} s=${s} /></div>`}
          ${a.mode === 'balance' && a.interest?.on && val.accrued > 0 && html`<div class="xs muted">مانده <${Money} v=${+a.balance || 0} s=${s} /> + سود انباشته <${Money} v=${val.accrued} s=${s} /> (روز واریز به مانده اضافه می‌شود)</div>`}
          ${a.mode === 'rate' && +r.principal > 0 && Math.abs(val.value - r.principal) >= 1 && html`<div class="xs muted">اصل <${Money} v=${+r.principal} s=${s} /> ${val.value >= r.principal ? '+' : '−'} سود <${Money} v=${Math.abs(val.value - r.principal)} s=${s} /></div>`}</div>
        <div style="text-align:left">
          ${a.mode === 'units' && a.price.source === 'market' && !a.price.ref?.key ? html`<span class="pill">${a.category === 'gold' ? 'نوع طلا یا سکه را انتخاب کن' : a.price.ref?.provider === 'fipiran' ? 'صندوق را جست‌وجو و انتخاب کن' : 'نماد را جست‌وجو و انتخاب کن'}</span>` : ''}
          ${a.mode === 'units' && a.price.source === 'market' && a.price.ref?.key && html`${preview.loading ? html`<span class="pill"><${Icon} n="refresh" cls="sm spin" />دریافت قیمت…</span>` : preview.q?.price ? html`<span class="pill live"><i class="blink"></i>قیمت زنده</span>` : html`<span class="pill error" title=${preview.err || ''}>قیمت دریافت نشد</span>`}
            ${preview.q?.changePct ? html`<div class="xs" style="margin-top:4px">امروز <span class=${preview.q.changePct >= 0 ? 'pos' : 'neg'}>${pct(preview.q.changePct)}</span></div>` : ''}`}
          ${a.mode === 'rate' && html`<span class="pill auto">رشد خودکار</span>`}
          ${a.mode === 'loan' && html`<span class="pill auto">قسط‌ها خودکار</span>`}
        </div>
      </div>
      ${a.mode === 'units' && a.price.source === 'market' && preview.err && !preview.q?.price && html`<div class="callout warn"><${Icon} n="wifi" cls="sm" /><div>${preview.err}. ذخیره کن؛ در به‌روزرسانی بعدی دوباره تلاش می‌شود${a.price.value ? ' و تا آن موقع آخرین قیمت شناخته‌شده استفاده می‌شود' : ''}.</div></div>`}
    </div>

    ${isNew && fundOk && balanceTargets.length > 0 && html`<div class="sec"><div class="st"><${Icon} n="swap" cls="sm" />${liabCat ? 'پول این وام کجا رفت؟' : 'پولش از کجا آمد؟'}${T(liabCat ? 'fundLoan' : 'fund')}</div>
      <${Seg} value=${fund.on ? 'acc' : 'none'} onChange=${(v) => setFund((f) => ({ ...f, on: v === 'acc', accountId: f.accountId || (v === 'acc' && balanceTargets.length === 1 ? balanceTargets[0].id : f.accountId) }))}
        options=${liabCat ? [['none', 'ثبت نشود'], ['acc', 'به حسابم واریز شد']] : [['none', 'از قبل داشتم'], ['acc', 'از حسابم پرداختم']]} />
      ${fund.on && html`<div class="grid2">
        <div class="field"><label>${liabCat ? 'واریز به حساب' : 'پرداخت از حساب'}</label><select class=${'input' + (E_('facc') ? ' err' : '')} value=${fund.accountId} onChange=${(e) => setFund((f) => ({ ...f, accountId: e.target.value }))}>
          <option value="">— انتخاب کن —</option>${balanceTargets.map((x) => html`<option value=${x.id}>${x.name}${x.custodian && x.custodian !== x.name ? ' — ' + x.custodian : ''}</option>`)}</select></div>
        <${MoneyField} label=${liabCat ? 'مبلغ واریزشده' : 'مبلغ پرداختی'} rial=${fundAmt || null} onRial=${(v) => setFund((f) => ({ ...f, amount: v }))} s=${s} err=${E_('famt')} hint=${liabCat ? 'اگر بانک کارمزد یا سپرده‌ای کم کرد، همان مبلغی را بنویس که واقعاً به حساب آمد؛ فرقش جدا ثبت می‌شود، نه به‌عنوان ضرر' : a.mode === 'rate' ? '' : 'اگر با کارمزد یا قیمتی غیر از قیمت روز خریدی، مبلغ واقعی را بنویس؛ همین به‌عنوان قیمت خرید ثبت می‌شود'} />
      </div>
      ${a.mode === 'rate' && a.rate.start && a.rate.start < todayIso() && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>این سپرده از ${fmtJ(a.rate.start)} شروع شده. اگر پولش همان موقع از حساب رفته، مانده امروزِ حساب آن را ندارد؛ «از قبل داشتم» را بزن تا دوباره کم نشود.</div></div>`}
      ${fundShort && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>مانده «${fundAcc.name}» کافی نیست؛ اگر ثبت کنی منفی می‌شود.</div></div>`}`}
      <span class="hint">${fund.on ? (liabCat ? 'مبلغ به آن حساب اضافه می‌شود؛ ارزش خالص تغییری نمی‌کند.' : 'مبلغ از آن حساب کم می‌شود؛ پول تازه یا سود حساب نمی‌شود.') : (liabCat ? 'اگر پول وام به حسابی رفته که در دارا ثبت کرده‌ای، انتخابش کن.' : 'اگر همین حالا با پول یکی از حساب‌هایت خریدی، انتخابش کن تا از آن کم شود.')}</span>
    </div>`}

    <div class="sec"><div class="st"><${Icon} n="target" cls="sm" />جزئیات بیشتر (اختیاری)</div>
      ${!cat.liability && a.mode !== 'rate' && a.mode !== 'loan' && a.category !== 'bank' && html`<div class="grid2">
        ${isNew && fund.on ? html`<div class="field"><label>قیمت خرید</label><span class="hint">همان مبلغ پرداختی ثبت می‌شود.</span></div>` : html`<${MoneyField} label=${LT('قیمت خرید کل (اختیاری)', 'cost')} rial=${a.costBasis} onRial=${(v) => set({ costBasis: v })} s=${s} hint="برای محاسبه سود و زیان" />`}
        ${(a.mode === 'balance' || a.price.source === 'manual') ? html`<div class="field"><label>${LT('یادآوری به‌روزرسانی', 'remind')}</label>
          <select class="input" value=${a.remindDays ?? ''} onChange=${(e) => set({ remindDays: e.target.value === '' ? null : +e.target.value })}>
            <option value="">پیش‌فرض (${num(E.remindDaysFor({ ...a, remindDays: null }, s))} روز)</option><option value="1">هر روز</option><option value="7">هر هفته</option><option value="30">هر ماه</option><option value="90">هر سه ماه</option><option value="0">هرگز</option>
          </select></div>` : html`<div></div>`}
      </div>`}
      ${a.mode !== 'loan' && a.mode !== 'rate' && html`<${JDateField} label=${LT('تاریخ خرید / شروع نگهداری', 'since')} iso=${a.since || null} onIso=${(v) => set({ since: v })} allowEmpty onBad=${dB('since')} err=${E_('since')} hint="برای بازسازی دقیق‌تر تاریخچه؛ خالی یعنی از قبل داشته‌ای" />`}
      <div class="field"><label>یادداشت</label><textarea class="input" rows="2" value=${a.note || ''} onInput=${(e) => set({ note: e.target.value })} placeholder="شماره حساب، لینک منبع، توضیحات…"></textarea></div>
    </div>
  </${Drawer}>`;
}
