// «ماشین‌حساب‌ها»: tools that need no portfolio. One tool on screen at a time; the home is a short list of tiles.
import { html, useState, useMemo, Icon, Money, NumField, MoneyField, Seg, num, pct, fmtJ } from '../components.js';
import { L } from '../tips.js';
import * as I from '../../lib/insights.js';
import { todayIso, daysBetween } from '../../lib/jalali.js';
import * as K from '../../lib/calc.js';
import * as E from '../../lib/engine.js';
import * as S from '../../lib/pricestats.js';
import { BreakEven } from './analysis.js';

const TOOLS = [
  { id: 'convert', icon: 'swap', t: 'با این پول چقدر می‌شود؟', d: 'یک مبلغ به گرم طلا، سکه، دلار و تتر — یا برعکس' },
  { id: 'gold', icon: 'gold', t: 'فاکتور طلا', d: 'قیمت طلای نو با اجرت، فروش طلای کهنه، و سنجیدن قیمت مغازه' },
  { id: 'rent', icon: 'home', t: 'رهن و اجاره', d: 'تبدیل ودیعه و اجاره به هم، و اینکه ودیعه بیشتر به‌صرفه است یا سپرده' },
  { id: 'loan', icon: 'debt', t: 'هزینه واقعی وام', d: 'قسط ماهانه، و نرخ واقعی با کارمزد، سپرده مسدودی یا پول خوابیده' },
  { id: 'deposit', icon: 'bank', t: 'سپرده', d: 'سود ماهانه و سود مؤثر، و اینکه شکستن سپرده چقدر هزینه دارد' },
  { id: 'breakeven', icon: 'target', t: 'نقطه سربه‌سر', d: 'قیمت چقدر باید بالا برود تا از سپرده جلو بزند' },
  { id: 'goal', icon: 'calendar', t: 'هدف پس‌انداز', d: 'ماهی چقدر کنار بگذاری تا به هدفت برسی — یا با این مبلغ کی می‌رسی' },
  { id: 'average', icon: 'layers', t: 'میانگین خرید', d: 'اگر باز هم بخری میانگینت چند می‌شود، و قیمت باید کجا برسد تا سربه‌سر شوی' },
  { id: 'trade', icon: 'chart', t: 'معاملهٔ بورس', d: 'کارمزد و مالیات خرید و فروش، سود خالص، و قیمت سربه‌سر' },
  { id: 'instal', icon: 'debt', t: 'قسطی یا نقدی؟', d: 'سود واقعی خرید قسطی، و اینکه نقد دادن بهتر است یا پول در سپرده بماند' },
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
    ${tool.id === 'convert' && html`<${Converter} st=${st} s=${s} toId=${route.q.to} />`}
    ${tool.id === 'gold' && html`<${GoldInvoice} st=${st} s=${s} open=${open} />`}
    ${tool.id === 'rent' && html`<${RentTool} st=${st} s=${s} />`}
    ${tool.id === 'loan' && html`<${LoanTool} st=${st} s=${s} />`}
    ${tool.id === 'deposit' && html`<${DepositTool} st=${st} s=${s} />`}
    ${tool.id === 'breakeven' && html`<${BreakEven} st=${st} s=${s} initial=${route.q.pick} />`}
    ${tool.id === 'goal' && html`<${GoalTool} st=${st} s=${s} />`}
    ${tool.id === 'average' && html`<${AverageTool} st=${st} s=${s} />`}
    ${tool.id === 'trade' && html`<${TradeTool} st=${st} s=${s} />`}
    ${tool.id === 'instal' && html`<${InstalTool} st=${st} s=${s} />`}
  </div>`;
}

/* ------------------------------------------------ converter ------------------------------------------------ */
function Converter({ st, s, toId }) {
  // opened from a price's page: start from that asset («how much is a quantity of it»)
  const [dir, setDir] = useState(toId && K.itemById(toId) ? 'to' : 'from');
  const [amount, setAmount] = useState(1_000_000_000);
  const [pick, setPick] = useState(toId && K.itemById(toId) ? toId : 'sekee');
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
          ${mode !== 'check' && html`<${NumField} label=${L('عیار فروش', 'cKarat')} value=${kIn} onInput=${setK} hint=${K.clampK(kIn) === +kIn ? 'بعضی مغازه‌ها ۷۴۷ حساب می‌کنند' : html`<span class="warn">عددی بین ۶۰۰ و ۷۵۰؛ فعلاً ${num(k)} حساب می‌شود</span>`} />`}
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

/* -------------------------------------------- shared bits -------------------------------------------- */
const pctIn = (v) => (v === null || v === undefined || v === '' ? null : +v);
const Row = ({ t, sub, children, strong }) => html`<div class=${'calc-line' + (strong ? ' strong' : '')}><span>${t}${sub ? html` <span class="xs muted">${sub}</span>` : ''}</span><span class="num">${children}</span></div>`;

/* ------------------------------------------- rent and deposit ------------------------------------------- */
function RentTool({ st, s }) {
  const [dep, setDep] = useState(null);
  const [rent, setRent] = useState(null);
  const [rateIn, setRate] = useState(K.RENT_DEFAULT_PCT);
  const [by, setBy] = useState('deposit');
  const [target, setTarget] = useState(null);
  const rate = K.clampPct(rateIn, K.RENT_DEFAULT_PCT);
  const r = K.rentConvert({ deposit: dep, rent, ratePct: rate, ...(target !== null ? (by === 'deposit' ? { newDeposit: target } : { newRent: target }) : {}) });
  const depPct = I.defaultDepositPct(st);
  const v = K.rentVsDeposit({ ratePct: rate, depositPct: depPct });
  const per = 1_000_000_000; // «هر ۱۰۰ میلیون تومان»
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="home" cls="sm" />رهن و اجاره</h3></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        <${MoneyField} label="ودیعه (رهن)" rial=${dep} onRial=${setDep} s=${s} />
        <${MoneyField} label="اجاره ماهانه" rial=${rent} onRial=${setRent} s=${s} />
        <${NumField} label=${L('نرخ تبدیل در ماه', 'cConv')} value=${rateIn} onInput=${setRate} suffix="٪"
          hint=${html`هر ۱۰۰ میلیون ودیعه = ${num(rate, 1)} میلیون اجاره در ماه. عرف بازار، معمولاً حدود ۳٪؛ شهر به شهر و سال به سال فرق دارد.`} />
        <div class="field"><label>ترکیب تازه</label>
          <div class="row" style="gap:8px"><${Seg} value=${by} onChange=${(x) => { setBy(x); setTarget(null); }} options=${[['deposit', 'ودیعه تازه'], ['rent', 'اجاره تازه']]} />
            <span class="grow"><${MoneyField} rial=${target} onRial=${setTarget} s=${s} /></span></div></div>
      </div>
      <div class="calc-out">
        ${!(rate > 0) ? html`<div class="empty small">نرخ تبدیل باید بیشتر از صفر باشد.</div>` : !r ? html`<div class="empty small">ودیعه یا اجاره را بنویس.</div>` : html`
          <${Row} t="اگر همه اجاره باشد"><${Money} v=${r.fullRent} s=${s} /> <span class="xs muted">در ماه</span></${Row}>
          <${Row} t="اگر همه رهن باشد"><${Money} v=${r.fullDeposit} s=${s} /></${Row}>
          ${r.to && html`<div class="calc-total"><span>${by === 'deposit' ? 'اجاره با این ودیعه' : 'ودیعه با این اجاره'}</span>
            <b class="num"><${Money} v=${by === 'deposit' ? r.to.rent : r.to.deposit} s=${s} /></b></div>
            ${r.to.over && html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>این عدد از ارزش کل قرارداد بیشتر است (${by === 'deposit' ? 'رهن کامل' : 'اجاره کامل'} <${Money} v=${by === 'deposit' ? r.fullDeposit : r.fullRent} s=${s} compact /> است).</div></div>`}`}
        `}
        <div class="callout" style="margin-top:6px"><${Icon} n="info" cls="sm" /><div>
          برای مستأجر، هر <${Money} v=${per} s=${s} compact /> ودیعه بیشتر سالی حدود <b><${Money} v=${per * v.rentYield} s=${s} compact /></b> اجاره کم می‌کند؛
          همین پول در سپرده ${num(depPct, 1)}٪ سالی حدود <b><${Money} v=${per * v.depositYield} s=${s} compact /></b> سود می‌دهد.
          ${v.more === 'deposit' ? ' با این نرخ‌ها، ودیعهٔ بیشتر و اجارهٔ کمتر به‌صرفه است.' : v.more === 'bank' ? ' با این نرخ‌ها، پول در سپرده و اجارهٔ بیشتر به‌صرفه است.' : ' با این نرخ‌ها، دو راه تقریباً برابرند.'}
          ${' '}<span class="muted">(برای صاحبخانه برعکس است.)</span></div></div>
      </div>
    </div>
    <div class="xs muted calc-foot">نرخ سپرده از تنظیمات «تحلیل» یا سپرده‌های خودت می‌آید. ودیعه سر قرارداد کامل برمی‌گردد؛ این مقایسه فقط پول جابه‌جاشده را می‌سنجد، نه تورم یا ریسک.</div>
  </div>`;
}

/* ------------------------------------------- the real cost of a loan ------------------------------------------- */
function LoanTool({ st, s }) {
  const [amount, setAmount] = useState(null);
  const [rateIn, setRate] = useState(23);
  const [monthsIn, setMonths] = useState(36);
  const [more, setMore] = useState(false);
  const [feeIn, setFee] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [blockedPctIn, setBlockedPct] = useState(null);
  const [idle, setIdle] = useState(null);
  const [idleMonthsIn, setIdleMonths] = useState(null);
  const [idlePctIn, setIdlePct] = useState(null);
  const depPct = I.defaultDepositPct(st);
  // the bank's conditions count only while their panel is open (closing it means «no conditions»)
  const c = more ? { feePct: feeIn || 0, blocked: blocked || 0, blockedPct: blockedPctIn || 0, idle: idle || 0, idleMonths: idleMonthsIn || 0, idlePct: idlePctIn || 0 } : {};
  const r = K.loanCost({ amount, ratePct: pctIn(rateIn), months: monthsIn, ...c, opportunityPct: depPct });
  const idleNoMonths = more && idle > 0 && !(idleMonthsIn > 0);
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="debt" cls="sm" />هزینه واقعی وام</h3></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        <${MoneyField} label="مبلغ وام" rial=${amount} onRial=${setAmount} s=${s} />
        <div class="calc-in two" style="max-width:none">
          <${NumField} label="سود سالانه" value=${rateIn} onInput=${setRate} suffix="٪" />
          <${NumField} label="مدت" value=${monthsIn} onInput=${setMonths} suffix="ماه" />
        </div>
        <button class="calc-link" style="align-self:flex-start" onClick=${() => setMore(!more)}>${more ? 'بستن شرط‌های بانک' : '+ شرط‌های بانک: کارمزد، سپرده مسدودی، پول خوابیده'}</button>
        ${more && html`<div class="calc-adv" style="grid-template-columns:1fr">
          <${NumField} label=${L('کارمزد و کسورات اول کار', 'cFee')} value=${feeIn} onInput=${setFee} suffix="٪" hint="درصدی از مبلغ وام که همان اول کم می‌شود (کارمزد، بیمه، سهم صندوق…)" />
          <div class="calc-in two" style="max-width:none"><${MoneyField} label=${L('سپرده مسدودی در طول وام', 'cBlocked')} rial=${blocked} onRial=${setBlocked} s=${s} />
            <${NumField} label="سود سپرده مسدودی" value=${blockedPctIn} onInput=${setBlockedPct} suffix="٪" /></div>
          <div class="calc-in two" style="max-width:none"><${MoneyField} label=${L('پول خوابیده قبل از وام (معدل)', 'cIdle')} rial=${idle} onRial=${setIdle} s=${s} />
            <${NumField} label="چند ماه قبل" value=${idleMonthsIn} onInput=${setIdleMonths} suffix="ماه" /></div>
          ${idleNoMonths && html`<div class="xs warn">چند ماه پول باید بخوابد؟ تا ننویسی، حساب نمی‌شود.</div>`}
          ${idle > 0 && html`<${NumField} label="سودی که پول خوابیده می‌گیرد" value=${idlePctIn} onInput=${setIdlePct} suffix="٪" hint=${`اگر در حساب قرض‌الحسنه یا جاری است، صفر. هزینه‌اش سودی است که در سپرده ${num(depPct, 1)}٪ از دست می‌دهد.`} />`}
        </div>`}
      </div>
      <div class="calc-out">
        ${!r ? html`<div class="empty small">مبلغ، سود و مدت وام را بنویس.</div>` : html`
          <span class="small muted">قسط ماهانه</span>
          <span class="calc-big"><${Money} v=${r.installment} s=${s} /></span>
          <${Row} t="کل بازپرداخت" sub=${`${num(r.months)} قسط`}><${Money} v=${r.total} s=${s} /></${Row}>
          <${Row} t="کل سود"><${Money} v=${r.interest} s=${s} /></${Row}>
          ${r.extras && html`<${Row} t="پولی که واقعاً دستت می‌رسد"><${Money} v=${r.netReceived} s=${s} /></${Row}>`}
          ${r.idleCost > 0 && html`<${Row} t="سودی که پول خوابیده از دست می‌دهد"><${Money} v=${r.idleCost} s=${s} /></${Row}>`}
          ${r.noMoney ? html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>با این شرط‌ها چیزی از وام دستت نمی‌رسد؛ سپرده مسدودی و کسورات از خود وام بیشتر است.</div></div>`
          : r.earns ? html`<div class="callout"><${Icon} n="info" cls="sm" /><div>با این شرط‌ها، این بسته در عمل هزینه‌ای ندارد و حتی چیزی هم برایت می‌ماند (سود سپرده مسدودی از سود وام بیشتر است).</div></div>`
          : r.realPct !== null && html`<div class="calc-total"><span>نرخ واقعی سالانه</span><b class="num ltr">${num(r.realPct, 1)}٪</b></div>
            <div class="xs muted">${r.extras ? `با شرط‌های بانک، این وام مثل وامی با سود ${num(r.realPct, 1)}٪ (بدون شرط) برایت تمام می‌شود.` : 'بدون شرط اضافه، نرخ واقعی همان نرخ اعلام‌شده است. شرط‌های بانک را اضافه کن تا اثرشان را ببینی.'}</div>
            <div class="callout"><${Icon} n="info" cls="sm" /><div>برای مقایسه: سود سپرده ${num(depPct, 1)}٪ است؛ نرخ واقعی این وام ${r.realPct > depPct + 0.05 ? 'از آن بیشتر' : r.realPct < depPct - 0.05 ? 'از آن کمتر' : 'تقریباً همان'} است. تورم را هم در نظر بگیر: وامی که نرخش از تورم کمتر باشد، در عمل ارزان است.</div></div>`}
        `}
      </div>
    </div>
    <div class="xs muted calc-foot">قسط با فرمول معمول بانک‌ها (اقساط مساوی ماهانه). نرخ واقعی از همه پول‌هایی حساب می‌شود که در طول وام می‌دهی و می‌گیری؛ دیرکرد، بیمه سالانه و هزینه‌های دیگر حساب نشده‌اند.</div>
  </div>`;
}

/* ---------------------------------------------------- deposits ---------------------------------------------------- */
const monthsBetween = (a, b) => Math.max(0, Math.round(daysBetween(a, b) / 30.44));
const fullMonths = (a, b) => Math.max(0, Math.floor(daysBetween(a, b) / 30.44 + 1e-9)); // months already completed
function DepositTool({ st, s }) {
  const [mode, setMode] = useState('yield');
  const mine = st.assets.filter((a) => !a.archived && a.mode === 'rate' && a.category !== 'debt' && +a.rate?.principal > 0 && +a.rate?.annualPct > 0 && a.rate.maturity);
  const [paidOut, setPaidOut] = useState(true);
  const [principal, setPrincipal] = useState(null);
  const [rateIn, setRate] = useState(() => I.defaultDepositPct(st));
  const [monthsIn, setMonths] = useState(12);
  const [heldIn, setHeld] = useState(null);
  const [breakIn, setBreak] = useState(null);
  const [newIn, setNew] = useState(null);
  const [pick, setPick] = useState('');
  const fromMine = (id) => {
    setPick(id); const a = mine.find((x) => x.id === id); if (!a) return;
    const today = todayIso();
    setPrincipal(+a.rate.principal); setRate(+a.rate.annualPct);
    setMonths(Math.max(1, monthsBetween(a.rate.start, a.rate.maturity))); setHeld(Math.min(fullMonths(a.rate.start, today), monthsBetween(a.rate.start, a.rate.maturity)));
    // interest paid into another account each month, or left on the deposit
    setPaidOut(a.rate.mode === 'payout' && !!a.rate.payoutTo && a.rate.payoutTo !== 'self');
  };
  const y = mode === 'yield' ? K.depositYield({ principal, ratePct: pctIn(rateIn), months: monthsIn }) : null;
  const b = mode === 'break' && breakIn !== null ? K.depositBreak({ principal, ratePct: pctIn(rateIn), termMonths: monthsIn, heldMonths: heldIn ?? 0, breakPct: breakIn, newPct: newIn, paidOut }) : null;
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="bank" cls="sm" />سپرده</h3>
      <${Seg} value=${mode} onChange=${setMode} options=${[['yield', 'سود سپرده'], ['break', 'شکستن سپرده']]} /></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        ${mode === 'break' && mine.length > 0 && html`<div class="field"><label>از سپرده‌های من (اختیاری)</label><select class="input" value=${pick} onChange=${(e) => fromMine(e.target.value)}>
          <option value="">—</option>${mine.map((a) => html`<option value=${a.id}>${a.name}${a.custodian ? ' — ' + a.custodian : ''}</option>`)}</select></div>`}
        <${MoneyField} label="مبلغ سپرده" rial=${principal} onRial=${setPrincipal} s=${s} />
        <div class="calc-in two" style="max-width:none">
          <${NumField} label="سود سالانه" value=${rateIn} onInput=${setRate} suffix="٪" />
          <${NumField} label=${mode === 'break' ? 'مدت قرارداد' : 'مدت'} value=${monthsIn} onInput=${setMonths} suffix="ماه" />
        </div>
        ${mode === 'break' && html`
          <${NumField} label="چند ماه از شروع گذشته" value=${heldIn} onInput=${setHeld} suffix="ماه" hint="فقط ماه‌های کامل حساب می‌شود" />
          <div class="field"><label>سود هر ماه</label><${Seg} value=${paidOut ? 'out' : 'in'} onChange=${(v) => setPaidOut(v === 'out')} options=${[['out', 'به حساب واریز می‌شده'], ['in', 'روی سپرده می‌مانده']]} /></div>
          <${NumField} label=${L('نرخ سود در صورت شکستن', 'cBreak')} value=${breakIn} onInput=${setBreak} suffix="٪" placeholder="از قرارداد سپرده"
            hint="نرخی که بانک برای ماه‌های گذشته دوباره حساب می‌کند؛ معمولاً نرخ کوتاه‌مدت یا نرخ مدت کوتاه‌تر. در قرارداد سپرده‌ات نوشته شده." />
          <${NumField} label="اگر پول را جای دیگری بگذاری، با سود سالانه (اختیاری)" value=${newIn} onInput=${setNew} suffix="٪" />`}
      </div>
      <div class="calc-out">
        ${mode === 'yield' && (!y ? html`<div class="empty small">مبلغ و سود سالانه را بنویس.</div>` : html`
          <span class="small muted">سود هر ماه</span>
          <span class="calc-big"><${Money} v=${y.monthly} s=${s} /></span>
          <${Row} t=${`سود ${num(y.months)} ماه`} sub="اگر سود هر ماه برداشته شود"><${Money} v=${y.simple} s=${s} /></${Row}>
          <${Row} t=${`سود ${num(y.months)} ماه`} sub="اگر سود هر ماه دوباره سپرده شود"><${Money} v=${y.compounded} s=${s} /></${Row}>
          <div class="calc-total"><span>سود مؤثر سالانه</span><b class="num ltr">${pct(y.effAnnual, { sign: false, digits: 1 })}</b></div>
          <div class="xs muted">وقتی سود ماهانه دوباره سپرده شود، سود روی سود هم می‌آید؛ برای همین سود مؤثر از نرخ اعلام‌شده (${num(pctIn(rateIn), 1)}٪) بیشتر است.</div>`)}
        ${mode === 'break' && (breakIn === null ? html`<div class="empty small">نرخ سود در صورت شکستن را از قرارداد سپرده بنویس.</div>`
          : !b ? html`<div class="empty small">مبلغ، سود و مدت را بنویس.</div>`
          : b.matured ? html`<div class="callout"><${Icon} n="check" cls="sm" /><div>مدت سپرده تمام شده؛ شکستن هزینه‌ای ندارد.</div></div>` : html`
          ${b.paidOut ? html`
            <${Row} t="سودی که تا حالا گرفته‌ای" sub=${`${num(b.held)} ماه`}><${Money} v=${b.received} s=${s} /></${Row}>
            <${Row} t="کسر از اصل پول"><span class="neg"><${Money} v=${-b.penalty} s=${s} /></span></${Row}>`
          : html`<${Row} t="سودی که با شکستن از دست می‌رود" sub=${`${num(b.held)} ماه`}><span class="neg"><${Money} v=${-b.lost} s=${s} /></span></${Row}>`}
          <div class="calc-total"><span>اگر امروز بشکنی، پس می‌گیری</span><b class="num"><${Money} v=${b.back} s=${s} /></b></div>
          <div class="xs muted">اگر نگه داری، ${num(b.remaining)} ماه دیگر ${b.paidOut ? html`<${Money} v=${b.keepInterest} s=${s} compact /> سود دیگر هم می‌گیری` : html`در سررسید <${Money} v=${b.keepEnd} s=${s} compact /> می‌گیری`}.</div>
          ${b.diff !== undefined && html`<div class=${'callout' + (b.diff < 0 ? ' warn' : '')}><${Icon} n="info" cls="sm" /><div>
            شکستن و گذاشتن ${+newIn > 0 ? `در سود ${num(+newIn, 1)}٪` : 'به‌صورت نقد'}، تا پایان همان ${num(b.remaining)} ماه، حدود <b><${Money} v=${Math.abs(b.diff)} s=${s} compact /></b> ${b.diff >= 0 ? 'بیشتر' : 'کمتر'} از نگه‌داشتن می‌شود.
            ${b.evenPct !== null && isFinite(b.evenPct) && html`<span class="muted"> سربه‌سر در سود حدود ${num(b.evenPct, 1)}٪.</span>`}</div></div>`}
        `)}
      </div>
    </div>
    <div class="xs muted calc-foot">${mode === 'break' ? 'روش رایج بانک‌ها: سود ماه‌های گذشته با نرخ کمتر دوباره حساب می‌شود و سودی که بیشتر گرفته‌ای از اصل پول کم می‌شود. قاعده هر بانک ممکن است کمی فرق کند.' : 'سود ماهانه با نرخ سالانه ÷ ۱۲ حساب شده؛ سپرده‌های روزشمار هم تقریباً همین را می‌دهند.'}</div>
  </div>`;
}

/* ------------------------------------------- a savings goal ------------------------------------------- */
const monthsText = (n) => (n < 12 ? `${num(n)} ماه` : `${num(Math.floor(n / 12))} سال${n % 12 ? ` و ${num(n % 12)} ماه` : ''}`);
function GoalTool({ st, s }) {
  const depPct = I.defaultDepositPct(st);
  const [target, setTarget] = useState(null);
  const [start, setStart] = useState(null);
  const [mode, setMode] = useState('monthly');
  const [monthsIn, setMonths] = useState(24);
  const [monthly, setMonthly] = useState(null);
  const [rateIn, setRate] = useState(depPct);
  const [inflIn, setInfl] = useState(null);
  const [growIn, setGrow] = useState(null);
  const net = useMemo(() => E.portfolio(st.assets, st.quotes, s).net, [st.assets, st.quotes]);
  const r = K.savingsGoal({ target, start, ratePct: pctIn(rateIn) || 0, inflPct: pctIn(inflIn) || 0, growPct: pctIn(growIn) || 0, ...(mode === 'monthly' ? { months: monthsIn } : { monthly }) });
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="calendar" cls="sm" />هدف پس‌انداز</h3><${Seg} value=${mode} onChange=${setMode} options=${[['monthly', 'ماهی چقدر؟'], ['months', 'کی می‌رسم؟']]} /></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        <${MoneyField} label="هدف (به پول امروز)" rial=${target} onRial=${setTarget} s=${s} />
        <div class="col" style="gap:4px"><${MoneyField} label="از حالا داری" rial=${start} onRial=${setStart} s=${s} />
          ${net > 0 && html`<button class="calc-link" style="align-self:flex-start" onClick=${() => setStart(Math.round(net))}>ارزش خالص فعلی‌ات را بگذار</button>`}</div>
        ${mode === 'monthly' ? html`<${NumField} label="در چند ماه" value=${monthsIn} onInput=${setMonths} suffix="ماه" digits=${0} />`
          : html`<${MoneyField} label="هر ماه کنار می‌گذاری" rial=${monthly} onRial=${setMonthly} s=${s} />`}
        <div class="calc-in two" style="max-width:none">
          <${NumField} label="سود سالانهٔ پس‌انداز" value=${rateIn} onInput=${setRate} suffix="٪" hint=${`پیش‌فرض: سود سپرده (${num(depPct, 1)}٪)`} />
          <${NumField} label="تورم سالانه" value=${inflIn} onInput=${setInfl} suffix="٪" hint="هدف هر سال این‌قدر گران‌تر می‌شود؛ خالی = بدون تورم" />
        </div>
        <${NumField} label="افزایش سالانهٔ مبلغ پس‌انداز" value=${growIn} onInput=${setGrow} suffix="٪" hint="مثلاً هم‌پای افزایش حقوق؛ خالی = ثابت" />
      </div>
      <div class="calc-out">
        ${!r ? html`<div class="empty small">${mode === 'monthly' ? (+monthsIn > 1200 ? 'مدت حداکثر ۱۲۰۰ ماه (۱۰۰ سال).' : 'هدف و مدت را بنویس.') : 'هدف و مبلغ ماهانه را بنویس.'}</div>`
        : r.never ? html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>با این مبلغ ثابت، در ۱۰۰ سال هم به هدف نمی‌رسی${(pctIn(inflIn) || 0) > (pctIn(rateIn) || 0) ? '؛ تورم از سود پس‌انداز بیشتر است و هدف تندتر از پس‌انداز بزرگ می‌شود' : ''}. مبلغ ماهانه را بیشتر کن، یا «افزایش سالانه» بگذار.</div></div>`
        : r.already ? html`<div class="callout"><${Icon} n="circleCheck" cls="sm" /><div>با همین پولی که داری${mode === 'monthly' ? ' و سودش' : ''} به هدف می‌رسی؛ پس‌انداز ماهانه لازم نیست.</div></div>`
        : html`
          <span class="small muted">${mode === 'monthly' ? `هر ماه${(pctIn(growIn) || 0) > 0 ? ' (سال اول)' : ''}` : 'می‌رسی در'}</span>
          <span class="calc-big">${mode === 'monthly' ? html`<${Money} v=${r.monthly} s=${s} />` : monthsText(r.months)}</span>
          <${Row} t="هدف در آن روز" sub=${(pctIn(inflIn) || 0) > 0 ? 'با تورم' : ''}><${Money} v=${r.goal} s=${s} /></${Row}>
          <${Row} t="کل پولی که کنار می‌گذاری" sub="با پول فعلی"><${Money} v=${r.put} s=${s} /></${Row}>
          <${Row} t="سودی که روی آن می‌آید"><${Money} v=${r.growth} s=${s} /></${Row}>`}
      </div>
    </div>
    <div class="xs muted calc-foot">سود ماهانه دوباره پس‌انداز می‌شود. سود و تورم آینده معلوم نیستند؛ این یک برآورد است، نه قول.</div>
  </div>`;
}

/* ------------------------------------------- average purchase price ------------------------------------------- */
const FEE_KINDS = [['stock', 'سهم'], ['etf', 'صندوق'], ['none', 'بدون کارمزد']];
const feesOf = (k) => (k === 'none' ? { buy: 0, sell: 0 } : K.TRADE_FEES[k === 'etf' ? 'etf' : 'stock']);
function AverageTool({ st, s }) {
  const held = useMemo(() => {
    const seen = new Map();
    for (const a of st.assets || []) if (!a.archived && a.mode === 'units' && a.price?.source === 'market' && a.price.ref && +a.quantity > 0 && !E.isLiability(a)) {
      const id = E.quoteId(a.price.ref); if (seen.has(id)) continue;
      const p = S.position(st.assets, st.quotes, s, a.price.ref); if (p?.qty > 0) seen.set(id, { id, name: a.name, pos: p, ref: a.price.ref });
    }
    return [...seen.values()];
  }, [st.assets, st.quotes]);
  const [pick, setPick] = useState('');
  const [qty0, setQty0] = useState(null);
  const [avg0, setAvg0] = useState(null);
  const [qty1, setQty1] = useState(null);
  const [p1, setP1] = useState(null);
  const [kind, setKind] = useState('stock');
  const [target, setTarget] = useState(null);
  const choose = (id) => {
    setPick(id); const h = held.find((x) => x.id === id); if (!h) return;
    setQty0(+h.pos.qty.toFixed(4)); setAvg0(h.pos.avg ? Math.round(h.pos.avg) : null);
    // today's price per unit of the position (dollar quotes converted, the asset's adjustment applied)
    if (h.pos.value > 0 && h.pos.qty > 0) setP1(Math.round(h.pos.value / h.pos.qty));
  };
  const f = feesOf(kind);
  const r = K.averageBuy({ have: { qty: qty0, avg: avg0 }, add: { qty: qty1, price: p1 }, buyFeePct: f.buy, sellFeePct: f.sell, target });
  const h = held.find((x) => x.id === pick);
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="layers" cls="sm" />میانگین خرید</h3><${Seg} value=${kind} onChange=${setKind} options=${FEE_KINDS} /></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        ${held.length > 0 && html`<div class="field"><label>از دارایی‌هایم</label><select value=${pick} onChange=${(e) => choose(e.target.value)}>
          <option value="">— انتخاب کن یا دستی بنویس —</option>${held.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select>
          ${h && !h.pos.avg && html`<div class="xs warn">قیمت خرید این دارایی ثبت نشده؛ میانگین فعلی را خودت بنویس.</div>`}</div>`}
        <div class="calc-in two" style="max-width:none">
          <${NumField} label="الان داری" value=${qty0} onInput=${setQty0} suffix=${h?.pos.unit || 'واحد'} />
          <${MoneyField} label="میانگین خرید فعلی (هر واحد)" rial=${avg0} onRial=${setAvg0} s=${s} placeholder="مثلاً ۴٬۵۰۰" />
        </div>
        <div class="calc-in two" style="max-width:none">
          <${NumField} label="می‌خواهی بخری" value=${qty1} onInput=${setQty1} suffix=${h?.pos.unit || 'واحد'} />
          <${MoneyField} label="به قیمت (هر واحد)" rial=${p1} onRial=${setP1} s=${s} placeholder="مثلاً ۴٬۰۰۰" />
        </div>
        <${MoneyField} label="یا: می‌خواهم میانگینم برسد به" rial=${target} onRial=${setTarget} s=${s} placeholder="مثلاً ۴٬۲۰۰" hint="چند واحد دیگر به همان قیمت باید بخری؟" />
      </div>
      <div class="calc-out">
        ${!r ? html`<div class="empty small">${+qty0 > 0 && !(+avg0 > 0) ? 'میانگین خرید فعلی را هم بنویس.' : 'مقدار و میانگین فعلی، یا خرید تازه را بنویس.'}</div>` : html`
          <span class="small muted">میانگین تازه</span>
          <span class="calc-big"><${Money} v=${r.avg} s=${s} /></span>
          ${r.change !== null && html`<${Row} t="نسبت به میانگین فعلی">${pct(r.change, { digits: 1 })}</${Row}>`}
          <${Row} t="کل مقدار">${num(r.qty, r.qty < 10 ? 3 : 0)}</${Row}>
          ${r.addCost > 0 && html`<${Row} t="پول خرید تازه" sub=${kind !== 'none' ? 'با کارمزد' : ''}><${Money} v=${r.addCost} s=${s} /></${Row}>`}
          ${r.breakeven && html`<div class="calc-total"><span>قیمت سربه‌سر کل${kind !== 'none' ? ' (با کارمزد خرید و فروش)' : ''}</span><b class="num"><${Money} v=${r.breakeven} s=${s} /></b></div>`}
          ${+target > 0 && html`<div class="callout" style="margin-top:6px"><${Icon} n="info" cls="sm" /><div>${r.toTarget === 0 ? 'میانگینت همین الان همین عدد است.' : r.toTarget > 0 ? html`برای رسیدن میانگین به <${Money} v=${target} s=${s} />، باید <b>${num(r.toTarget, r.toTarget < 10 ? 2 : 0)}</b> واحد دیگر به قیمت <${Money} v=${p1} s=${s} /> بخری (<${Money} v=${r.toTarget * p1} s=${s} compact />).`
            : !(p1 > 0) ? 'قیمت خرید تازه را بنویس.' : 'با این قیمت خرید، میانگین به این عدد نمی‌رسد؛ هدف باید بین قیمت خرید تازه و میانگین فعلی باشد.'}</div></div>`}`}
      </div>
    </div>
    <div class="xs muted calc-foot">میانگین پایین‌تر یعنی سربه‌سر زودتر، نه اینکه خرید بیشتر کار درستی است؛ پول بیشتری روی یک دارایی می‌رود. کارمزدها تقریبی‌اند.</div>
  </div>`;
}

/* ------------------------------------------- one stock-market trade ------------------------------------------- */
function TradeTool({ st, s }) {
  const [kind, setKind] = useState('stock');
  const [buy, setBuy] = useState(null);
  const [sell, setSell] = useState(null);
  const [qty, setQty] = useState(null);
  const [targetIn, setTarget] = useState(null);
  const [fees, setFees] = useState(null); // edited { buy, sell } or null = defaults of the kind
  const [more, setMore] = useState(false);
  const f = fees || K.TRADE_FEES[kind];
  const r = K.stockTrade({ buy, sell, qty: qty || 1, buyFeePct: f.buy, sellFeePct: f.sell, targetPct: pctIn(targetIn) });
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="chart" cls="sm" />معاملهٔ بورس</h3><${Seg} value=${kind} onChange=${(k) => { setKind(k); setFees(null); }} options=${[['stock', 'سهم'], ['etf', 'صندوق سهامی و طلا'], ['fixed', 'صندوق درآمد ثابت']]} /></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        <div class="calc-in two" style="max-width:none">
          <${MoneyField} label="قیمت خرید (هر سهم)" rial=${buy} onRial=${setBuy} s=${s} placeholder="مثلاً ۴٬۰۰۰" />
          <${MoneyField} label="قیمت فروش (هر سهم)" rial=${sell} onRial=${setSell} s=${s} placeholder="مثلاً ۴٬۸۰۰" />
        </div>
        <${NumField} label="تعداد" value=${qty} onInput=${setQty} suffix="سهم" digits=${0} placeholder="۱" />
        <${NumField} label="سود خالصی که می‌خواهی" value=${targetIn} onInput=${setTarget} suffix="٪" hint="قیمت فروشی که بعد از کارمزدها به این سود می‌رسد" />
        <button class="calc-link" style="align-self:flex-start" onClick=${() => setMore(!more)}>${more ? 'بستن کارمزدها' : `کارمزد خرید ${num(f.buy, 3)}٪ و فروش ${num(f.sell, 3)}٪ — تغییر`}</button>
        ${more && html`<div class="calc-adv">
          <${NumField} label="کارمزد خرید" value=${f.buy} onInput=${(v) => setFees({ ...f, buy: v ?? 0 })} suffix="٪" />
          <${NumField} label="کارمزد فروش (با مالیات)" value=${f.sell} onInput=${(v) => setFees({ ...f, sell: v ?? 0 })} suffix="٪" />
        </div>`}
      </div>
      <div class="calc-out">
        ${!r ? html`<div class="empty small">قیمت خرید را بنویس.</div>` : html`
          ${r.profit !== undefined && html`<span class="small muted">سود خالص</span>
            <span class=${'calc-big ' + (r.profit >= 0 ? 'pos' : 'neg')}><${Money} v=${r.profit} s=${s} sign /></span>
            <${Row} t="بازده خالص">${pct(r.ret, { digits: 2 })}</${Row}>
            <${Row} t="تغییر قیمت">${pct(r.move, { digits: 2 })}</${Row}>
            <${Row} t="کارمزد و مالیات کل"><${Money} v=${r.buyFee + r.sellFee} s=${s} /></${Row}>`}
          <${Row} t="پول خرید" sub="با کارمزد"><${Money} v=${r.paid} s=${s} /></${Row}>
          <div class="calc-total"><span>قیمت فروش سربه‌سر <span class="xs muted">(${pct(r.evenPct, { digits: 2 })})</span></span><b class="num"><${Money} v=${r.even} s=${s} /></b></div>
          ${r.forTarget && html`<${Row} t=${`برای ${num(pctIn(targetIn))}٪ سود خالص`}><${Money} v=${r.forTarget} s=${s} /></${Row}>`}`}
      </div>
    </div>
    <div class="xs muted calc-foot">کارمزدها تقریبی‌اند و کارگزاری‌ها کمی با هم فرق دارند؛ در فروش سهم، ۰٫۵٪ مالیات هم هست. سود نقدی و افزایش سرمایه در این حساب نیست.</div>
  </div>`;
}

/* ------------------------------------------- instalments or cash ------------------------------------------- */
function InstalTool({ st, s }) {
  const depPct = I.defaultDepositPct(st);
  const [cash, setCash] = useState(null);
  const [down, setDown] = useState(null);
  const [each, setEach] = useState(null);
  const [monthsIn, setMonths] = useState(12);
  const r = K.payInstalments({ cash, down, each, months: monthsIn, depositPct: depPct });
  return html`<div class="card calc-card">
    <div class="card-h"><h3><${Icon} n="debt" cls="sm" />قسطی یا نقدی؟</h3></div>
    <div class="calc-split">
      <div class="col" style="gap:12px">
        <${MoneyField} label="قیمت نقدی" rial=${cash} onRial=${setCash} s=${s} />
        <${MoneyField} label="پیش‌پرداخت قسطی" rial=${down} onRial=${setDown} s=${s} hint="اگر ندارد، خالی بگذار" />
        <div class="calc-in two" style="max-width:none">
          <${MoneyField} label="هر قسط" rial=${each} onRial=${setEach} s=${s} />
          <${NumField} label="تعداد قسط" value=${monthsIn} onInput=${setMonths} suffix="ماه" digits=${0} />
        </div>
      </div>
      <div class="calc-out">
        ${!r ? html`<div class="empty small">${+cash > 0 && +down >= +cash ? 'پیش‌پرداخت از قیمت نقدی کمتر باشد.' : +monthsIn > 600 ? 'تعداد قسط حداکثر ۶۰۰ ماه.' : 'قیمت نقدی، مبلغ و تعداد قسط را بنویس.'}</div>` : html`
          <span class="small muted">سود واقعی قسط‌ها در سال</span>
          <span class="calc-big">${r.realPct === null ? '—' : `${num(r.realPct, 1)}٪`}</span>
          <${Row} t="کل پرداخت قسطی"><${Money} v=${r.total} s=${s} /></${Row}>
          <${Row} t=${r.extra >= 0 ? 'بیشتر از نقد' : 'ارزان‌تر از نقد'} sub=${r.extra !== 0 ? pct(Math.abs(r.extraPct), { digits: 1 }) : ''}><${Money} v=${Math.abs(r.extra)} s=${s} /></${Row}>
          ${r.endBalance !== undefined && html`<div class=${'callout' + (r.endBalance < 0 ? ' warn' : '')} style="margin-top:6px"><${Icon} n="info" cls="sm" /><div>
            اگر پول نقد (منهای پیش‌پرداخت) را در سپرده ${num(depPct, 1)}٪ بگذاری و قسط‌ها را از آن بدهی، آخر کار
            ${r.endBalance >= 0 ? html` <b><${Money} v=${r.endBalance} s=${s} /></b> برایت می‌ماند — <b>قسطی به‌صرفه‌تر است</b>.` : html` <b><${Money} v=${-r.endBalance} s=${s} /></b> کم می‌آوری — <b>نقد دادن به‌صرفه‌تر است</b>.`}</div></div>`}`}
      </div>
    </div>
    <div class="xs muted calc-foot">نرخ سپرده از تنظیمات «تحلیل» یا سپرده‌های خودت می‌آید. گران شدن کالا در طول قسط‌ها (که قسطی را جذاب‌تر می‌کند) در این حساب نیست.</div>
  </div>`;
}
