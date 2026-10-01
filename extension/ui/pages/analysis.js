import { html, useState, useMemo, Icon, Money, Delta, Ava, StackBar, NumField, Slider, Seg, toast, num, pct } from '../components.js';
import { CAT, EXPOSURES, LIQUIDITY, SCENARIOS } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import { act } from '../actions.js';

function Bars({ items, s, total }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return html`<div class="bars">${items.map((i) => html`<div class="bar-row">
    <span class="row ellipsis" style="gap:8px"><span style=${`width:9px;height:9px;border-radius:3px;background:${i.color};flex:none`}></span><span class="ellipsis">${i.name}</span></span>
    <div class="track"><i style=${`width:${i.value / max * 100}%;background:${i.color}`}></i></div>
    <span class="small num" style="text-align:left"><${Money} v=${i.value} s=${s} compact unit=${false} /> <span class="muted">، ${pct(i.value / (total || 1), { sign: false })}</span></span></div>`)}</div>`;
}

function Targets({ pf, s }) {
  const [t, setT] = useState(() => ({ ...s.targets }));
  const rows = E.rebalance(pf, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (+v || 0) / 100])));
  const sum = Object.values(t).reduce((x, v) => x + (+v || 0), 0);
  const dirty = JSON.stringify(t) !== JSON.stringify(s.targets);
  const fill = () => { const n = {}; for (const r of rows) n[r.id] = Math.round(r.currentShare * 1000) / 10; setT(n); };
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="target" cls="sm" />تخصیص هدف و پیشنهاد متوازن‌سازی</h3>
      <div class="row"><button class="btn sm ghost" onClick=${fill}>پر کردن با وضعیت فعلی</button>
        <button class="btn sm primary" disabled=${!dirty} onClick=${() => { act.setSettings({ targets: t }); toast('اهداف ذخیره شد'); }}>ذخیره اهداف</button></div></div>
    <div class=${'callout' + (Math.abs(sum - 100) > 0.5 && sum > 0 ? ' warn' : '')} style="margin-bottom:12px"><${Icon} n="info" cls="sm" /><div>
      درصد هدف هر دسته را وارد کن (مثلاً ۳۰٪ طلا، ۲۰٪ ارز). جمع فعلی: <b class="num">${num(sum, 1)}٪</b>${Math.abs(sum - 100) > 0.5 && sum > 0 ? ' — بهتر است جمع ۱۰۰٪ باشد.' : ''}</div></div>
    <table class="tbl"><thead><tr><th>دسته</th><th class="n">ارزش فعلی</th><th class="n">سهم فعلی</th><th style="width:130px">هدف ٪</th><th style="width:28%">فعلی در برابر هدف</th><th class="n">اقدام پیشنهادی</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr class="r">
      <td><div class="row"><${Ava} cat=${r.id} size=${28} /><span class="sb">${r.cat.short}</span></div></td>
      <td class="n small"><${Money} v=${r.current} s=${s} compact unit=${false} /></td>
      <td class="n small num">${pct(r.currentShare, { sign: false })}</td>
      <td><input class="input num-in" style="height:32px" value=${t[r.id] ?? ''} placeholder="—" onInput=${(e) => setT({ ...t, [r.id]: e.target.value === '' ? undefined : parseFloat(e.target.value.replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))) || 0 })} /></td>
      <td><div class="bars"><div class="track"><i style=${`width:${Math.min(100, r.currentShare * 100)}%;background:${r.cat.color}`}></i>${r.hasTarget && html`<span class="tgt" style=${`right:${Math.min(100, r.target * 100)}%`}></span>`}</div></div></td>
      <td class="n small">${r.hasTarget ? (Math.abs(r.diff) < pf.gross * 0.005 ? html`<span class="pos">متوازن</span>` : html`<span class=${r.diff > 0 ? 'pos' : 'neg'}>${r.diff > 0 ? 'خرید' : 'فروش'} <${Money} v=${Math.abs(r.diff)} s=${s} compact /></span>`) : html`<span class="faint">—</span>`}</td>
    </tr>`)}</tbody></table>
  </div>`;
}


/* ---------------- scenario simulator ---------------- */
const ZERO = { usd: 0, gold: 0, crypto: 0, metals: 0, equity: 0, private: 0, real: 0 };
function Scenario({ st, pf, s }) {
  const [sh, setSh] = useState(ZERO);
  const [more, setMore] = useState(false);
  const [preset, setPreset] = useState(null);
  const shocks = Object.fromEntries(Object.entries(sh).map(([k, v]) => [k, v / 100]));
  const r = useMemo(() => E.simulate(st.assets, st.quotes, s, shocks, pf), [st, pf, JSON.stringify(sh)]);
  const set = (k) => (v) => { setPreset(null); setSh((x) => ({ ...x, [k]: v })); };
  const pick = (sc) => { setPreset(sc.id); setSh({ ...ZERO, ...Object.fromEntries(Object.entries(sc.shocks).map(([k, v]) => [k, Math.round(v * 100)])) }); };
  const goldLocal = ((1 + sh.usd / 100) * (1 + sh.gold / 100) - 1) * 100;
  const usdTerms = r.usdBefore ? r.usdAfter / r.usdBefore - 1 : null;
  const goldTerms = r.goldBefore ? r.goldAfter / r.goldBefore - 1 : null;
  const touched = Object.values(sh).some((v) => v !== 0);
  const maxAbs = Math.max(1, ...r.exposures.map((e) => Math.abs(e.after - e.before)));
  return html`<div class="card">
    <div class="card-h"><h3><${Icon} n="sliders" cls="sm" />شبیه‌ساز سناریو</h3>
      ${touched && html`<button class="btn sm ghost" onClick=${() => { setSh(ZERO); setPreset(null); }}><${Icon} n="reset" cls="sm" />بازنشانی</button>`}</div>
    <div class="row wrap" style="gap:6px;margin-bottom:14px">${SCENARIOS.map((sc) => html`<button class=${'chip' + (preset === sc.id ? ' on' : '')} onClick=${() => pick(sc)}>${sc.name}</button>`)}</div>
    <div class="why" style="grid-template-columns:1fr 1fr">
      <div class="col" style="gap:14px">
        <${Slider} label="نرخ دلار (بازار آزاد)" value=${sh.usd} onChange=${set('usd')} min=${-50} max=${150} note="روی ارز، طلا، رمزارز و فلزات اثر می‌گذارد" />
        <${Slider} label="انس جهانی طلا (دلاری)" value=${sh.gold} onChange=${set('gold')} min=${-50} max=${100} note=${html`طلای داخلی ≈ <span class="ltr">${goldLocal >= 0 ? '+' : ''}${num(goldLocal, 1)}٪</span>`} />
        <${Slider} label="بورس تهران" value=${sh.equity} onChange=${set('equity')} min=${-60} max=${150} />
        ${more ? html`
          <${Slider} label="رمزارز (دلاری)" value=${sh.crypto} onChange=${set('crypto')} min=${-80} max=${200} />
          <${Slider} label="نقره و مس (دلاری)" value=${sh.metals} onChange=${set('metals')} min=${-50} max=${100} />
          <${Slider} label="سهام غیربورسی" value=${sh.private} onChange=${set('private')} min=${-80} max=${200} />
          <${Slider} label="ملک و خودرو" value=${sh.real} onChange=${set('real')} min=${-50} max=${150} />`
          : html`<button class="btn sm ghost" style="align-self:flex-start" onClick=${() => setMore(true)}><${Icon} n="chevronDown" cls="sm" />متغیرهای بیشتر</button>`}
      </div>
      <div class="col" style="gap:12px">
        <div class="preview" style="flex-direction:column;align-items:stretch;gap:6px">
          <span class="xs muted">ارزش خالص بعد از سناریو</span>
          <span class="v"><${Money} v=${r.after} s=${s} compact /></span>
          <span class=${'sb ' + (r.delta >= 0 ? 'pos' : 'neg')}><span class="ltr">${pct(r.pct)}</span>، <${Money} v=${r.delta} s=${s} compact sign /></span>
        </div>
        <div class="grid2">
          <div class="pcell"><span class="n">بر حسب دلار</span><span class="v"><${Delta} p=${usdTerms} showAbs=${false} /></span></div>
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
  if (topAsset && topAsset.value / g > 0.3) risks.push({ t: `${pct(topAsset.value / g, { sign: false })} از کل دارایی در «${topAsset.asset.name}» است`, d: 'تمرکز بالا روی یک دارایی؛ نوسان آن مستقیماً روی کل ثروت اثر می‌گذارد.', a: topAsset.asset });
  if ((pf.byExposure.rial || 0) / g > 0.4) risks.push({ t: `${pct((pf.byExposure.rial || 0) / g, { sign: false })} از دارایی‌ها ریالی است`, d: 'با تورم بالا، دارایی‌های ریالی بدون سود کافی ارزش واقعی از دست می‌دهند.' });
  if ((pf.byLiquidity.high || 0) / g < 0.1) risks.push({ t: 'نقدینگی در دسترس کمتر از ۱۰٪ است', d: 'برای شرایط اضطراری، بخشی از دارایی را با نقدشوندگی بالا نگه دار.' });
  if (pf.debt > 0 && pf.debt / g > 0.3) risks.push({ t: `نسبت بدهی به دارایی ${pct(pf.debt / g, { sign: false })}`, d: 'بدهی بالا ریسک نقدینگی را زیاد می‌کند.' });
  const perf = pf.rows.filter((r) => r.pnl !== null).sort((a, b) => b.pnl - a.pnl);
  const realReturn = (() => {
    const snaps = st.snapshots; const keys = Object.keys(snaps).sort(); if (keys.length < 2) return null;
    const a = snaps[keys[0]], b = snaps[keys[keys.length - 1]];
    return { days: keys.length, toman: a.t ? b.t / a.t - 1 : null, usd: a.usd && b.usd ? (b.t / b.usd) / (a.t / a.usd) - 1 : null, gold: a.gold && b.gold ? (b.t / b.gold) / (a.t / a.gold) - 1 : null, from: keys[0] };
  })();

  return html`<div class="page">
    <${Scenario} st=${st} pf=${pf} s=${s} />
    <div class="grid-ov">
      <div class="card"><div class="card-h"><h3><${Icon} n="shield" cls="sm" />مواجهه با تورم و ارز</h3><span class="sub">ضدتورمی: ${pct(1 - (pf.byExposure.rial || 0) / g, { sign: false })}</span></div>
        <${StackBar} items=${exItems} height=${14} /><div style="height:14px"></div><${Bars} items=${exItems} s=${s} total=${g} /></div>
      <div class="card"><div class="card-h"><h3><${Icon} n="droplet" cls="sm" />نردبان نقدشوندگی</h3></div>
        <${StackBar} items=${liqItems} height=${14} /><div style="height:14px"></div><${Bars} items=${liqItems} s=${s} total=${g} />
        <div class="xs muted" style="margin-top:8px">بالا: قابل نقد در چند روز (بانک، ارز، صندوق بورسی)، متوسط: چند هفته، پایین: ملک، سهام خصوصی، مطالبات</div></div>
    </div>

    <div class="grid-ov">
      <div class="card"><div class="card-h"><h3><${Icon} n="bank" cls="sm" />تمرکز بر اساس محل نگهداری</h3></div>
        <${Bars} items=${cust} s=${s} total=${g} /></div>
      <div class="card"><div class="card-h"><h3><${Icon} n="alert" cls="sm" />ریسک‌ها و نکات</h3></div>
        ${risks.length ? html`<div class="list">${risks.map((r) => html`<div class="it" style="align-items:flex-start"><span class="ava" style="background:var(--warn-bg);color:var(--warn)"><${Icon} n="alert" /></span>
          <div class="grow"><div class="sb small">${r.t}</div><div class="xs muted">${r.d}</div></div></div>`)}</div>`
          : html`<div class="empty small"><div class="ico"><${Icon} n="check" /></div>ریسک برجسته‌ای در ترکیب فعلی دیده نشد.</div>`}
        ${realReturn && html`<hr class="sep" /><div class="small sb" style="margin-bottom:8px">بازدهی واقعی از ${num(realReturn.days)} روز پیش</div>
          <div class="grid3"><div class="pcell"><span class="n">ریالی</span><span class="v"><${Delta} p=${realReturn.toman} showAbs=${false} /></span></div>
          <div class="pcell"><span class="n">بر حسب دلار</span><span class="v"><${Delta} p=${realReturn.usd} showAbs=${false} /></span></div>
          <div class="pcell"><span class="n">بر حسب طلا</span><span class="v"><${Delta} p=${realReturn.gold} showAbs=${false} /></span></div></div>`}
      </div>
    </div>

    <${Targets} pf=${pf} s=${s} />

    <div class="card"><div class="card-h"><h3><${Icon} n="chart" cls="sm" />سود و زیان دارایی‌ها</h3><span class="sub">${perf.length ? `بر اساس بهای تمام‌شده، کل: ` : 'برای دیدن بازده، بهای تمام‌شده را در دارایی‌ها وارد کن'}${pf.pnl !== null ? html`<${Money} v=${pf.pnl} s=${s} compact sign cls=${pf.pnl >= 0 ? 'pos' : 'neg'} />` : ''}</span></div>
      ${perf.length ? html`<table class="tbl"><thead><tr><th>دارایی</th><th class="n">بهای تمام‌شده</th><th class="n">ارزش روز</th><th class="n">سود / زیان</th><th class="n">بازده</th></tr></thead><tbody>
        ${perf.map((r) => html`<tr class="r" style="cursor:pointer" onClick=${() => open(r.asset)}><td><div class="row"><${Ava} cat=${r.asset.category} size=${28} /><span class="sb">${r.asset.name}</span></div></td>
          <td class="n small"><${Money} v=${r.asset.costBasis} s=${s} compact /></td><td class="n small"><${Money} v=${r.value} s=${s} compact /></td>
          <td class=${'n small ' + (r.pnl >= 0 ? 'pos' : 'neg')}><${Money} v=${r.pnl} s=${s} compact sign /></td><td class="n small"><${Delta} p=${r.ret} showAbs=${false} /></td></tr>`)}
      </tbody></table>` : ''}
    </div>
  </div>`;
}
