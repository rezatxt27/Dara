// «ماشین‌حساب‌ها»: tools that need no portfolio. One tool on screen at a time; the home is a short list of tiles.
import { html, useState, useMemo, Icon, Money, NumField, MoneyField, Seg, num, pct } from '../components.js';
import * as K from '../../lib/calc.js';
import { BreakEven } from './analysis.js';

const TOOLS = [
  { id: 'convert', icon: 'swap', t: 'با این پول چقدر می‌شود؟', d: 'یک مبلغ به گرم طلا، سکه، دلار و تتر — یا برعکس' },
  { id: 'gold', icon: 'gold', t: 'فاکتور طلا', d: 'قیمت طلای نو با اجرت، فروش طلای کهنه، و سنجیدن قیمت مغازه' },
  { id: 'breakeven', icon: 'target', t: 'نقطه سربه‌سر', d: 'قیمت چقدر باید بالا برود تا از سپرده جلو بزند' },
];
const GROUPS = [['gold', 'طلا'], ['coin', 'سکه'], ['fx', 'ارز'], ['crypto', 'رمزارز'], ['metal', 'نقره']];
const qtyDigits = (it, q) => (it.id === 'btc' ? 6 : q < 10 ? 2 : q < 100 ? 1 : 0);
const fmtQty = (it, q) => `${num(q, qtyDigits(it, q))} ${it.unit}`;

export function CalcPage({ st, s, open, route }) {
  const tool = TOOLS.find((t) => t.id === route.q.t);
  if (!tool) return html`<div class="page" style="max-width:920px">
    <div class="calc-tiles">${TOOLS.map((t) => html`<a class="calc-tile" href=${'#/calc?t=' + t.id}>
      <span class="calc-ic"><${Icon} n=${t.icon} /></span>
      <span class="calc-tt">${t.t}</span><span class="calc-td">${t.d}</span>
      <${Icon} n="chevronLeft" cls="sm calc-go" /></a>`)}</div>
  </div>`;
  return html`<div class="page" style="max-width:920px">
    <a class="calc-back" href="#/calc"><${Icon} n="chevronRight" cls="sm" />همه ماشین‌حساب‌ها</a>
    ${tool.id === 'convert' && html`<${Converter} st=${st} s=${s} />`}
    ${tool.id === 'gold' && html`<${GoldInvoice} st=${st} s=${s} open=${open} />`}
    ${tool.id === 'breakeven' && html`<${BreakEven} st=${st} s=${s} />`}
  </div>`;
}

/* ------------------------------------------------ converter ------------------------------------------------ */
function Converter({ st, s }) {
  const [dir, setDir] = useState('from');
  const [amount, setAmount] = useState(1_000_000_000);
  const [pick, setPick] = useState('sekee');
  const [qty, setQty] = useState(1);
  const rows = useMemo(() => K.convertFrom(amount, st.quotes), [amount, st.quotes]);
  const to = useMemo(() => K.convertTo(pick, qty, st.quotes), [pick, qty, st.quotes]);
  const it = K.itemById(pick);
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="swap" cls="sm" />با این پول چقدر می‌شود؟</h3>
      <${Seg} value=${dir} onChange=${setDir} options=${[['from', 'از مبلغ'], ['to', 'از دارایی']]} /></div>
    ${dir === 'from' ? html`
      <div class="calc-in"><${MoneyField} label="مبلغ" rial=${amount} onRial=${(v) => setAmount(v || 0)} s=${s} /></div>
      ${amount > 0 ? html`<div class="calc-groups">${GROUPS.map(([g, title]) => {
        const list = rows.filter((r) => r.group === g);
        if (!list.length) return null;
        return html`<div class="calc-group"><div class="calc-gt">${title}</div>${list.map((r) => html`<div class="calc-row">
          <span class="grow"><span class="sb">${r.name}</span>
            ${r.price ? html`<span class="xs muted">هر ${r.unit} <${Money} v=${r.price} s=${s} compact />${r.stale ? html` · <span class="warn">قیمت قدیمی</span>` : ''}</span>` : html`<span class="xs faint">فعلاً قیمت ندارد</span>`}</span>
          ${r.price && html`<span class="calc-q"><b class="num">≈ ${fmtQty(r, r.qty)}</b>
            <span class="xs muted">${r.whole
              ? (r.count > 0 ? html`با هزینه خرید ${num(r.count)} ${r.unit} کامل${r.left >= 1 ? html`، <${Money} v=${r.left} s=${s} compact /> می‌ماند` : ''}` : `با هزینه خرید، کمتر از یک ${r.unit}`)
              : html`با هزینه خرید ≈ ${fmtQty(r, r.net)}`}</span></span>`}
        </div>`)}</div>`;
      })}</div>` : html`<div class="empty small">مبلغ را بنویس؛ عدد یا به حروف، مثل «صد میلیون».</div>`}`
    : html`
      <div class="calc-in two">
        <div class="field"><label>دارایی</label><select class="input" value=${pick} onChange=${(e) => setPick(e.target.value)}>
          ${GROUPS.map(([g, title]) => html`<optgroup label=${title}>${K.ITEMS.filter((x) => x.group === g).map((x) => html`<option value=${x.id}>${x.name}</option>`)}</optgroup>`)}</select></div>
        <${NumField} label="مقدار" value=${qty} onInput=${(v) => setQty(v || 0)} suffix=${it?.unit} />
      </div>
      ${to?.price ? html`<div class="calc-result">
          <span class="small muted">ارزش امروز</span>
          <span class="calc-big"><${Money} v=${to.value} s=${s} /></span>
          <span class="small">اگر بفروشی، بعد از هزینه فروش حدود <b><${Money} v=${to.net} s=${s} compact /></b></span>
          <span class="xs muted">هر ${to.unit} <${Money} v=${to.price} s=${s} />${to.stale ? html` · <span class="warn">قیمت قدیمی</span>` : ''}</span>
        </div>`
        : to ? html`<div class="empty small">قیمت این دارایی فعلاً در دسترس نیست.</div>` : html`<div class="empty small">مقدار را بنویس.</div>`}`}
    <div class="xs muted calc-foot">قیمت‌ها از tgju و نوبیتکس. «با هزینه خرید» یعنی با نصف هزینه خرید و فروشی که در «مقایسه دو گزینه» فرض شده؛ قیمت واقعی هر فروشنده کمی فرق دارد.</div>
  </div>`;
}

/* ---------------------------------------------- gold invoice ---------------------------------------------- */
function GoldInvoice({ st, s, open }) {
  const mq = st.quotes['tgju:geram18'];
  const market = mq?.price > 0 ? mq.price : null;
  const marketStale = !!market && (!!mq.error || Date.now() - (mq.at || mq.fetchedAt || 0) > 3 * 86400000);
  const [mode, setMode] = useState('buy');
  const [gramIn, setGramIn] = useState(null); // null: today's market price
  const gram = gramIn ?? market;
  const [weight, setWeight] = useState(null);
  const [wageBy, setWageBy] = useState('pct');
  const [wagePct, setWagePct] = useState(null);
  const [wagePer, setWagePer] = useState(null);
  const [stones, setStones] = useState(null);
  const [offer, setOffer] = useState(null);
  const [total, setTotal] = useState(null);
  const [adv, setAdv] = useState(false);
  const [sellerIn, setSeller] = useState(K.GOLD_DEFAULTS.sellerPct);
  const [vatIn, setVat] = useState(K.GOLD_DEFAULTS.vatPct);
  const [kIn, setK] = useState(K.GOLD_DEFAULTS.sellK);
  // what's typed may be half-way («7» on the way to «740») or a typo: the sums always use a valid value
  const seller = K.clampPct(sellerIn, K.GOLD_DEFAULTS.sellerPct), vat = K.clampPct(vatIn, K.GOLD_DEFAULTS.vatPct), k = K.clampK(kIn);
  const wage = wageBy === 'pct' ? { pct: wagePct || 0 } : { perGram: wagePer || 0 };
  const buy = mode === 'buy' ? K.goldBuy({ weight, gram, wage, sellerPct: seller, vatPct: vat, sellK: k }) : null;
  const sell = mode === 'sell' ? K.goldSell({ weight, stones, gram, k, offer }) : null;
  const chk = mode === 'check' ? K.impliedWage({ weight, gram, total, sellerPct: seller, vatPct: vat }) : null;
  const unit = s.currency === 'rial' ? 'ریال' : 'تومان';
  const register = () => open(null, { category: 'gold', draft: {
    name: 'طلای زینتی', unit: 'گرم', quantity: buy.weight, costBasis: Math.round(buy.total),
    note: `ارزش با عیار ${k} از ۷۵۰ حساب می‌شود؛ یعنی مبلغی که موقع فروش به طلافروشی می‌گیری`,
    // valued at what it would fetch when sold (k of 750), not at the raw 18k price
    price: { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, adjustPct: Math.round((k / 750 - 1) * 10000) / 100, factor: 1, value: null } } });
  const Line = ({ t, v, sub, strong }) => html`<div class=${'calc-line' + (strong ? ' strong' : '')}><span>${t}${sub ? html` <span class="xs muted">${sub}</span>` : ''}</span><span class="num"><${Money} v=${v} s=${s} /></span></div>`;

  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="gold" cls="sm" />فاکتور طلا</h3>
      <${Seg} value=${mode} onChange=${setMode} options=${[['buy', 'خرید طلای نو'], ['sell', 'فروش طلای کهنه'], ['check', 'سنجیدن قیمت مغازه']]} /></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        <${MoneyField} label="قیمت هر گرم طلای ۱۸ عیار" rial=${gram} onRial=${(v) => setGramIn(v || null)} s=${s}
          hint=${gramIn && market ? html`قیمت خودت. <button class="calc-link" onClick=${() => setGramIn(null)}>برگشت به قیمت بازار</button>` : marketStale ? html`<span class="warn">قیمت بازار به‌روز نیست؛ قیمت امروز مغازه را بنویس</span>` : 'قیمت امروز بازار؛ اگر مغازه قیمت دیگری می‌گوید، عوضش کن'} />
        <${NumField} label=${mode === 'sell' ? 'وزن کل' : 'وزن'} value=${weight} onInput=${setWeight} suffix="گرم" placeholder="مثلاً ۳٫۵" />
        ${mode === 'buy' && html`<div class="field"><label>اجرت ساخت</label>
          <div class="row" style="gap:8px"><${Seg} value=${wageBy} onChange=${setWageBy} options=${[['pct', 'درصد'], ['per', `${unit} هر گرم`]]} />
            <span class="grow">${wageBy === 'pct'
              ? html`<${NumField} value=${wagePct} onInput=${setWagePct} suffix="٪" placeholder="مثلاً ۱۵" compact />`
              : html`<${MoneyField} rial=${wagePer} onRial=${setWagePer} s=${s} />`}</span></div></div>`}
        ${mode === 'sell' && html`
          <${NumField} label="وزن سنگ و قطعه‌های غیرطلا (اختیاری)" value=${stones} onInput=${setStones} suffix="گرم" hint="از وزن کل کم می‌شود؛ مغازه بابتش پولی نمی‌دهد" />
          <${MoneyField} label="قیمتی که مغازه پیشنهاد داده (اختیاری)" rial=${offer} onRial=${setOffer} s=${s} />`}
        ${mode === 'check' && html`<${MoneyField} label="قیمت نهایی‌ای که مغازه گفته" rial=${total} onRial=${setTotal} s=${s} />`}
        <div class="xs muted">${mode === 'sell' ? `عیار ${num(k)} از ۷۵۰ (افت ذوب)` : `سود فروشنده ${num(seller, 1)}٪ · مالیات ${num(vat, 1)}٪ روی اجرت و سود${mode === 'buy' ? ` · فروش با عیار ${num(k)}` : ''}`}
          · <button class="calc-link" onClick=${() => setAdv(!adv)}>${adv ? 'بستن' : 'تغییر'}</button></div>
        ${adv && html`<div class="calc-adv">
          ${mode !== 'sell' && html`<${NumField} label="سود فروشنده" value=${sellerIn} onInput=${setSeller} suffix="٪" compact />
            <${NumField} label="مالیات بر ارزش افزوده" value=${vatIn} onInput=${setVat} suffix="٪" compact />`}
          ${mode !== 'check' && html`<${NumField} label="عیار فروش" value=${kIn} onInput=${setK} hint=${K.clampK(kIn) === +kIn ? 'بعضی مغازه‌ها ۷۴۷ حساب می‌کنند' : html`<span class="warn">عددی بین ۶۰۰ و ۷۵۰؛ فعلاً ${num(k)} حساب می‌شود</span>`} />`}
        </div>`}
      </div>

      <div class="calc-out">
        ${!gram ? html`<div class="empty small">قیمت هر گرم را بنویس.</div>` : !(weight > 0) ? html`<div class="empty small">وزن را بنویس.</div>` : ''}
        ${buy && html`
          <${Line} t="ارزش طلا" sub=${`${num(buy.weight, 2)} گرم`} v=${buy.base} />
          <${Line} t="اجرت ساخت" sub=${pct(buy.makingPct, { sign: false, digits: 1 })} v=${buy.making} />
          <${Line} t="سود فروشنده" sub=${`${num(seller, 1)}٪`} v=${buy.seller} />
          <${Line} t="مالیات" sub=${`${num(vat, 1)}٪ روی اجرت و سود`} v=${buy.vat} />
          <div class="calc-total"><span>جمع قابل پرداخت</span><b class="num"><${Money} v=${buy.total} s=${s} /></b></div>
          <div class="xs muted">هر گرم با همه هزینه‌ها: <${Money} v=${buy.perGram} s=${s} /></div>
          <div class="callout warn" style="margin-top:4px"><${Icon} n="info" cls="sm" /><div>اگر فردا همین را بفروشی، حدود <b><${Money} v=${buy.resale} s=${s} compact /></b> می‌گیری؛ یعنی <b class="ltr">${pct(buy.resaleLoss, { sign: false, digits: 0 })}</b> کمتر از مبلغی که می‌پردازی. اجرت، سود فروشنده و مالیات برنمی‌گردد.</div></div>
          <div class="row"><button class="btn" onClick=${register}><${Icon} n="plus" cls="sm" />ثبت به‌عنوان دارایی</button></div>`}
        ${sell?.nothing && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>وزن سنگ و قطعه‌ها از وزن کل بیشتر یا برابر است؛ یکی از دو عدد را درست کن.</div></div>`}
        ${sell && !sell.nothing && html`
          <span class="small muted">مبلغ تقریبی فروش</span>
          <span class="calc-big"><${Money} v=${sell.expected} s=${s} /></span>
          <div class="xs muted">${num(sell.net, 2)} گرم طلای خالص${sell.stones > 0 ? ` (بعد از کم کردن ${num(sell.stones, 2)} گرم)` : ''} × قیمت هر گرم × ${num(sell.k)}/۷۵۰</div>
          ${sell.offer && html`<div class=${'callout' + (sell.diff < -0.02 ? ' warn' : '')}><${Icon} n="info" cls="sm" /><div>پیشنهاد مغازه <b class="ltr">${pct(Math.abs(sell.diff), { sign: false, digits: 1 })}</b> ${sell.diff < 0 ? 'کمتر' : 'بیشتر'} از این تقریب است.${sell.diff < -0.02 ? ' می‌توانی قیمت مغازه دیگری را هم بپرسی.' : ''}</div></div>`}
          <div class="xs muted">اجرتی که موقع خرید داده‌ای در فروش برنمی‌گردد.</div>`}
        ${chk && html`
          ${chk.belowGold
            ? html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>این قیمت از ارزش خود طلا (<${Money} v=${chk.base} s=${s} compact />) هم کمتر است. شاید قیمت هر گرم مغازه پایین‌تر از بازار است؛ قیمت هر گرم را از مغازه بپرس و عوضش کن.</div></div>`
            : html`<span class="small muted">این قیمت یعنی اجرت ساخت حدود</span>
              <span class="calc-big ltr">${chk.pct < -0.005 ? '—' : pct(Math.max(0, chk.pct), { sign: false, digits: 1 })}</span>
              ${chk.pct < -0.005 ? html`<div class="callout warn"><${Icon} n="info" cls="sm" /><div>این قیمت از ارزش طلا به‌علاوه سود فروشنده و مالیات کمتر است؛ احتمالاً مغازه قیمت هر گرم یا سود کمتری حساب کرده. قیمت هر گرم مغازه را بپرس.</div></div>`
                : chk.pct < 0.005 ? html`<div class="xs muted">تقریباً بدون اجرت؛ مثل طلای دست‌دوم.</div>` : ''}`}
          <div class="xs muted">هر گرم با همه هزینه‌ها: <${Money} v=${chk.perGram} s=${s} /> · با سود فروشنده ${num(seller, 1)}٪ و مالیات ${num(vat, 1)}٪ حساب شد.</div>`}
      </div>
    </div>
    <div class="xs muted calc-foot">این روش رایج فاکتور طلاست؛ درصدها پیش‌فرض‌اند و هر مغازه ممکن است کمی متفاوت حساب کند. برای طلای سنگ‌دار و برلیان، قیمت سنگ جداست.</div>
  </div>`;
}
