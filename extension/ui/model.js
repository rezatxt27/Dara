// «سبد مدل امروز» at the top of the radar: one diversified model for each risk level — its parts, why each, its numbers
// against the markets, what changed since the last model, and its own record. The rules are in lib/model.js.
import { html, useState, useMemo, Icon, Money, Tip, num, pct, fmtJ } from './components.js';
import * as MD from '../lib/model.js';
import * as PR from '../lib/profile.js';
import * as PB from '../lib/builder.js';
import { usePast } from './committee.js';
import * as I from '../lib/insights.js';

const P = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : pct(Math.abs(x) < 0.5 * Math.pow(10, -2 - d) ? 0 : x, { digits: d }));
const P0 = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : pct(x, { sign: false, digits: d }));
const TIP = 'سبد مدل از قاعده ساخته می‌شود، نه از پیش‌بینی: سهم هر بخش (درآمد ثابت، طلا، بورس، دلار، رمزارز) همان ترکیب سطح ریسکی است که پروفایل و کمیته به کار می‌برند. در هر بخش ابزار با قاعدهٔ روشن انتخاب می‌شود: درآمد ثابت با بازده بیشتر از سپرده (دو صندوق از دو مدیر وقتی سهم بزرگ است)، صندوق طلای پرمعامله با کمترین حباب، صندوق سهامی یا شاخصی، و حداکثر ۳ کاندیدای رشد رادار از صنعت‌های مختلف با سقف ۸٪ برای هر سهم. انتخاب‌ها تا وقتی واضحاً بدتر نشده‌اند (زیر قیمت باطل‌شدن، پرچم قرمز جدی، از دست دادن شرط) می‌مانند تا سبد هر روز عوض نشود. «۱۲ ماه گذشته» آزمون انتخاب‌های امروز روی گذشته است و خوش‌بینانه است؛ کارنامهٔ واقعی از روز اول ثبت می‌شود.';

export function ModelCard({ radar, built, st, s, openPrice, onFit }) {
  const mine = PR.riskLevel(s.profile);
  const [lv, setLv] = useState(mine || 'mid');
  const R = usePast(st);
  const depositPct = I.defaultDepositPct(st);
  const noCrypto = !!s.profile?.noCrypto;
  const model = useMemo(() => {
    const saved = radar.model?.levels?.[lv];
    const prev = !saved ? null : radar.model.day === radar.day ? saved.prev || null : saved;
    return MD.buildModel(radar, built, lv, { prev, depositPct, noCrypto });
  }, [radar, built, lv, depositPct, noCrypto]);
  const stats = useMemo(() => MD.modelStats(model, radar, { R, depositPct }), [model, R]);
  const rec = useMemo(() => MD.modelRecord(radar, lv, st.quotes), [radar, lv, st.quotes]);
  if (!model) return null;
  // «آزمایشی» until its own record covers PROVEN_DAYS; then that record, not the test on the past, leads
  const proven = rec?.pct !== null && rec?.pct !== undefined && rec.days >= MD.PROVEN_DAYS;
  const core = model.items.filter((i) => i.role !== MD.ROLE.sat), sat = model.items.filter((i) => i.role === MD.ROLE.sat);
  const corrWord = (c) => (c === null ? '' : c < 0.25 ? 'کم' : c < 0.5 ? 'متوسط' : 'زیاد');
  const m = stats?.markets || {};
  return html`<section class="rd-sec md">
    <div class="rd-sec-h"><h4>سبد مدل امروز</h4>${!proven && html`<span class="pill stale" title=${`تا وقتی کارنامهٔ واقعی این سبد کمتر از ${num(MD.PROVEN_DAYS)} روز است`}>آزمایشی</span>`}<${Tip} title="سبد مدل" text=${TIP} /><span class="xs muted">یک ترکیب متنوع از همین رادار، برای هر سطح ریسک؛ مدل است، نه پیشنهاد خرید.</span></div>
    <div class="card md-card">
      <div class="row between wrap" style="gap:8px">
        <div class="seg" role="tablist">${MD.LEVELS.map((l) => html`<button role="tab" aria-selected=${lv === l ? 'true' : 'false'} class=${lv === l ? 'on' : ''} onClick=${() => setLv(l)}>ریسک ${PR.RISK[l]}${mine === l ? ' ✓' : ''}</button>`)}</div>
        <span class="xs muted">${mine ? (mine === lv ? 'مطابق پروفایلت' : `پروفایلت: ریسک ${PR.RISK[mine]}`) : 'پروفایل ریسک تعیین نشده'} · ${fmtJ(model.day)}</span>
      </div>

      <div class="md-stats">
        <div><span class="xs muted">${proven ? `کارنامهٔ واقعی از ${fmtJ(rec.since)}` : 'کارنامهٔ واقعی'}</span>
          ${rec?.pct !== null && rec?.pct !== undefined ? html`<b class=${'num ' + (proven ? (rec.pct > 0 ? 'pos' : rec.pct < 0 ? 'neg' : '') : 'md-dim')}>${P(rec.pct, 1)}</b><span class="xs muted">${num(rec.days)} روز${proven ? '' : '؛ هنوز کم است'}</span>` : html`<b class="md-dim">—</b><span class="xs muted">از امروز ثبت می‌شود</span>`}
          <span class="xs faint">آزمون ۱۲ ماه روی گذشته: ${P(stats?.y1)} (خوش‌بینانه)؛ همین مدت شاخص ${P(m.index)}${m.gold !== null ? `، طلا ${P(m.gold)}` : ''}${m.usd !== null ? `، دلار ${P(m.usd)}` : ''}، سپرده ${P(m.deposit)}</span></div>
        <div><span class="xs muted">بدترین ماه</span><b class=${'num ' + (stats?.worst < 0 ? 'neg' : '')}>${P(stats?.worst, 1)}</b><span class="xs muted">${stats?.vol !== null && stats?.vol !== undefined ? `نوسان سالانه ${P0(stats.vol)}` : 'تاریخچهٔ بازارها هنوز نیامده'}</span></div>
        <div><span class="xs muted">هم‌حرکتی اجزا</span><b>${stats?.avgCorr !== null ? `${corrWord(stats.avgCorr)} (${num(Math.round(stats.avgCorr * 100) / 100, 2)})` : '—'}</b><span class="xs muted">${num(stats?.blocks || 0)} بخش${stats?.sectors ? `، ${num(stats.sectors)} صنعت` : ''}</span></div>
        <div><span class="xs muted">محافظت از تورم</span><b class="num">${P0(stats?.protectedShare)}</b><span class="xs muted">هزینهٔ خرید حدود ${P0(stats?.cost, 1)}</span></div>
      </div>
      <div class="cmt-bar md-bar">${PB.CLASSES.filter((c) => model.blocks[c.id] > 0).map((c) => html`<i style=${`flex:${model.blocks[c.id]};background:${c.color}`} title=${`${c.short} ${P0(model.blocks[c.id])}`}></i>`)}</div>
      <div class="cmt-split xs">${PB.CLASSES.filter((c) => model.blocks[c.id] > 0).map((c) => html`<span><i style=${`background:${c.color}`}></i>${c.short} ${P0(model.blocks[c.id])}</span>`)}</div>

      <div class="md-group"><div class="xs sb muted">هسته: ابزارهای پهن و کم‌هزینه</div>${core.map((it) => html`<${Row} it=${it} s=${s} openPrice=${openPrice} />`)}</div>
      ${sat.length > 0 && html`<div class="md-group"><div class="xs sb muted">ماهواره: کاندیداهای رشد رادار، از صنعت‌های مختلف، حداکثر ${P0(MD.MAX_STOCK)} هرکدام</div>${sat.map((it) => html`<${Row} it=${it} s=${s} openPrice=${openPrice} />`)}</div>`}

      ${model.changes && (model.changes.added.length > 0 || model.changes.removed.length > 0) && html`<div class="md-chg xs"><${Icon} n="refresh" cls="xs" /><span>از ${fmtJ(model.changes.since)}:
        ${model.changes.added.length > 0 && html` آمد: ${model.changes.added.join('، ')}.`}${model.changes.removed.map((r) => html` رفت: ${r.name} (${r.why}).`)}</span></div>`}
      ${model.notes.map((n) => html`<div class="xs muted"><${Icon} n="info" cls="xs" /> ${n}</div>`)}
      <div class=${'rd-track' + (rec?.pct > 0 ? ' good' : rec?.pct < 0 ? ' bad' : '')}><${Icon} n="chart" cls="xs" /><span>${rec?.pct !== null && rec?.pct !== undefined
        ? html`کارنامهٔ واقعی همین سبد مدل از ${fmtJ(rec.since)} (${num(rec.days)} روز): <b>${P(rec.pct, 1)}</b>${rec.unpriced ? '؛ بخشی که قیمت روزانه ندارد ثابت حساب شده' : ''}.`
        : 'کارنامهٔ واقعی این سبد از امروز ثبت می‌شود؛ هر هفته و با هر تغییر، با قیمت‌های همان روز.'} «۱۲ ماه گذشته» آزمون انتخاب‌های امروز روی گذشته است و خوش‌بینانه است${stats?.approx ? '؛ صندوق‌ها با بازار خودشان (شاخص یا طلا) تقریب زده شده‌اند' : ''}.</span></div>
      <div class="row wrap" style="gap:6px">
        <button class="btn sm primary" onClick=${() => onFit?.(lv)}><${Icon} n="layers" cls="sm" />به سبد من می‌خورد؟</button>
        <span class="xs faint grow">مدل است، نه پیشنهاد خرید؛ تصمیم با توست.</span>
      </div>
    </div>
  </section>`;
}

function Row({ it, s, openPrice }) {
  const name = it.sym || it.name;
  return html`<div class="md-row">
    <span class="md-w num">${P0(it.w)}</span>
    <div class="grow" style="min-width:0">
      <div class="row wrap" style="gap:6px;align-items:baseline">${it.ref && openPrice ? html`<button class="calc-link sb" onClick=${() => openPrice(it.ref)}>${name}</button>` : html`<span class="sb">${name}</span>`}
        ${it.sym && it.name !== it.sym && html`<span class="xs muted ellipsis" style="max-width:220px">${it.name}</span>`}
        <span class="md-role xs">${it.role}</span>${it.kept && html`<span class="xs faint">از قبل مانده</span>`}${it.sector && html`<span class="xs muted">${it.sector}</span>`}</div>
      <div class="xs muted">${(it.why || []).slice(0, 2).join('؛ ')}${it.liq ? `؛ نقد شدن: ${it.liq}` : ''}</div>
      ${it.stop > 0 && html`<div class="xs muted">باطل می‌شود اگر زیر <${Money} v=${it.stop} s=${s} /> بسته شود</div>`}
      ${it.flags?.length > 0 && html`<div class="rd-flags">${it.flags.map((f) => html`<span class="rd-flag"><${Icon} n="alert" cls="xs" />${f}</span>`)}</div>`}
    </div>
  </div>`;
}
