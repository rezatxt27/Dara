// «پروفایل سرمایه‌گذاری»: the questions (settings), and the emergency-fund card on the overview.
import { html, useState, Icon, Money, MoneyField, NumField, Toggle, toast, num, pct } from './components.js';
import { CAT } from '../lib/catalog.js';
import * as PR from '../lib/profile.js';
import { act } from './actions.js';
import { T } from './tips.js';

const Choice = ({ value, options, onChange, label }) => html`<div class="field"><label>${label}</label>
  <div class="chips" role="radiogroup" aria-label=${label}>${options.map(([v, t]) => html`<button type="button" role="radio" aria-checked=${value === v} class=${'chip' + (value === v ? ' on' : '')} onClick=${() => onChange(v)}>${t}</button>`)}</div></div>`;

/** The questions. Saved as settings.profile; nothing leaves the device except, for the assistant, its labels. */
export function ProfileCard({ s }) {
  const [p, setP] = useState(() => ({ ...(s.profile || {}) }));
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(p) !== JSON.stringify(s.profile || {});
  const risk = PR.riskLevel(p);
  const mix = PR.suggestTargets(p);
  // the optional answers stay folded until one of them is used
  // (set once: flipping a toggle off must not fold the section under the cursor)
  const [moreOpen] = useState(() => !!(p.income || p.expense || p.emergencyMonths || p.noCrypto || p.maxOne));
  const save = async () => { await act.setSettings({ profile: { ...p, at: Date.now() } }); toast('پروفایل ذخیره شد؛ سبدساز، دستیار و تذکرهای خرید از این به بعد با آن جورند'); };
  const useMix = async () => {
    if (Object.keys(s.targets || {}).length && !confirm('ترکیب هدفی که قبلاً گذاشته‌ای با این نمونه عوض شود؟')) return;
    await act.setSettings({ targets: mix }); toast('ترکیب هدف گذاشته شد؛ در «تحلیل و سناریو» ← «تخصیص هدف» می‌بینی چقدر بخری یا بفروشی');
  };
  const left = ['goal', 'horizon', 'drop'].filter((k) => !p[k]).length;
  return html`<div class="card" id="profile"><div class="card-h"><h3><${Icon} n="target" cls="sm" />پروفایل سرمایه‌گذاری${T('profHow')}</h3>
      ${risk && html`<span class="sub">ریسک قابل‌قبول: <b>${PR.RISK[risk]}</b></span>`}</div>
    <div class="small muted" style="margin-bottom:12px;line-height:1.9">سه سؤال کوتاه، کمتر از یک دقیقه. سبدساز، دستیار، کارت پول اضطراری، تذکر هنگام خرید و رادار با آن جور می‌شوند. روی همین دستگاه می‌ماند؛ به دستیار فقط برچسب جواب‌ها می‌رود. توصیهٔ خرید و فروش نیست.</div>
    <div class="col" style="gap:14px">
      ${['goal', 'horizon', 'drop'].map((k, n) => html`<${Choice} label=${`${'۱۲۳'[n]}. ${PR.QUESTIONS[k].t}`} value=${p[k]} options=${PR.QUESTIONS[k].o} onChange=${set(k)} />`)}
      ${p.goal === 'purchase' && html`<div class="field"><label>برای چه؟ (اختیاری)</label><input class="input" maxlength="60" placeholder="مثلاً پیش‌پرداخت خانه" value=${p.purchase || ''} onInput=${(e) => set('purchase')(e.target.value)} /></div>`}
      <details class="prof-more" open=${moreOpen}><summary class="small"><span class="sb">تنظیمات بیشتر</span> <span class="muted">(اختیاری: پول اضطراری و خط قرمزها)</span>${T('profMore')}</summary>
        <div class="col" style="gap:14px;margin-top:12px">
          <${Choice} label=${PR.QUESTIONS.income.t} value=${p.income} options=${PR.QUESTIONS.income.o} onChange=${set('income')} />
          <div class="calc-in two" style="max-width:none">
            <${MoneyField} label="خرج ماهانهٔ تقریبی" rial=${p.expense ?? null} onRial=${set('expense')} s=${s} placeholder="مثلاً ۴۰ میلیون" hint="برای کارت «پول اضطراری» در نمای کلی؛ تقریبی کافی است" />
            <${NumField} label="پول اضطراری، چند ماه خرج" value=${p.emergencyMonths ?? null} onInput=${set('emergencyMonths')} suffix="ماه" digits=${0} placeholder=${String(PR.emergencyMonths({ ...p, emergencyMonths: null }))} hint="پیش‌فرض ۶ ماه؛ با درآمد نامنظم ۹" />
          </div>
          <div class="field"><label>خط قرمزها</label>
            <div class="row between" style="gap:12px"><span class="small">رمزارز نمی‌خواهم <span class="xs muted">— از سبدهای پیشنهادی سبدساز حذف می‌شود و هنگام خرید تذکر می‌گیری</span></span><${Toggle} title="رمزارز نمی‌خواهم" on=${!!p.noCrypto} onChange=${set('noCrypto')} /></div>
            <div class="row between" style="gap:12px;margin-top:6px"><span class="small">بیشترین سهم یک دارایی از کل <span class="xs muted">— اگر خریدی از این بیشتر شود، تذکر می‌گیری</span></span>
              <span style="width:130px;flex:none"><${NumField} value=${p.maxOne ?? null} onInput=${set('maxOne')} suffix="٪" digits=${0} placeholder="مثلاً ۲۵" compact /></span></div></div>
        </div>
      </details>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" disabled=${!dirty || !PR.isSet(p)} onClick=${save}>ذخیرهٔ پروفایل</button>
        ${!PR.isSet(p) ? html`<span class="xs muted">${left === 3 ? 'به سه سؤال بالا جواب بده' : `${'۰۱۲۳'[left]} سؤال مانده`}</span>`
          : html`<span class="xs muted">بعد از ذخیره: سبد هم‌خوان با ریسکت در سبدساز مشخص می‌شود و دستیار و تذکرهای خرید با آن جور می‌شوند.</span>`}</div>
      ${mix && html`<div class="callout"><${Icon} n="info" cls="sm" /><div>
        <div style="margin-bottom:6px">یک ترکیب رایج برای ریسک «${PR.RISK[risk]}»، به‌عنوان نقطهٔ شروع (نه توصیه):</div>
        <div class="chips" style="margin-bottom:8px">${Object.entries(mix).map(([c, v]) => html`<span class="chip"><i class="dot" style=${`background:${CAT[c]?.color}`}></i>${CAT[c]?.short} ${num(v)}٪</span>`)}</div>
        <div class="row" style="gap:4px;flex-wrap:wrap;margin-bottom:6px"><button class="btn sm" onClick=${useMix}>بگذارش ترکیب هدف</button>${T('pbTarget')}
          <a class="small" href="#/analysis?to=targets" style="margin-inline-start:8px">دیدن تخصیص هدف ←</a></div>
        <div class="xs muted" style="line-height:1.9">یعنی این درصدها هدفِ هر دسته در «تحلیل و سناریو» ← «تخصیص هدف» می‌شود: آنجا می‌بینی الان از هر دسته چقدر کم یا زیاد داری و برای رسیدن به آن چقدر بخری یا بفروشی؛ سبدساز هم سبد «ترکیب هدف تو» را امتحان می‌کند. چیزی خرید و فروش نمی‌شود و هر وقت بخواهی عوضش می‌کنی. دسته‌هایی که اینجا نیستند (مثل طلای آنلاین یا فلزات) هدفی نمی‌گیرند؛ اگر داری، سهمشان را از دستهٔ نزدیکشان کم کن.</div></div></div>`}
    </div>
  </div>`;
}

/** Overview: months of spending held in accounts and deposits, against the profile's target; or an invitation. */
export function EmergencyCard({ s, pf }) {
  const p = s.profile;
  const e = PR.emergency(p, pf);
  if (!e) {
    if (PR.isSet(p) || s.profileHint === false) return null;
    return html`<div class="callout row" style="gap:10px;align-items:center"><${Icon} n="target" cls="sm" /><div class="grow">پروفایل سرمایه‌گذاری‌ات را بساز تا سبدساز، دستیار و هشدارها با هدف و ریسک خودت جور شوند (سه سؤال، کمتر از یک دقیقه).</div>
      <a class="btn sm primary" href="#/settings?to=profile">ساختن</a><button class="btn sm ghost" onClick=${() => act.setSettings({ profileHint: false })}>بعداً</button></div>`;
  }
  const frac = Math.min(1, e.months / e.want);
  return html`<div class="card emg"><div class="row" style="gap:14px;flex-wrap:wrap">
    <div class="grow" style="min-width:200px"><div class="sb">پول اضطراری</div>
      <div class="small muted">${e.ok ? 'حساب‌ها و سپرده‌هایت خرج این مدت را پوشش می‌دهند.' : html`برای ${num(e.want)} ماه خرج، حدود <b><${Money} v=${e.short} s=${s} compact /></b> کم است.`}</div></div>
    <div style="min-width:220px;flex:1">
      <div class="row between small"><b class=${e.ok ? 'pos' : 'warn'}>${num(Math.floor(e.months * 10) / 10, e.months < 10 ? 1 : 0)} ماه</b><span class="muted">هدف ${num(e.want)} ماه</span></div>
      <div class="emg-t"><i class=${e.ok ? 'ok' : ''} style=${`width:${frac * 100}%`}></i></div>
      <div class="xs muted">حساب‌ها و سپرده‌ها <${Money} v=${e.have} s=${s} compact /> · خرج ماهانه <${Money} v=${p.expense} s=${s} compact /></div></div>
    <a class="small" href="#/settings?to=profile">پروفایل ←</a>
  </div></div>`;
}
