// «برترین هر بخش، امروز»: at the top of the radar, the single best pick of each part of it — growth, trend, money
// coming in, value, equity funds, the cheapest way into gold, fixed income, a fund under its NAV. «Best» is the section's
// own rule, then the combined score among stocks that carry no severe red flag. Each tile: the one number that matters,
// why, its red flags, how that section did in the record, and the way to check it against the owner's money.
import { html, Icon, Tip, num, fmtJ } from './components.js';
import { ago } from '../lib/format.js';
import * as RD from '../lib/radar.js';

const pctTxt = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x * 100), d)}٪`);
const TIP = 'برای هر بخش رادار فقط یک گزینه: همان که قاعدهٔ آن بخش بالاتر گذاشته، و بین سهم‌ها آن که امتیاز ترکیبی بیشتری دارد و پرچم قرمز جدی ندارد. زیر هر کدام کارنامهٔ همان بخش آمده: در گذشته چند درصد مواقع یک ماه بعد از شاخص جلوتر بوده. بخشی که در گذشته جواب نداده با برچسب نشان داده می‌شود. اینجا ترکیب و درصد تقسیم نیست؛ برای اینکه یک گزینه با پول و سبد خودت جور هست یا نه، «به سبد من می‌خورد؟» را بزن.';

// each tile: which sections feed it, its title, and the headline number of its pick
const TILES = [
  { id: 'growth', t: 'کاندیدای رشد', sigs: ['cand'], head: (c) => `${num((c.checks || []).filter((x) => x.on && !x.weak).length)} نشانه از ۵`, icon: 'sparkles' },
  { id: 'trend', t: 'قوی‌ترین روند', sigs: ['breakout', 'strength', 'momentum3'], head: (c) => (c.m?.rel91 !== null && c.m?.rel91 !== undefined ? `۳ ماه ${pctTxt(c.m.rel91)} جلوتر از شاخص` : `۳ ماه ${pctTxt(c.m?.ret91)}`), icon: 'chart' },
  { id: 'money', t: 'بیشترین ورود پول حقیقی', sigs: ['flowRun', 'buyerPower', 'inflow'], head: (c) => (c.m?.flowPos7 ? `${num(c.m.flowPos7)} جلسه از ${num(c.m.flowN7)} ورود پول` : c.m?.flowShare5 ? `${pctTxt(c.m.flowShare5)} ارزش معاملات` : 'ورود پول'), icon: 'cash' },
  { id: 'value', t: 'ارزنده‌ترین سهم', sigs: ['cheap'], head: (c) => (c.m?.pe ? `P/E ${num(Math.round(c.m.pe * 10) / 10, 1)} (گروه ${num(Math.round((c.m.sectorPE || 0) * 10) / 10, 1)})` : ''), icon: 'percent' },
  { id: 'fund', t: 'بهترین صندوق سهامی', sigs: ['topFund'], fund: (c) => /سهامی|شاخصی|بخشی|اهرمی/.test(c.sub || ''), head: (c) => `بازده ۱۲ ماه ${pctTxt(c.m?.y1)}`, icon: 'layers' },
  { id: 'fixed', t: 'بهترین درآمد ثابت', sigs: ['fixedBeat'], head: (c) => `بازده ۱۲ ماه ${pctTxt(c.m?.y1)}`, icon: 'shield' },
  { id: 'nav', t: 'صندوق زیر ارزش واقعی', sigs: ['negBubble'], head: (c) => `${num(Math.abs(Math.round((c.m?.bubble || 0) * 1000)) / 10, 1)}٪ ارزان‌تر از NAV`, icon: 'target' },
];

export function BestOfRadar({ radar, built, gold, s, openPrice, onFit }) {
  const weak = built.weak || new Set();
  const taken = new Set();
  const tiles = TILES.map((t) => { const c = RD.bestOf(built.cards, t, weak, taken); if (c) taken.add(c.id); return { t, c }; }).filter((x) => x.c);
  // gold: the cheapest way in today, over coins, 18k and the gold funds
  const g = gold ? [...(gold.rows || []), ...(gold.funds || []).slice(0, 1)].sort((a, b) => a.buy - b.buy)[0] : null;
  if (!tiles.length && !g) return null;
  const rec = (sig) => { const r = built.records?.[sig]?.use; return r && r.hit !== null && r.hit !== undefined ? { hit: r.hit, n: r.n, weak: !!built.records[sig].weak, test: !!r.test } : null; };
  return html`<section class="rd-sec bo">
    <div class="rd-sec-h"><h4>برترین هر بخش، امروز</h4><${Tip} title="برترین هر بخش" text=${TIP} /><span class="xs muted">از هر بخش رادار، بهترین گزینهٔ امروز؛ پیشنهاد خرید نیست، نقطهٔ شروع بررسی است.</span></div>
    <div class="bo-grid">
      ${tiles.map(({ t, c }) => { const r = rec(c.sig); return html`<article class="card bo-tile">
        <div class="row between" style="gap:6px"><span class="xs sb muted"><${Icon} n=${t.icon} cls="xs" /> ${t.t}</span>${c.kind === 'stock' && c.score !== undefined && html`<span class="bo-score" title="امتیاز ترکیبی رادار">${num(Math.round(c.score))}</span>`}</div>
        <button class="bo-name" onClick=${() => openPrice(c.ref)}><b>${c.sym || c.name}</b>${c.sym && html`<span class="xs muted ellipsis">${c.name}</span>`}</button>
        <div class="bo-head">${t.head(c)}</div>
        <div class="xs muted bo-why">${c.why?.[0] || ''}</div>
        ${c.kind === 'fund' && c.m?.navDay && html`<div class="xs faint">NAV ${c.m.navSrc === 'tsetmc' ? 'بورس تهران' : 'فیپیران'} تا ${fmtJ(c.m.navDay)}</div>`}
        ${c.flags?.length > 0 && html`<div class="rd-flags">${c.flags.slice(0, 2).map((f) => html`<span class="rd-flag"><${Icon} n="alert" cls="xs" />${f.t}</span>`)}</div>`}
        ${c.stop?.price > 0 && html`<div class="xs faint">باطل زیر قیمت ${num(Math.round(c.stop.price / (s.currency === 'rial' ? 1 : 10)))} ${s.currency === 'rial' ? 'ریال' : 'تومان'}</div>`}
        ${r ? html`<div class=${'xs bo-rec ' + (r.weak ? 'bad' : r.hit >= 0.5 ? 'good' : '')}>${r.weak ? 'این بخش در گذشته جواب نداده؛ ' : ''}کارنامهٔ بخش: ${num(Math.round(r.hit * 100))}٪ مواقع جلوتر از شاخص${r.test ? ' (آزمون روی گذشته)' : ''}</div>` : c.kind === 'stock' ? html`<div class="xs faint">کارنامهٔ این بخش هنوز کافی نیست</div>` : ''}
        <div class="row" style="gap:6px;margin-top:auto"><button class="btn sm ghost" onClick=${() => openPrice(c.ref)}><${Icon} n="chart" cls="sm" />نمودار</button>
          <button class="btn sm ghost" onClick=${() => onFit(c)}><${Icon} n="layers" cls="sm" />به سبد من می‌خورد؟</button></div>
      </article>`; })}
      ${g && html`<article class="card bo-tile">
        <span class="xs sb muted"><${Icon} n="gold" cls="xs" /> ارزان‌ترین راه طلا</span>
        <div class="bo-name" style="cursor:default"><b>${g.name}</b></div>
        <div class="bo-head">${g.kind === 'etf' ? `حباب ${pctTxt(g.bubble, 1)}` : `${pctTxt(g.premium, 1)} نسبت به طلای جهانی`}</div>
        <div class="xs muted bo-why">با هزینهٔ خرید و فروش، ${pctTxt(g.buy, 1)} نسبت به ارزش طلای داخلش؛ ارزان‌ترین بین سکه‌ها، طلای ۱۸ عیار و صندوق‌های طلا</div>
        ${g.ref && html`<div class="row" style="gap:6px;margin-top:auto"><button class="btn sm ghost" onClick=${() => openPrice(g.ref)}><${Icon} n="chart" cls="sm" />نمودار</button></div>`}
      </article>`}
    </div>
    <div class="xs faint bo-fresh">جلسهٔ ${fmtJ(radar.day)}${radar.at > 1e12 && radar.at <= Date.now() ? `؛ آخرین بررسی رادار ${ago(radar.at)}` : ''}${radar.fundsAt > 1e12 && radar.fundsAt <= Date.now() ? `؛ فهرست صندوق‌ها ${ago(radar.fundsAt)}` : ''}${gold ? '؛ قیمت طلا و سکه از به‌روزرسانی قیمت‌ها' : ''}. هر ۱۵ دقیقه (تا وقتی کروم باز است) دوباره بررسی می‌شود.</div>
  </section>`;
}
