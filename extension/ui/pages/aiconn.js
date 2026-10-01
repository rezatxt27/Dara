// Settings → AI connections: add several services, pick the active one, test connectivity.
import { html, useState, Icon, Seg, Toggle, toast, hasChrome, num } from '../components.js';
import * as AI from '../../lib/ai.js';
import { uid, ago } from '../../lib/format.js';
import { act } from '../actions.js';

/** Must be called synchronously inside a click handler (user gesture) */
function requestHost(baseUrl) {
  const pattern = AI.permissionPattern(baseUrl);
  if (!pattern || !hasChrome || !chrome.permissions) return Promise.resolve(true);
  return chrome.permissions.request({ origins: [pattern] }).catch(() => false);
}

function blankConn(service = 'custom') {
  const sv = AI.SERVICES[service];
  return { id: uid('c'), service, api: sv.api, name: '', baseUrl: sv.base, apiKey: '', model: '', fastModel: '' };
}

function ConnForm({ initial, onDone, onCancel }) {
  const [c, setC] = useState(() => ({ ...initial }));
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState(null);
  const [busy, setBusy] = useState(null);
  const [res, setRes] = useState(initial.lastTest || null);
  const sv = AI.SERVICES[c.service] || AI.SERVICES.custom;
  const set = (p) => setC((x) => ({ ...x, ...p }));
  const pickService = (id) => { const s2 = AI.SERVICES[id]; set({ service: id, api: s2.api, baseUrl: s2.base || (c.service === 'custom' ? c.baseUrl : ''), model: '', fastModel: '' }); setModels(null); };
  const valid = (c.baseUrl || '').trim() && c.model.trim() && (sv.noKey || c.apiKey.trim() || c.service === 'custom');
  const norm = () => ({ ...c, name: c.name.trim() || sv.name, baseUrl: c.baseUrl.trim(), apiKey: c.apiKey.trim(), model: c.model.trim(), fastModel: c.fastModel.trim() });

  const test = (e) => {
    e?.preventDefault?.();
    if (!valid) return toast('سرویس، آدرس، کلید و مدل را کامل کن');
    const p = requestHost(c.baseUrl); // keep inside the gesture
    (async () => {
      if (!(await p)) return toast('برای اتصال، اجازه دسترسی به این دامنه لازم است');
      setBusy('test'); setRes(null);
      try {
        const r = await AI.testConnection(norm());
        const out = { ok: true, at: Date.now(), ms: r.ms, reply: r.reply, model: r.model, supportsTools: r.supportsTools, fastOk: r.fastOk };
        setRes(out); set({ supportsTools: r.supportsTools, lastTest: out });
      } catch (err) {
        const out = { ok: false, at: Date.now(), msg: err.message, detail: err.detail };
        setRes(out); set({ lastTest: out });
      }
      setBusy(null);
    })();
  };
  const save = () => {
    if (!valid) return toast('سرویس، آدرس، کلید و مدل را کامل کن');
    const p = requestHost(c.baseUrl);
    (async () => {
      if (!(await p)) return toast('بدون اجازه دسترسی به این دامنه، اتصال کار نمی‌کند');
      await act.saveConnection({ ...norm(), lastTest: res || c.lastTest || null, supportsTools: c.supportsTools ?? null });
      toast('اتصال ذخیره شد'); onDone();
    })();
  };
  const loadModels = () => {
    const p = requestHost(c.baseUrl);
    (async () => {
      if (!(await p)) return;
      setBusy('models');
      try { const list = await AI.listModels(norm()); setModels(list); if (!list.length) toast('فهرستی برنگشت؛ نام مدل را دستی وارد کن'); }
      catch (err) { toast('دریافت فهرست مدل‌ها ممکن نشد: ' + err.message); }
      setBusy(null);
    })();
  };
  return html`<div class="sec" style="background:var(--surface-2)">
    <div class="st">${initial.createdAt ? 'ویرایش اتصال' : 'افزودن اتصال جدید'}</div>
    <div class="grid2">
      <div class="field"><label>سرویس</label><select class="input" value=${c.service} onChange=${(e) => pickService(e.target.value)}>${Object.entries(AI.SERVICES).map(([k, v]) => html`<option value=${k}>${v.name}</option>`)}</select></div>
      <div class="field"><label>نام دلخواه</label><input class="input" value=${c.name} placeholder=${'مثلاً ' + sv.name + ' کاری'} onInput=${(e) => set({ name: e.target.value })} /></div>
    </div>
    <div class="field"><label>آدرس سرویس (Base URL)</label><input class="input num-in" dir="ltr" value=${c.baseUrl} placeholder=${sv.baseHint || 'https://…/v1'} onInput=${(e) => set({ baseUrl: e.target.value })} />
      <span class="hint">${c.api === 'anthropic' ? 'API بومی Anthropic (Messages)' : 'سازگار با OpenAI (chat/completions)'}${sv.baseHint ? '، ' + sv.baseHint : ''}</span></div>
    <div class="grid2">
      <div class="field"><label>کلید API</label><div class="input-wrap"><input class="input num-in" dir="ltr" type=${showKey ? 'text' : 'password'} value=${c.apiKey} placeholder=${sv.noKey ? 'لازم نیست' : sv.keyHint || ''} onInput=${(e) => set({ apiKey: e.target.value })} style="padding-left:40px" autocomplete="off" />
        <button type="button" class="cal-btn" onClick=${() => setShowKey(!showKey)} aria-label="نمایش کلید"><${Icon} n=${showKey ? 'eyeOff' : 'eye'} cls="sm" /></button></div></div>
      <div class="field"><label>مدل اصلی</label><div class="input-wrap"><input class="input num-in" dir="ltr" list="dara-models" value=${c.model} placeholder=${sv.modelHint || 'نام مدل'} onInput=${(e) => set({ model: e.target.value })} style="padding-left:40px" />
        <button type="button" class="cal-btn" title="دریافت فهرست مدل‌ها" onClick=${loadModels}><${Icon} n=${busy === 'models' ? 'refresh' : 'chevronDown'} cls=${'sm' + (busy === 'models' ? ' spin' : '')} /></button></div>
        ${models && html`<datalist id="dara-models">${models.slice(0, 400).map((m) => html`<option value=${m} />`)}</datalist>`}
        ${models && html`<span class="hint">${num(models.length)} مدل پیدا شد — تایپ کن تا فیلتر شود</span>`}</div>
    </div>
    <div class="field"><label>مدل سریع و ارزان (اختیاری)</label><input class="input num-in" dir="ltr" list="dara-models" value=${c.fastModel} placeholder="خالی = همان مدل اصلی" onInput=${(e) => set({ fastModel: e.target.value })} />
      <span class="hint">برای کارهای ساده مثل خواندن موجودی از صفحه استفاده می‌شود.</span></div>
    ${res && html`<div class=${'callout ' + (res.ok ? '' : 'err')}><${Icon} n=${res.ok ? 'circleCheck' : 'circleX'} cls="sm" /><div>
      ${res.ok ? html`<b class="test-ok">متصل است</b>، ${num(res.ms)} میلی‌ثانیه، پاسخ مدل: «${res.reply}»<br />
        فراخوانی ابزار: ${res.supportsTools ? html`<b>پشتیبانی می‌شود</b>` : 'پشتیبانی نمی‌شود — دستیار از حالت متنی سازگار استفاده می‌کند'}${res.fastOk === false ? html`<br /><span class="warn">مدل سریع پاسخ نداد؛ نامش را بررسی کن.</span>` : ''}`
        : html`<b class="test-bad">وصل نشد:</b> ${res.msg}${res.detail ? html`<div class="xs muted" style="direction:ltr;text-align:left;margin-top:4px">${String(res.detail).slice(0, 220)}</div>` : ''}`}
    </div></div>`}
    <div class="row">
      <button class="btn primary" onClick=${save} disabled=${!!busy}><${Icon} n="check" cls="sm" />ذخیره اتصال</button>
      <button class="btn" onClick=${test} disabled=${!!busy}><${Icon} n=${busy === 'test' ? 'refresh' : 'plug'} cls=${'sm' + (busy === 'test' ? ' spin' : '')} />${busy === 'test' ? 'در حال تست…' : 'تست اتصال'}</button>
      <span class="grow"></span>
      <button class="btn ghost" onClick=${onCancel}>انصراف</button>
    </div>
  </div>`;
}

export function AIConnections({ st }) {
  const ai = st.ai;
  const [form, setForm] = useState(null);
  const [testing, setTesting] = useState(null);
  const conns = ai.connections || [];
  const quickTest = (c) => {
    const p = requestHost(c.baseUrl);
    (async () => {
      if (!(await p)) return;
      setTesting(c.id);
      try {
        const r = await AI.testConnection(c);
        await act.patchConnection(c.id, { supportsTools: r.supportsTools, lastTest: { ok: true, at: Date.now(), ms: r.ms, reply: r.reply, supportsTools: r.supportsTools } });
        toast(`«${c.name}» متصل است (${num(r.ms)} میلی‌ثانیه)`);
      } catch (err) {
        await act.patchConnection(c.id, { lastTest: { ok: false, at: Date.now(), msg: err.message, detail: err.detail } });
        toast(`«${c.name}» وصل نشد: ${err.message}`);
      }
      setTesting(null);
    })();
  };
  return html`<div class="card" id="ai">
    <div class="card-h"><h3><${Icon} n="sparkles" cls="sm" />هوش مصنوعی — اتصال‌ها</h3>${!form && html`<button class="btn sm primary" onClick=${() => setForm(blankConn())}><${Icon} n="plus" cls="sm" />اتصال جدید</button>`}</div>
    <div class="small muted" style="margin-bottom:12px">چند سرویس اضافه کن تا اگر یکی جواب نداد، بعدی استفاده شود. اتصالِ انتخاب‌شده برای دستیار، گزارش هفتگی و ثبت از صفحه به کار می‌رود. کلیدها فقط روی همین مرورگر می‌مانند و در فایل پشتیبان ذخیره نمی‌شوند.</div>
    <div class="col">
      ${conns.map((c) => {
        const t = c.lastTest;
        return html`<div class=${'conn' + (ai.activeId === c.id ? ' on' : '')} onClick=${() => act.setAI({ activeId: c.id })} role="radio" aria-checked=${ai.activeId === c.id}>
          <span class="radio"></span>
          <div class="grow" style="min-width:0">
            <div class="row" style="gap:8px"><span class="sb">${c.name}</span>${ai.activeId === c.id && html`<span class="pill auto">فعال</span>`}
              ${t && html`<span class=${'pill ' + (t.ok ? 'live' : 'error')} title=${t.msg || ''}>${t.ok ? `متصل، ${num(t.ms)} میلی‌ثانیه` : 'خطا'}</span>`}
              ${c.supportsTools === false && html`<span class="pill" title="مدل فراخوانی ابزار ندارد؛ از حالت متنی استفاده می‌شود">حالت متنی</span>`}</div>
            <div class="meta ellipsis">${AI.SERVICES[c.service]?.name || c.service}، مدل <span class="ltr latin">${c.model}</span>${c.fastModel ? html`، سریع <span class="ltr latin">${c.fastModel}</span>` : ''}</div>
            ${t && !t.ok && html`<div class="xs neg">${t.msg}</div>`}
          </div>
          <div class="row" style="gap:4px" onClick=${(e) => e.stopPropagation()}>
            <button class="btn sm" onClick=${() => quickTest(c)} disabled=${testing === c.id}><${Icon} n=${testing === c.id ? 'refresh' : 'plug'} cls=${'sm' + (testing === c.id ? ' spin' : '')} />تست</button>
            <button class="btn sm" onClick=${() => setForm({ ...c })}>ویرایش</button>
            <button class="btn sm ghost danger" onClick=${() => { if (confirm(`اتصال «${c.name}» حذف شود؟`)) act.deleteConnection(c.id); }}>حذف</button>
          </div>
        </div>`;
      })}
      ${!conns.length && !form && html`<div class="empty small"><div class="ico"><${Icon} n="bot" /></div>هنوز اتصالی تعریف نشده. با یک کلید API از هر سرویس سازگار با OpenAI، یا OpenRouter، OpenAI، Anthropic، یا یک مدل محلی (Ollama) شروع کن.</div>`}
      ${form && html`<${ConnForm} initial=${form} onDone=${() => setForm(null)} onCancel=${() => setForm(null)} />`}
    </div>
    <hr class="sep" />
    <div class="row between" style="padding:6px 0;gap:16px"><div><div class="sb">اطلاعاتی که به هوش مصنوعی ارسال می‌شود</div><div class="xs muted">«فقط درصد» یعنی مبالغ مطلق هرگز ارسال نمی‌شوند؛ دستیار با سهم‌ها و درصدها پاسخ می‌دهد.</div></div>
      <${Seg} value=${ai.privacy} onChange=${(v) => act.setAI({ privacy: v })} options=${[['full', 'کامل'], ['percent', 'فقط درصد']]} /></div>
    <div class="row between" style="padding:6px 0;gap:16px"><div><div class="sb">استفاده از اتصال بعدی در صورت خطا</div><div class="xs muted">اگر اتصال فعال جواب نداد، اتصال‌های دیگر به ترتیب امتحان شوند.</div></div><${Toggle} on=${ai.fallback} onChange=${(v) => act.setAI({ fallback: v })} /></div>
    <div class="row between" style="padding:6px 0;gap:16px"><div><div class="sb">گزارش هفتگی خودکار</div><div class="xs muted">جمعه‌ها بعد از ساعت ۱۸ ساخته می‌شود؛ بدون اتصال هوش مصنوعی، نسخه خلاصه خودکار ساخته می‌شود.</div></div><${Toggle} on=${ai.weekly} onChange=${(v) => act.setAI({ weekly: v })} /></div>
  </div>`;
}
