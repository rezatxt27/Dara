// Assistant: chat with your portfolio (tool-using AI) + weekly narrative reports.
import { isoFromDate } from '../../lib/jalali.js';
import { html, useState, useEffect, useRef, Icon, Money, Markdown, Modal, toast, send, num, fmtJ, hasChrome } from '../components.js';
import * as AI from '../../lib/ai.js';
import * as A from '../../lib/assistant.js';
import { uid, ago } from '../../lib/format.js';
import { act } from '../actions.js';
import { ProposalCard } from '../proposals.js';

const STEP = {
  get_overview: 'بررسی خلاصه پرتفوی', list_assets: 'خواندن دارایی‌ها', get_prices: 'خواندن قیمت‌ها', explain_change: 'تحلیل تغییرات',
  simulate_scenario: 'شبیه‌سازی سناریو', get_schedule: 'بررسی رویدادهای آینده', get_history: 'بررسی تاریخچه', propose_update: 'آماده‌کردن پیشنهاد', propose_trade: 'آماده‌کردن پیشنهاد',
  explain_value: 'بررسی ریز محاسبه', compare_performance: 'مقایسه با طلا، دلار و سپرده', break_even: 'محاسبه نقطه سربه‌سر', plan_new_money: 'تقسیم پول جدید',
};
const SUGGESTIONS = [
  'امروز ارزش دارایی‌ام چرا تغییر کرد؟',
  'اگر دلار ۳۰٪ گران شود و انس طلا ۱۰٪ بریزد، چه می‌شود؟',
  'چند درصد از دارایی‌ام ریالی است و چه ریسکی دارد؟',
  'تا یک ماه آینده چه سودها و پرداخت‌هایی دارم؟',
  'در سه ماه گذشته واقعاً پولدارتر شدم؟ با طلا، دلار و سپرده مقایسه کن',
  'اگر ۵۰۰ میلیون تومان پول جدید داشته باشم، طبق هدفم کجا بگذارم؟',
];

function Reports({ st, s }) {
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const list = st.reports || [];
  const make = async () => { setBusy(true); const r = await send('weekly', { force: true }); setBusy(false); if (!r?.ok) toast(r?.error || 'ساخت گزارش ممکن نشد'); else toast('گزارش ساخته شد'); };
  const latest = list[0];
  return html`<div class="card" id="reports">
    <div class="card-h"><h3><${Icon} n="file" cls="sm" />گزارش هفتگی</h3><button class="btn sm" onClick=${make} disabled=${busy}><${Icon} n=${busy ? 'refresh' : 'plus'} cls=${'sm' + (busy ? ' spin' : '')} />${busy ? 'در حال ساخت…' : 'ساخت گزارش'}</button></div>
    ${latest ? html`<div class="xs muted" style="margin-bottom:6px">${fmtJ(isoFromDate(new Date(latest.createdAt)))}، ${latest.by === 'ai' ? 'نوشته هوش مصنوعی' : 'خلاصه خودکار'}${latest.aiError ? ' (هوش مصنوعی در دسترس نبود)' : ''}</div>
      <div class="report"><${Markdown} text=${latest.text} /></div>`
      : html`<div class="empty small">هر جمعه عصر خودکار ساخته می‌شود. با «ساخت گزارش» گزارش ۷ روز گذشته را ببین.</div>`}
    ${list.length > 1 && html`<hr class="sep" /><div class="xs muted sb" style="margin-bottom:4px">گزارش‌های قبلی</div>
      <div class="list">${list.slice(1, 12).map((r) => html`<div class="it" style="cursor:pointer;padding:7px 2px" onClick=${() => setView(r)}><${Icon} n="file" cls="sm" /><span class="grow small">هفته منتهی به ${fmtJ(r.weekOf)}</span><span class="xs muted">${r.by === 'ai' ? 'AI' : 'خودکار'}</span></div>`)}</div>`}
    ${view && html`<${Modal} title=${`گزارش هفته منتهی به ${fmtJ(view.weekOf)}`} onClose=${() => setView(null)}><div class="report"><${Markdown} text=${view.text} /></div></${Modal}>`}
  </div>`;
}

export function AssistantPage({ st, s, route }) {
  const [msgs, setMsgs] = useState(() => st.chat?.messages || []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null); // {steps:[], conn}
  const stRef = useRef(st); stRef.current = st;
  const ctlRef = useRef(null);
  const logRef = useRef();
  const conns = AI.orderedConnections(st.ai);
  const active = conns[0];
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [msgs.length, busy?.steps?.length]);
  useEffect(() => { if (route.q.tab === 'reports') document.getElementById('reports')?.scrollIntoView({ behavior: 'smooth' }); }, []);
  // always update from the latest list (an approval made while an answer is pending must not be overwritten)
  const msgsRef = useRef(msgs);
  const persist = (fn) => { const next = typeof fn === 'function' ? fn(msgsRef.current) : fn; msgsRef.current = next; setMsgs(next); act.saveChat(next); };

  const ask = async (q) => {
    q = (q ?? text).trim();
    if (!q || busy) return;
    setText('');
    const privacy = stRef.current.ai.privacy;
    const userMsg = { id: uid('m'), role: 'user', content: q, at: Date.now(), privacy };
    persist((m) => [...m, userMsg]);
    const base = msgsRef.current;
    const proposals = [];
    const steps = [];
    setBusy({ steps: [], conn: active });
    const ctl = new AbortController(); ctlRef.current = ctl;
    try {
      const tools = A.makeTools({ getState: () => stRef.current, privacy, onProposal: (p) => proposals.push(p),
        bubbleStats: async (keys) => { const r = await send('bubbleStats', { keys, days: 90 }); return r?.ok ? r.stats : {}; } });
      // in «only percentages» mode, earlier answers written with full amounts are not sent again
      const history = base.slice(-10).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.error && (privacy !== 'percent' || m.privacy === 'percent'))).map((m) => ({ role: m.role, content: m.content }));
      const res = await AI.runAgent({ ai: stRef.current.ai, system: A.systemPrompt(stRef.current, privacy), messages: history, tools, signal: ctl.signal,
        onStep: (st2) => { if (st2.type === 'tool') { steps.push(st2.name); setBusy((b) => ({ ...b, steps: [...steps] })); } if (st2.type === 'conn') setBusy((b) => ({ ...b, conn: st2.conn })); },
        onConnUpdate: (id, patch) => act.patchConnection(id, patch) });
      persist((m) => [...m, { id: uid('m'), role: 'assistant', content: res.text || '…', at: Date.now(), steps: [...new Set(steps)], proposals, privacy, by: `${res.conn.name}، ${res.model}` }]);
    } catch (e) {
      persist((m) => [...m, { id: uid('m'), role: 'assistant', error: true, content: e.message + (e.detail ? `\n\n${String(e.detail).slice(0, 200)}` : ''), at: Date.now() }]);
    }
    setBusy(null); ctlRef.current = null;
  };
  // «بپرس» buttons elsewhere open this page with ?ask=…: send it once, then clean the address.
  useEffect(() => {
    const q = route.q.ask;
    if (!q) return;
    history.replaceState(null, '', '#/assistant');
    if (active) ask(q); else setText(q);
  }, [route.q.ask]);
  const setPropStatus = (mid, pid, status) => persist((list) => list.map((m) => (m.id === mid ? { ...m, proposals: m.proposals.map((p) => (p.id === pid ? { ...p, status } : p)) } : m)));

  return html`<div class="page">
    <div class="asst">
      <div class="card chat">
        <div class="row between" style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="row"><span class="ava" style="background:var(--accent-soft);color:var(--accent)"><${Icon} n="sparkles" /></span>
            <div><div class="sb">دستیار دارا</div><div class="xs muted">${active ? html`${active.name}، <span class="ltr latin">${active.model}</span>، ${st.ai.privacy === 'percent' ? 'فقط درصدها ارسال می‌شود' : 'ارسال اطلاعات کامل'}` : 'هنوز به هوش مصنوعی وصل نیست'}</div></div></div>
          ${msgs.length > 0 && html`<button class="btn sm ghost" onClick=${() => persist([])}><${Icon} n="reset" cls="sm" />گفتگوی تازه</button>`}
        </div>
        <div class="chat-log" ref=${logRef}>
          ${!active && html`<div class="empty"><div class="ico"><${Icon} n="bot" /></div><div class="sb" style="margin-bottom:6px">دستیار هنوز فعال نیست</div>
            <div class="small" style="margin-bottom:12px">یک اتصال هوش مصنوعی (هر سرویس سازگار با OpenAI، Anthropic یا مدل محلی) اضافه کن.</div>
            <a class="btn primary" href="#/settings" onClick=${() => setTimeout(() => document.getElementById('ai')?.scrollIntoView({ behavior: 'smooth' }), 300)}><${Icon} n="plug" cls="sm" />افزودن اتصال</a></div>`}
          ${active && !msgs.length && html`<div class="empty" style="padding:30px 10px"><div class="ico"><${Icon} n="message" /></div>
            <div class="sb" style="margin-bottom:4px">درباره دارایی‌هایت بپرس</div><div class="small" style="margin-bottom:14px">دستیار به داده‌های واقعی دارا دسترسی دارد، سناریو شبیه‌سازی می‌کند و تغییرات را فقط با تأیید تو اعمال می‌کند.</div>
            <div class="sugg" style="justify-content:center">${SUGGESTIONS.map((q) => html`<button class="chip" onClick=${() => ask(q)}>${q}</button>`)}</div></div>`}
          ${msgs.map((m) => html`<div class=${'msg ' + (m.role === 'user' ? 'user' : 'bot') + (m.error ? ' err' : '')} key=${m.id}>
            ${m.role === 'user' ? m.content : html`<${Markdown} text=${m.content} />`}
            ${m.steps?.length > 0 && html`<div class="steps">${m.steps.map((x) => html`<span class="pill"><${Icon} n="check" cls="sm" />${STEP[x] || x}</span>`)}</div>`}
            ${(m.proposals || []).map((p) => html`<${ProposalCard} p=${p} st=${st} s=${s} onStatus=${(stt) => setPropStatus(m.id, p.id, stt)} />`)}
            ${m.error && html`<div class="row" style="margin-top:6px"><a class="btn sm" href="#/settings">بررسی اتصال‌ها</a></div>`}
            ${m.by && html`<div class="by">${m.by}</div>`}
          </div>`)}
          ${busy && html`<div class="msg bot"><span class="typing"><i></i><i></i><i></i></span>
            <div class="steps">${busy.steps.length ? busy.steps.map((x) => html`<span class="pill"><${Icon} n="refresh" cls="sm" />${STEP[x] || x}</span>`) : html`<span class="pill">${busy.conn ? `در حال فکر کردن با ${busy.conn.name}` : 'در حال فکر کردن…'}</span>`}</div></div>`}
        </div>
        <div class="chat-in">
          <textarea class="input" rows="1" placeholder=${active ? 'سؤالت را بنویس… (Enter ارسال، Shift+Enter خط جدید)' : 'اول یک اتصال اضافه کن'} disabled=${!active} value=${text}
            onInput=${(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; }}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}></textarea>
          ${busy ? html`<button class="btn icon" title="توقف" onClick=${() => ctlRef.current?.abort()}><${Icon} n="stop" /></button>`
            : html`<button class="btn primary icon" title="ارسال" disabled=${!active || !text.trim()} onClick=${() => ask()}><${Icon} n="send" /></button>`}
        </div>
      </div>
      <div class="col" style="gap:18px">
        <${Reports} st=${st} s=${s} />
        <div class="card"><div class="card-h"><h3><${Icon} n="scan" cls="sm" />ثبت از صفحه</h3></div>
          <div class="small ink2" style="line-height:1.9">در سایت پلتفرم طلا، صرافی رمزارز، کارگزاری یا اینترنت‌بانک، روی آیکون دارا بزن و «ثبت از این صفحه» را انتخاب کن (یا راست‌کلیک ← «ثبت موجودی از این صفحه»). دستیار موجودی‌ها را می‌خواند و قبل از ثبت، تغییرات را برای تأیید نشانت می‌دهد.</div></div>
      </div>
    </div>
  </div>`;
}
