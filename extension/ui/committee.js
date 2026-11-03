// «کمیتهٔ سرمایه‌گذاری»: the card (in the assistant's answer, or on its own) and the window that runs it from other
// pages (سبدساز, a radar card). The numbers come from lib/committee.js; nothing here decides anything.
import { html, useState, useEffect, useMemo, Icon, Money, Modal, MoneyField, AskBtn, num, pct, fmtJ, send, useRadar } from './components.js';
import * as C from '../lib/committee.js';
import * as PB from '../lib/builder.js';
import * as RD from '../lib/radar.js';
import * as I from '../lib/insights.js';
import * as PR from '../lib/profile.js';

const P = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : pct(x, { sign: false, digits: d }));
// signed, and a rounding to nothing shown as a plain zero (not «−۰٪»)
const PS = (x, d = 0) => (x === null || x === undefined || !isFinite(x) ? '—' : pct(Math.abs(x) < 0.5 * Math.pow(10, -2 - d) ? 0 : x, { digits: d }));
const arrow = (a, b, d = 0) => html`<span class="num">${P(a, d)}</span> ← <b class="num">${P(b, d)}</b>`;

/**
 * The committee with its risk levels side by side: the owner's basis and low / mid / high, each a column; picking one
 * shows its four parts below. set: committeeSet(); a lone result (older saved answers) is shown as it is.
 */
export function CommitteeView({ set = null, c = null, s, openPrice = null }) {
  const variants = set?.variants || [];
  const [sel, setSel] = useState(variants[0]?.id || null);
  const cur = variants.find((v) => v.id === sel)?.c || set?.main || c;
  if (!cur) return null;
  return html`<div class="cmt-wrap">
    ${variants.length > 1 && html`<${RiskCompare} variants=${variants} sel=${sel} onSel=${setSel} />`}
    <${CommitteeCard} c=${cur} s=${s} openPrice=${openPrice} />
  </div>`;
}
function RiskCompare({ variants, sel, onSel }) {
  const rows = variants.map(C.variantRow);
  const hasPast = rows.some((r) => r.histBadPct !== null);
  return html`<div class="cmt-cmp" role="radiogroup" aria-label="ترکیب‌ها">
    <div class="xs muted" style="grid-column:1/-1">همین پول با ${variants.length === 4 ? 'چهار' : 'سه'} ترکیب. چون دارایی‌های فعلی‌ات هم حساب می‌شوند، پول تازه اول جاهای خالی هر ترکیب را پر می‌کند؛ برای همین تقسیم پول تازه با درصدهای خود ترکیب فرق دارد. روی هرکدام بزن تا جزئیاتش پایین بیاید.</div>
    ${rows.map((r) => html`<button class=${'cmt-col' + (sel === r.id ? ' on' : '')} role="radio" aria-checked=${sel === r.id ? 'true' : 'false'} onClick=${() => onSel(r.id)}>
      <span class="sb small">${r.name}</span>
      <span class=${'xs ' + (r.mine || r.fitsProfile ? 'acc' : 'muted')}>${r.mine ? 'مبنای خودت' : r.fitsProfile ? 'مطابق پروفایلت' : '\u00a0'}</span>
      <span class="cmt-bar">${PB.CLASSES.filter((k) => r.split[k.id] > 0.004).map((k) => html`<i style=${`flex:${r.split[k.id]};background:${k.color}`} title=${`${k.short} ${P(r.split[k.id])}`}></i>`)}</span>
      <span class="cmt-split xs">${PB.CLASSES.filter((k) => r.split[k.id] > 0.004).map((k) => html`<span><i style=${`background:${k.color}`}></i>${k.short} ${P(r.split[k.id])}</span>`)}</span>
      <span class="cmt-kv xs"><span class="muted">در فرض ریزش</span><b class=${'num ' + (r.stressPct < 0 ? 'neg' : '')}>${PS(r.stressPct, 0)}</b></span>
      ${hasPast && html`<span class="cmt-kv xs"><span class="muted">سال بد گذشته</span><b class="num">${PS(r.histBadPct, 0)}</b></span>`}
      <span class="cmt-kv xs"><span class="muted">محافظت از تورم</span><b class="num">${P(r.protAfter)}</b></span>
    </button>`)}
  </div>`;
}

/** The four parts. c: committee() result. openPrice: optional (a way in with a symbol opens its chart). */
export function CommitteeCard({ c, s, openPrice = null }) {
  if (!c) return null;
  const cash = c.cash;
  return html`<div class="cmt">
    <div class="cmt-h"><span class="ava sm" style="background:var(--accent-soft);color:var(--accent)"><${Icon} n="layers" cls="sm" /></span>
      <div class="grow"><div class="sb">کمیتهٔ سرمایه‌گذاری${c.focus ? html`: <span>${c.focus.sym || c.focus.name}</span>` : ''}</div>
        <div class="xs muted"><${Money} v=${c.amount} s=${s} compact />، ${c.source !== 'new' ? 'از موجودی حساب' : 'پول تازه'}، ${fmtJ(c.today)}</div></div></div>

    <section class="cmt-s"><h4><span class="cmt-n">۱</span>نیاز تو</h4>
      <div class="small">در ${num(cash.days)} روز آینده: پرداختی <${Money} v=${cash.out} s=${s} compact />${cash.in > 0 ? html`، دریافتی و سررسید <${Money} v=${cash.in} s=${s} compact />` : ''}؛ موجودی حساب‌ها <${Money} v=${cash.start} s=${s} compact />.</div>
      ${cash.reserve > 0
        ? html`<div class="cmt-key warn"><${Icon} n="alert" cls="sm" /><span><b><${Money} v=${cash.reserve} s=${s} compact /></b> نقد بماند: ${cash.lowDate ? html`بدون آن، حساب‌هایت در ${fmtJ(cash.lowDate)} حدود <${Money} v=${cash.shortfall} s=${s} compact /> کم می‌آورند` : 'برای پرداخت‌های پیش رو لازم است'}.</span></div>`
        : html`<div class="cmt-key ok"><${Icon} n="circleCheck" cls="sm" /><span>پرداخت‌های ${num(cash.days)} روز آینده از موجودی و دریافتی‌ها پوشش داده می‌شود؛ لازم نیست چیزی از این پول نقد بماند.</span></div>`}
      <div class="xs muted">قابل سرمایه‌گذاری: <b><${Money} v=${c.invest} s=${s} compact /></b>؛ مبنای تقسیم: ${c.basis.name}</div>
    </section>

    ${c.blocks.length > 0 && html`<section class="cmt-s"><h4><span class="cmt-n">۲</span>گزینه‌ها، با دادهٔ امروز</h4>
      ${c.blocks.map((b) => html`<div class="cmt-b">
        <div class="row between wrap" style="gap:6px"><b>${b.name}: <${Money} v=${b.add} s=${s} compact /> <span class="xs muted">(${P(b.share)} این پول)</span></b>
          <span class="xs muted">سهم از دارایی‌ها: ${arrow(b.before, b.after)}${b.target ? html`، هدف ${P(b.target)}` : ''}</span></div>
        ${b.options.map((o) => html`<div class="cmt-o">
          <div class="row" style="gap:6px">${o.ref && openPrice ? html`<button class="calc-link sb" onClick=${() => openPrice(o.ref)}>${o.sym || o.name}</button>` : html`<span class="sb">${o.sym || o.name}</span>`}${o.sym && o.name !== o.sym ? html`<span class="xs muted ellipsis">${o.name}</span>` : ''}</div>
          ${o.pros.map((t) => html`<div class="xs cmt-pro"><${Icon} n="check" cls="xs" />${t}</div>`)}
          ${o.cons.map((t) => html`<div class="xs cmt-con"><${Icon} n="minus" cls="xs" />${t}</div>`)}
          ${o.record && html`<div class="xs muted">${o.record}</div>`}
          ${o.stop && html`<div class="xs muted">باطل می‌شود اگر زیر <${Money} v=${o.stop} s=${s} /> بسته شود</div>`}
        </div>`)}
      </div>`)}
    </section>`}

    ${c.blocks.length > 0 && html`<section class="cmt-s"><h4><span class="cmt-n">۳</span>اثر روی سبد</h4>
      <div class="cmt-grid">
        <div><span class="xs muted">محافظت‌شده در برابر تورم</span><span>${arrow(c.impact.protBefore, c.impact.protAfter)}</span></div>
        ${c.impact.largest && html`<div><span class="xs muted">بزرگ‌ترین دارایی (${c.impact.largest.name})</span><span>${arrow(c.impact.largest.before, c.impact.largest.after)}</span></div>`}
        ${c.impact.devBefore !== null && c.impact.devAfter !== null && html`<div><span class="xs muted">بیشترین فاصله از ${c.basis.id === 'targets' ? 'هدف' : 'ترکیب مبنا'}</span><span>${arrow(c.impact.devBefore, c.impact.devAfter)}</span></div>`}
      </div>
    </section>`}

    ${c.wrong && html`<section class="cmt-s"><h4><span class="cmt-n">۴</span>اگر اشتباه باشد</h4>
      <div class="small">اگر در یک سال طلا و دلار ۱۵٪ و بورس ۳۰٪ بریزند (رمزارز ۵۰٪): <b class=${c.wrong.stress.loss < 0 ? 'neg' : ''}><${Money} v=${c.wrong.stress.loss} s=${s} compact sign /></b> <span class="xs muted">(${PS(c.wrong.stress.pct, 1)} مبلغ سرمایه‌گذاری‌شده)</span></div>
      ${c.wrong.history && html`<div class="small">در گذشتهٔ ${num(c.wrong.history.years)} سالهٔ بازارهای ایران، در بدترین ۱۰٪ سال‌ها همین ترکیب ${PS(c.wrong.history.badPct, 0)} و در یک سال معمولی ${PS(c.wrong.history.midPct, 0)} شد.</div>`}
      ${c.wrong.worst && html`<div class="small">پرریسک‌ترین بخش، ${c.wrong.worst.name}: ${c.wrong.worst.from === 'history' ? `بدترین ۱۲ ماهش در همین گذشته ${PS(c.wrong.worst.fall, 0)}` : `در فرض بالا ${PS(c.wrong.worst.fall, 0)}`}.</div>`}
      <div class="xs muted">همین پول در سپردهٔ ${num(c.depositPct)}٪ در یک سال حدود ${PS(c.wrong.depositPct, 0)} می‌شد.</div>
    </section>`}

    ${c.notes.length > 0 && html`<div class="cmt-notes">${c.notes.map((n) => html`<div class="xs"><${Icon} n="info" cls="xs" />${n}</div>`)}</div>`}
    <div class="xs faint">پیشنهاد خرید نیست؛ گزینه‌ها با قاعده‌های ثابت از دادهٔ امروز آمده‌اند و تصمیم با توست. گذشته تضمین آینده نیست.</div>
  </div>`;
}

/** The market's past, for the bad case (one request, the same one سبدساز uses). */
export function usePast(st) {
  const [data, setData] = useState(null);
  useEffect(() => { let alive = true; send('pbData').then((r) => alive && setData(r && !r.error ? r : false), () => alive && setData(false)); return () => { alive = false; }; }, []);
  return useMemo(() => (data ? PB.returnsFrom(PB.seriesOf(data), I.defaultDepositPct(st)) : null), [data]);
}

/** The committee in a window: an amount (and where it is), then the card. focus: a radar card asked about. */
export function CommitteeModal({ st, s, amount: amount0 = null, focus = null, onClose, openPrice = null }) {
  const [amount, setAmount] = useState(amount0);
  const [source, setSource] = useState('new');
  const radar = useRadar();
  const R = usePast(st);
  const accounts = st.assets.filter((a) => !a.archived && a.category === 'bank' && a.mode === 'balance' && +a.balance > 0);
  const depositPct = I.defaultDepositPct(st);
  const built = useMemo(() => (radar?.day ? RD.buildCards(radar, { depositPct, level: PR.riskLevel(s.profile) || 'mid' }) : null), [radar]);
  const set = useMemo(() => (amount > 0 ? C.committeeSet(st, { amount, source, focus, radar, cards: built?.cards, records: built?.records, R, depositPct }) : null), [amount, source, R, built, st.assets, st.quotes]);
  const c = set?.main || null;
  const q = focus ? `«${focus.sym || focus.name}» با ${Math.round(amount / (s.currency === 'rial' ? 1 : 10)).toLocaleString('en-US')} ${s.currency === 'rial' ? 'ریال' : 'تومان'} به سبد من می‌خورد؟ با کمیتهٔ سرمایه‌گذاری بررسی کن.`
    : `${Math.round((amount || 0) / (s.currency === 'rial' ? 1 : 10)).toLocaleString('en-US')} ${s.currency === 'rial' ? 'ریال' : 'تومان'} پول دارم؛ کجا ببرم؟ با کمیتهٔ سرمایه‌گذاری بررسی کن.`;
  return html`<${Modal} title=${focus ? `به سبد من می‌خورد؟ ${focus.sym || focus.name}` : 'کمیتهٔ سرمایه‌گذاری'} onClose=${onClose}
    footer=${html`${c && html`<${AskBtn} q=${q} label="ادامه در دستیار" />`}<button class="btn" onClick=${onClose}>بستن</button>`}>
    <div class="row wrap" style="gap:10px;align-items:flex-end">
      <div class="grow" style="min-width:200px"><${MoneyField} label=${focus ? 'چه مبلغی را در نظر داری؟' : 'چه مبلغی؟'} rial=${amount} onRial=${setAmount} s=${s} autoFocus=${!amount} /></div>
      ${accounts.length > 0 && html`<div class="field" style="min-width:180px"><label>این پول کجاست؟</label><select class="input" value=${source} onChange=${(e) => setSource(e.target.value)}>
        <option value="new">پول تازه (هنوز در دارا نیست)</option>${accounts.map((a) => html`<option value=${a.id}>در «${a.name}»</option>`)}</select></div>`}
    </div>
    ${c ? html`<${CommitteeView} set=${set} s=${s} openPrice=${openPrice} key=${`${amount}|${source}`} />` : html`<div class="xs muted">مبلغ را بنویس تا نیاز نقدینگی، گزینه‌ها، اثر روی سبد و حالت اشتباه را ببینی.</div>`}
  </${Modal}>`;
}
