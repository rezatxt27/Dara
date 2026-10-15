// «پروفایل سرمایه‌گذاری»: the questions (settings), and the emergency-fund card on the overview.
import { html, useState, Icon, Money, MoneyField, NumField, Toggle, toast, num, pct } from './components.js';
import { CAT } from '../lib/catalog.js';
import * as PR from '../lib/profile.js';
import { act } from './actions.js';

const Choice = ({ value, options, onChange, label }) => html`<div class="field"><label>${label}</label>
  <div class="chips" role="radiogroup" aria-label=${label}>${options.map(([v, t]) => html`<button type="button" role="radio" aria-checked=${value === v} class=${'chip' + (value === v ? ' on' : '')} onClick=${() => onChange(v)}>${t}</button>`)}</div></div>`;

/** The questions. Saved as settings.profile; nothing leaves the device except, for the assistant, its labels. */
export function ProfileCard({ s }) {
  const [p, setP] = useState(() => ({ ...(s.profile || {}) }));
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(p) !== JSON.stringify(s.profile || {});
  const risk = PR.riskLevel(p);
  const mix = PR.suggestTargets(p);
  const save = async () => { await act.setSettings({ profile: { ...p, at: Date.now() } }); toast('پروفایل ذخیره شد'); };
  const useMix = async () => {
    if (Object.keys(s.targets || {}).length && !confirm('ترکیب هدفی که قبلاً گذاشته‌ای با این نمونه عوض شود؟')) return;
    await act.setSettings({ targets: mix }); toast('ترکیب هدف گذاشته شد؛ در «تحلیل و سناریو» عوضش کن');
  };
  return html`<div class="card" id="profile"><div class="card-h"><h3><${Icon} n="target" cls="sm" />پروفایل سرمایه‌گذاری</h3>
      ${risk && html`<span class="sub">ریسک قابل‌قبول: <b>${PR.RISK[risk]}</b></span>`}</div>
    <div class="small muted" style="margin-bottom:12px;line-height:1.9">چند جواب کوتاه دربارهٔ خودت. دستیار، کارت پول اضطراری، چک‌لیست پیش از خرید و رادار با آن جور می‌شوند. روی همین دستگاه می‌ماند؛ به دستیار فقط برچسب جواب‌ها می‌رود. توصیهٔ خرید و فروش نیست.</div>
    <div class="col" style="gap:14px">
      ${['goal', 'horizon', 'drop'].map((k) => html`<${Choice} label=${PR.QUESTIONS[k].t} value=${p[k]} options=${PR.QUESTIONS[k].o} onChange=${set(k)} />`)}
      ${p.goal === 'purchase' && html`<div class="field"><label>برای چه؟ (اختیاری)</label><input class="input" maxlength="60" placeholder="مثلاً پیش‌پرداخت خانه" value=${p.purchase || ''} onInput=${(e) => set('purchase')(e.target.value)} /></div>`}
      <${Choice} label=${PR.QUESTIONS.income.t} value=${p.income} options=${PR.QUESTIONS.income.o} onChange=${set('income')} />
      <div class="calc-in two" style="max-width:none">
        <${MoneyField} label="خرج ماهانهٔ تقریبی" rial=${p.expense ?? null} onRial=${set('expense')} s=${s} placeholder="مثلاً ۴۰ میلیون" hint="برای حساب پول اضطراری؛ تقریبی کافی است" />
        <${NumField} label="پول اضطراری، چند ماه خرج" value=${p.emergencyMonths ?? null} onInput=${set('emergencyMonths')} suffix="ماه" digits=${0} placeholder=${String(PR.emergencyMonths({ ...p, emergencyMonths: null }))} hint="پیش‌فرض ۶ ماه؛ با درآمد نامنظم ۹" />
      </div>
      <div class="field"><label>خط قرمزها (اختیاری)</label>
        <div class="row between" style="gap:12px"><span class="small">رمزارز نمی‌خواهم</span><${Toggle} title="رمزارز نمی‌خواهم" on=${!!p.noCrypto} onChange=${set('noCrypto')} /></div>
        <div class="row between" style="gap:12px;margin-top:6px"><span class="small">بیشترین سهم یک دارایی از کل</span>
          <span style="width:130px"><${NumField} value=${p.maxOne ?? null} onInput=${set('maxOne')} suffix="٪" digits=${0} placeholder="مثلاً ۲۵" compact /></span></div></div>
      <div class="row" style="gap:8px"><button class="btn primary" disabled=${!dirty || !PR.isSet(p)} onClick=${save}>ذخیرهٔ پروفایل</button>
        ${!PR.isSet(p) && html`<span class="xs muted">سه سؤال اول لازم است</span>`}</div>
      ${mix && html`<div class="callout"><${Icon} n="info" cls="sm" /><div>
        <div style="margin-bottom:6px">یک ترکیب رایج برای ریسک «${PR.RISK[risk]}»، به‌عنوان نقطهٔ شروع (نه توصیه):</div>
        <div class="chips" style="margin-bottom:8px">${Object.entries(mix).map(([c, v]) => html`<span class="chip"><i class="dot" style=${`background:${CAT[c]?.color}`}></i>${CAT[c]?.short} ${num(v)}٪</span>`)}</div>
        <div class="xs muted" style="margin-bottom:8px">دسته‌هایی که اینجا نیستند (مثل طلای آنلاین، فلزات یا ملک) هدفی نمی‌گیرند؛ اگر داری، در «ترکیب هدف» سهمشان را از دستهٔ نزدیکشان کم کن (مثلاً طلای آنلاین از «طلا و سکه»).</div>
        <button class="btn sm" onClick=${useMix}>بگذارش ترکیب هدف</button> <a class="small" href="#/analysis" style="margin-inline-start:8px">ترکیب هدف فعلی ←</a></div></div>`}
    </div>
  </div>`;
}

/** Overview: months of spending held in accounts and deposits, against the profile's target; or an invitation. */
export function EmergencyCard({ s, pf }) {
  const p = s.profile;
  const e = PR.emergency(p, pf);
  if (!e) {
    if (PR.isSet(p) || s.profileHint === false) return null;
    return html`<div class="callout row" style="gap:10px;align-items:center"><${Icon} n="target" cls="sm" /><div class="grow">پروفایل سرمایه‌گذاری‌ات را بساز تا دستیار و هشدارها با هدف و ریسک خودت جور شوند (کمتر از دو دقیقه).</div>
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
