import { html, useState, useEffect, useMemo, Icon, Drawer, Seg, NumField, MoneyField, JDateField, Money, Ava, Toggle, send, toast, refLabel, num, pct, fmtJ } from '../components.js';
import { CryptoPicker } from '../pickers.js';
import { CATEGORIES, CAT, TGJU, NOBITEX, LIQUIDITY, METAL_PRESETS } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import { todayIso } from '../../lib/jalali.js';
import { uid } from '../../lib/format.js';
import { act } from '../actions.js';

const MODES = [
  { id: 'units', t: 'تعداد × قیمت', d: 'طلا، سکه، ارز، سهام، صندوق، رمزارز', icon: 'coin' },
  { id: 'balance', t: 'مانده / ارزش کل', d: 'حساب بانکی، ملک، خودرو، طلب، بدهی', icon: 'bank' },
  { id: 'rate', t: 'سود با نرخ ثابت', d: 'سپرده، درآمد ثابت، شراکت؛ رشد خودکار روزانه', icon: 'percent' },
];

const DEFAULT_REF = { metal: { provider: 'tgju', key: 'silver_999' }, gold_online: { provider: 'tgju', key: 'geram18' }, gold: { provider: 'tgju', key: 'geram18' }, fx: { provider: 'tgju', key: 'price_dollar_rl' }, crypto: { provider: 'nobitex', key: 'usdt' }, stock: { provider: 'tsetmc', key: '' }, fixed: { provider: 'fipiran', key: '' } };
const DEFAULT_UNIT = { metal: 'گرم', gold_online: 'گرم', gold: 'گرم', fx: 'دلار', crypto: 'USDT', stock: 'سهم', private: 'سهم', fixed: 'واحد' };

function blank(cat = 'bank') {
  const c = CAT[cat];
  return { id: uid('a'), name: '', category: cat, custodian: '', code: '', liquidity: c.liquidity, note: '', mode: c.defaultMode,
    quantity: null, unit: DEFAULT_UNIT[cat] || 'واحد',
    price: { source: DEFAULT_REF[cat] ? 'market' : 'manual', value: null, ref: DEFAULT_REF[cat] ? { ...DEFAULT_REF[cat] } : null, adjustPct: 0, factor: 1 },
    balance: null, rate: { principal: null, annualPct: null, start: todayIso(), mode: 'payout', payoutTo: 'self', maturity: null }, costBasis: null };
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
      options=${[['tgju', 'طلا، سکه و ارز'], ['tsetmc', 'بورس (TSETMC)'], ['fipiran', 'صندوق‌ها (NAV)'], ['nobitex', 'رمزارز']]} />
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
    if (preset?.mode) {
      // "automate this" suggestion: carry over current value
      const v = E.valueOf(base, st.quotes, s).value;
      if (preset.mode === 'rate' && base.mode !== 'rate') base.rate.principal = v;
      if (preset.mode === 'units' && preset.source === 'market') { base.price.source = 'market'; base.price.ref = base.price.ref || { ...(DEFAULT_REF[base.category] || { provider: 'tgju', key: 'geram18' }) }; }
      base.mode = preset.mode;
    }
    return base;
  });
  const [adv, setAdv] = useState(!!(a.price?.adjustPct || (a.price?.factor && a.price.factor !== 1)));
  const [preview, setPreview] = useState({ loading: false, q: null, err: null });
  const set = (patch) => setA((x) => ({ ...x, ...patch }));
  const setPrice = (p) => setA((x) => ({ ...x, price: { ...x.price, ...p } }));
  const setRate = (p) => setA((x) => ({ ...x, rate: { ...x.rate, ...p } }));
  const cat = CAT[a.category];

  const pickCat = (id) => {
    const c = CAT[id];
    setA((x) => {
      const n = { ...x, category: id, liquidity: c.liquidity };
      if (isNew) {
        n.mode = c.defaultMode; n.unit = DEFAULT_UNIT[id] || x.unit;
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

  const errors = [];
  if (!a.name.trim()) errors.push('نام دارایی');
  if (a.mode === 'units' && !(+a.quantity > 0)) errors.push('مقدار');
  if (a.mode === 'units' && a.price.source === 'manual' && !(+a.price.value > 0)) errors.push('قیمت واحد');
  if (a.mode === 'units' && a.price.source === 'market' && !a.price.ref?.key && !a.price.ref?.symbol) errors.push('منبع قیمت');
  if (a.mode === 'balance' && !(isFinite(+a.balance) && a.balance !== null)) errors.push('مبلغ');
  if (a.mode === 'balance' && a.interest?.on && !(+a.interest.annualPct > 0)) errors.push('نرخ سود روزشمار');
  if (a.mode === 'rate' && (!(+a.rate.principal > 0) || !(+a.rate.annualPct >= 0) || !a.rate.start)) errors.push('اصل سرمایه، نرخ و تاریخ شروع');

  const save = async () => {
    if (errors.length) return toast('تکمیل کن: ' + errors.join('، '));
    const out = structuredClone(a);
    out.name = out.name.trim();
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
    if (!out.code) out.code = 'A-' + String(st.assets.length + 1).padStart(3, '0');
    delete out.review;
    await act.saveAsset(out);
    toast(isNew ? 'دارایی اضافه شد' : 'ذخیره شد');
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
      <div class="field"><label>نام دارایی</label><input class="input" autoFocus=${isNew} value=${a.name} onInput=${(e) => set({ name: e.target.value })} placeholder=${cat.liability ? 'مثلاً: وام مسکن' : 'مثلاً: طلای آب‌شده'} /></div>
      <div class="grid2">
        <div class="field"><label>محل نگهداری / بانک / کارگزاری</label><input class="input" value=${a.custodian || ''} onInput=${(e) => set({ custodian: e.target.value })} placeholder="مثلاً: نام بانک یا کارگزاری" /></div>
        <div class="field"><label>نقدشوندگی</label><${Seg} value=${a.liquidity} onChange=${(v) => set({ liquidity: v })} options=${Object.entries(LIQUIDITY)} /></div>
      </div>
    </div>

    <div class="sec"><div class="st"><${Icon} n="zap" cls="sm" />روش ارزش‌گذاری و به‌روزرسانی</div>
      <div class="modes">${MODES.map((m) => html`<button type="button" class=${'mode' + (a.mode === m.id ? ' on' : '')} onClick=${() => set({ mode: m.id })}>
        <span class="mt"><${Icon} n=${m.icon} cls="sm" />${m.t}</span><span class="md">${m.d}</span></button>`)}</div>

      ${a.mode === 'units' && html`
        <div class="grid2">
          <${NumField} label="مقدار / تعداد" value=${a.quantity} onInput=${(v) => set({ quantity: v })} />
          <div class="field"><label>واحد</label><input class="input" value=${a.unit || ''} onInput=${(e) => set({ unit: e.target.value })} placeholder="گرم، عدد، سهم، دلار…" /></div>
        </div>
        <div class="row between"><span class="lbl">منبع قیمت</span><${Seg} value=${a.price.source} onChange=${(v) => setPrice({ source: v, ref: v === 'market' ? (a.price.ref || { ...(DEFAULT_REF[a.category] || { provider: 'tgju', key: 'geram18' }) }) : a.price.ref })}
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
        : html`<${MoneyField} label="قیمت هر واحد" rial=${a.price.value} onRial=${(v) => setPrice({ value: v })} s=${s} prev=${asset?.price?.value} />`}
      `}

      ${a.mode === 'balance' && html`
        <${MoneyField} label=${cat.liability ? 'مانده بدهی' : a.category === 'bank' ? 'مانده حساب' : 'ارزش فعلی'} rial=${a.balance} onRial=${(v) => set({ balance: v })} s=${s} autoFocus=${!isNew} prev=${asset?.balance} />
        ${!cat.liability && ['bank', 'fixed', 'receivable', 'other'].includes(a.category) && html`<div class="sec" style="padding:12px;gap:10px;background:var(--surface-2)">
          <div class="row between"><div><div class="sb small">سود روزشمار روی همین مانده</div><div class="xs muted">برای حساب‌های کوتاه‌مدت بانکی: سود هر روز روی مانده همان روز حساب و ماهانه واریز می‌شود.</div></div>
            <${Toggle} on=${!!a.interest?.on} onChange=${(v) => set({ interest: v ? { basis: 365, payDay: 1, ...(a.interest || {}), on: true, since: todayIso(), lastAccrual: null, accrued: 0 } : { ...(a.interest || {}), on: false } })} /></div>
          ${a.interest?.on && html`<div class="grid2">
            <${NumField} label="نرخ سود سالانه (٪)" value=${a.interest.annualPct} onInput=${(v) => set({ interest: { ...a.interest, annualPct: v } })} digits=${2} />
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
        <div class="xs muted">برای حقوق، قسط یا اجاره که هر ماه این مانده را تغییر می‌دهد، در صفحه «خودکارسازی» یک جریان تکراری بساز.</div>
      `}

      ${a.mode === 'rate' && html`
        <div class="grid2">
          <${MoneyField} label=${cat.liability ? 'اصل بدهی' : 'اصل سرمایه'} rial=${r.principal} onRial=${(v) => setRate({ principal: v })} s=${s} />
          <${NumField} label="نرخ سود سالانه (٪)" value=${r.annualPct} onInput=${(v) => setRate({ annualPct: v })} digits=${2} />
        </div>
        <div class="field"><label>نحوه محاسبه سود</label>
          <${Seg} value=${r.mode} onChange=${(v) => setRate({ mode: v })} options=${[['payout', 'روزشمار + واریز ماهانه'], ['compound', 'روزشمار مرکب'], ['simple', 'روزشمار ساده']]} />
          <span class="hint">${r.mode === 'payout' ? 'مثل سپرده بانکی: سود هر روز حساب می‌شود (اصل × نرخ ÷ ۳۶۵) و هر ماه در همان روزِ تاریخ شروع واریز می‌شود.' : r.mode === 'compound' ? 'مثل صندوق درآمد ثابت: ارزش هر روز با نرخ سالانه رشد مرکب می‌کند.' : 'مثل شراکت یا قرض: سود هر روز به‌صورت خطی اضافه می‌شود و مرکب نمی‌شود.'}</span>
        </div>
        <div class="grid2">
          <${JDateField} label="تاریخ شروع" iso=${r.start} onIso=${(v) => setRate({ start: v })} />
          <${JDateField} label="تاریخ سررسید (اختیاری)" iso=${r.maturity} onIso=${(v) => setRate({ maturity: v })} allowEmpty hint="خالی = بدون سررسید" />
        </div>
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

      <div class="preview">
        <div><div class="xs muted">ارزش فعلی</div><div class="v"><${Money} v=${cat.liability ? -val.value : val.value} s=${s} /></div>
          ${a.mode === 'units' && html`<div class="xs muted num">${num(+a.quantity || 0, 'auto')} ${a.unit || ''} × <${Money} v=${val.unitPrice} s=${s} /></div>`}</div>
        <div style="text-align:left">
          ${a.mode === 'units' && a.price.source === 'market' && html`${preview.loading ? html`<span class="pill"><${Icon} n="refresh" cls="sm spin" />دریافت قیمت…</span>` : preview.q?.price ? html`<span class="pill live"><i class="blink"></i>قیمت زنده</span>` : html`<span class="pill error" title=${preview.err || ''}>قیمت دریافت نشد</span>`}
            ${preview.q?.changePct ? html`<div class="xs" style="margin-top:4px">امروز <span class=${preview.q.changePct >= 0 ? 'pos' : 'neg'}>${pct(preview.q.changePct)}</span></div>` : ''}`}
          ${a.mode === 'rate' && html`<span class="pill auto">رشد خودکار</span>`}
        </div>
      </div>
      ${a.mode === 'units' && a.price.source === 'market' && preview.err && !preview.q?.price && html`<div class="callout warn"><${Icon} n="wifi" cls="sm" /><div>${preview.err}. ذخیره کن؛ در به‌روزرسانی بعدی دوباره تلاش می‌شود${a.price.value ? ' و تا آن موقع آخرین قیمت شناخته‌شده استفاده می‌شود' : ''}.</div></div>`}
    </div>

    <div class="sec"><div class="st"><${Icon} n="target" cls="sm" />جزئیات بیشتر (اختیاری)</div>
      ${!cat.liability && a.mode !== 'rate' && html`<div class="grid2">
        <${MoneyField} label="بهای تمام‌شده کل" rial=${a.costBasis} onRial=${(v) => set({ costBasis: v })} s=${s} hint="برای محاسبه سود/زیان" />
        ${(a.mode === 'balance' || a.price.source === 'manual') ? html`<div class="field"><label>یادآوری به‌روزرسانی</label>
          <select class="input" value=${a.remindDays ?? ''} onChange=${(e) => set({ remindDays: e.target.value === '' ? null : +e.target.value })}>
            <option value="">پیش‌فرض (${a.mode === 'balance' ? s.remindDays.balance : s.remindDays.price} روز)</option><option value="1">هر روز</option><option value="7">هر هفته</option><option value="30">هر ماه</option><option value="90">هر سه ماه</option><option value="0">هرگز</option>
          </select></div>` : html`<div></div>`}
      </div>`}
      <${JDateField} label="تاریخ خرید / شروع نگهداری" iso=${a.since || null} onIso=${(v) => set({ since: v })} allowEmpty hint="برای بازسازی دقیق‌تر تاریخچه؛ خالی یعنی از قبل داشته‌ای" />
      <div class="field"><label>یادداشت</label><textarea class="input" rows="2" value=${a.note || ''} onInput=${(e) => set({ note: e.target.value })} placeholder="شماره حساب، لینک منبع، توضیحات…"></textarea></div>
    </div>
  </${Drawer}>`;
}
