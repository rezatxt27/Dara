import { html, useState, useTick, Icon, Money, Ava, Modal, Seg, NumField, MoneyField, JDateField, Toggle, toast, num, pct, fmtJ } from '../components.js';
import { CAT, FLOW_TEMPLATES } from '../../lib/catalog.js';
import * as E from '../../lib/engine.js';
import { todayIso, isoToJ, addDaysIso } from '../../lib/jalali.js';
import { uid, ago } from '../../lib/format.js';
import { act } from '../actions.js';

/* -------------------- suggestions: what could be automated -------------------- */
function suggestions(st, pf) {
  const out = [];
  for (const r of pf.rows) {
    const a = r.asset;
    if (a.mode === 'balance' && (a.category === 'fixed' || a.category === 'receivable')) out.push({ a, r, preset: { mode: 'rate' }, t: 'سود با نرخ ثابت', d: 'ارزش هر روز خودکار رشد کند و سود ماهانه واریز شود' });
    else if (a.mode === 'units' && a.price?.source !== 'market' && ['gold', 'gold_online', 'fx', 'crypto', 'stock', 'fixed'].includes(a.category)) out.push({ a, r, preset: { mode: 'units', source: 'market' }, t: 'اتصال به قیمت آنلاین', d: a.category === 'stock' || a.category === 'fixed' ? 'قیمت از TSETMC یا NAV فیپیران' : 'قیمت زنده از tgju یا نوبیتکس' });
    else if (a.mode === 'balance' && ['gold', 'gold_online', 'fx', 'crypto'].includes(a.category)) out.push({ a, r, preset: { mode: 'units', source: 'market' }, t: 'تعداد × قیمت آنلاین', d: 'مقدار را وارد کن تا ارزش با قیمت روز حساب شود' });
  }
  return out.sort((x, y) => y.r.value - x.r.value);
}

/* -------------------- flow editor -------------------- */
function FlowModal({ st, s, flow, onClose }) {
  const [f, setF] = useState(() => flow || { id: uid('f'), title: '', amount: null, fromId: '', toId: '', freq: 'monthly', day: isoToJ(todayIso()).jd, start: todayIso(), end: null, count: null, active: true, done: 0 });
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const accounts = st.assets.filter((a) => !a.archived);
  const applyTpl = (t) => {
    const bank = accounts.find((a) => a.category === 'bank');
    const debt = accounts.find((a) => a.category === 'debt');
    const gold = accounts.find((a) => a.category === 'gold_online');
    const fixed = accounts.find((a) => a.category === 'fixed');
    const map = { salary: { toId: bank?.id, fromId: '' }, rent: { toId: bank?.id, fromId: '' }, installment: { fromId: bank?.id, toId: debt?.id }, dca: { fromId: bank?.id, toId: gold?.id }, saving: { fromId: bank?.id, toId: fixed?.id }, expense: { fromId: bank?.id, toId: '' } };
    set({ title: t.title, ...(map[t.id] || {}) });
  };
  const past = f.start && !flow ? E.flowOccurrences({ ...f, done: 0 }, '0000-00-00', todayIso(), 400).length : 0;
  const [confirmPast, setConfirmPast] = useState(false);
  const save = async () => {
    if (!f.title.trim() || !(f.amount > 0) || (!f.fromId && !f.toId)) return toast('عنوان، مبلغ و دست‌کم یکی از حساب‌های مبدأ/مقصد لازم است');
    const out = { ...f, fromId: f.fromId || null, toId: f.toId || null };
    if (!flow && past > 0 && !confirmPast) { out.lastRun = todayIso(); out.done = past; } // don't back-apply old occurrences unless asked
    await act.saveFlow(out); onClose();
  };
  const toAsset = accounts.find((a) => a.id === f.toId);
  return html`<${Modal} title=${flow ? 'ویرایش جریان تکراری' : 'جریان تکراری جدید'} onClose=${onClose} footer=${html`${flow && html`<button class="btn danger" onClick=${() => { act.deleteFlow(f.id); onClose(); }}>حذف</button>`}<span class="grow"></span><button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" onClick=${save}>ذخیره</button>`}>
    ${!flow && html`<div class="row wrap" style="gap:6px">${FLOW_TEMPLATES.map((t) => html`<button class="chip" onClick=${() => applyTpl(t)} title=${t.hint}>${t.title}</button>`)}</div>`}
    <div class="field"><label>عنوان</label><input class="input" value=${f.title} onInput=${(e) => set({ title: e.target.value })} placeholder="مثلاً: حقوق ماهانه" /></div>
    <${MoneyField} label="مبلغ هر بار" rial=${f.amount} onRial=${(v) => set({ amount: v })} s=${s} />
    <div class="grid2">
      <div class="field"><label>از (برداشت)</label><select class="input" value=${f.fromId || ''} onChange=${(e) => set({ fromId: e.target.value })}><option value="">— بیرون از دارایی‌ها (درآمد) —</option>${accounts.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select></div>
      <div class="field"><label>به (واریز)</label><select class="input" value=${f.toId || ''} onChange=${(e) => set({ toId: e.target.value })}><option value="">— بیرون از دارایی‌ها (هزینه) —</option>${accounts.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select></div>
    </div>
    ${toAsset?.mode === 'units' && html`<div class="callout"><${Icon} n="info" cls="sm" /><div>واریز به «${toAsset.name}» با قیمت روز به مقدار (${toAsset.unit}) تبدیل می‌شود — مناسب خرید ماهانه طلا یا صندوق.</div></div>`}
    ${CAT[toAsset?.category]?.liability && html`<div class="callout"><${Icon} n="info" cls="sm" /><div>هر قسط از مانده بدهی کم می‌شود.</div></div>`}
    <div class="grid2">
      <div class="field"><label>تکرار</label><${Seg} value=${f.freq} onChange=${(v) => set({ freq: v })} options=${[['monthly', 'ماهانه'], ['weekly', 'هفتگی'], ['yearly', 'سالانه']]} /></div>
      ${f.freq !== 'weekly' && html`<${NumField} label="روز ماه (شمسی)" value=${f.day} onInput=${(v) => set({ day: Math.max(1, Math.min(31, Math.round(v || 1))) })} digits=${0} />`}
    </div>
    <div class="grid2">
      <${JDateField} label="شروع از" iso=${f.start} onIso=${(v) => set({ start: v })} />
      <${JDateField} label="پایان (اختیاری)" iso=${f.end} onIso=${(v) => set({ end: v })} allowEmpty hint="مثلاً سررسید آخرین قسط" />
    </div>
    <${NumField} label="تعداد دفعات (اختیاری)" value=${f.count} onInput=${(v) => set({ count: v ? Math.round(v) : null })} digits=${0} hint="مثلاً ۳۶ قسط" />
    ${!flow && past > 0 && html`<label class="row small" style="cursor:pointer"><input type="checkbox" checked=${confirmPast} onChange=${(e) => setConfirmPast(e.target.checked)} />
      ${num(past)} نوبت از تاریخ شروع تا امروز گذشته؛ آن‌ها هم روی موجودی‌ها اعمال شوند</label>`}
  </${Modal}>`;
}

/* -------------------- page -------------------- */
export function AutomationPage({ st, pf, s, open }) {
  useTick(3000);
  const [flowEdit, setFlowEdit] = useState(null);
  const byId = Object.fromEntries(st.assets.map((a) => [a.id, a]));
  const rates = pf.rows.filter((r) => r.asset.mode === 'rate');
  const banks = pf.rows.filter((r) => r.asset.mode === 'balance' && r.asset.interest?.on);
  const sugg = suggestions(st, pf);
  const up = E.upcoming(st.assets, st.flows, 45);
  const auto = E.monthlyAuto(st.assets, st.flows, st.quotes, s);
  const events = st.events.slice(0, 40);
  const nm = (id) => (id && byId[id] ? byId[id].name : null);

  return html`<div class="page">
    <div class="callout"><${Icon} n="zap" cls="sm" /><div>
      <b>دارا چه چیزهایی را خودش به‌روز می‌کند؟</b> قیمت طلا، سکه، ارز، نمادهای بورسی، NAV صندوق‌ها و رمزارزها هر ${num(s.refreshMinutes)} دقیقه دریافت می‌شود؛
      دارایی‌های <b>درآمد ثابت</b> هر روز طبق نرخ سود رشد می‌کنند و سود ماهانه‌شان به حساب مقصد واریز می‌شود؛ و <b>جریان‌های تکراری</b> مثل حقوق، قسط و خرید ماهانه طلا در موعدشان روی موجودی‌ها اعمال می‌شوند. همه رویدادها قابل برگشت‌اند.
    </div></div>

    <div class="kpis">
      <div class="kpi"><span class="t">سود ماهانه درآمد ثابت</span><span class="v"><${Money} v=${auto.interest} s=${s} compact /></span><span class="s">${num(rates.length)} دارایی با نرخ ثابت</span></div>
      <div class="kpi"><span class="t">ورودی‌های ماهانه</span><span class="v pos"><${Money} v=${auto.inflow} s=${s} compact /></span><span class="s">حقوق، اجاره و…</span></div>
      <div class="kpi"><span class="t">خروجی‌های ماهانه</span><span class="v neg"><${Money} v=${auto.outflow} s=${s} compact /></span><span class="s">هزینه‌های ثابت</span></div>
      <div class="kpi"><span class="t">خالص جریان خودکار</span><span class=${'v ' + (auto.net >= 0 ? 'pos' : 'neg')}><${Money} v=${auto.net} s=${s} compact sign /></span><span class="s">در ماه</span></div>
    </div>

    ${sugg.length > 0 && html`<div class="card">
      <div class="card-h"><h3><${Icon} n="sparkles" cls="sm" />پیشنهاد خودکارسازی</h3><span class="sub">این دارایی‌ها هنوز دستی به‌روز می‌شوند</span></div>
      <div class="list">${sugg.map((x) => html`<div class="it"><${Ava} cat=${x.a.category} size=${32} />
        <div class="grow"><div class="sb">${x.a.name} <span class="xs muted">${x.a.custodian || ''}</span></div><div class="xs muted">${x.t} — ${x.d}</div></div>
        <span class="small"><${Money} v=${x.r.value} s=${s} compact /></span>
        <button class="btn sm primary" onClick=${() => open(x.a, x.preset)}><${Icon} n="zap" cls="sm" />خودکار کن</button></div>`)}</div>
    </div>`}

    <div class="grid-ov">
      <div class="card">
        <div class="card-h"><h3><${Icon} n="percent" cls="sm" />سودهای روزشمار</h3><button class="btn sm" onClick=${() => open(null, { category: 'fixed', mode: 'rate' })}><${Icon} n="plus" cls="sm" />افزودن</button></div>
        ${banks.length > 0 && html`<div class="list" style="margin-bottom:6px">${banks.map((r) => {
          const it = r.asset.interest; let nd = addDaysIso(todayIso(), 1); let g = 0; while (!E.isPayDay(nd, it.payDay) && g++ < 40) nd = addDaysIso(nd, 1);
          return html`<div class="it" style="cursor:pointer;align-items:flex-start" onClick=${() => open(r.asset)}><${Ava} cat=${r.asset.category} size=${34} />
            <div class="grow"><div class="sb">${r.asset.name}</div>
              <div class="xs muted">حساب روزشمار، ${num(it.annualPct, 2)}٪ سالانه، سود هر روز <${Money} v=${(+r.asset.balance || 0) * it.annualPct / 100 / 365} s=${s} compact /></div>
              <div class="xs" style="margin-top:3px"><${Icon} n="calendar" cls="sm" /> واریز بعدی ${fmtJ(nd, 'dm')}</div></div>
            <div style="text-align:left"><div class="sb"><${Money} v=${r.value} s=${s} /></div><div class="xs pos num">+<${Money} v=${r.accrued} s=${s} unit=${false} /> سود انباشته</div></div></div>`;
        })}</div>`}
        ${rates.length ? html`<div class="list">${rates.map((r) => {
          const a = r.asset, rt = a.rate;
          const accrued = rt.mode === 'payout' ? r.value - rt.principal : r.value - rt.principal;
          const next = rt.mode === 'payout' ? E.nextMonthlyAfter(rt.start, rt.start > todayIso() ? rt.start : todayIso()) : null;
          return html`<div class="it" style="cursor:pointer;align-items:flex-start" onClick=${() => open(a)}><${Ava} cat=${a.category} size=${34} />
            <div class="grow"><div class="sb">${a.name}</div>
              <div class="xs muted">روزشمار ${num(rt.annualPct, 2)}٪، ${rt.mode === 'payout' ? 'واریز ماهانه' : rt.mode === 'compound' ? 'مرکب' : 'ساده'}، سود هر روز <${Money} v=${E.rateDaily(rt, r.value)} s=${s} compact />، اصل <${Money} v=${rt.principal} s=${s} compact />${rt.maturity ? '، سررسید ' + fmtJ(rt.maturity) : ''}</div>
              ${rt.mode === 'payout' && next && html`<div class="xs" style="margin-top:3px"><${Icon} n="calendar" cls="sm" /> واریز بعدی ${fmtJ(next, 'dm')} — حدود <${Money} v=${E.rateMonthly(rt, r.value)} s=${s} compact /> به ${rt.payoutTo && rt.payoutTo !== 'self' ? (nm(rt.payoutTo) || 'حساب حذف‌شده') : 'خود دارایی'}</div>`}</div>
            <div style="text-align:left"><div class="sb"><${Money} v=${r.value} s=${s} /></div><div class="xs pos num">+<${Money} v=${accrued} s=${s} unit=${false} /> سود ${rt.mode === 'payout' ? 'این دوره' : 'تاکنون'}</div></div></div>`;
        })}</div>` : !banks.length ? html`<div class="empty small">سپرده، صندوق درآمد ثابت یا شراکتی که سود سالانه مشخص دارد را اضافه کن؛ سودش هر روز حساب و به ارزش اضافه می‌شود. برای حساب کوتاه‌مدت بانکی، «سود روزشمار» را در خود حساب روشن کن.</div>` : ''}
      </div>

      <div class="card">
        <div class="card-h"><h3><${Icon} n="repeat" cls="sm" />جریان‌های تکراری</h3><button class="btn sm" onClick=${() => setFlowEdit({})}><${Icon} n="plus" cls="sm" />جریان جدید</button></div>
        ${st.flows.length ? html`<div class="list">${st.flows.map((f) => html`<div class="it">
          <span class="ava" style=${`background:${f.toId && !f.fromId ? 'var(--pos-bg)' : !f.toId ? 'var(--neg-bg)' : 'var(--accent-soft)'};color:${f.toId && !f.fromId ? 'var(--pos)' : !f.toId ? 'var(--neg)' : 'var(--accent)'}`}><${Icon} n=${f.toId && !f.fromId ? 'arrowDown' : !f.toId ? 'arrowUp' : 'swap'} /></span>
          <div class="grow" style="cursor:pointer" onClick=${() => setFlowEdit({ flow: f })}><div class="sb">${f.title}</div>
            <div class="xs muted">${f.freq === 'monthly' ? `ماهانه، روز ${num(f.day)}` : f.freq === 'weekly' ? 'هفتگی' : 'سالانه'}، ${nm(f.fromId) || 'بیرون'} ← ${nm(f.toId) || 'بیرون'}${f.count ? `، ${num(f.done || 0)} از ${num(f.count)}` : ''}${f.lastRun ? '، آخرین: ' + fmtJ(f.lastRun, 'dm') : ''}</div></div>
          <span class="small sb"><${Money} v=${f.amount} s=${s} compact /></span>
          <${Toggle} on=${f.active} onChange=${(v) => act.saveFlow({ ...f, active: v, lastRun: v && !f.active ? todayIso() : f.lastRun })} title="فعال/غیرفعال" /></div>`)}</div>`
          : html`<div class="empty small">حقوق ماهانه، قسط وام، اجاره، یا «هر ماه ۵ میلیون طلا بخر» را تعریف کن تا خودکار روی حساب‌ها اعمال شود.</div>`}
      </div>
    </div>

    <div class="grid-ov">
      <div class="card"><div class="card-h"><h3><${Icon} n="calendar" cls="sm" />تقویم ۴۵ روز آینده</h3></div>
        ${up.length ? html`<div class="list">${up.slice(0, 12).map((e) => html`<div class="it">
          <div style="width:46px;text-align:center;flex:none"><div class="lg b" style="line-height:1">${num(isoToJ(e.date).jd)}</div><div class="xs muted">${fmtJ(e.date, 'dm').split(' ')[1]}</div></div>
          <div class="grow"><div class="sb small">${e.title}</div><div class="xs muted">${e.kind === 'interest' ? 'واریز سود' : e.kind === 'maturity' ? 'سررسید' : 'جریان تکراری'}${e.toId && nm(e.toId) ? '، به ' + nm(e.toId) : ''}</div></div>
          <span class="small"><${Money} v=${e.amount} s=${s} compact /></span></div>`)}</div>` : html`<div class="empty small">رویدادی برنامه‌ریزی نشده.</div>`}
      </div>
      <div class="card"><div class="card-h"><h3><${Icon} n="clock" cls="sm" />گزارش رویدادها</h3><span class="sub">قابل برگشت</span></div>
        ${events.length ? html`<div class="list">${events.map((e) => html`<div class="it" style=${e.undone ? 'opacity:.45' : ''}>
          <span class="ava" style="background:var(--surface-3);color:var(--ink-2)"><${Icon} n=${e.kind === 'interest' ? 'percent' : e.kind === 'trade' ? 'swap' : e.kind === 'capture' ? 'scan' : e.kind === 'adjust' || e.kind === 'edit' ? 'edit' : 'repeat'} /></span>
          <div class="grow"><div class="sb small">${e.title}</div><div class="xs muted">${fmtJ(e.date)}، ${ago(e.at)}${e.undone ? '، برگشت داده شد' : ''}</div></div>
          ${e.amount ? html`<span class="small"><${Money} v=${e.amount} s=${s} compact /></span>` : ''}
          ${!e.undone && e.changes?.length ? html`<button class="btn icon sm ghost" title="برگشت" onClick=${() => act.undoEvent(e)}><${Icon} n="undo" cls="sm" /></button>` : ''}</div>`)}</div>`
          : html`<div class="empty small">هنوز رویدادی ثبت نشده.</div>`}
      </div>
    </div>
    ${flowEdit && html`<${FlowModal} st=${st} s=${s} flow=${flowEdit.flow} onClose=${() => setFlowEdit(null)} />`}
  </div>`;
}
