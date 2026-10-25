// «رادار فرصت‌ها»: what in the stock market and among funds is worth a look today — each card says why it showed up and
// what to check before deciding. Not advice: fixed rules, plain numbers, the other side always shown. Logic: lib/radar.js.
import { html, useState, useEffect, useMemo, useRef, Icon, Seg, Modal, NumField, MoneyField, AskBtn, Tip, Sparkline, YearBar, toast, send, num, fmtJ, money, useRadar } from '../components.js';
import { ago } from '../../lib/format.js';
import * as RD from '../../lib/radar.js';
import * as BB from '../../lib/bubble.js';
import * as E from '../../lib/engine.js';
import * as I from '../../lib/insights.js';
import { act } from '../actions.js';
import * as PR from '../../lib/profile.js';
import { Terms } from '../glossary.js';

const ORDER = ['top', 'gold', 'negBubble', 'goldBubble', 'fixedBeat', 'inflow', 'momentum12', 'momentum3', 'volume', 'cheap', 'nearLow', 'topFund'];
const STOCK_SIGS = new Set(['top', 'inflow', 'momentum12', 'momentum3', 'volume', 'cheap', 'nearLow']);
const SIG_D = {
  top: 'نمادهایی که در جمع روند، ارزش، پول حقیقی، توجه بازار و ریسک کم، امروز بیشترین امتیاز را گرفته‌اند؛ فهرست بررسی است، نه خرید.',
  inflow: 'پرمعامله‌هایی که در جلسه‌های اخیر بیشتر روزها پول حقیقی واردشان شده، به اندازهٔ قابل‌توجهی از معاملاتشان.',
  momentum12: 'پرمعامله‌هایی که در ۱۲ ماه گذشته جزو ۱۰٪ پربازده بازار بوده‌اند.',
  momentum3: 'پرمعامله‌هایی که در ۳ ماه گذشته جزو ۱۰٪ پربازده بازار بوده‌اند.',
  volume: 'امروز دست‌کم ۳ برابر معمول معامله شده‌اند؛ دلیلش را در خبرها و اطلاعیه‌های شرکت ببین.',
  cheap: 'P/E آن‌ها کمتر از ۶۰٪ میانهٔ هم‌گروه‌های سودده است.',
  nearLow: 'تا ۱۰٪ بالای کمترین قیمت سال، ولی هنوز سودده.',
  negBubble: 'قیمت بازار کمتر از ارزش دارایی‌های صندوق (NAV ابطال).',
  goldBubble: 'صندوق‌های طلای پرمعامله با کمترین حباب (قیمت در برابر NAV همان روز).',
  fixedBeat: 'صندوق‌های درآمد ثابت با سابقهٔ یک‌ساله که از سپرده بیشتر داده‌اند.',
  topFund: 'بیشترین بازدهی ۱۲ ماه در هر نوع صندوق (با سابقهٔ دست‌کم یک سال).',
};
// the ⓘ beside each section: what it takes to get in, and where it can mislead
const SIG_TIP = {
  top: 'امتیاز ترکیبی (۰ تا ۱۰۰) جایگاه هر نماد پرمعامله را در پنج بخش در برابر بقیهٔ بازار می‌سنجد: روند (بازدهی ۱۲ و ۳ ماه)، ارزش (P/E در برابر هم‌گروه‌ها؛ زیان‌ده صفر می‌گیرد)، پول حقیقی (۵ جلسهٔ اخیر)، توجه بازار (حجم امروز در برابر معمول) و ریسک کم (نوسان روزانه و بیشترین افت سال). وزن بخش‌ها با سطح ریسک پروفایلت عوض می‌شود. بخشی که برای نمادی معلوم نیست کنار می‌رود و بقیه وزنش را می‌گیرند. فقط امتیاز ۶۵ به بالا، با دست‌کم چهار بخشِ معلوم (از جمله ریسک)، اینجا می‌آید. امتیاز بالا یعنی «ارزش بررسی دارد»، نه «بخر».',
  inflow: 'پول حقیقی یعنی خرید منهای فروش اشخاص حقیقی (نه شرکت‌ها و صندوق‌ها)، به ریال، از آمار روزانهٔ سایت بورس. شرط: دست‌کم ۳ جلسه آمار، ورود خالص در ۵ جلسهٔ اخیر حداقل ۸٪ ارزش معاملات، و ورود در بیشتر جلسه‌ها. «قدرت خریدار» یعنی میانگین خرید هر خریدار حقیقی تقسیم بر میانگین فروش هر فروشندهٔ حقیقی. ورود پول گاهی ادامه‌دار نیست و ممکن است یک خریدار بزرگ باشد.',
  momentum12: 'از بین نمادهای پرمعامله، ۱۰٪ که بیشترین بازدهی ۱۲ ماه (تعدیل‌شده) را داشته‌اند. روند قوی گاهی ادامه پیدا می‌کند، ولی سهمی که چند برابر شده ممکن است خبرهای خوبش را قبلاً در قیمت گرفته باشد؛ P/E و فاصله از سقف را کنارش ببین.',
  momentum3: 'همان روند قوی در ۳ ماه اخیر، برای نمادهایی که در فهرست اول ۱۲ ماه نیامده‌اند. حرکت‌های کوتاه‌مدت پرنوسان‌ترند و زودتر برمی‌گردند.',
  volume: 'نمادهایی که امروز دست‌کم ۳ برابر میانهٔ ۲۰ روز معاملهٔ قبلی‌شان معامله شده‌اند و ارزش معاملاتشان قابل‌توجه است. دلیلش می‌تواند خبر، عرضهٔ سنگین یا خرید یک‌باره باشد؛ جهت قیمت امروز را هم ببین.',
  cheap: 'نمادهای پرمعامله و سودده‌ای که P/E آن‌ها حداکثر ۶۰٪ میانهٔ هم‌گروه‌هاست. P/E از سود برآوردی سایت بورس است؛ اگر سود یک‌باره یا رو به کاهش باشد، ارزانی فقط ظاهری است.',
  nearLow: 'تا ۱۰٪ بالای کمترین قیمت یک سال، دست‌کم ۱۵٪ زیر بالاترین قیمت، و هنوز سودده. افت ممکن است دلیل داشته باشد؛ «نزدیک کف» به‌تنهایی یعنی ارزان نیست.',
  negBubble: 'صندوق‌های قابل معامله‌ای که قیمت پایانی‌شان کمتر از ارزش دارایی‌ها (NAV ابطال همان روز) بوده. فاصله معمولاً کم است و زود بسته می‌شود.',
  goldBubble: 'سه صندوق طلای پرمعامله با کمترین حباب، یعنی کمترین فاصلهٔ قیمت از ارزش دارایی‌ها در روز NAV. حباب هر روز عوض می‌شود.',
  fixedBeat: 'صندوق‌های درآمد ثابت با دست‌کم یک سال سابقه و اندازهٔ قابل‌توجه که بازدهی ۱۲ ماهشان از سپرده با سود ماهانه بیشتر بوده. بازدهی این صندوق‌ها معمولاً پایدارتر است، ولی تضمینی نیست.',
  topFund: 'دو صندوق با بیشترین بازدهی ۱۲ ماه در هر نوع (سهامی، مختلط، کالایی، شاخصی، بخشی، اهرمی). صندوق‌های اهرمی و بخشی پرریسک‌ترند.',
};
/** «کارنامهٔ رادار» for a section: how its stock cards did a month later, against the index — once there's enough of it. */
function trackText(radar, sig) {
  const t = RD.trackStats(radar, sig);
  if (!STOCK_SIGS.has(sig)) return '';
  if (t.avg === null) return t.since ? `کارنامهٔ رادار: از ${fmtJ(t.since)} ثبت می‌شود؛ وقتی کارت‌های کافی یک ماه از عمرشان گذشت، اینجا می‌آید که یک ماه بعد به‌طور میانگین چه کردند.` : '';
  return `کارنامهٔ رادار: کارت‌های این بخش (${num(t.n)} مورد، ${num(t.stocks)} نماد، از ${fmtJ(t.since)}) یک ماه بعد به‌طور میانگین ${pctTxt(t.avg, 1)} تغییر کردند${t.index !== null ? `؛ شاخص کل در همان مدت ${pctTxt(t.index, 1)}` : ''}. گذشته است و تضمینی برای آینده نیست.`;
}
/** The same record as one short line under a section's title, always in view: { text, good } — good: beat the index or not. */
function trackLine(radar, sig) {
  const t = RD.trackStats(radar, sig);
  if (!t.since) return { text: 'کارنامهٔ این بخش از اولین بررسی کامل بازار ثبت می‌شود؛ یک ماه بعد، نتیجهٔ کارت‌هایش همین‌جا می‌آید.', good: null };
  if (t.avg === null) return { text: `کارنامهٔ این بخش از ${fmtJ(t.since)} ثبت می‌شود؛ وقتی کارت‌هایش یک ماه عمر کردند، نتیجه همین‌جا می‌آید.`, good: null };
  const vs = t.index !== null ? t.avg - t.index : null;
  return { text: `کارنامه: یک ماه بعد میانگین ${pctTxt(t.avg, 1)}${t.index !== null ? `؛ شاخص کل ${pctTxt(t.index, 1)}` : ''} (${num(t.n)} کارت از ${fmtJ(t.since)}). گذشته تضمین آینده نیست.`, good: vs === null ? null : vs > 0 };
}
const PRESETS = [
  { name: 'صندوق طلا با حباب زیر ۱٪', kind: 'fund', ftype: 5, conds: [{ f: 'bubble', op: '<=', v: 1 }] },
  { name: 'سهم با P/E زیر ۵', kind: 'stock', conds: [{ f: 'pe', op: '<=', v: 5 }, { f: 'pe', op: '>=', v: 0.1 }] },
  { name: 'درآمد ثابت بالای ۳۰٪', kind: 'fund', ftype: 4, conds: [{ f: 'y1', op: '>=', v: 30 }] },
  { name: '۳۰٪ زیر سقف سال', kind: 'stock', conds: [{ f: 'fromHigh', op: '<=', v: -30 }, { f: 'pe', op: '>=', v: 0.1 }] },
];
const pctTxt = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x * 100), d)}٪`);

export function RadarPage({ st, s, openPrice, route }) {
  const radar = useRadar();
  const user = st.radarUser;
  const [tab, setTab] = useState(route?.q?.tab || 'today');
  const [only, setOnly] = useState('all');
  const [showAll, setShowAll] = useState({});
  const [run, setRun] = useState(null); // { pending, total } while gathering
  const [editRule, setEditRule] = useState(null);
  const fmt = (v) => money(v, s, { compact: true });
  const day = radar?.day || null;

  // while this page is open, keep gathering the year's prices (busiest stocks first) instead of waiting for the alarm
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 40 && alive; i++) {
        if (document.visibilityState !== 'visible') { await new Promise((r) => setTimeout(r, 3000)); continue; }
        const r = await send('radar', { batch: 40 });
        if (!alive) return;
        setRun(r?.ok ? r : { error: r?.error });
        if (!r?.ok || !r.pending || r.off) break;
      }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (day && user.seenDay !== day) act.setRadarUser({ seenDay: day }); }, [day]);

  const depositPct = I.defaultDepositPct(st);
  const level = PR.riskLevel(s.profile) || 'mid';
  const built = useMemo(() => (radar?.day ? RD.buildCards(radar, { depositPct, money: fmt, level }) : null), [radar, s.currency, depositPct, level]);
  const pulse = useMemo(() => RD.pulse(radar, { depositPct }), [radar, depositPct]);
  const gold = useMemo(() => (radar?.day ? BB.goldRoutes(st.quotes, RD.goldFunds(radar)) : null), [radar, st.quotes]);
  const before = new Set(radar?.results?.day === day ? radar.results.before || [] : []);
  const isNew = (c) => before.size > 0 && !before.has(RD.cardKey(c));
  const marked = new Set(user.marks.map((m) => m.id));
  const mark = (c) => act.toggleRadarMark(c, RD.priceOf(radar, c.id), day).then(() => toast(marked.has(c.id) ? 'از پیگیری برداشته شد' : 'به پیگیری اضافه شد'));
  const pending = run?.pending ?? (radar ? Object.values(radar.stocks || {}).filter((r) => r.need > 0).length : 0);
  const total = run?.total ?? Object.keys(radar?.stocks || {}).length;
  const year = run?.year ?? (radar ? Object.values(radar.stocks || {}).filter((r) => r.need >= 60).length : 0);
  const force = async () => { setRun({ busy: true }); const r = await send('radar', { force: true, batch: 40 }); setRun(r?.ok ? r : { error: r?.error }); if (!r?.ok) toast(r?.error || 'بررسی انجام نشد'); };

  const head = html`<div class="card rd-top">
    <div class="row between wrap" style="gap:10px">
      <div><div class="row wrap" style="gap:8px"><h3 style="margin:0"><${Icon} n="radar" cls="sm" />رادار فرصت‌ها</h3>${day && html`<span class="sub">جلسهٔ ${fmtJ(day)}</span>`}${radar?.fundsAt > 0 && html`<span class="sub" title="فیپیران NAV صندوق‌ها را روزی یک بار و معمولاً با یک روز فاصله منتشر می‌کند">· صندوق‌ها ${ago(radar.fundsAt)}</span>`}</div>
        <div class="xs muted" style="margin-top:4px">هر روز بعد از بسته شدن بازار، کل بورس و فرابورس و همهٔ صندوق‌ها با قاعده‌های ثابت گشته می‌شوند.</div></div>
      <div class="row" style="gap:6px">
        <${Seg} value=${tab} onChange=${setTab} options=${[['today', 'امروز'], ['rules', `قاعده‌های من${user.rules.length ? ` (${num(user.rules.length)})` : ''}`], ['marks', `پیگیری${user.marks.length ? ` (${num(user.marks.length)})` : ''}`]]} />
        <button class="btn icon ghost" title="بررسی دوباره" aria-label="بررسی دوباره" disabled=${run?.busy} onClick=${force}><${Icon} n="refresh" cls=${run?.busy ? 'sm spin' : 'sm'} /></button>
      </div>
    </div>
    ${day && html`<${RadarSearch} radar=${radar} openPrice=${openPrice} today=${built} />`}
    ${pending > 0 && total > 0 && html`<div class="rd-prog"><div class="row between xs"><span>${year > 0 ? 'در حال جمع کردن قیمت‌های یک سال' : 'در حال گرفتن قیمت‌های پایانی جلسه'}: ${num(total - pending)} از ${num(total)} نماد</span><span class="muted">${run && !run.error ? 'تا این صفحه باز است ادامه دارد' : 'در پس‌زمینه ادامه دارد'}</span></div>
      <div class="progress"><i style=${`width:${Math.round(((total - pending) / total) * 100)}%;background:var(--accent)`}></i></div>
      <div class="xs muted">تا کامل شود، کارت‌های سهام فقط برای نمادهای آماده ساخته می‌شوند.</div></div>`}
    ${radar?.waitFor && day && radar.waitFor > day && html`<div class="xs muted" style="margin-top:8px">قیمت‌های پایانی جلسهٔ ${fmtJ(radar.waitFor)} هنوز کامل منتشر نشده (معمولاً بعد از ساعت ۱۳:۳۰ و گاهی دیرتر)؛ تا آن موقع کارت‌ها از جلسهٔ ${fmtJ(day)} هستند و خودکار به‌روز می‌شوند.</div>`}
    ${(run?.error || radar?.error) && html`<div class="callout warn" style="margin-top:10px"><${Icon} n="info" cls="sm" /><div>${run?.error || radar.error}</div></div>`}
    <div class="xs muted rd-note">این‌ها پیشنهاد خرید یا فروش نیستند؛ فهرست چیزهایی است که با قاعده‌های بالا ارزش بررسی دارند. بازدهی گذشته تضمینی برای آینده نیست.</div>
  </div>`;

  if (radar === null) return html`<div class="page">${head}</div>`;
  if (!day) return html`<div class="page">${head}<div class="card"><div class="empty small" style="padding:24px">
    ${run?.off ? 'رادار در تنظیمات خاموش است.' : run && !run.error ? 'در حال اولین بررسی بازار…' : 'هنوز بررسی‌ای انجام نشده. اولین بررسی بعد از بسته شدن بازار، یا همین حالا:'}
    <div style="margin-top:12px"><button class="btn primary" disabled=${run?.busy} onClick=${force}><${Icon} n="radar" cls="sm" />بررسی بازار</button></div></div></div></div>`;

  return html`<div class="page">${head}
    ${tab === 'today' && pulse && html`<${Pulse} p=${pulse} s=${s} />`}
    ${tab === 'today' && html`<div class="row wrap" style="gap:6px">${[['all', 'همه'], ['stock', 'سهام'], ['fund', 'صندوق‌ها']].map(([k, t]) => html`<button class=${'chip' + (only === k ? ' on' : '')} onClick=${() => setOnly(k)}>${t}</button>`)}</div>
      <${Mine} radar=${radar} st=${st} s=${s} cards=${built.cards} depositPct=${depositPct} openPrice=${openPrice} />
      ${ORDER.map((sig) => {
        if (sig === 'gold') return only !== 'stock' && gold && gold.rows.length + gold.funds.length > 1 ? html`<${GoldRoutes} g=${gold} s=${s} openPrice=${openPrice} />` : null;
        const all = built.cards.filter((c) => c.sig === sig && (only === 'all' || c.kind === only));
        if (!all.length) return null;
        const list = showAll[sig] ? all : all.filter(RD.isFirst);
        const more = all.length - list.length;
        return html`<section class="rd-sec"><div class="rd-sec-h"><h4>${RD.SIGNALS[sig].t}</h4><${Tip} title=${RD.SIGNALS[sig].t} text=${SIG_TIP[sig]} /><span class="xs muted">${SIG_D[sig]}</span></div>
          ${STOCK_SIGS.has(sig) && ((tt) => tt && html`<div class=${'rd-track' + (tt.good === true ? ' good' : tt.good === false ? ' bad' : '')}><${Icon} n="chart" cls="xs" /><span>${tt.text}</span></div>`)(trackLine(radar, sig))}
          <div class="rd-grid">${list.map((c) => html`<${Card} c=${c} radar=${radar} s=${s} isNew=${isNew(c)} marked=${marked.has(c.id)} onMark=${() => mark(c)} openPrice=${openPrice} />`)}</div>
          ${(more > 0 || (showAll[sig] && all.some((c) => !RD.isFirst(c)))) && html`<button class="btn sm ghost rd-more" aria-expanded=${showAll[sig] ? 'true' : 'false'} onClick=${() => setShowAll({ ...showAll, [sig]: !showAll[sig] })}>${showAll[sig] ? 'کمتر' : `همه را ببین (${num(all.length)})`}<${Icon} n="chevronDown" cls=${'sm' + (showAll[sig] ? ' rot' : '')} /></button>`}</section>`;
      })}
      ${!built.cards.filter((c) => only === 'all' || c.kind === only).length && html`<div class="card"><div class="empty small">امروز چیزی از این قاعده‌ها رد نشد.</div></div>`}`}
    ${tab === 'rules' && html`<${Rules} radar=${radar} user=${user} s=${s} openPrice=${openPrice} onEdit=${setEditRule} />`}
    ${tab === 'marks' && html`<${Marks} radar=${radar} user=${user} s=${s} openPrice=${openPrice} />`}
    ${editRule && html`<${RuleModal} rule=${editRule} sectors=${radar.sectors || {}} onClose=${() => setEditRule(null)} />`}
  </div>`;
}

function Card({ c, radar, s, isNew, marked, onMark, openPrice }) {
  const q = c.kind === 'stock' ? `نماد «${c.sym}» (${c.name}) امروز در رادار دارا آمده. با عددهای همین امروزش توضیح بده چرا، و چه چیزهایی را باید پیش از تصمیم بررسی کنم. توصیهٔ خرید یا فروش نکن.`
    : `صندوق «${c.name}» امروز در رادار دارا آمده. با عددهای همین امروزش توضیح بده چرا، و چه چیزهایی را باید پیش از تصمیم بررسی کنم. توصیهٔ خرید یا فروش نکن.`;
  return html`<article class="card rd-card">
    <div class="row between" style="gap:8px;align-items:flex-start">
      <button class="rd-name" onClick=${() => openPrice(c.ref)} title="نمودار و کارنامه">
        <span class="row" style="gap:6px"><b>${c.sym || c.name}</b>${isNew && html`<span class="pill live">تازه</span>`}${PR.tooRisky(s.profile, c) && html`<span class="tag-risk" title="نوسان روزانه یا افت یک سالش برای ریسکی که در پروفایلت گفته‌ای زیاد است؛ فقط برچسب است">با پروفایلت پرریسک</span>`}</span>
        <span class="xs muted ellipsis">${c.sym ? c.name + '، ' : ''}${c.sub}</span></button>
      <button class=${'btn icon sm ghost' + (marked ? ' on' : '')} title=${marked ? 'برداشتن از پیگیری' : 'افزودن به پیگیری'} aria-label=${marked ? 'برداشتن از پیگیری' : 'افزودن به پیگیری'} aria-pressed=${marked ? 'true' : 'false'} onClick=${onMark}><${Icon} n=${marked ? 'circleCheck' : 'plus'} cls="sm" /></button>
    </div>
    <${Viz} kind=${c.kind} m=${c.m} rec=${c.kind === 'stock' ? radar.stocks?.[c.ins] : null} day=${radar.day} s=${s} />
    ${c.kind === 'stock' && c.score !== undefined && html`<${Score} c=${c} full=${c.sig === 'top'} />`}
    ${c.kind === 'stock' && c.sig !== 'inflow' && html`<${Flow} m=${c.m} s=${s} />`}
    ${((seen) => html`<div class="rd-why"><span class="xs sb">چرا دیده شد</span>${c.why.map((t) => html`<div class="small"><${Terms} text=${t} seen=${seen} /></div>`)}</div>
    <div class="rd-check"><span class="xs sb">پیش از تصمیم ببین</span>${c.check.map((t) => html`<div class="xs"><${Terms} text=${t} seen=${seen} /></div>`)}</div>`)(new Set())}
    <div class="row" style="gap:6px;margin-top:auto"><button class="btn sm ghost" onClick=${() => openPrice(c.ref)}><${Icon} n="chart" cls="sm" />نمودار و کارنامه</button><span class="grow"></span><${AskBtn} q=${q} label="از دستیار بپرس" /></div>
  </article>`;
}

const PART_ORDER = ['trend', 'value', 'flow', 'attention', 'safety'];
/** The combined score: a number and — on «برترین‌ها» — a bar per part; elsewhere one line, with the other lists it is in. */
function Score({ c, full }) {
  const tone = c.score >= 75 ? 'hi' : c.score >= 50 ? 'mid' : 'lo';
  const lit = (c.lit || []).filter((g) => RD.SIGNALS[g]);
  return html`<div class=${'rd-score' + (full ? ' full' : '')}>
    <div class="row" style="gap:10px;align-items:center">
      <span class=${'rd-sc-n ' + tone} title="امتیاز ترکیبی از ۱۰۰"><b class="num">${num(c.score)}</b><span class="xs">از ۱۰۰</span></span>
      ${full ? html`<div class="rd-parts grow">${PART_ORDER.filter((k) => c.parts?.[k] !== undefined).map((k) => html`<div class="rd-part" title=${`${RD.SCORE_PARTS[k]}: بهتر از ${num(Math.round(c.parts[k] * 100))}٪ ${k === 'value' ? 'نمادهای پرمعاملهٔ سودده (زیان‌ده صفر می‌گیرد)' : k === 'flow' ? 'نمادهای پرمعامله‌ای که آمار پول حقیقی‌شان هست' : 'نمادهای پرمعامله'}`}>
          <span class="xs muted">${RD.SCORE_PARTS[k]}</span><span class="rd-pbar"><i style=${`width:${Math.max(4, Math.round(c.parts[k] * 100))}%`}></i></span></div>`)}</div>`
        : html`<span class="xs muted grow">امتیاز ترکیبی${c.parts ? ` · قوی در ${PART_ORDER.filter((k) => c.parts[k] >= 0.7).map((k) => RD.SCORE_PARTS[k]).join('، ') || '—'}` : ''}</span>`}
    </div>
    ${full && lit.length > 0 && html`<div class="row wrap" style="gap:4px">${lit.map((g) => html`<span class="pill auto xs" title=${SIG_D[g]}>${RD.SIGNALS[g].t}</span>`)}</div>`}
  </div>`;
}
/** Individual money over the last sessions, on a stock card — or how far its gathering has got. */
function Flow({ m, s }) {
  if (!m) return null;
  if (!(m.flowN >= 3)) return m.flowN > 0 ? html`<div class="xs muted rd-flow">پول حقیقی: در حال جمع‌آوری (${num(m.flowN)} از ۳ جلسه)</div>` : null;
  const n = Math.min(5, m.flowN); const v = m.flow5;
  return html`<div class=${'xs rd-flow ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '')}><span class="muted">پول حقیقی ${num(n)} جلسه:</span> <b class="num">${v > 0 ? 'ورود' : v < 0 ? 'خروج' : 'خنثی'}${v ? ' ' + money(Math.abs(v), s, { compact: true }) : ''}</b>${m.flowShare5 && v ? html` <span class="muted">(${pctTxt(Math.abs(m.flowShare5), Math.abs(m.flowShare5) < 0.01 ? 1 : 0).replace('+', '')} معاملات)</span>` : ''}</div>`;
}

/** «نبض بازار»: the session in one sentence and five numbers. */
function Pulse({ p, s }) {
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const m = (v) => `${sign(v)}${money(Math.abs(v), s, { compact: true })}`;
  const breadth = p.up + p.down + p.flat;
  const line = [
    p.indexDay !== null && `شاخص کل ${pctTxt(p.indexDay, 1)}`,
    breadth >= 20 && (p.up > p.down * 1.3 ? 'بیشتر نمادها مثبت' : p.down > p.up * 1.3 ? 'بیشتر نمادها منفی' : 'مثبت و منفی نزدیک به هم'),
    p.flowToday !== null && (p.flowToday > 0 ? 'پول حقیقی وارد شد' : p.flowToday < 0 ? 'پول حقیقی خارج شد' : null),
  ].filter(Boolean).join('، ');
  const tone = p.tone >= 1 ? 'pos' : p.tone <= -1 ? 'neg' : '';
  return html`<section class="card rd-pulse">
    <div class="row between wrap" style="gap:8px"><div class="row" style="gap:8px;align-items:center"><span class=${'rd-dot ' + tone} aria-hidden="true"></span><h4 style="margin:0">نبض بازار</h4><span class="xs muted">جلسهٔ ${fmtJ(p.day)}</span></div>
      <${Tip} title="نبض بازار" text="خلاصهٔ همین جلسه از داده‌های سایت بورس: تغییر شاخص کل، تعداد نمادهای مثبت و منفی، پول حقیقی (خرید منهای فروش اشخاص حقیقی)، و P/E میانهٔ نمادهای سودده. «بازده سود» یعنی ۱ تقسیم بر P/E: اگر سود شرکت‌ها ثابت بماند، هر ۱۰۰ تومان سهم چقدر سود سالانه دارد؛ کنار سود سپرده می‌آید تا مقایسه ساده باشد. پیش‌بینی نیست." /></div>
    ${line && html`<div class="rd-pline">${line}.</div>`}
    ${p.pending > 0 && html`<div class="xs muted">تعداد مثبت و منفی و پول حقیقی وقتی قیمت‌های پایانی همهٔ نمادها رسید می‌آید (${num(p.pending)} نماد مانده).</div>`}
    <div class="rd-stats">
      <div class="rd-stat"><span class="xs muted">شاخص کل</span><b class=${'num ' + (p.indexDay > 0 ? 'pos' : p.indexDay < 0 ? 'neg' : '')}>${pctTxt(p.indexDay, 1)}</b><span class="xs muted">${p.index1m !== null ? `یک ماه ${pctTxt(p.index1m)}` : 'امروز'}</span></div>
      ${breadth > 0 && html`<div class="rd-stat"><span class="xs muted">مثبت / منفی</span><b class="num"><span class="pos">${num(p.up)}</span> / <span class="neg">${num(p.down)}</span></b>
        <span class="rd-breadth" title=${`${num(p.up)} مثبت، ${num(p.flat)} بدون تغییر، ${num(p.down)} منفی`}><i class="u" style=${`width:${(p.up / breadth) * 100}%`}></i><i class="f" style=${`width:${(p.flat / breadth) * 100}%`}></i><i class="d" style=${`width:${(p.down / breadth) * 100}%`}></i></span></div>`}
      <div class="rd-stat"><span class="xs muted">پول حقیقی امروز</span>${p.flowToday !== null ? html`<b class=${'num ' + (p.flowToday > 0 ? 'pos' : p.flowToday < 0 ? 'neg' : '')}>${m(p.flowToday)}</b><span class="xs muted">${p.flowSessions >= 2 ? `${num(p.flowSessions)} جلسه ${m(p.flow5)}` : 'از امروز جمع می‌شود'}</span>` : html`<b class="muted">—</b><span class="xs muted">${p.flowSessions ? `${num(p.flowSessions)} جلسه ${m(p.flow5)}` : 'هنوز آماری نیامده'}</span>`}</div>
      ${p.pe !== null && html`<div class="rd-stat"><span class="xs muted">P/E بازار</span><b class="num">${num(p.pe, 1)}</b><span class="xs muted">بازده سود ${num(p.ey * 100, 0)}٪ · سپرده ${num(p.depositPct)}٪</span></div>`}
      ${p.usd1m !== null && html`<div class="rd-stat"><span class="xs muted">دلار، یک ماه</span><b class=${'num ' + (p.usd1m > 0 ? 'pos' : p.usd1m < 0 ? 'neg' : '')}>${pctTxt(p.usd1m, 1)}</b><span class="xs muted">بازار آزاد</span></div>`}
    </div>
  </section>`;
}

/** «ارزان‌ترین راه خرید طلا، امروز»: coins and 18k by their premium over world gold plus buying cost; gold funds by their bubble. */
function GoldRoutes({ g, s, openPrice }) {
  const [all, setAll] = useState(false);
  const rows = all ? g.rows : g.rows.slice(0, 4);
  const funds = all ? g.funds : g.funds.slice(0, 3);
  const max = Math.max(...g.rows.map((r) => Math.abs(r.buy)), 0.01);
  const fmax = Math.max(...g.funds.map((r) => Math.abs(r.buy)), 0.01);
  const more = g.rows.length > 4 || g.funds.length > 3;
  const row = (r, mx, sub) => html`<div class=${'rd-grow' + (r.best ? ' best' : '')}>
      ${r.ref ? html`<button class="rd-name" onClick=${() => openPrice(r.ref)}><b>${r.name}</b>${r.best && html`<span class="xs pos">${r.kind === 'etf' ? 'کم‌حباب‌ترین صندوق' : 'ارزان‌ترین امروز'}</span>`}</button>`
        : html`<div class="rd-name" style="cursor:default"><b>${r.name}</b>${r.best ? html`<span class="xs pos">ارزان‌ترین امروز</span>` : r.retail ? html`<span class="xs muted">قیمت مغازه</span>` : ''}</div>`}
      <span class="rd-gbar" aria-hidden="true"><i class=${r.buy < 0 ? 'neg' : ''} style=${`width:${Math.max(3, (Math.abs(r.buy) / mx) * 100)}%`}></i></span>
      <div class="rd-gnum"><b class="num">${pctTxt(r.buy, 1)}</b><span class="xs muted">${sub}</span></div>
    </div>`;
  return html`<section class="rd-sec">
    <div class="rd-sec-h"><h4>ارزان‌ترین راه خرید طلا، امروز</h4><${Tip} title="ارزان‌ترین راه خرید طلا" text=${`سکه‌ها و طلای ۱۸ عیار با قیمت جهانی طلا (اونس × دلار بازار آزاد) مقایسه می‌شوند: برای هر گرم طلای خالص چند درصد بیشتر یا کمتر از قیمت جهانی می‌پردازی، به‌علاوهٔ نیمی از هزینهٔ رفت‌وبرگشت (کارمزد و اختلاف خرید و فروش) که موقع خرید پرداخت می‌شود. صندوق‌های طلا جدا آمده‌اند، با حبابشان نسبت به NAV: ارزش دارایی صندوق خودش با قیمت داخلی آنچه نگه می‌دارد (بیشتر گواهی سکه و شمش، به سهم‌های متفاوت) حساب می‌شود، پس با این فهرست مستقیم مقایسه‌پذیر نیست. هزینه‌ها تخمینی‌اند (۱۸ عیار ${num(BB.ROUTE_COST.geram18, 1)}٪، سکه ${num(BB.ROUTE_COST.sekee)}٪ تا گرمی ${num(BB.ROUTE_COST.retail_gerami)}٪، صندوق حدود ${num(BB.ROUTE_COST.etf, 1)}٪). حباب‌ها هر روز عوض می‌شوند.`} /><span class="xs muted">هر گرم طلای خالص چقدر گران‌تر از قیمت جهانی، با هزینهٔ خرید</span></div>
    <div class="card rd-gold">
      ${rows.map((r) => row(r, max, `حباب ${pctTxt(r.premium, 1)} + هزینه ${num(r.cost / 2, 2)}٪`))}
      ${funds.length > 0 && html`<div class="rd-gsub xs muted">صندوق‌های طلا: حباب نسبت به ارزش دارایی‌هایشان (NAV ${fmtJ(funds[0].navDay)})، با هزینهٔ خرید</div>
        ${funds.map((r) => row(r, fmax, `حباب ${pctTxt(r.bubble, 1)} + هزینه ${num(r.cost / 2, 2)}٪`))}`}
      ${more && html`<button class="btn sm ghost" style="align-self:center" onClick=${() => setAll(!all)}>${all ? 'کمتر' : `همه (${num(g.rows.length + g.funds.length)})`}</button>`}
      <div class="xs muted">قیمت جهانی هر گرم طلای خالص: ${money(g.gold.price, s)} (اونس × دلار آزاد). حباب یعنی هزینهٔ نگه‌داری طلا در ایران نسبت به قیمت جهانی؛ ممکن است بالا یا پایین برود.</div>
    </div></section>`;
}

function Rules({ radar, user, s, openPrice, onEdit }) {
  const [open, setOpen] = useState(null);
  const level = PR.riskLevel(s.profile) || 'mid';
  const hits = useMemo(() => Object.fromEntries(user.rules.map((r) => [r.id, RD.runRule(radar, r, { level })])), [radar, user.rules, level]);
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="filter" cls="sm" />قاعده‌های من</h3><button class="btn sm primary" onClick=${() => onEdit({ kind: 'stock', name: '', conds: [{ f: 'pe', op: '<=', v: 6 }], notify: true })}><${Icon} n="plus" cls="sm" />قاعدهٔ تازه</button></div>
    <div class="xs muted" style="margin-bottom:10px">فیلترهای خودت. هر روز بعد از بازار اجرا می‌شوند و اگر بخواهی، نماد تازه‌ای که از فیلتر رد شود خبرت می‌کنند. فقط نمادهای پرمعامله حساب می‌شوند.</div>
    ${!user.rules.length && html`<div class="col" style="gap:8px"><span class="small">شروع سریع:</span><div class="row wrap" style="gap:6px">${PRESETS.map((p) => html`<button class="chip" onClick=${() => onEdit({ ...p, notify: true })}>${p.name}</button>`)}</div></div>`}
    <div class="list">${user.rules.map((r) => {
      const h = hits[r.id] || [];
      return html`<div class="it" style="flex-direction:column;align-items:stretch;gap:6px">
        <div class="row" style="gap:8px">
          <button class="rd-name grow" onClick=${() => setOpen(open === r.id ? null : r.id)} aria-expanded=${open === r.id ? 'true' : 'false'}><b>${r.name}</b><span class="xs muted">${ruleText(r)}</span></button>
          <span class="pill">${num(h.length)} ${r.kind === 'fund' ? 'صندوق' : 'نماد'}</span>
          <button class="btn icon sm ghost" title=${r.notify ? 'خبرم نکن' : 'خبرم کن'} aria-label=${r.notify ? 'خاموش کردن اعلان' : 'روشن کردن اعلان'} aria-pressed=${r.notify ? 'true' : 'false'} onClick=${() => act.saveRadarRule({ ...r, notify: !r.notify })}><${Icon} n="bell" cls=${r.notify ? 'sm' : 'sm faint'} /></button>
          <button class="btn icon sm ghost" title="ویرایش" aria-label=${'ویرایش ' + r.name} onClick=${() => onEdit(r)}><${Icon} n="edit" cls="sm" /></button>
          <button class="btn icon sm ghost danger" title="حذف" aria-label=${'حذف ' + r.name} onClick=${() => act.deleteRadarRule(r.id)}><${Icon} n="trash" cls="sm" /></button>
        </div>
        ${open === r.id && html`<div class="rd-hits">${h.length ? h.slice(0, 30).map((x) => html`<button class="rd-hit" onClick=${() => openPrice(x.ref)}><b>${x.sym || x.name}</b><span class="xs muted ellipsis">${x.sym ? x.name : ''}</span><span class="xs num">${hitLine(r.kind, x.m)}</span></button>`)
          : html`<div class="xs muted">امروز نمادی از این فیلتر رد نشد.</div>`}</div>`}
      </div>`;
    })}</div>
  </div>`;
}
const hitLine = (kind, m) => (kind === 'stock' ? `P/E ${m.pe !== null ? num(m.pe, 1) : '—'}، ۳ ماه ${pctTxt(m.ret91)}، ۱۲ ماه ${pctTxt(m.ret365)}` : `۱۲ ماه ${pctTxt(m.y1)}، ۳ ماه ${pctTxt(m.m3)}${m.bubble !== null ? `، حباب ${pctTxt(m.bubble, 1)}` : ''}`);
function ruleText(r) {
  const F = RD.FIELDS[r.kind];
  return [r.kind === 'fund' && r.ftype ? `صندوق ${RD.FUND_KIND[r.ftype] || ''}` : r.kind === 'fund' ? 'همهٔ صندوق‌ها' : 'سهام',
    ...r.conds.map((c) => `${F[c.f]?.t} ${c.op === '<=' ? 'حداکثر' : 'حداقل'} ${num(+c.v, 2)}${F[c.f]?.pct ? '٪' : ''}`)].join('، ');
}

function RuleModal({ rule, sectors, onClose }) {
  const [r, setR] = useState(() => structuredClone(rule));
  const F = RD.FIELDS[r.kind];
  const setCond = (i, patch) => setR({ ...r, conds: r.conds.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setKind = (kind) => setR({ ...r, kind, ftype: undefined, sector: undefined, conds: [{ f: Object.keys(RD.FIELDS[kind])[0], op: '>=', v: 0 }] });
  const ok = r.name.trim() && RD.validRule(r);
  const save = async () => { if (!ok) return; await act.saveRadarRule({ ...r, name: r.name.trim() }); toast(r.notify ? 'قاعده ذخیره شد؛ اگر نماد تازه‌ای از آن رد شد خبرت می‌کنیم' : 'قاعده ذخیره شد'); onClose(); };
  return html`<${Modal} title=${rule.id ? 'ویرایش قاعده' : 'قاعدهٔ تازه'} onClose=${onClose} footer=${html`<button class="btn primary" disabled=${!ok} onClick=${save}>ذخیره</button><button class="btn ghost" onClick=${onClose}>انصراف</button>`}>
    <div class="field"><label>نام</label><input class="input" value=${r.name} placeholder="مثلاً صندوق طلای ارزان" onInput=${(e) => setR({ ...r, name: e.target.value })} /></div>
    <div class="field"><label>روی چه چیزی</label><${Seg} value=${r.kind} onChange=${setKind} options=${[['stock', 'سهام'], ['fund', 'صندوق']]} /></div>
    ${r.kind === 'fund' && html`<div class="field"><label>نوع صندوق</label><select class="input" value=${r.ftype || ''} onChange=${(e) => setR({ ...r, ftype: e.target.value ? +e.target.value : undefined })}>
      <option value="">همه</option>${Object.entries(RD.FUND_KIND).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></div>`}
    ${r.kind === 'stock' && html`<div class="field"><label>گروه صنعت</label><select class="input" value=${r.sector || ''} onChange=${(e) => setR({ ...r, sector: e.target.value || undefined })}>
      <option value="">همهٔ گروه‌ها</option>${Object.entries(sectors).filter(([, t]) => !/حذف شده|اوراق|صندوق/.test(t)).sort((a, b) => a[1].localeCompare(b[1], 'fa')).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></div>`}
    <div class="col" style="gap:8px"><span class="small sb">شرط‌ها (همه باید برقرار باشند)</span>
      ${r.conds.map((c, i) => html`<div class="row" style="gap:6px">
        <select class="input" style="flex:2" aria-label="معیار" value=${c.f} onChange=${(e) => setCond(i, { f: e.target.value })}>${Object.entries(F).map(([k, x]) => html`<option value=${k}>${x.t}</option>`)}</select>
        <select class="input" style="flex:1" aria-label="مقایسه" value=${c.op} onChange=${(e) => setCond(i, { op: e.target.value })}><option value=">=">حداقل</option><option value="<=">حداکثر</option></select>
        <div style="flex:1"><${NumField} value=${c.v} onInput=${(v) => setCond(i, { v })} suffix=${F[c.f]?.pct ? '٪' : ''} digits=${2} allowNegative /></div>
        ${r.conds.length > 1 && html`<button class="btn icon sm ghost" aria-label="حذف شرط" onClick=${() => setR({ ...r, conds: r.conds.filter((_, k) => k !== i) })}><${Icon} n="x" cls="sm" /></button>`}
      </div>`)}
      ${r.conds.length < 4 && html`<button class="btn sm ghost" style="align-self:flex-start" onClick=${() => setR({ ...r, conds: [...r.conds, { f: Object.keys(F)[0], op: '>=', v: 0 }] })}><${Icon} n="plus" cls="sm" />شرط دیگر</button>`}
      <span class="xs muted">${r.kind === 'stock' ? 'بازدهی‌ها و فاصله از سقف و کف به درصدند؛ «فاصله از بالاترین سال» منفی است (مثلاً −۳۰ یعنی ۳۰٪ زیر سقف).' : 'بازدهی‌ها به درصدند و از فیپیران می‌آیند؛ حباب فقط برای صندوق‌های قابل معامله.'}</span>
    </div>
    <label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" checked=${!!r.notify} onChange=${(e) => setR({ ...r, notify: e.target.checked })} />وقتی نماد تازه‌ای از این فیلتر رد شد خبرم کن</label>
  </${Modal}>`;
}

function Marks({ radar, user, s, openPrice }) {
  const [edit, setEdit] = useState(null);
  if (!user.marks.length) return html`<div class="card"><div class="empty small" style="padding:20px">روی ➕ هر کارت بزن تا اینجا ببینی از آن روز به بعد چه کرده.</div></div>`;
  return html`<div class="card"><div class="card-h"><h3><${Icon} n="target" cls="sm" />پیگیری</h3><span class="sub">تغییر قیمت از روزی که نشانش کردی</span></div>
    <div class="list">${user.marks.map((m) => {
      const ch = RD.changeSince(radar, m.id, m.day, m.price);
      const bi = m.day ? RD.benchRet(radar, RD.dayNum(radar.day) - RD.dayNum(m.day)) : null;
      const a = m.alert || {}; const has = a.above > 0 || a.below > 0 || a.fall > 0;
      const fired = Object.keys(m.fired || {}).length > 0;
      return html`<div class="rd-mark"><div class="it">
        <button class="rd-name grow" onClick=${() => m.ref && openPrice(m.ref)}><b>${m.sym || m.name}</b><span class="xs muted">${m.sym ? m.name + '، ' : ''}نشان‌شده ${m.day ? fmtJ(m.day) : ''}${bi?.index !== null && bi?.index !== undefined && m.day !== radar.day ? `؛ شاخص کل در همین مدت ${pctTxt(bi.index, 1)}` : ''}</span></button>
        <span class=${'small num ' + (ch > 0 ? 'pos' : ch < 0 ? 'neg' : '')}>${ch === null ? '—' : pctTxt(ch, 1)}</span>
        <button class=${'btn icon sm ghost' + (has ? ' on' : '')} title=${has ? 'هشدار قیمت (روشن)' : 'هشدار قیمت'} aria-label=${'هشدار قیمت برای ' + (m.sym || m.name)} aria-expanded=${edit === m.id ? 'true' : 'false'} onClick=${() => setEdit(edit === m.id ? null : m.id)}><${Icon} n="bell" cls=${has ? 'sm' : 'sm faint'} /></button>
        <button class="btn icon sm ghost" aria-label=${'برداشتن ' + (m.sym || m.name)} title="برداشتن" onClick=${() => act.toggleRadarMark(m)}><${Icon} n="x" cls="sm" /></button></div>
        ${has && edit !== m.id && html`<div class="xs muted rd-alert-sum">${alertText(m, s)}${fired ? html` <span class="pill live">رسید</span>` : ''}</div>`}
        ${edit === m.id && html`<${AlertEdit} m=${m} s=${s} price=${RD.priceOf(radar, m.id)} onDone=${() => setEdit(null)} />`}
      </div>`;
    })}</div>
    <div class="xs muted" style="margin-top:8px">قیمت سهام تعدیل‌شده است؛ برای صندوق‌های غیربورسی NAV ابطال. هشدارها با قیمت پایانی هر جلسه سنجیده می‌شوند.</div></div>`;
}

/** A stock's year in a small line, where today's price sits between its low and high, and its returns; a fund's returns. */
function Viz({ kind, m, rec, day, s, compact = false }) {
  if (!m) return null;
  // a fund: only its returns over each period are known (Fipiran publishes no daily NAV) — the same row as a stock's
  if (kind === 'fund') return html`<${Rets} items=${[['۱ ماه', m.m1], ['۳ ماه', m.m3], ['۶ ماه', m.m6], ['۱۲ ماه', m.y1]]} />`;
  const v = rec && day ? RD.spark(rec, RD.dayNum(day)) : [];
  const up = v.length > 1 && v[v.length - 1] >= v[0];
  return html`<div class=${'rd-viz' + (compact ? ' compact' : '')}>
    ${v.length > 1 && html`<div class="rd-spark" title="روند یک سال (قیمت تعدیل‌شده)" aria-hidden="true"><${Sparkline} values=${v} w=${compact ? 110 : 132} h=${compact ? 32 : 38} color=${up ? 'var(--pos)' : 'var(--neg)'} /></div>`}
    <div class="grow" style="min-width:0"><${YearBar} pos=${RD.yearPos(m)} lo=${m.lo52} hi=${m.hi52} fmt=${(x) => `${money(x, s)} (تعدیل‌شده)`} /></div>
  </div>${!compact && html`<${Rets} items=${[['۱ ماه', m.ret30], ['۳ ماه', m.ret91], ['۶ ماه', m.ret182], ['۱۲ ماه', m.ret365]]} />`}`;
}

/** A small row of returns: «۱ ماه +۲۸٪ · ۳ ماه +۱۹۶٪ · …» (unknown periods left out). */
function Rets({ items }) {
  const l = items.filter(([, v]) => v !== null && v !== undefined && isFinite(v));
  if (!l.length) return null;
  return html`<div class="rd-rets">${l.map(([t, v]) => html`<span><span class="muted">${t}</span> <b class=${'num ' + (v > 0.0005 ? 'pos' : v < -0.0005 ? 'neg' : '')}>${pctTxt(v)}</b></span>`)}</div>`;
}

/** Quick search over every stock and fund in the radar. «/» focuses it from anywhere on the page. */
function RadarSearch({ radar, openPrice, today }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inp = useRef(null);
  const res = useMemo(() => RD.search(radar, q, 10), [radar, q]);
  const inRadar = useMemo(() => new Set((today?.cards || []).map((c) => c.id)), [today]);
  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    const k = (e) => {
      const t = document.activeElement;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) return;
      if (document.querySelector('.drawer, .modal')) return; // a page or dialog is open on top
      e.preventDefault(); inp.current?.focus();
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const go = (x) => { setOpen(false); openPrice(x.ref); };
  const show = open && q.trim().length > 0;
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!show) { setOpen(true); return; } setHi((h) => Math.min(res.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (show) setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && show && res[hi]) { e.preventDefault(); go(res[hi]); }
    else if (e.key === 'Escape') { if (show) setOpen(false); else if (q) setQ(''); else inp.current?.blur(); }
  };
  return html`<div class="rd-search">
    <label class="rd-sbox"><${Icon} n="search" cls="sm" />
      <input ref=${inp} type="search" role="combobox" aria-label="جست‌وجوی نماد یا صندوق" aria-expanded=${show ? 'true' : 'false'} aria-controls=${show ? 'rd-sres' : undefined} aria-autocomplete="list"
        aria-activedescendant=${show && res[hi] ? 'rd-so-' + hi : undefined} placeholder="جست‌وجوی نماد یا صندوق؛ مثلاً فولاد، طلا، اهرم" value=${q}
        onInput=${(e) => { setQ(e.target.value); setOpen(true); }} onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 150)} onKeyDown=${onKey} autocomplete="off" spellcheck="false" />
      ${q ? html`<button type="button" class="btn icon sm ghost" title="پاک کردن" aria-label="پاک کردن جست‌وجو" onMouseDown=${(e) => e.preventDefault()} onClick=${() => { setQ(''); inp.current?.focus(); }}><${Icon} n="x" cls="sm" /></button>`
        : html`<kbd class="xs" title="میان‌بر: از هر جای این صفحه / را بزن">/</kbd>`}</label>
    <div class="sr-only" aria-live="polite">${show ? (res.length ? `${num(res.length)} نتیجه؛ با کلیدهای بالا و پایین انتخاب کن` : 'نتیجه‌ای پیدا نشد') : ''}</div>
    ${show && html`<div class="rd-sres" id="rd-sres" role="listbox" aria-label="نتیجه‌ها">
      ${res.length ? res.map((x, i) => html`<${Hit} x=${x} i=${i} on=${i === hi} radar=${radar} live=${inRadar.has(x.id)} onHover=${() => setHi(i)} onPick=${() => go(x)} />`)
        : html`<div class="empty small" style="padding:14px">نمادی با «${q.trim()}» پیدا نشد.</div>`}
    </div>`}
  </div>`;
}
function Hit({ x, i, on, radar, live, onHover, onPick }) {
  const rep = useMemo(() => RD.report(radar, x.kind === 'stock' ? { ins: x.ins } : { fundKey: x.key }), [radar, x.id]);
  const m = rep?.m;
  const v = x.kind === 'stock' && radar.stocks?.[x.ins] ? RD.spark(radar.stocks[x.ins], RD.dayNum(radar.day), 32) : [];
  const nums = !m ? '' : x.kind === 'stock' ? `۱۲ ماه ${pctTxt(m.ret365)}، ۳ ماه ${pctTxt(m.ret91)}${m.pe !== null ? `، P/E ${num(m.pe, 1)}` : ''}`
    : `۱۲ ماه ${pctTxt(m.y1)}، ۳ ماه ${pctTxt(m.m3)}${m.bubble !== null ? `، حباب ${pctTxt(m.bubble, 1)}` : ''}`;
  return html`<button type="button" class=${'rd-sitem' + (on ? ' on' : '')} id=${'rd-so-' + i} role="option" aria-selected=${on ? 'true' : 'false'} tabindex="-1"
    onMouseEnter=${onHover} onMouseDown=${(e) => e.preventDefault()} onClick=${onPick}>
    <span class="rd-s-name"><span class="row" style="gap:6px"><b>${x.sym || x.name}</b><span class="pill">${x.kind === 'stock' ? 'سهم' : 'صندوق'}</span>${live && html`<span class="pill auto">در رادار امروز</span>`}</span>
      <span class="xs muted ellipsis">${x.sym ? x.name : ''}${x.sub ? (x.sym ? '، ' : '') + x.sub : ''}</span></span>
    <span class="xs num muted rd-s-nums">${nums}</span>
    ${v.length > 1 ? html`<span aria-hidden="true"><${Sparkline} values=${v} w=${72} h=${24} fill=${false} color=${v[v.length - 1] >= v[0] ? 'var(--pos)' : 'var(--neg)'} /></span>` : html`<span></span>`}
  </button>`;
}

/** «دارایی‌های تو در رادار»: the owner's own stocks and funds with today's numbers, the cards they're in, and what to watch. */
function Mine({ radar, st, s, cards, depositPct, openPrice }) {
  const refs = useMemo(() => RD.holdRefs(st.assets, E.isLiability), [st.assets]);
  const items = useMemo(() => RD.mine(radar, refs, { depositPct, cards }), [radar, refs, depositPct, cards]);
  const share = useMemo(() => {
    if (!items.length) return {};
    const pf = E.portfolio(st.assets, st.quotes, s);
    const byId = new Map(pf.rows.map((r) => [r.asset.id, Math.max(0, r.value)]));
    return Object.fromEntries(items.map((x) => [x.id, pf.gross > 0 ? x.hold.assets.reduce((t, id) => t + (byId.get(id) || 0), 0) / pf.gross : null]));
  }, [items, st.assets, st.quotes, s]);
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const warned = items.filter((x) => x.flags.some((f) => f.warn)).length;
  const shown = all || items.length <= 6 ? items : items.slice(0, 6);
  return html`<section class="rd-sec">
    <div class="rd-sec-h"><h4>دارایی‌های تو در رادار</h4><span class="xs muted">${warned ? `${num(warned)} مورد نکته‌ای دارد که بهتر است نگاهی بیندازی` : 'سهم‌ها و صندوق‌هایی که داری، با عددهای همین جلسه'}</span></div>
    <div class="card rd-mine">${shown.map((x) => html`<div class="rd-mrow">
      <button class="rd-name" onClick=${() => openPrice(x.ref)} title="نمودار و کارنامه">
        <b>${x.sym || x.name}</b><span class="xs muted ellipsis">${x.sym && x.name ? x.name : ''}${share[x.id] > 0 ? `${x.sym && x.name ? '، ' : ''}${pctTxt(share[x.id], share[x.id] < 0.1 ? 1 : 0).replace('+', '')} از دارایی‌هایت` : ''}</span></button>
      <div class="rd-mviz">${x.missing ? html`<span class="xs muted">${x.note}</span>` : html`<${Viz} kind=${x.kind} m=${x.m} rec=${x.kind === 'stock' ? radar.stocks?.[x.id.slice(2)] : null} day=${radar.day} s=${s} compact />`}</div>
      <div class="rd-mflags">
        ${x.sigs.map((g) => html`<span class="pill auto" title=${SIG_D[g]}>${RD.SIGNALS[g].t}</span>`)}
        ${x.flags.map((f) => html`<span class=${'pill' + (f.warn ? ' stale' : '')}>${f.warn && html`<${Icon} n="alert" cls="xs" />`}${f.t}</span>`)}
        ${!x.missing && !x.sigs.length && !x.flags.length && html`<span class="xs muted">امروز نکتهٔ خاصی ندارد</span>`}
      </div>
    </div>`)}
    ${items.length > 6 && html`<button class="btn sm ghost" style="align-self:center" onClick=${() => setAll(!all)}>${all ? 'کمتر' : `همه (${num(items.length)})`}</button>`}
    </div></section>`;
}

const alertText = (m, s) => {
  const a = m.alert || {}; const f = m.fired || {};
  return [a.above > 0 && `بالاتر از ${money(a.above, s)}${f.above ? ' ✓' : ''}`, a.below > 0 && `پایین‌تر از ${money(a.below, s)}${f.below ? ' ✓' : ''}`,
    a.fall > 0 && `${num(a.fall)}٪ افت از روز نشان‌گذاری${f.fall ? ' ✓' : ''}`].filter(Boolean).join(' · ') || '';
};
/** Set or clear a followed item's price alerts. Saving re-arms them (an alert goes off once). */
function AlertEdit({ m, s, price, onDone }) {
  const [a, setA] = useState({ above: m.alert?.above || null, below: m.alert?.below || null, fall: m.alert?.fall || null });
  const save = async (clear = false) => {
    const alert = clear ? null : { above: a.above > 0 ? a.above : null, below: a.below > 0 ? a.below : null, fall: a.fall > 0 ? a.fall : null };
    const on = alert && (alert.above || alert.below || alert.fall);
    await act.setRadarUser((u) => ({ marks: u.marks.map((x) => (x.id === m.id ? { ...x, alert: on ? alert : null, fired: {} } : x)) }));
    toast(on ? 'هشدار ذخیره شد' : 'هشدار برداشته شد'); onDone();
  };
  const bad = a.above > 0 && a.below > 0 && a.below >= a.above;
  return html`<div class="rd-alert-ed">
    ${price > 0 && html`<div class="xs muted">قیمت پایانی آخرین جلسه: ${money(price, s)}</div>`}
    <div class="rd-alert-f">
      <${MoneyField} label="اگر رسید به بالاتر از" rial=${a.above} onRial=${(v) => setA({ ...a, above: v })} s=${s} />
      <${MoneyField} label="اگر رسید به پایین‌تر از" rial=${a.below} onRial=${(v) => setA({ ...a, below: v })} s=${s} err=${bad ? 'باید کمتر از حد بالا باشد' : ''} />
      <${NumField} label="اگر از روز نشان‌گذاری افت کرد" value=${a.fall} onInput=${(v) => setA({ ...a, fall: v })} suffix="٪" digits=${0} placeholder="مثلاً ۱۰" />
    </div>
    <div class="row" style="gap:6px"><button class="btn sm primary" disabled=${bad} onClick=${() => save(false)}>ذخیره</button>
      ${(m.alert) && html`<button class="btn sm ghost" onClick=${() => save(true)}>برداشتن هشدار</button>`}
      <span class="grow"></span><button class="btn sm ghost" onClick=${onDone}>انصراف</button></div>
    <div class="xs muted">هر هشدار یک بار خبرت می‌کند؛ با ذخیرهٔ دوباره، از نو فعال می‌شود. اعلانش با «هشدارهای قیمت و حباب» در تنظیمات است.</div>
  </div>`;
}
