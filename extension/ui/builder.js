// «سبدساز» on «تحلیل و سناریو»: an amount, a horizon, alone or with what you hold → four mixes tried on the past,
// and a plan for the one you pick. The numbers come from lib/builder.js; this file only shows them.
import { html, useState, useEffect, useMemo, useRef, Icon, Money, MoneyField, Seg, StackBar, toast, send, num, pct, fmtJ, useRadar } from './components.js';
import * as B from '../lib/builder.js';
import * as I from '../lib/insights.js';
import * as PR from '../lib/profile.js';
import { T } from './tips.js';
import { act } from './actions.js';
import { uid } from '../lib/format.js';
import { TermTip } from './glossary.js';

const H_OPTS = [[6, '۶ ماه'], [12, '۱ سال'], [24, '۲ سال'], [36, '۳ سال']];
const monthFa = (m) => (m ? fmtJ(m + '-15', 'my') : '');

/** The worker's history, once per page (it caches it for a few hours). */
export function usePbData() {
  const [d, setD] = useState(null);
  useEffect(() => { let alive = true; send('pbData').then((r) => alive && setD(r || { error: 'پاسخی نیامد' })); return () => { alive = false; }; }, []);
  return d;
}

/** Several lines on one time axis (start = 100), oldest on the left. */
function Lines({ series, months }) {
  const W = 600, Hh = 170, pad = 8, padB = 18;
  const all = series.flatMap((x) => x.p.map((v) => v * 100));
  const lo = Math.min(...all), hi = Math.max(...all);
  const L = Math.log(Math.max(lo, 1e-6)), Hl = Math.log(hi);
  const X = (i, n) => pad + (i / (n - 1)) * (W - pad * 2);
  // a log scale: years of high inflation would otherwise flatten the first half to a line
  const Y = (v) => pad + (1 - (Math.log(v * 100) - L) / (Hl - L || 1)) * (Hh - pad - padB);
  return html`<div class="pb-lines">
    <svg viewBox=${`0 0 ${W} ${Hh}`} preserveAspectRatio="none" style="width:100%;height:170px;direction:ltr;display:block">
      ${series.map((x) => html`<path d=${x.p.map((v, i) => (i ? 'L' : 'M') + X(i, x.p.length).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')} fill="none" stroke=${x.color} stroke-width=${x.hl ? 2.6 : 1.6} opacity=${x.hl ? 1 : 0.75} vector-effect="non-scaling-stroke" />`)}
    </svg>
    <div class="row between xs muted" style="direction:ltr"><span>${monthFa(months[0])}</span><span>${monthFa(months[months.length - 1])}</span></div>
    <div class="chips" style="margin-top:6px">${series.map((x) => html`<span class="chip"><i class="dot" style=${`background:${x.color}`}></i>${x.name} <b class="num">${num(Math.round(x.p[x.p.length - 1] * 100))}</b></span>`)}</div>
    <div class="xs muted">شروع = ۱۰۰؛ محور عمودی لگاریتمی است.</div>
  </div>`;
}

const LINE_COLORS = { current: 'var(--ink-2)', targets: '#14A89B', low: '#3D7BF7', mid: '#8E70FF', high: '#EF4D6B' };

function CandCard({ c, r, s, on, onPick }) {
  const m = c.metrics;
  const top = B.CLASSES.filter((k) => (c.weights[k.id] || 0) >= 0.005).sort((a, b) => c.weights[b.id] - c.weights[a.id]);
  const Row = ({ t, children }) => html`<div class="pb-row"><span>${t}</span><b class="num">${children}</b></div>`;
  return html`<div class=${'pb-c' + (on ? ' on' : '') + (c.fits ? ' fits' : '')}>
    <div class="row between" style="gap:6px"><b>${c.name}</b>${c.fits && html`<span class="pill live">با پروفایلت</span>`}</div>
    <${StackBar} items=${top.map((k) => ({ name: k.short, value: c.weights[k.id], color: k.color }))} height=${8} />
    <div class="pb-legend xs">${top.map((k) => html`<span><i class="dot" style=${`background:${k.color}`}></i>${k.short} ${num(Math.round(c.weights[k.id] * 100))}٪</span>`)}</div>
    ${m && html`<div class="pb-rows">
      <${Row} t=${html`<${TermTip} id="cagr" label="بازده سالانه" />`}>${pct(m.cagr, { digits: 0 })}</${Row}>
      <${Row} t=${html`<${TermTip} id="inflation" label="همان به دلار" />`}>${pct(m.usdCagr, { digits: 0 })}</${Row}>
      <${Row} t=${html`<${TermTip} id="drawdown" label="بدترین افت" />`}><span class="neg">${pct(m.maxDD, { digits: 0 })}</span>${m.under ? html`<span class="xs muted"> · ${num(m.under)} ماه زیر اوج</span>` : ''}</${Row}>
      <${Row} t="بدترین ۱۲ ماه"><span class=${m.worst12 < 0 ? 'neg' : ''}>${pct(m.worst12, { digits: 0 })}</span></${Row}>
      <${Row} t=${`جلوتر از سپرده در ${num(r.horizon)} ماه`}>${m.beat === null ? '—' : `${num(Math.round(m.beat * 100))}٪ دوره‌ها`}</${Row}>
    </div>`}
    ${c.range && html`<div class="pb-range">
      <div class="xs muted">بعد از ${H_OPTS.find((x) => x[0] === r.horizon)?.[1] || num(r.horizon) + ' ماه'}، <${TermTip} id="range" label="اگر گذشته تکرار شود" /></div>
      <div class="pb-3"><span><i>بد</i><${Money} v=${c.range.bad} s=${s} compact unit=${false} /><em class="num">${pct(c.range.badPct, { digits: 0 })}</em></span>
        <span><i>معمولی</i><${Money} v=${c.range.mid} s=${s} compact unit=${false} /><em class="num">${pct(c.range.midPct, { digits: 0 })}</em></span>
        <span><i>خوب</i><${Money} v=${c.range.good} s=${s} compact unit=${false} /><em class="num">${pct(c.range.goodPct, { digits: 0 })}</em></span></div>
      <div class="xs muted" style="margin-top:4px">معمولی به دلار: <b class=${'num ' + (c.range.midUsdPct < 0 ? 'neg' : '')}>${pct(c.range.midUsdPct, { digits: 0 })}</b></div></div>`}
    <div class="pb-stress xs"><span>دلار +۵۰٪: <b class="num pos">${pct(c.stress.usdUp, { digits: 0 })}</b></span><span>بورس −۳۰٪: <b class="num neg">${pct(c.stress.bourseDown, { digits: 0 })}</b></span></div>
    ${c.moved.length > 0 && html`<div class="xs warn">${c.moved.map((k) => B.CLASS[k].short).join('، ')} در این بازه داده نداشت؛ سهمش سپرده حساب شد.</div>`}
    <button class=${'btn sm' + (on ? ' primary' : '')} onClick=${onPick}>${on ? 'انتخاب شد' : 'برنامهٔ این سبد'}</button>
  </div>`;
}

/** Step 3: what goes where, and the ways in. */
function Plan({ c, r, s, st, radar, data, onSaved }) {
  const dep = r.depositPct;
  const rows = B.CLASSES.filter((k) => (c.adds[k.id] || 0) >= 1).sort((a, b) => c.adds[b.id] - c.adds[a.id]);
  const save = async () => {
    const plans = [{ id: uid('pl'), at: Date.now(), name: c.name, amount: r.amount, horizon: r.horizon, mode: r.mode, adds: c.adds, start: B.latestOf(data), depositPct: dep }, ...(s.plans || [])].slice(0, 10);
    await act.setSettings({ plans }); toast('برنامه ذخیره شد؛ پایین همین بخش می‌بینی از امروز چه کرده'); onSaved?.();
  };
  const toTargets = async () => {
    if (Object.keys(s.targets || {}).length && !confirm('ترکیب هدفی که قبلاً گذاشته‌ای با این سبد عوض شود؟')) return;
    await act.setSettings({ targets: c.byCat }); toast('ترکیب هدف گذاشته شد');
  };
  return html`<div class="pb-step" style="margin-top:14px"><span>۳</span>برنامه‌ات</div><div class="pb-plan" id="pb-plan">
    <div class="sb" style="margin-bottom:8px">برنامهٔ «${c.name}» برای <${Money} v=${r.amount} s=${s} compact /></div>
    ${rows.map((k) => {
      const vs = B.vehicles(k.id, { radar, quotes: st.quotes, depositPct: dep });
      return html`<div class="pb-pr">
        <div class="row between"><span class="row" style="gap:6px"><i class="dot" style=${`background:${k.color}`}></i><b>${k.name}</b></span>
          <span><b class="num"><${Money} v=${c.adds[k.id]} s=${s} compact /></b> <span class="xs muted">${num(Math.round(c.adds[k.id] / r.amount * 100))}٪</span></span></div>
        ${vs.length > 0 && html`<ul class="pb-veh">${vs.map((v) => html`<li>
          <span>${v.kind === 'fund' ? html`صندوق ${v.sym ? html`<b>${v.sym}</b> ` : ''}<span class="muted">${v.name}</span>` : html`<b>${v.name}</b>`}</span>
          <span class="xs muted">${v.kind === 'fund' ? [v.y1 !== null ? `بازده ۱۲ ماه ${pct(v.y1, { digits: 0 })}` : '', v.bubble !== null && v.bubble !== undefined ? `حباب ${pct(v.bubble, { digits: 1 })}` : ''].filter(Boolean).join(' · ')
            : v.kind === 'coin' ? `حباب ${pct(v.bubble, { digits: 1 })} · ${v.note}` : v.note}</span></li>`)}</ul>`}
      </div>`;
    })}
    ${!radar?.day && html`<div class="xs muted">با روشن بودن «رادار فرصت‌ها»، صندوق‌های هر دسته (با بازده و حباب) هم اینجا می‌آید.</div>`}
    <div class="xs muted" style="margin:8px 0">صندوق‌ها فقط از یک غربال ثابت رد شده‌اند (سابقهٔ یک ساله، اندازهٔ کافی، بازده یا حباب)؛ رتبه‌بندی «بهترین» نیست. پیش از خرید، کارنامه‌شان را ببین.</div>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary sm" onClick=${save}><${Icon} n="check" cls="sm" />ذخیرهٔ برنامه</button>
      ${c.byCat && html`<button class="btn sm" onClick=${toTargets}>بگذارش ترکیب هدف</button>`}</div>
  </div>`;
}

function Saved({ s, data }) {
  const plans = s.plans || [];
  if (!plans.length) return null;
  const latest = B.latestOf(data);
  const del = async (id) => { await act.setSettings({ plans: plans.filter((p) => p.id !== id) }); toast('برنامه حذف شد'); };
  return html`<div class="pb-saved"><div class="xs sb muted" style="margin-bottom:6px">برنامه‌های ذخیره‌شده</div>
    ${plans.map((p) => { const v = B.planToday(p, latest); return html`<div class="row between pb-sv">
      <span><b>${p.name}</b> <span class="xs muted">· <${Money} v=${p.amount} s=${s} compact /> · ${fmtJ(new Date(p.at).toISOString().slice(0, 10), 'dm')}</span></span>
      <span class="small">${v ? html`از آن روز <b class=${'num ' + (v.pct >= 0 ? 'pos' : 'neg')}>${pct(v.pct, { digits: 1 })}</b> <span class="xs muted">(سپرده ${pct(v.deposit, { digits: 1 })}${v.missing.length ? `؛ ${v.missing.map((k) => B.CLASS[k].short).join('، ')} بدون قیمت` : ''})</span>` : html`<span class="xs muted">در انتظار قیمت</span>`}
        <button class="btn icon sm ghost danger" title="حذف برنامه" onClick=${() => del(p.id)}><${Icon} n="trash" cls="sm" /></button></span></div>`; })}
  </div>`;
}

export function Builder({ st, pf, s, route }) {
  const q = route?.q || {};
  const [amount, setAmount] = useState(() => (+q.pb > 0 ? +q.pb : null));
  const [horizon, setHorizon] = useState(() => ([6, 12, 24, 36].includes(+q.m) ? +q.m : 24));
  const [mode, setMode] = useState(() => (q.mode === 'alone' ? 'alone' : 'with'));
  const [years, setYears] = useState(5);
  const [pick, setPick] = useState(null);
  const data = usePbData();
  const radar = useRadar();
  const box = useRef();
  useEffect(() => { if (q.pb) setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200); }, []);
  const R = useMemo(() => (data && !data.error ? B.returnsFrom(B.seriesOf(data), I.defaultDepositPct(st)) : null), [data]);
  const r = useMemo(() => (R && amount > 0 ? B.build({ R, pf, profile: s.profile, targets: s.targets, amount, horizon, mode, years }) : null), [R, amount, horizon, mode, years, pf.gross, s.profile, s.targets]);
  const chosen = r?.cands?.find((c) => c.id === pick) || null;
  return html`<div class="card" id="builder" ref=${box}>
    <div class="card-h"><h3><${Icon} n="layers" cls="sm" />سبدساز${T('pbHow')}</h3><span class="sub">پول تازه را کجا بگذارم؟</span></div>
    <div class="pb-step"><span>۱</span>مبلغ و مدت را بگو</div>
    <div class="pb-in">
      <div style="min-width:220px;flex:1"><${MoneyField} label="مبلغ" rial=${amount} onRial=${setAmount} s=${s} placeholder="مثلاً ۷۰۰ میلیون" /></div>
      <div class="field"><label>برای چه مدت</label><${Seg} value=${horizon} onChange=${setHorizon} options=${H_OPTS} /></div>
      <div class="field"><label>حساب کن</label><${Seg} value=${mode} onChange=${setMode} options=${[['with', 'کنار دارایی‌هایم'], ['alone', 'فقط همین پول']]} /></div>
      <div class="field"><label>گذشته</label><${Seg} value=${years} onChange=${setYears} options=${[[5, '۵ سال'], [10, '۱۰ سال']]} /></div>
    </div>
    ${!PR.isSet(s.profile) && html`<div class="callout" style="margin-top:10px"><${Icon} n="info" cls="sm" /><div>پروفایل سرمایه‌گذاری‌ات را بساز تا سبدِ هم‌خوان با ریسکت مشخص شود و خط قرمزهایت رعایت شود. <a href="#/settings?to=profile">ساختن ←</a></div></div>`}
    ${!data ? html`<div class="empty small">در حال خواندن ۱۰ سال قیمت طلا، دلار، بورس و رمزارز…</div>`
      : data.error ? html`<div class="callout warn" style="margin-top:10px"><${Icon} n="wifi" cls="sm" /><div>${data.error}. کمی بعد دوباره امتحان کن.</div></div>`
      : !(amount > 0) ? html`<div class="empty small">مبلغ را بنویس تا چند سبد روی گذشتهٔ واقعی بازار ایران امتحان شوند.
          <div class="chips" style="justify-content:center;margin-top:10px">${[2e9, 7e9, 2e10].map((v) => html`<button class="chip" onClick=${() => setAmount(v)}><${Money} v=${v} s=${s} compact /></button>`)}</div></div>`
      : r?.error ? html`<div class="callout warn"><${Icon} n="alert" cls="sm" /><div>${r.error}</div></div>`
      : r && html`
        <div class="small muted pb-sum">از ${monthFa(r.from)} تا ${monthFa(r.to)} (${num(r.months)} ماه)، ماه‌به‌ماه و به تومان. ${r.mode === 'with' ? 'مبلغ کنار دارایی‌هایت حساب شده؛ عددها برای کل دارایی‌های قابل‌مدل است.' : 'فقط همین مبلغ.'} سپرده در همین ${num(horizon)} ماه (با نرخ امروز ${num(r.depositPct, 1)}٪): <b class="num">${pct(r.depositGain, { digits: 0 })}</b>. عددها به تومان‌اند و بخشی از رشدشان فقط پایین آمدن ارزش ریال است؛ ستون «به دلار» این را جدا می‌کند.
          ${r.askedWith && r.mode === 'alone' ? ' (هنوز دارایی قابل‌مدلی ثبت نکرده‌ای؛ فقط همین مبلغ حساب شد.)' : ''}
          ${r.other > 0 ? html` ملک، سهام خصوصی، فلزات و سایر (<${Money} v=${r.other} s=${s} compact />) در این حساب نیستند.` : ''}</div>
        ${r.mode === 'with' && r.cands[0] && amount / r.cands[0].value0 < 0.2 && html`<div class="callout" style="margin-bottom:10px"><${Icon} n="info" cls="sm" /><div>این مبلغ حدود ${num(Math.round(amount / r.cands[0].value0 * 100))}٪ دارایی‌هایت است؛ برای همین سبدها به هم نزدیک‌اند و بیشتر ترکیب فعلی‌ات تعیین‌کننده است. برای دیدن فرق خود ترکیب‌ها، <button class="calc-link" onClick=${() => setMode('alone')}>«فقط همین پول»</button> را بزن.</div></div>`}
        ${(() => { const f = r.cands.find((c) => c.fits) || r.cands.find((c) => c.id === 'mid'); const m = f?.metrics; return m && html`<div class="pb-tldr"><${Icon} n="sparkles" cls="sm" /><div>
          ${f.fits ? 'سبدی که با پروفایلت جور است' : 'سبد میانه'} («${f.name}») در ${num(r.years)} سال گذشته سالی حدود <b class="num">${pct(m.cagr, { digits: 0, sign: false })}</b> رشد کرده (به دلار <b class="num">${pct(m.usdCagr, { digits: 0 })}</b>)، بدترین افتش <b class="num">${pct(Math.abs(m.maxDD), { digits: 0, sign: false })}</b> بوده و در <b class="num">${num(Math.round((m.beat || 0) * 100))}٪</b> دوره‌های ${num(horizon)} ماهه از سپرده جلو زده. بقیه را کنارش مقایسه کن؛ روی هر کارت بزن تا برنامه‌اش را ببینی.</div></div>`; })()}
        <div class="pb-step"><span>۲</span>سبدها را مقایسه کن</div>
        <div class="pb-cards">${r.cands.map((c) => html`<${CandCard} c=${c} r=${r} s=${s} on=${pick === c.id} onPick=${() => { setPick(pick === c.id ? null : c.id); setTimeout(() => document.getElementById('pb-plan')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80); }} />`)}</div>
        <div class="pb-chart"><div class="xs sb ink2" style="margin-bottom:4px">اگر از ${monthFa(r.from)} همین سبدها را داشتی</div>
          <${Lines} months=${[r.from, r.to]} series=${r.cands.map((c) => ({ name: c.name, p: c.path, color: LINE_COLORS[c.id], hl: c.fits }))} /></div>
        <div class="xs muted">هر دارایی به‌تنهایی در همین دوره، سالانه: ${r.each.map((e) => `${e.name} ${e.cagr === null ? '—' : pct(e.cagr, { digits: 0 })}`).join('، ')}.</div>
        <details class="pb-notes"><summary class="xs">فرض‌ها و محدودیت‌ها</summary><ul class="xs muted">
          <li>طلا = طلای ۱۸ عیار، بورس = شاخص کل (با سود نقدی)، رمزارز = بیت‌کوین، دلار = بازار آزاد؛ همه از tgju و TSETMC.</li>
          <li>سپرده با نرخ امروز (${num(r.depositPct, 1)}٪) برای همهٔ گذشته حساب شده؛ نرخ واقعی گذشته کمتر بوده.</li>
          <li>هر سال یک بار سبد به ترکیب خودش برگردانده می‌شود. هزینهٔ خرید و فروش هر دسته (سپرده ۰، طلا ۱٫۵٪، دلار ۲٪، بورس ۱٪، رمزارز ۱٪) از اول کم شده.</li>
          <li>بازهٔ «بد، معمولی، خوب» از کنار هم گذاشتن تکه‌های ۶ ماههٔ گذشته ساخته شده (۱۵۰۰ بار)؛ ۱۰ و ۹۰ درصد نتیجه‌ها و میانه. شوک‌هایی که در گذشته نبوده‌اند در آن نیستند.</li>
          <li>ده سال اخیر ایران پر از جهش ارزی بوده؛ اگر آینده آرام‌تر یا تندتر باشد، نتیجه فرق می‌کند. این پیشنهاد خرید یا فروش نیست.</li>
        </ul></details>
        ${chosen && html`<${Plan} c=${chosen} r=${r} s=${s} st=${st} radar=${radar} data=${data} onSaved=${() => setPick(null)} />`}`}
    ${data && !data.error && html`<${Saved} s=${s} data=${data} />`}
  </div>`;
}
