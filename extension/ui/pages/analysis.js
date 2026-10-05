import { html, useState, useMemo, useEffect, Icon, Money, Delta, Ava, StackBar, NumField, MoneyField, Slider, Seg, toast, num, pct, fmtJ, send, Explain, AskBtn, BackfillButton, Tip } from '../components.js';
import { CAT, EXPOSURES, LIQUIDITY, SCENARIOS } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import * as I from '../../lib/insights.js';
import * as AI from '../../lib/ai.js';
import * as A from '../../lib/assistant.js';
import * as store from '../../lib/store.js';
import { ago, parseNum } from '../../lib/format.js';
import { act } from '../actions.js';
import { T as TT } from '../tips.js';
import * as BB from '../../lib/bubble.js';
import * as CMP from '../../lib/compare.js';

/* Plain-language help for each section (for people new to these ideas). */
const TIPS = {
  perf: ['واقعاً پولدارتر شدم؟', 'نشان می‌دهد دارایی‌هایت در این دوره واقعاً چقدر رشد کرده‌اند. پولی که خودت اضافه کرده‌ای (مثل حقوق یا واریز) سود حساب نمی‌شود. بعد همان پول، با همان تاریخ‌ها، در سه حالت دیگر هم حساب می‌شود: اگر همه را طلا، دلار یا سپرده نگه داشته بودی. «جلوتری» یعنی ترکیب دارایی‌هایت از آن حالت بهتر عمل کرده.', 'اگر طلا در این مدت ۲۰٪ رشد کرده و دارایی تو ۱۵٪، از «طلا» عقب‌تری.'],
  deposit: ['نرخ سپرده برای مقایسه', 'سود سالانه‌ای که بانک یا صندوق درآمد ثابت واقعاً به تو می‌دهد. برای مقایسه منصفانه، نرخی را بگذار که خودت به آن دسترسی داری. این نرخ مثل سپرده بانکی حساب می‌شود: سود هر ماه دوباره سپرده می‌شود؛ پس سپرده ۲۵٪ در عمل حدود ۲۸٪ در سال رشد می‌کند. بازدهی که صندوق‌ها «سالانه مؤثر» اعلام می‌کنند از قبل همین را دارد.'],
  scenario: ['شبیه‌ساز سناریو', 'می‌بینی اگر قیمت‌ها تغییر کنند، ارزش دارایی‌هایت چه می‌شود. لغزنده‌ها را جابه‌جا کن، یکی از سناریوهای آماده را بزن، یا اتفاق را با یک جمله بنویس تا فرض‌ها خودکار ساخته شوند. این پیش‌بینی نیست؛ فقط حساب «اگر … شود» است.', '«اگر دلار ۳۰٪ گران شود» را امتحان کن و ببین کدام دارایی‌ها بیشتر اثر می‌گیرند.'],
  terms: ['بر حسب دلار و طلا', 'ارزش دارایی‌هایت را با دلار یا طلا می‌سنجد، نه تومان. اگر ارزش تومانی بالا برود ولی این عدد منفی شود، یعنی با پولت دلار یا طلای کمتری می‌توانی بخری؛ قدرت خریدت کم شده.'],
  ounce: ['انس جهانی طلا', 'قیمت جهانی هر اونس (حدود ۳۱ گرم) طلا به دلار. قیمت طلای داخل ایران تقریباً برابر است با انس × نرخ دلار؛ پس هر دو روی طلای تو اثر دارند.'],
  exposure: ['مواجهه با تورم و ارز', 'نشان می‌دهد دارایی‌هایت به چه چیزی حساس‌اند. دارایی «ریالی» (حساب بانکی، سپرده، طلب) با تورم ارزش واقعی از دست می‌دهد؛ طلا، ارز، سهام و ملک معمولاً همراه تورم بالا می‌روند. «محافظت‌شده» یعنی سهم دارایی‌های غیرریالی.'],
  liquidity: ['چقدر زود نقد می‌شود؟', 'چقدر از دارایی‌ات را می‌توانی زود به پول نقد تبدیل کنی. بالا: در چند روز (حساب بانکی، ارز، صندوق بورسی). متوسط: چند هفته. پایین: ملک، سهام خصوصی و طلب‌ها. بهتر است همیشه بخشی برای شرایط اضطراری در ردیف «بالا» باشد.'],
  custody: ['تمرکز بر اساس محل نگهداری', 'دارایی‌هایت کجا یا نزد چه کسی است: بانک، کارگزاری، پلتفرم آنلاین یا خانه. اگر بخش بزرگی فقط در یک جا باشد، هر مشکلی در همان یک جا روی کل دارایی‌ات اثر می‌گذارد.'],
  risks: ['ریسک‌ها و نکات', 'هشدارهای خودکار درباره ترکیب دارایی‌هایت، مثل تمرکز زیاد روی یک دارایی یا کمبود پول در دسترس. «نگاه دستیار» با هوش مصنوعی سه نقطه ضعف را به زبان ساده توضیح می‌دهد؛ برای این کار فقط درصدها فرستاده می‌شود، نه مبلغ‌ها.'],
  targets: ['تخصیص هدف', 'مشخص کن دوست داری هر دسته چند درصد از دارایی‌ات باشد (بهتر است جمع ۱۰۰٪ شود). جدول نشان می‌دهد الان کجا بیشتر یا کمتر از هدفی و تقریباً چقدر باید خرید یا فروخت تا به هدف برسی. این فقط حساب ریاضی بر اساس هدف خودت است، نه توصیه.', 'اگر هدف طلا ۳۰٪ باشد و الان ۲۰٪ داری، ستون آخر می‌گوید چقدر طلا کم داری.'],
  newmoney: ['پول جدید را کجا بگذارم؟', 'اگر پول تازه‌ای داری (مثلاً پاداش یا پس‌انداز)، این بخش آن را طوری بین دسته‌ها پخش می‌کند که به درصدهای هدفت نزدیک‌تر شوی، بدون اینکه چیزی را بفروشی.'],
  breakeven: ['از کِی سود می‌دهد؟ (نقطه سربه‌سر)', 'سرمایه‌گذاری در یک دارایی را با گذاشتن همان پول در سپرده مقایسه می‌کند. نشان می‌دهد قیمت آن دارایی تا پایان مدت باید به چه عددی برسد تا سودش از سپرده بیشتر شود. اگر فکر می‌کنی به آن قیمت نمی‌رسد، سپرده انتخاب امن‌تری است.', 'سپرده ۲۵٪ در ۶ ماه حدود ۱۳٪ سود می‌دهد؛ پس طلا باید بیش از ۱۳٪ (به‌علاوه کارمزد) گران شود.'],
  fee: ['کارمزد خرید و فروش', 'هزینه‌ای که در خرید و فروش از دست می‌دهی: اختلاف قیمت خرید و فروش، کارمزد پلتفرم یا اجرت طلا. برای طلای آب‌شده معمولاً کم و برای طلای زینتی بیشتر است.'],
  pnl: ['سود و زیان دارایی‌ها', 'فقط برای آنچه الان داری (سود فروش‌های گذشته اینجا حساب نمی‌شود)، و برای دارایی‌هایی که «بهای تمام‌شده» (مبلغی که بابتش پرداخته‌ای) را وارد کرده‌ای، سود یا زیان تا امروز را نشان می‌دهد. بهای تمام‌شده را در ویرایش هر دارایی وارد کن.'],
  compare: ['مقایسه دو گزینه', 'یک مبلغ را دو جور کنار هم می‌گذارد، برای همان مدت: مثلاً «بماند در سپرده» در برابر «سکه بخرم». هزینه خرید و فروش، سودی که از دست می‌رود، حباب سکه و اثرش روی ترکیب دارایی‌ات را نشان می‌دهد. با لغزنده ببین اگر قیمت بالا یا پایین برود چه می‌شود. فقط حساب است، نه توصیه؛ هزینه‌ها و نرخ‌ها فرض‌اند و می‌توانی عوضشان کنی.', 'سپرده ۲۵٪ در یک سال حدود ۲۸٪ رشد می‌کند؛ پس سکه با ۲٪ هزینه خرید و فروش باید حدود ۳۱٪ گران شود تا به آن برسد.'],
  critique: ['نگاه دستیار', 'هوش مصنوعی با نگاه به درصدهای ترکیب دارایی‌ات، سه نقطه ضعف مهم را پیدا می‌کند و برای هرکدام یک بررسی ساده پیشنهاد می‌دهد. توصیه خرید یا فروش نمی‌کند.'],
};
const T = (k) => html`<${Tip} title=${TIPS[k][0]} text=${TIPS[k][1]} example=${TIPS[k][2]} />`;

const unitOf = (s) => (s.currency === 'rial' ? 'ریال' : 'تومان');
const parsePct = (v) => parseFloat(String(v).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٫,]/g, '.'));

/* ---------------- «واقعاً پولدارتر شدم؟» ---------------- */
function Performance({ st, pf, s }) {
  const [days, setDays] = useState(90);
  const dep = I.defaultDepositPct(st);
  const r = useMemo(() => I.performance(st, days, { depositPct: dep, pf }), [st.assets, st.quotes, st.snapshots, st.events, pf, days, dep]);
  const periodName = { 30: 'یک ماه گذشته', 90: 'سه ماه گذشته', 365: 'یک سال گذشته', 0: 'از ابتدای ثبت' }[days];
  const head = html`<div class="card-h"><h3><${Icon} n="chart" cls="sm" />واقعاً پولدارتر شدم؟${T('perf')}</h3>
    <div class="row" style="gap:8px">${r && html`<${AskBtn} q=${`در ${periodName} واقعاً پولدارتر شدم؟ بازده من را با طلا، دلار و سپرده مقایسه کن و بگو کجا جلو یا عقب بودم.`} label="توضیح بده" />`}
    <${Seg} value=${days} onChange=${setDays} options=${[[30, 'ماه'], [90, '۳ ماه'], [365, 'سال'], [0, 'از ابتدا']]} /></div></div>`;
  if (!r) return html`<div class="card" id="perf">${head}<div class="empty small" style="padding:18px"><div style="margin-bottom:10px">برای این مقایسه تاریخچه ارزش دارایی لازم است. نمودار از امروز خودکار پر می‌شود، یا همین حالا یک سال گذشته را بازسازی کن.</div><${BackfillButton} st=${st} /></div></div>`;
  const ahead = r.bench.filter((b) => b.diff >= 0).map((b) => b.short);
  const behind = r.bench.filter((b) => b.diff < 0).map((b) => b.short);
  const verdict = !r.bench.length ? '' : !behind.length ? `از نگه‌داشتن ${ahead.join('، ')} جلوتری.` : !ahead.length ? `از نگه‌داشتن ${behind.join('، ')} عقب‌تری.` : `از ${ahead.join(' و ')} جلوتری، ولی از ${behind.join(' و ')} عقب‌تری.`;
  const max = Math.max(1, ...r.bench.map((b) => Math.abs(b.diff)));
  const short = r.partial;
  return html`<div class="card" id="perf">${head}
    <div class="perf">
      <div>
        <div class="lead">${verdict ? html`<b>${verdict}</b><br />` : ''}
          در ${short ? `${num(r.days)} روزی که تاریخچه هست` : periodName} بازار برایت <b class=${r.market >= 0 ? 'pos' : 'neg'}><${Money} v=${r.market} s=${s} compact sign /></b>${r.ret !== null ? html` (<span class="ltr">${pct(r.ret)}</span>)` : ''} ساخت${r.annual !== null ? html`، معادل سالانه <span class="ltr">${pct(r.annual)}</span>` : ''}.
          ${Math.abs(r.moneyIn) >= 1 ? html` <span class="muted">${r.moneyIn > 0 ? 'جدا از آن' : 'و'} <${Money} v=${Math.abs(r.moneyIn)} s=${s} compact /> ${r.moneyIn > 0 ? 'پول تازه (حقوق، واریز یا دارایی تازه‌ثبت‌شده) اضافه شد که بازده حساب نمی‌شود' : 'برداشت یا حذف شد که زیان حساب نمی‌شود'}.</span>` : ''}
          <${Explain} s=${s} title="این مقایسه چطور حساب می‌شود؟" get=${() => ({
            formula: 'بازده = اثر قیمت بازار ÷ (ارزش اول دوره + پول‌هایی که در طول دوره اضافه شد، به نسبت مدتی که بوده)',
            lines: [
              { t: 'ارزش خالص اول دوره', v: r.base, k: 'money', sub: r.from, subK: 'date' },
              { t: 'پول اضافه یا کم‌شده', v: r.moneyIn, k: 'money', sign: true },
              { t: 'اثر قیمت بازار و سود', v: r.market, k: 'money', sign: true, strong: true },
              { t: 'ارزش خالص الان', v: r.end, k: 'money', total: true },
              ...r.bench.map((b) => ({ t: b.name, v: b.end, k: 'money' })),
            ],
            notes: ['در هر گزینه، همان پول‌هایی که در طول دوره اضافه یا کم شده، در همان روز وارد آن گزینه می‌شود؛ پس مقایسه منصفانه است.', `سپرده با سود ${num(r.depositPct, 1)}٪ سالانه حساب شده که سود هر ماهش دوباره سپرده می‌شود.`, ...(r.est ? ['مبنای اول دوره بازسازی‌شده (تخمینی) است؛ دارایی‌هایی که تاریخ خریدشان ثبت نشده، از اول دوره فرض شده‌اند.'] : [])],
          })} />
        </div>
      </div>
      <div class="bench">${r.bench.map((b) => html`<div class="brow">
        <span class="bn"><span class="small">${b.name}</span><span class="xs muted">${b.short} در این مدت <span class="ltr">${pct(b.ret)}</span></span></span>
        <div class="wt" dir="ltr"><b style=${`${b.diff >= 0 ? 'left:50%' : `left:${50 - Math.abs(b.diff) / max * 50}%`};width:${Math.max(1.5, Math.abs(b.diff) / max * 50)}%;background:${b.diff >= 0 ? 'var(--pos)' : 'var(--neg)'}`}></b></div>
        <span class=${'bv ' + (b.diff >= 0 ? 'pos' : 'neg')}><${Money} v=${Math.abs(b.diff)} s=${s} compact /> ${b.diff >= 0 ? 'جلوتری' : 'عقب‌تری'}</span></div>`)}
        <div class="row xs muted" style="gap:6px;margin-top:4px">نرخ سپرده برای مقایسه${T('deposit')}:
          <input class="input num-in" style="width:64px;height:28px" value=${num(dep, 1)} onChange=${(e) => { const v = parsePct(e.target.value); if (v > 0 && v < 200) act.setSettings({ depositPct: v }); }} />٪</div>
      </div>
    </div>
  </div>`;
}


/* ---------------- «مقایسه دو گزینه» ---------------- */
const MONTHS = [[3, '۳ ماه'], [6, '۶ ماه'], [12, '۱ سال'], [24, '۲ سال']];
const monthsName = (m) => (m === 12 ? 'یک سال' : m === 24 ? 'دو سال' : `${num(m)} ماه`);
function CmpPick({ label, spec, onChange, other, s, depositPct }) {
  const c = CMP.choiceById(spec.id);
  return html`<div class="cmp-pick">
    <div class="row" style="gap:8px"><span class="cmp-tag">${label}</span>
    <select class="input" value=${spec.id} aria-label=${'گزینه ' + label} onChange=${(e) => onChange({ id: e.target.value })}>
      <optgroup label="نگه‌داشتن">${CMP.CHOICES.filter((x) => x.kind !== 'market').map((x) => html`<option value=${x.id} disabled=${x.id === other}>${x.name}</option>`)}</optgroup>
      <optgroup label="خرید">${CMP.CHOICES.filter((x) => x.kind === 'market').map((x) => html`<option value=${x.id} disabled=${x.id === other}>${x.name}</option>`)}</optgroup>
    </select></div>
    ${c?.kind === 'deposit' && html`<label class="cmp-as">سود سالانه <input class="input num-in" inputmode="decimal" value=${num(spec.ratePct ?? depositPct, 1)} onChange=${(e) => { const v = parsePct(e.target.value); if (v > 0 && v < 200) onChange({ ...spec, ratePct: v }); }} />٪</label>`}
    ${c?.kind === 'market' && html`<label class="cmp-as">هزینه خرید و فروش <input class="input num-in" inputmode="decimal" value=${num(spec.costPct ?? c.cost, 1)} onChange=${(e) => { const v = parsePct(e.target.value); if (v >= 0 && v <= 50) onChange({ ...spec, costPct: v }); }} />٪${T('fee')}</label>`}
  </div>`;
}
function CmpCol({ o, other, g, r, s, label }) {
  const v = o.valueAt(g);
  const gain = v - r.amount;
  const unit = (x) => html`<${Money} v=${x} s=${s} compact />`;
  const shift = (a, b) => html`<span class="cmp-shift"><span class="num">${pct(a, { sign: false, digits: 0 })}</span><span class="muted">←</span><b class="num">${pct(b, { sign: false, digits: 0 })}</b></span>`;
  return html`<div class="cmp-col">
    <div class="cmp-h"><span class="cmp-tag">${label}</span><b>${o.name}</b></div>
    <div class="cmp-v"><span class="v"><${Money} v=${v} s=${s} compact /></span><span class=${'small ' + (gain >= 0 ? 'pos' : 'neg')}><${Money} v=${gain} s=${s} compact sign /></span></div>
    <div class="xs muted">ارزش در پایان ${monthsName(r.months)}${o.kind === 'market' ? (g ? html`، اگر قیمت <span class="ltr">${pct(g, { digits: 0 })}</span> تغییر کند` : '، اگر قیمت ثابت بماند') : o.rate ? `، با سود سالانه ${num(o.rate, 1)}٪` : ''}</div>
    <dl class="cmp-dl">
      ${o.kind !== 'market' && o.rate > 0 && html`<dt>سود این مدت</dt><dd class="pos">${unit(o.final - r.amount)}</dd>`}
      ${o.kind === 'market' && html`<dt>هزینه خرید و فروش</dt><dd class="neg">${unit(-o.costAmount)}</dd>`}
      ${o.lost > 0 && html`<dt>سود «${r.source.name}» که دیگر نمی‌گیری</dt><dd class="neg">${unit(-o.lost)}</dd>`}
      ${o.units > 0 && html`<dt>تقریباً می‌خری</dt><dd>${num(o.units, o.units < 10 ? 2 : 0)} ${o.unit}</dd>`}
      ${o.bubble !== undefined && html`<dt>حباب امروز</dt><dd>${pct(o.bubble, { digits: 1 })}<span class="xs muted"> · ${pct(o.bubble / (1 + o.bubble), { sign: false, digits: 0 })} از قیمت</span></dd>`}
      ${o.bubbleRevert !== undefined && Math.abs(o.bubbleRevert) >= 0.005 && html`<dt>اگر حباب به میانگین ۳ ماهه برگردد</dt><dd class=${o.bubbleRevert < 0 ? 'neg' : 'pos'}><span class="ltr">${pct(o.bubbleRevert, { digits: 1 })}</span><span class="xs muted"> قیمت، با طلای ثابت</span></dd>`}
      ${o.breakEven !== null && o.breakEven !== undefined && html`<dt>برای رسیدن به «${other.name}»</dt><dd>قیمت باید <b class="ltr">${pct(o.breakEven, { digits: 1 })}</b> تغییر کند${r.months !== 12 ? html`<span class="xs muted"> (سالانه <span class="ltr">${pct(o.breakEvenAnnual, { digits: 0 })}</span>)</span>` : ''}</dd>`}
    </dl>
    ${o.kind !== 'keep' && o.after && r.before && html`<div class="cmp-after">
      <span class="xs muted">بعد از این کار</span>
      <div><span>محافظت در برابر تورم</span>${shift(r.before.protected, o.after.protected)}</div>
      <div><span>نقد در چند روز</span>${shift(r.before.liquidDays, o.after.liquidDays)}</div>
      <div><span>بیشترین سهم: ${EXPOSURES[o.after.top.exposure]?.name || ''}</span>${shift(r.before.by[o.after.top.exposure] || 0, o.after.top.share)}</div>
    </div>`}
    ${o.notes.map((n) => html`<div class="xs muted">• ${n}</div>`)}
  </div>`;
}
function Compare({ st, pf, s }) {
  const srcs = useMemo(() => CMP.sources(st.assets, pf), [st.assets, pf]);
  const dep = I.defaultDepositPct(st);
  const [src, setSrc] = useState(() => srcs[0]?.id || 'new');
  const first = srcs.find((x) => x.id === src);
  const [amount, setAmount] = useState(() => { const v = first ? Math.min(first.value, 1e9) : 1e9; return v >= 1e7 ? Math.floor(v / 1e7) * 1e7 : Math.round(v); });
  const [months, setMonths] = useState(12);
  const [a, setA] = useState(() => ({ id: first ? 'keep' : 'deposit' }));
  const [b, setB] = useState({ id: 'geram18' });
  const [ga, setGa] = useState(0), [gb, setGb] = useState(0);
  const [avg, setAvg] = useState({});
  const coinKeys = [a, b].map((x) => CMP.choiceById(x.id)?.ref).filter((ref) => BB.isCoinRef(ref)).map((ref) => ref.key);
  useEffect(() => {
    if (!coinKeys.length) return;
    let alive = true;
    send('bubbleStats', { keys: coinKeys, days: 90 }).then((res) => { if (alive && res?.ok) setAvg(Object.fromEntries(Object.entries(res.stats || {}).filter(([, v]) => v).map(([k, v]) => [k, v.avg]))); }).catch(() => {});
    return () => { alive = false; };
  }, [coinKeys.join()]);
  const r = useMemo(() => CMP.compareOptions(st, pf, { amount, sourceId: src, a, b, months, depositPct: dep, bubbleAvg: avg }), [st.assets, st.quotes, pf, amount, src, JSON.stringify(a), JSON.stringify(b), months, dep, JSON.stringify(avg)]);
  const both = r && r.a.kind === 'market' && r.b.kind === 'market';
  const out = r ? CMP.outcome(r, r.a.kind === 'market' ? ga : 0, r.b.kind === 'market' ? (both ? gb : ga) : 0) : null;
  const gB = r && r.b.kind === 'market' ? (both ? gb : ga) : 0;
  // with one market choice its slider follows it; with two, each slider goes with its choice
  const swap = () => { setA(b); setB(a); if (both) { setGa(gb); setGb(ga); } };
  const verdict = out && (Math.abs(out.diff) < Math.max(1, r.amount * 0.002) ? 'در این فرض، دو گزینه تقریباً برابرند.'
    : html`در این فرض، «${out.diff > 0 ? r.a.name : r.b.name}» حدود <b><${Money} v=${Math.abs(out.diff)} s=${s} compact /></b> بیشتر می‌شود.`);
  const market = r && [r.a, r.b].filter((o) => o.kind === 'market');
  return html`<div class="card" id="compare">
    <div class="card-h"><h3><${Icon} n="swap" cls="sm" />مقایسه دو گزینه${T('compare')}</h3>
      ${r && html`<${AskBtn} q=${`${Math.round(r.amount / (s.currency === 'rial' ? 1 : 10)).toLocaleString('fa-IR')} ${unitOf(s)} از «${r.source.name}» را برای ${monthsName(r.months)} «${r.a.name}» کنم یا «${r.b.name}»؟ با compare_options مقایسه کن و فرض‌ها را توضیح بده.`} label="بپرس" />`}</div>
    <div class="cmp-q">
      <${MoneyField} label="مبلغ" rial=${amount} onRial=${(v) => setAmount(v || 0)} s=${s} />
      <div class="field"><label>از کجا</label><select class="input" value=${src} onChange=${(e) => setSrc(e.target.value)}>
        ${srcs.map((x) => html`<option value=${x.id}>${x.name}</option>`)}<option value="new">پول تازه (هنوز در دارا نیست)</option></select></div>
      <div class="field"><label>برای چه مدت</label><${Seg} value=${months} onChange=${setMonths} options=${MONTHS} /></div>
    </div>
    ${r?.source.exceeds && html`<div class="callout warn" style="margin-top:10px"><${Icon} n="alert" cls="sm" /><div>این مبلغ از موجودی «${r.source.name}» (<${Money} v=${r.source.value} s=${s} compact />) بیشتر است.</div></div>`}
    <div class="cmp-picks">
      <${CmpPick} label="الف" spec=${a} onChange=${setA} other=${b.id} s=${s} depositPct=${dep} />
      <button class="btn icon ghost cmp-swap" onClick=${swap} aria-label="جابه‌جا کردن دو گزینه" title="جابه‌جا کردن"><${Icon} n="swap" /></button>
      <${CmpPick} label="ب" spec=${b} onChange=${setB} other=${a.id} s=${s} depositPct=${dep} />
    </div>
    ${!r ? html`<div class="empty small" style="padding:18px">مبلغ را وارد کن تا دو گزینه کنار هم حساب شوند.</div>` : html`
      <div class="cmp-grid">
        <${CmpCol} o=${r.a} other=${r.b} g=${r.a.kind === 'market' ? ga : 0} r=${r} s=${s} label="الف" />
        <${CmpCol} o=${r.b} other=${r.a} g=${gB} r=${r} s=${s} label="ب" />
      </div>
      ${market.length > 0 && html`<div class="cmp-what">
        ${both ? html`
          <${Slider} label=${`اگر قیمت «${r.a.name}» تا پایان مدت`} value=${Math.round(ga * 100)} onChange=${(v) => setGa(v / 100)} min=${-40} max=${80} />
          <${Slider} label=${`اگر قیمت «${r.b.name}» تا پایان مدت`} value=${Math.round(gb * 100)} onChange=${(v) => setGb(v / 100)} min=${-40} max=${80} />`
        : html`<${Slider} label=${`اگر قیمت «${market[0].name}» تا پایان مدت`} value=${Math.round(ga * 100)} onChange=${(v) => setGa(v / 100)} min=${-40} max=${80} note="دوبار کلیک: برگشت به صفر" />`}
      </div>`}
      <div class="cmp-verdict">${verdict}</div>
      <div class="xs muted">فقط حساب است، نه توصیه. هزینه خرید و فروش و نرخ سپرده فرض‌اند و می‌توانی عوضشان کنی؛ سود سپرده‌ها ماهانه دوباره سپرده فرض شده است.</div>`}
  </div>`;
}

/* ---------------- نقطه سربه‌سر ---------------- */
const BE_ASSETS = [['tgju:geram18', 'طلای ۱۸', { provider: 'tgju', key: 'geram18' }, 'هر گرم'], ['tgju:sekee', 'سکه امامی', { provider: 'tgju', key: 'sekee' }, 'هر سکه'], ['tgju:price_dollar_rl', 'دلار', { provider: 'tgju', key: 'price_dollar_rl' }, 'هر دلار'], ['nobitex:usdt', 'تتر', { provider: 'nobitex', key: 'usdt' }, 'هر تتر']];
function BreakEven({ st, s }) {
  const held = st.assets.filter((a) => !a.archived && a.mode === 'units' && a.price?.source === 'market' && a.price.ref?.key && !BE_ASSETS.some(([id]) => id === E.quoteId(a.price.ref)));
  const [pick, setPick] = useState('tgju:geram18');
  const [rate, setRate] = useState(() => I.defaultDepositPct(st));
  const [months, setMonths] = useState(6);
  const [fee, setFee] = useState(0);
  const [past, setPast] = useState(null);
  const heldA = held.find((a) => a.id === pick);
  const preset = BE_ASSETS.find(([id]) => id === pick);
  const name = preset ? preset[1] : heldA?.name || '';
  const per = preset ? preset[3] : `هر ${heldA?.unit || 'واحد'}`;
  const ref = preset ? preset[2] : heldA?.price.ref;
  const price0 = preset ? st.quotes[pick]?.price : heldA ? E.unitPriceOf(heldA, st.quotes).price : null;
  const r = I.breakEven({ price0, ratePct: rate, months, feePct: fee });
  useEffect(() => {
    let alive = true; setPast(null);
    if (!ref) return;
    send('history', { ref, days: months * 31 + 7 }).then((res) => {
      if (!alive || !res?.ok || !res.points?.length) return;
      const pts = res.points; const last = pts[pts.length - 1];
      const target = new Date(); target.setMonth(target.getMonth() - months);
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
      const first = [...pts].reverse().find(([d]) => d <= iso);
      if (first && first[1] > 0) setPast({ pct: last[1] / first[1] - 1, from: first[0] });
    });
    return () => { alive = false; };
  }, [pick, months]);
  return html`<div class="card" id="breakeven">
    <div class="card-h"><h3><${Icon} n="target" cls="sm" />نقطه سربه‌سر: سپرده یا …؟${T('breakeven')}</h3>
      <${AskBtn} q=${`اگر به‌جای سپرده ${num(rate, 1)}٪، روی «${name}» برای ${num(months)} ماه سرمایه‌گذاری کنم (کارمزد ${num(fee, 1)}٪)، نقطه سربه‌سر چقدر است و در گذشته چطور بوده؟`} label="بپرس" /></div>
    <div class="be">
      <div class="col" style="gap:12px">
        <div class="field"><label>دارایی</label><select class="input" value=${pick} onChange=${(e) => setPick(e.target.value)}>
          ${BE_ASSETS.map(([id, n]) => html`<option value=${id}>${n}</option>`)}
          ${held.length > 0 && html`<optgroup label="دارایی‌های من">${held.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</optgroup>`}</select></div>
        <div class="grid2">
          <${NumField} label="سود سپرده (سالانه)" value=${rate} onInput=${(v) => setRate(Math.max(0, Math.min(200, v || 0)))} suffix="٪" digits=${1} />
          <${NumField} label="کارمزد خرید و فروش" value=${fee} onInput=${(v) => setFee(Math.max(0, Math.min(50, v || 0)))} suffix="٪" digits=${1} hint=${html`اختلاف قیمت خرید و فروش، کارمزد یا اجرت ${T('fee')}`} />
        </div>
        <div class="field"><label>مدت</label><${Seg} value=${months} onChange=${setMonths} options=${[[1, '۱ ماه'], [3, '۳ ماه'], [6, '۶ ماه'], [12, '۱ سال'], [24, '۲ سال']]} /></div>
      </div>
      <div class="col" style="gap:10px">
        ${price0 > 0 ? html`
          <div class="preview" style="flex-direction:column;align-items:stretch;gap:6px">
            <span class="small">برای اینکه «${name}» در ${months === 12 ? 'یک سال' : months === 24 ? 'دو سال' : num(months) + ' ماه'} از سپرده جلو بزند، قیمت ${per} باید برسد به</span>
            <span class="v"><${Money} v=${r.targetPrice} s=${s} /></span>
            <span class="small">یعنی <b class="ltr">${pct(r.needed)}</b> رشد از قیمت فعلی (<${Money} v=${price0} s=${s} compact />)${months !== 12 ? html`، معادل سالانه <span class="ltr">${pct(r.annualNeeded)}</span>` : ''}.</span>
          </div>
          <div class="xs muted">سپرده در همین مدت <span class="ltr">${pct(r.depositGain)}</span> سود می‌دهد (اگر سود هر ماه دوباره سپرده شود)${fee ? ` و کارمزد ${num(fee, 1)}٪ هم باید جبران شود` : ''}.</div>
          ${past && html`<div class="callout"><${Icon} n="history" cls="sm" /><div>برای مقایسه: «${name}» در ${num(months)} ماه گذشته <b class=${past.pct >= r.needed ? 'pos' : 'neg'}><span class="ltr">${pct(past.pct)}</span></b> تغییر کرده؛ ${past.pct >= r.needed ? 'بیشتر از نقطه سربه‌سر.' : 'کمتر از نقطه سربه‌سر.'} گذشته تضمینی برای آینده نیست.</div></div>`}`
          : html`<div class="empty small">قیمت فعلی این دارایی در دسترس نیست.</div>`}
      </div>
    </div>
  </div>`;
}

/* ---------------- AI review ---------------- */
function Critique({ st, pf, s }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const conns = AI.orderedConnections(st.ai);
  const c = st.critique;
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const perf = I.performance(st, 90, { depositPct: I.defaultDepositPct(st), pf });
      const facts = I.critiqueFacts(st, pf, perf);
      if (!facts) throw new Error('هنوز دارایی‌ای برای بررسی ثبت نشده');
      const res = await AI.extract({ ai: st.ai, system: A.critiqueSystem(), prompt: A.critiquePrompt(facts), maxTokens: 1200 });
      const points = A.parseCritique(res.json);
      if (!points.length) throw new Error('پاسخ مدل نکته‌ای نداشت؛ دوباره امتحان کن');
      await store.locked(() => store.save({ critique: { at: Date.now(), points, by: `${res.conn.name}، ${res.model}` } }));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const LV = { high: ['var(--neg)', 'var(--neg-bg, rgba(239,77,107,.12))'], mid: ['var(--warn)', 'var(--warn-bg)'], low: ['var(--accent)', 'var(--accent-soft)'] };
  return html`<div class="critique">
    <div class="row between" style="margin-bottom:8px"><span class="sb small row" style="gap:6px"><${Icon} n="sparkles" cls="sm" />نگاه دستیار${T('critique')}</span>
      ${conns.length ? html`<button class="btn sm" onClick=${run} disabled=${busy || !(pf.gross > 0)}><${Icon} n=${busy ? 'refresh' : 'sparkles'} cls=${'sm' + (busy ? ' spin' : '')} />${busy ? 'در حال بررسی…' : c ? 'بررسی دوباره' : 'نقد پرتفوی'}</button>`
        : html`<a class="btn sm" href="#/settings">افزودن اتصال هوش مصنوعی</a>`}</div>
    ${err && html`<div class="callout err" style="margin-bottom:8px"><${Icon} n="circleX" cls="sm" /><div>${err}</div></div>`}
    ${c?.points?.length ? html`<div class="list">${c.points.map((p) => html`<div class="it" style="align-items:flex-start">
        <span class="ava" style=${`background:${LV[p.level][1]};color:${LV[p.level][0]}`}><${Icon} n=${p.level === 'low' ? 'info' : 'alert'} /></span>
        <div class="grow"><div class="sb small">${p.title}</div><div class="xs muted">${p.detail}</div>${p.check && html`<div class="xs" style="margin-top:3px"><b>بررسی کن:</b> ${p.check}</div>`}</div></div>`)}</div>
      <div class="xs faint" style="margin-top:6px">${ago(c.at)}، ${c.by}. فقط درصدها فرستاده شد، نه مبلغ‌ها.</div>`
      : !err && html`<div class="xs muted">سه نقطه ضعف ترکیب دارایی‌ات را پیدا می‌کند: تمرکز، تورم، نقدینگی، بدهی و فاصله از هدف. فقط درصدها فرستاده می‌شود، نه مبلغ‌ها.</div>`}
  </div>`;
}


function Bars({ items, s, total }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return html`<div class="bars">${items.map((i) => html`<div class="bar-row">
    <span class="row ellipsis" style="gap:8px"><span style=${`width:9px;height:9px;border-radius:3px;background:${i.color};flex:none`}></span><span class="ellipsis">${i.name}</span></span>
    <div class="track"><i style=${`width:${i.value / max * 100}%;background:${i.color}`}></i></div>
    <span class="small num" style="text-align:left"><${Money} v=${i.value} s=${s} compact unit=${false} /> <span class="muted">، ${pct(i.value / (total || 1), { sign: false })}</span></span></div>`)}</div>`;
}

function NewMoney({ pf, s, targets, assets, dirty }) {
  const [amount, setAmount] = useState(null);
  const tf = Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, (+v || 0) / 100]));
  const plan = amount > 0 ? I.allocateNew(pf, tf, amount, assets) : null;
  const hasTargets = Object.values(tf).some((v) => v > 0);
  return html`<div class="newmoney" id="newmoney">
    <div class="row between" style="margin-bottom:8px"><span class="sb small row" style="gap:6px"><${Icon} n="plus" cls="sm" />پول جدید را کجا بگذارم؟${T('newmoney')}</span>
      ${plan && !dirty && html`<${AskBtn} q=${`اگر ${num(amount / (s.currency === 'rial' ? 1 : 10))} ${unitOf(s)} پول جدید داشته باشم، طبق تخصیص هدفم کجا بگذارم؟ با plan_new_money حساب کن و دلیلش را بگو.`} label="توضیح بده" />`}</div>
    ${!hasTargets ? html`<div class="xs muted">اول درصد هدف دسته‌ها را در جدول بالا وارد کن (یا «پر کردن با وضعیت فعلی» را بزن و تغییر بده)؛ بعد مبلغ را بنویس.</div>` : html`
      <div style="max-width:340px"><${MoneyField} label="مبلغی که می‌خواهی سرمایه‌گذاری کنی" rial=${amount} onRial=${setAmount} s=${s} /></div>
      ${plan && html`<table class="tbl" style="margin-top:10px"><thead><tr><th>دسته</th><th class="n">سهم این پول</th><th class="n">سهم فعلی ← بعد</th><th class="n">هدف</th><th>مثلاً در</th></tr></thead><tbody>
        ${plan.rows.filter((r) => r.add >= 1).map((r) => html`<tr class="r"><td><div class="row"><${Ava} cat=${r.id} size=${26} /><span class="sb">${r.cat.short}</span></div></td>
          <td class="n sb"><${Money} v=${r.add} s=${s} compact /></td>
          <td class="n small num">${pct(r.currentShare, { sign: false })} ← <b>${pct(r.afterShare, { sign: false })}</b></td>
          <td class="n small num">${pct(r.target, { sign: false })}</td>
          <td class="small">${r.vehicle ? r.vehicle.name : html`<span class="faint">دارایی جدید</span>`}</td></tr>`)}
      </tbody></table>
      <div class="xs muted" style="margin-top:6px">بدون فروش هیچ دارایی. بیشترین فاصله از هدف از <span class="ltr">${pct(plan.maxDevBefore, { sign: false })}</span> به <span class="ltr">${pct(plan.maxDevAfter, { sign: false })}</span> می‌رسد. این فقط حساب ریاضی بر اساس هدف خودت است، نه توصیه خرید.</div>`}`}
  </div>`;
}

function Targets({ pf, s, assets }) {
  const [t, setT] = useState(() => ({ ...s.targets }));
  const rows = E.rebalance(pf, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (+v || 0) / 100])));
  const sum = Object.values(t).reduce((x, v) => x + (+v || 0), 0);
  const dirty = JSON.stringify(t) !== JSON.stringify(s.targets);
  const fill = () => { const n = {}; for (const r of rows) n[r.id] = Math.round(r.currentShare * 1000) / 10; setT(n); };
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="target" cls="sm" />تخصیص هدف و پیشنهاد متوازن‌سازی${T('targets')}</h3>
      <div class="row"><button class="btn sm ghost" onClick=${fill}>پر کردن با وضعیت فعلی</button>
        <button class="btn sm primary" disabled=${!dirty} onClick=${() => { act.setSettings({ targets: t }); toast('اهداف ذخیره شد'); }}>ذخیره اهداف</button></div></div>
    <div class=${'callout' + (Math.abs(sum - 100) > 0.5 && sum > 0 ? ' warn' : '')} style="margin-bottom:12px"><${Icon} n="info" cls="sm" /><div>
      درصد هدف هر دسته را وارد کن (مثلاً ۳۰٪ طلا، ۲۰٪ ارز). جمع فعلی: <b class="num">${num(sum, 1)}٪</b>${Math.abs(sum - 100) > 0.5 && sum > 0 ? ' — بهتر است جمع ۱۰۰٪ باشد.' : ''}</div></div>
    <table class="tbl"><thead><tr><th>دسته</th><th class="n">ارزش فعلی</th><th class="n">سهم فعلی</th><th style="width:130px">هدف ٪</th><th style="width:28%">فعلی در برابر هدف</th><th class="n">اقدام پیشنهادی</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr class="r">
      <td><div class="row"><${Ava} cat=${r.id} size=${28} /><span class="sb">${r.cat.short}</span></div></td>
      <td class="n small"><${Money} v=${r.current} s=${s} compact unit=${false} /></td>
      <td class="n small num">${pct(r.currentShare, { sign: false })}</td>
      <td><input class="input num-in" style="height:32px" value=${t[r.id] ?? ''} placeholder="—" onInput=${(e) => setT({ ...t, [r.id]: e.target.value === '' ? undefined : (parseNum(e.target.value) || 0) })} /></td>
      <td><div class="bars"><div class="track"><i style=${`width:${Math.min(100, r.currentShare * 100)}%;background:${r.cat.color}`}></i>${r.hasTarget && html`<span class="tgt" style=${`right:${Math.min(100, r.target * 100)}%`}></span>`}</div></div></td>
      <td class="n small">${r.hasTarget ? (Math.abs(r.diff) < pf.gross * 0.005 ? html`<span class="pos">متوازن</span>` : html`<span class=${r.diff > 0 ? 'pos' : 'neg'}>${r.diff > 0 ? 'خرید' : 'فروش'} <${Money} v=${Math.abs(r.diff)} s=${s} compact /></span>`) : html`<span class="faint">—</span>`}</td>
    </tr>`)}</tbody></table>
    <hr class="sep" />
    <${NewMoney} pf=${pf} s=${s} targets=${t} assets=${assets} dirty=${dirty} />
  </div>`;
}


/* ---------------- scenario simulator ---------------- */
const ZERO = { usd: 0, gold: 0, crypto: 0, metals: 0, equity: 0, private: 0, real: 0, bubble: 0 };
const MORE_KEYS = ['crypto', 'metals', 'private', 'real', 'bubble'];
function Scenario({ st, pf, s }) {
  const [sh, setSh] = useState(ZERO);
  const [more, setMore] = useState(false);
  const [preset, setPreset] = useState(null);
  const [nl, setNl] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlErr, setNlErr] = useState('');
  const [ai, setAi] = useState(null); // {title, assumptions:[{key,label,reason}]}
  const conns = AI.orderedConnections(st.ai);
  const build = async () => {
    const text = nl.trim(); if (!text || nlBusy) return;
    setNlBusy(true); setNlErr('');
    try {
      const res = await AI.extract({ ai: st.ai, system: A.scenarioSystem(), prompt: A.scenarioPrompt(text, st.quotes), maxTokens: 900 });
      const sc = A.parseScenario(res.json);
      if (!sc.assumptions.length) throw new Error('برای این اتفاق فرض قابل‌استفاده‌ای ساخته نشد؛ دقیق‌تر بنویس');
      setSh({ ...ZERO, ...sc.shocks }); setPreset(null);
      if (MORE_KEYS.some((k) => sc.shocks[k])) setMore(true);
      setAi({ title: sc.title || text, text, assumptions: sc.assumptions });
    } catch (e) { setNlErr(e.message); }
    setNlBusy(false);
  };
  const shocks = Object.fromEntries(Object.entries(sh).map(([k, v]) => [k, v / 100]));
  const r = useMemo(() => E.simulate(st.assets, st.quotes, s, shocks, pf), [st.assets, st.quotes, pf, JSON.stringify(sh)]);
  const set = (k) => (v) => { setPreset(null); setSh((x) => ({ ...x, [k]: v })); };
  const pick = (sc) => { setPreset(sc.id); setSh({ ...ZERO, ...Object.fromEntries(Object.entries(sc.shocks).map(([k, v]) => [k, Math.round(v * 100)])) }); if (MORE_KEYS.some((k) => sc.shocks[k])) setMore(true); };
  // the bubble slider and preset only matter when coins or exchange-traded gold funds are held
  const hasBubble = useMemo(() => pf.rows.some((x) => x.exposure === 'gold' && BB.assetBubble(x.asset, st.quotes)), [pf, st.quotes]);
  const goldLocal = ((1 + sh.usd / 100) * (1 + sh.gold / 100) - 1) * 100;
  const usdTerms = r.usdBefore ? r.usdAfter / r.usdBefore - 1 : null;
  const goldTerms = r.goldBefore ? r.goldAfter / r.goldBefore - 1 : null;
  const touched = Object.values(sh).some((v) => v !== 0);
  const maxAbs = Math.max(1, ...r.exposures.map((e) => Math.abs(e.after - e.before)));
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="sliders" cls="sm" />شبیه‌ساز سناریو${T('scenario')}</h3>
      <div class="row" style="gap:8px">${touched && html`<${AskBtn} q=${`اگر ${Object.entries(sh).filter(([, v]) => v).map(([k, v]) => `${A.SCENARIO_LABELS[k]} ${v > 0 ? '+' : ''}${v}٪`).join('، ')} شود، روی دارایی‌هایم چه اثری دارد؟ با simulate_scenario حساب کن و بگو کدام بخش بیشترین اثر را می‌گیرد.`} label="توضیح بده" />`}
      ${touched && html`<button class="btn sm ghost" onClick=${() => { setSh(ZERO); setPreset(null); setAi(null); }}><${Icon} n="reset" cls="sm" />بازنشانی</button>`}</div></div>
    <div class="nl-scn">
      <input class="input" placeholder=${conns.length ? 'یک اتفاق را بنویس؛ مثلاً «اگر توافق شود» یا «اگر تورم دو برابر شود»' : 'برای ساختن سناریو با یک جمله، یک اتصال هوش مصنوعی اضافه کن'} disabled=${!conns.length} value=${nl}
        onInput=${(e) => setNl(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && build()} />
      <button class="btn primary" onClick=${build} disabled=${!conns.length || !nl.trim() || nlBusy}><${Icon} n=${nlBusy ? 'refresh' : 'sparkles'} cls=${'sm' + (nlBusy ? ' spin' : '')} />${nlBusy ? 'در حال ساختن…' : 'بساز'}</button>
    </div>
    ${nlErr && html`<div class="callout err" style="margin-bottom:10px"><${Icon} n="circleX" cls="sm" /><div>${nlErr}</div></div>`}
    ${ai && html`<div class="assume">
      <div class="row between"><span class="sb small">فرض‌های سناریوی «${ai.title}»</span><button class="btn icon sm ghost" title="بستن" onClick=${() => setAi(null)}><${Icon} n="x" cls="sm" /></button></div>
      ${ai.assumptions.map((x) => html`<div class="arow"><span class="sb">${x.label}</span><span class=${'num ltr ' + (sh[x.key] >= 0 ? 'pos' : 'neg')}>${sh[x.key] > 0 ? '+' : ''}${num(sh[x.key])}٪</span><span class="muted grow">${x.reason}</span></div>`)}
      <div class="xs muted">این‌ها فرض‌اند، نه پیش‌بینی. با لغزنده‌های پایین هر کدام را عوض کن تا نتیجه همان لحظه به‌روز شود.</div>
    </div>`}
    <div class="row wrap" style="gap:6px;margin-bottom:14px">${SCENARIOS.filter((sc) => sc.needs !== 'bubble' || hasBubble).map((sc) => html`<button class=${'chip' + (preset === sc.id ? ' on' : '')} onClick=${() => { pick(sc); setAi(null); }}>${sc.name}</button>`)}</div>
    <div class="why" style="grid-template-columns:1fr 1fr">
      <div class="col" style="gap:14px">
        <${Slider} label="نرخ دلار (بازار آزاد)" value=${sh.usd} onChange=${set('usd')} min=${-50} max=${150} note="روی ارز، طلا، رمزارز و فلزات اثر می‌گذارد" />
        <${Slider} label="انس جهانی طلا (دلاری)" value=${sh.gold} onChange=${set('gold')} min=${-50} max=${100} note=${html`طلای داخلی ≈ <span class="ltr">${goldLocal >= 0 ? '+' : ''}${num(goldLocal, 1)}٪</span>${T('ounce')}`} />
        <${Slider} label="بورس تهران" value=${sh.equity} onChange=${set('equity')} min=${-60} max=${150} />
        ${more ? html`
          <${Slider} label="رمزارز (دلاری)" value=${sh.crypto} onChange=${set('crypto')} min=${-80} max=${200} />
          <${Slider} label="نقره و مس (دلاری)" value=${sh.metals} onChange=${set('metals')} min=${-50} max=${100} />
          <${Slider} label="سهام غیربورسی" value=${sh.private} onChange=${set('private')} min=${-80} max=${200} />
          <${Slider} label="ملک و خودرو" value=${sh.real} onChange=${set('real')} min=${-50} max=${150} />
          ${(hasBubble || sh.bubble !== 0) && html`<${Slider} label=${html`<span class="row" style="gap:2px">اندازه حباب سکه و صندوق طلا${TT('bubble')}</span>`} value=${sh.bubble} onChange=${set('bubble')} min=${-100} max=${100} note="−۱۰۰ یعنی حباب کاملاً تخلیه شود و سکه به ارزش طلایش برسد؛ +۱۰۰ یعنی حباب دو برابر شود" />`}`
          : html`<button class="btn sm ghost" style="align-self:flex-start" onClick=${() => setMore(true)}><${Icon} n="chevronDown" cls="sm" />متغیرهای بیشتر</button>`}
      </div>
      <div class="col" style="gap:12px">
        <div class="preview" style="flex-direction:column;align-items:stretch;gap:6px">
          <span class="xs muted">ارزش خالص بعد از سناریو</span>
          <span class="v"><${Money} v=${r.after} s=${s} compact /></span>
          <span class=${'sb ' + (r.delta >= 0 ? 'pos' : 'neg')}><span class="ltr">${pct(r.pct)}</span>، <${Money} v=${r.delta} s=${s} compact sign /></span>
        </div>
        <div class="grid2">
          <div class="pcell"><span class="n row" style="gap:2px">بر حسب دلار${T('terms')}</span><span class="v"><${Delta} p=${usdTerms} showAbs=${false} /></span></div>
          <div class="pcell"><span class="n">بر حسب طلا</span><span class="v"><${Delta} p=${goldTerms} showAbs=${false} /></span></div>
        </div>
        ${touched && usdTerms !== null && usdTerms < -0.005 && r.delta > 0 && html`<div class="callout warn"><${Icon} n="info" cls="sm" /><div>ارزش تومانی بالا می‌رود ولی قدرت خرید دلاری‌ات <b>${pct(Math.abs(usdTerms), { sign: false })}</b> کم می‌شود — بخش ریالی دارایی از تورم عقب می‌ماند.</div></div>`}
        <div class="wbars">${r.exposures.filter((e) => Math.abs(e.after - e.before) >= 1).map((e) => html`<div class="wbar"><span class="ellipsis sb">${e.name}</span>
          <div class="wt" dir="ltr"><b style=${`${e.after - e.before >= 0 ? 'left:50%' : `left:${50 - Math.abs(e.after - e.before) / maxAbs * 50}%`};width:${Math.max(1.5, Math.abs(e.after - e.before) / maxAbs * 50)}%;background:${e.color}`}></b></div>
          <span class=${'wv ' + (e.after >= e.before ? 'pos' : 'neg')}><${Money} v=${e.after - e.before} s=${s} compact sign unit=${false} /></span></div>`)}
          ${!touched && html`<div class="muted small">یک سناریو انتخاب کن یا لغزنده‌ها را جابه‌جا کن.</div>`}</div>
      </div>
    </div>
  </div>`;
}

export function AnalysisPage({ st, pf, s, open }) {
  const g = pf.gross || 1;
  const exItems = Object.entries(EXPOSURES).map(([k, v]) => ({ name: v.name, color: v.color, value: pf.byExposure[k] || 0 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const liqItems = [['high', '#14BCDB'], ['mid', '#8E70FF'], ['low', '#D946A8']].map(([k, c]) => ({ name: 'نقدشوندگی ' + LIQUIDITY[k], color: c, value: pf.byLiquidity[k] || 0 }));
  const cust = Object.entries(pf.byCustodian).map(([name, value]) => ({ name, value, color: 'var(--violet-2)' })).sort((a, b) => b.value - a.value).slice(0, 8);
  const topAsset = pf.rows.filter((r) => !r.cat.liability).sort((a, b) => b.value - a.value)[0];
  const risks = [];
  const has = pf.gross > 0;
  if (!has && pf.debt > 0) risks.push({ t: 'بدهی ثبت شده ولی دارایی‌ای نه', d: 'دارایی‌هایت را هم وارد کن تا نسبت بدهی و ریسک‌ها درست حساب شود.' });
  if (has && topAsset && topAsset.value / g > 0.3) risks.push({ t: `${pct(topAsset.value / g, { sign: false })} از کل دارایی در «${topAsset.asset.name}» است`, d: 'تمرکز بالا روی یک دارایی؛ نوسان آن مستقیماً روی کل ثروت اثر می‌گذارد.', a: topAsset.asset });
  if (has && (pf.byExposure.rial || 0) / g > 0.4) risks.push({ t: `${pct((pf.byExposure.rial || 0) / g, { sign: false })} از دارایی‌ها ریالی است`, d: 'با تورم بالا، دارایی‌های ریالی بدون سود کافی ارزش واقعی از دست می‌دهند.' });
  if (has && (pf.byLiquidity.high || 0) / g < 0.1) risks.push({ t: 'نقدینگی در دسترس کمتر از ۱۰٪ است', d: 'برای شرایط اضطراری، بخشی از دارایی را با نقدشوندگی بالا نگه دار.' });
  if (has && pf.debt > 0 && pf.debt / g > 0.3) risks.push({ t: `نسبت بدهی به دارایی ${pct(pf.debt / g, { sign: false })}`, d: 'بدهی بالا ریسک نقدینگی را زیاد می‌کند.' });
  const perf = pf.rows.filter((r) => r.pnl !== null).sort((a, b) => b.pnl - a.pnl);

  return html`<div class="page">
    <${Performance} st=${st} pf=${pf} s=${s} />
    <${Scenario} st=${st} pf=${pf} s=${s} />
    <div class="grid-ov">
      <div class="card"><div class="card-h"><h3><${Icon} n="shield" cls="sm" />مواجهه با تورم و ارز${T('exposure')}</h3><span class="sub">محافظت‌شده در برابر تورم: ${pf.gross > 0 ? pct(1 - (pf.byExposure.rial || 0) / g, { sign: false }) : '—'}</span></div>
        <${StackBar} items=${exItems} height=${14} /><div style="height:14px"></div><${Bars} items=${exItems} s=${s} total=${g} /></div>
      <div class="card"><div class="card-h"><h3><${Icon} n="droplet" cls="sm" />چقدر زود نقد می‌شود؟${T('liquidity')}</h3></div>
        <${StackBar} items=${liqItems} height=${14} /><div style="height:14px"></div><${Bars} items=${liqItems} s=${s} total=${g} />
        <div class="xs muted" style="margin-top:8px">بالا: قابل نقد در چند روز (بانک، ارز، صندوق بورسی)، متوسط: چند هفته، پایین: ملک، سهام خصوصی، مطالبات</div></div>
    </div>

    <div class="grid-ov">
      <div class="card"><div class="card-h"><h3><${Icon} n="bank" cls="sm" />تمرکز بر اساس محل نگهداری${T('custody')}</h3></div>
        <${Bars} items=${cust} s=${s} total=${g} /></div>
      <div class="card"><div class="card-h"><h3><${Icon} n="alert" cls="sm" />ریسک‌ها و نکات${T('risks')}</h3></div>
        ${risks.length ? html`<div class="list">${risks.map((r) => html`<div class="it" style="align-items:flex-start"><span class="ava" style="background:var(--warn-bg);color:var(--warn)"><${Icon} n="alert" /></span>
          <div class="grow"><div class="sb small">${r.t}</div><div class="xs muted">${r.d}</div></div></div>`)}</div>`
          : html`<div class="empty small"><div class="ico"><${Icon} n="check" /></div>ریسک برجسته‌ای در ترکیب فعلی دیده نشد.</div>`}
        <hr class="sep" />
        <${Critique} st=${st} pf=${pf} s=${s} />
      </div>
    </div>

    <${Compare} st=${st} pf=${pf} s=${s} />
    <${Targets} pf=${pf} s=${s} assets=${st.assets} />
    <${BreakEven} st=${st} s=${s} />

    <div class="card"><div class="card-h"><h3><${Icon} n="chart" cls="sm" />سود و زیان دارایی‌ها${T('pnl')}</h3><span class="sub">${perf.length ? `بر اساس بهای تمام‌شده، کل: ` : 'برای دیدن بازده، بهای تمام‌شده را در دارایی‌ها وارد کن'}${pf.pnl !== null ? html`<${Money} v=${pf.pnl} s=${s} compact sign cls=${pf.pnl >= 0 ? 'pos' : 'neg'} />` : ''}</span></div>
      ${perf.length ? html`<table class="tbl"><thead><tr><th>دارایی</th><th class="n">بهای تمام‌شده</th><th class="n">ارزش روز</th><th class="n">سود / زیان</th><th class="n">بازده</th></tr></thead><tbody>
        ${perf.map((r) => html`<tr class="r" style="cursor:pointer" onClick=${() => open(r.asset)}><td><div class="row"><${Ava} cat=${r.asset.category} size=${28} /><span class="sb">${r.asset.name}</span></div></td>
          <td class="n small"><${Money} v=${r.asset.costBasis} s=${s} compact /></td><td class="n small"><${Money} v=${r.value} s=${s} compact /></td>
          <td class=${'n small ' + (r.pnl >= 0 ? 'pos' : 'neg')}><${Money} v=${r.pnl} s=${s} compact sign /></td><td class="n small"><${Delta} p=${r.ret} showAbs=${false} /></td></tr>`)}
      </tbody></table>` : ''}
    </div>
  </div>`;
}
