// Provider-agnostic AI client: OpenAI-compatible (any compatible provider, OpenAI, OpenRouter, Gemini, DeepSeek, Groq, Ollama…)
// and Anthropic Messages API. Supports native tool calling, with a text protocol fallback for models without tools.

export const SERVICES = {
  custom: { name: 'سرویس سازگار با OpenAI', api: 'openai', base: '', keyHint: 'کلید API از پنل سرویس‌دهنده', baseHint: 'آدرس API سازگار با OpenAI از پنل سرویس‌دهنده (معمولاً با /v1 تمام می‌شود)' },
  openrouter: { name: 'OpenRouter', api: 'openai', base: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', modelHint: 'مثلاً anthropic/claude-sonnet-5.5' },
  openai: { name: 'OpenAI', api: 'openai', base: 'https://api.openai.com/v1', keyHint: 'sk-…' },
  anthropic: { name: 'Anthropic (Claude)', api: 'anthropic', base: 'https://api.anthropic.com', keyHint: 'sk-ant-…', modelHint: 'مثلاً claude-sonnet-5-5' },
  gemini: { name: 'Google Gemini', api: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…' },
  deepseek: { name: 'DeepSeek', api: 'openai', base: 'https://api.deepseek.com/v1', keyHint: 'sk-…' },
  groq: { name: 'Groq', api: 'openai', base: 'https://api.groq.com/openai/v1', keyHint: 'gsk_…' },
  ollama: { name: 'Ollama (روی همین کامپیوتر)', api: 'openai', base: 'http://localhost:11434/v1', noKey: true, modelHint: 'مثلاً llama3.1' },
};

let _fetch = (...a) => fetch(...a);
export function setAIFetch(f) { _fetch = f; }

/** Older saves may name a provider that is no longer listed: treat it as a generic OpenAI-compatible service. */
export function normalizeConnection(c) {
  if (!c || SERVICES[c.service]) return c;
  return { ...c, service: c.api === 'anthropic' ? 'anthropic' : 'custom', name: c.name === 'ستون (Sotoon)' ? 'اتصال من' : c.name };
}

export class AIError extends Error {
  constructor(msg, { status = 0, detail = '', retryable = true, toolsUnsupported = false } = {}) {
    super(msg); this.status = status; this.detail = detail; this.retryable = retryable; this.toolsUnsupported = toolsUnsupported;
  }
}

export function originOf(base) { try { const u = new URL(base); return `${u.protocol}//${u.host}`; } catch { return null; } }
export function permissionPattern(base) { const o = originOf(base); return o ? o + '/*' : null; }

export function endpoint(conn, path) {
  let base = (conn.baseUrl || SERVICES[conn.service]?.base || '').trim().replace(/\/+$/, '');
  if (!base) throw new AIError('آدرس سرویس (Base URL) خالی است', { retryable: false });
  if (conn.api === 'anthropic') return base.replace(/\/v1$/, '') + '/v1' + path;
  try { const u = new URL(base); if (u.pathname === '' || u.pathname === '/') base += '/v1'; } catch { throw new AIError('آدرس سرویس معتبر نیست', { retryable: false }); }
  return base + path;
}

function headersFor(conn) {
  const h = { 'Content-Type': 'application/json' };
  if (conn.api === 'anthropic') {
    h['x-api-key'] = conn.apiKey || '';
    h['anthropic-version'] = '2023-06-01';
    h['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (conn.apiKey) h.Authorization = `Bearer ${conn.apiKey}`;
  if (conn.service === 'openrouter') { h['X-Title'] = 'Dara Asset Manager'; h['HTTP-Referer'] = 'https://dara.local'; }
  return h;
}

function friendly(status, msg) {
  const m = String(msg || '');
  if (status === 401) return 'کلید API نامعتبر است یا منقضی شده';
  if (status === 402) return 'اعتبار حساب این سرویس تمام شده';
  if (status === 403) return 'دسترسی رد شد — ممکن است این سرویس در منطقه شما در دسترس نباشد';
  if (status === 404) return /model/i.test(m) ? 'نام مدل پیدا نشد' : 'آدرس سرویس یا مدل اشتباه است';
  if (status === 429) return 'محدودیت تعداد درخواست یا سهمیه حساب';
  if (status >= 500) return 'سرویس هوش مصنوعی موقتاً در دسترس نیست';
  if (status === 400) return 'درخواست توسط سرویس پذیرفته نشد';
  return 'خطا در سرویس هوش مصنوعی';
}

async function post(conn, url, body, signal, timeout = 90000) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener?.('abort', onAbort);
  const t = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await _fetch(url, { method: 'POST', headers: headersFor(conn), body: JSON.stringify(body), signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
  } catch (e) {
    clearTimeout(t); signal?.removeEventListener?.('abort', onAbort);
    if (signal?.aborted) throw new AIError('لغو شد', { retryable: false });
    if (e.name === 'AbortError') throw new AIError('پاسخ سرویس بیش از حد طول کشید');
    throw new AIError('اتصال به سرویس برقرار نشد', { detail: String(e.message || e) });
  }
  // the timeout and the Stop button keep working while the body is read (some services send headers early)
  let text;
  try { text = await r.text(); } catch (e) {
    if (signal?.aborted) throw new AIError('لغو شد', { retryable: false });
    throw new AIError(e.name === 'AbortError' ? 'پاسخ سرویس بیش از حد طول کشید' : 'خواندن پاسخ سرویس ممکن نشد');
  } finally { clearTimeout(t); signal?.removeEventListener?.('abort', onAbort); }
  let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const detail = j?.error?.message || j?.message || j?.detail || text.slice(0, 300);
    const toolsUnsupported = r.status === 400 || r.status === 404 || r.status === 422 ? /tool|function/i.test(detail) : false;
    throw new AIError(friendly(r.status, detail), { status: r.status, detail, retryable: r.status !== 400 || toolsUnsupported, toolsUnsupported });
  }
  if (!j) throw new AIError('پاسخ نامعتبر از سرویس', { detail: text.slice(0, 200) });
  if (j.error) throw new AIError(friendly(j.error.code || 0, j.error.message), { detail: j.error.message || '' });
  return j;
}

/* ---------------- message format conversion ---------------- */
// internal: {role:'user'|'assistant'|'tool', content, toolCalls?:[{id,name,args}], toolCallId?, name?}
function toOpenAI(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length) out.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) });
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}
function toAnthropic(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      out.push({ role: 'assistant', content });
    } else {
      const last = out[out.length - 1];
      if (last && last.role === m.role && typeof last.content === 'string') last.content += '\n\n' + m.content;
      else out.push({ role: m.role, content: m.content });
    }
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '.' });
  return out;
}

/** One model call. Returns { text, toolCalls, model, usage } */
export async function chat(conn, { model, system, messages, tools, maxTokens = 1200, temperature = 0.3, signal, timeout } = {}) {
  model = model || conn.model;
  if (!model) throw new AIError('نام مدل مشخص نشده', { retryable: false });
  if (!SERVICES[conn.service]?.noKey && !conn.apiKey && conn.service !== 'custom') throw new AIError('کلید API وارد نشده', { retryable: false });
  if (conn.api === 'anthropic') {
    const body = { model, max_tokens: maxTokens, temperature, system: system || undefined, messages: toAnthropic(messages) };
    if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
    const j = await post(conn, endpoint(conn, '/messages'), body, signal, timeout);
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const toolCalls = (j.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
    return { text, toolCalls, model: j.model || model, usage: j.usage };
  }
  const body = { model, messages: toOpenAI(system, messages), max_tokens: maxTokens, temperature };
  if (tools?.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  const j = await post(conn, endpoint(conn, '/chat/completions'), body, signal, timeout);
  const msg = j.choices?.[0]?.message || {};
  let text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : '';
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // reasoning models
  const toolCalls = (msg.tool_calls || []).map((c, i) => {
    let args = {}; try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}); } catch { args = {}; }
    return { id: c.id || `call_${i}`, name: c.function?.name, args };
  }).filter((c) => c.name);
  return { text, toolCalls, model: j.model || model, usage: j.usage };
}

/** List models offered by the endpoint (best effort) */
export async function listModels(conn) {
  const url = endpoint(conn, '/models');
  const r = await _fetch(url, { headers: headersFor(conn), credentials: 'omit' });
  if (!r.ok) throw new AIError(friendly(r.status, ''), { status: r.status });
  const j = await r.json();
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}

/** Connection test: a tiny completion, then a tool-calling probe. */
export async function testConnection(conn, { signal } = {}) {
  const t0 = performance.now();
  const r = await chat(conn, { system: 'You are a connectivity check.', messages: [{ role: 'user', content: 'Reply with exactly: OK' }], maxTokens: 16, temperature: 0, signal, timeout: 30000 });
  const ms = Math.round(performance.now() - t0);
  let supportsTools = false;
  try {
    const tr = await chat(conn, { system: 'Use the tool when asked.', messages: [{ role: 'user', content: 'Call the ping tool now.' }], maxTokens: 60, temperature: 0, signal, timeout: 30000,
      tools: [{ name: 'ping', description: 'Connectivity probe. Call it when asked.', schema: { type: 'object', properties: {}, required: [] } }] });
    supportsTools = tr.toolCalls.some((c) => c.name === 'ping');
  } catch { supportsTools = false; }
  let fastOk = null;
  if (conn.fastModel && conn.fastModel !== conn.model) {
    try { await chat(conn, { model: conn.fastModel, messages: [{ role: 'user', content: 'Reply with: OK' }], maxTokens: 8, temperature: 0, signal, timeout: 30000 }); fastOk = true; } catch { fastOk = false; }
  }
  return { ok: true, ms, reply: (r.text || '').slice(0, 40), model: r.model, supportsTools, fastOk };
}

/* ---------------- robust JSON extraction ---------------- */
export function extractJSON(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cands = [fence?.[1], text];
  for (const c of cands) {
    if (!c) continue;
    const s = c.indexOf('{'); const e = c.lastIndexOf('}');
    if (s >= 0 && e > s) { try { return JSON.parse(c.slice(s, e + 1)); } catch { /* next */ } }
  }
  return null;
}

/* ---------------- agent loop ---------------- */
const TOOL_TAG = /<<tool>>\s*([\s\S]*?)\s*<<\/tool>>/;
function textToolPrompt(tools) {
  return `\n\nابزارها (فقط از همین فهرست):\n${tools.map((t) => `- ${t.name}: ${t.description} — ورودی: ${JSON.stringify(t.schema.properties || {})}`).join('\n')}\n
برای استفاده از ابزار، فقط و فقط یک خط به این شکل بنویس و هیچ متن دیگری ننویس:
<<tool>>{"name":"نام_ابزار","args":{...}}<</tool>>
بعد از دیدن نتیجه، پاسخ نهایی را به فارسی بنویس.`;
}

/**
 * Run a tool-using conversation.
 * ai: settings {connections, activeId, fallback}; tools: [{name, description, schema, run(args)}]
 * onStep({type:'tool'|'conn', name, conn}) for progress UI. Returns { text, conn, model, steps, mode }.
 */
export async function runAgent({ ai, system, messages, tools = [], onStep = () => {}, maxSteps = 6, signal, purpose = 'main', maxTokens = 1400, onConnUpdate }) {
  const conns = orderedConnections(ai);
  if (!conns.length) throw new AIError('هیچ اتصال هوش مصنوعی فعالی تعریف نشده', { retryable: false });
  let lastErr;
  for (const conn of conns) {
    onStep({ type: 'conn', conn });
    try {
      return await agentLoop(conn, { system, messages, tools, onStep, maxSteps, signal, purpose, maxTokens, onConnUpdate });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted || e.retryable === false || !ai.fallback) throw e;
    }
  }
  throw lastErr;
}

export function orderedConnections(ai) {
  const list = (ai?.connections || []).filter((c) => !c.disabled);
  const active = list.find((c) => c.id === ai.activeId) || list[0];
  return active ? [active, ...list.filter((c) => c !== active)] : [];
}

async function agentLoop(conn, { system, messages, tools, onStep, maxSteps, signal, purpose, maxTokens, onConnUpdate }) {
  const model = purpose === 'fast' && conn.fastModel ? conn.fastModel : conn.model;
  let mode = !tools.length ? 'none' : conn.supportsTools === false ? 'text' : 'native';
  const msgs = [...messages];
  const steps = [];
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const runTool = async (name, args) => {
    const t = byName[name];
    onStep({ type: 'tool', name });
    steps.push({ name, args });
    if (!t) return { error: `ابزار ${name} وجود ندارد` };
    try { return await t.run(args || {}); } catch (e) { return { error: String(e.message || e) }; }
  };
  for (let step = 0; step < maxSteps; step++) {
    const sys = mode === 'text' ? system + textToolPrompt(tools) : system;
    let res;
    try {
      res = await chat(conn, { model, system: sys, messages: msgs, tools: mode === 'native' ? tools : undefined, maxTokens, signal });
    } catch (e) {
      if (mode === 'native' && e.toolsUnsupported) { mode = 'text'; onConnUpdate?.(conn.id, { supportsTools: false }); step--; continue; }
      throw e;
    }
    if (mode === 'native' && res.toolCalls.length) {
      msgs.push({ role: 'assistant', content: res.text || '', toolCalls: res.toolCalls });
      for (const c of res.toolCalls) msgs.push({ role: 'tool', toolCallId: c.id, name: c.name, content: JSON.stringify(await runTool(c.name, c.args)) });
      continue;
    }
    if (mode === 'text') {
      const m = res.text.match(TOOL_TAG);
      if (m) {
        const call = extractJSON(m[1]) || {};
        const out = await runTool(call.name, call.args);
        msgs.push({ role: 'assistant', content: res.text });
        msgs.push({ role: 'user', content: `[نتیجه ابزار ${call.name}]\n${JSON.stringify(out)}\n\nاکنون پاسخ را ادامه بده (در صورت نیاز ابزار دیگری صدا بزن).` });
        continue;
      }
    }
    return { text: res.text.replace(TOOL_TAG, '').trim(), conn, model: res.model, steps, mode };
  }
  // step budget exhausted → ask for a final answer without tools
  const fin = await chat(conn, { model, system, messages: [...msgs.filter((m) => m.role !== 'tool' && !m.toolCalls), { role: 'user', content: 'با همین اطلاعات پاسخ نهایی را کوتاه بنویس.' }], maxTokens, signal });
  return { text: fin.text, conn, model: fin.model, steps, mode };
}

/** Single structured-extraction call (JSON out), with connection fallback. */
export async function extract({ ai, system, prompt, signal, maxTokens = 2500 }) {
  const conns = orderedConnections(ai);
  if (!conns.length) throw new AIError('هیچ اتصال هوش مصنوعی فعالی تعریف نشده', { retryable: false });
  let lastErr;
  for (const conn of conns) {
    try {
      const r = await chat(conn, { model: conn.fastModel || conn.model, system, messages: [{ role: 'user', content: prompt }], maxTokens, temperature: 0, signal });
      const json = extractJSON(r.text);
      if (!json) throw new AIError('پاسخ مدل قابل خواندن نبود', { detail: r.text.slice(0, 200) });
      return { json, conn, model: r.model };
    } catch (e) { lastErr = e; if (signal?.aborted || e.retryable === false || !ai.fallback) throw e; }
  }
  throw lastErr;
}

/** Mask card numbers, IBANs and phone numbers before sending page text to an AI service. */
/**
 * Hide identifying numbers before page text goes to an AI service: card numbers, IBAN/sheba (with or without «IR»),
 * mobile numbers, account numbers written with separators, and any number right after «شماره حساب/کارت/شبا/کد ملی/…».
 * Persian and Arabic digits are read too (they're turned into Latin digits first). Amounts with thousands separators stay.
 */
export function maskSensitive(text) {
  let s = String(text || '').replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
  // after a label that names an id (not just «حساب»: «موجودی حساب ۱۲۵۰۰۰۰۰۰» is a balance)
  s = s.replace(/((?:شماره\s*(?:حساب|کارت|شبا|همراه|موبایل|تلفن)|شبا|کد\s*ملی|شناسه\s*ملی|موبایل|تلفن\s*همراه)\s*[:：]?\s*)((?:IR)?[\d][\d\s\-\/.]{5,}\d)/gi, (m, k) => k + '••••');
  s = s.replace(/(?<![\d,٬])(?:IR\s?)?\d{2}(?:[\s-]?\d{4}){5}[\s-]?\d{2}(?![\d,٬])/gi, 'IR••••');
  s = s.replace(/(?<![\d,٬])\d{4}([\s-]?)\d{4}\1\d{4}\1\d{4}(?![\d,٬])/g, '•••• •••• •••• ••••');
  s = s.replace(/(?:\+98|0098|(?<!\d)0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g, '09•••••••••');
  s = s.replace(/(?<![\d,٬.])\d{16,}(?![\d,٬.])/g, '••••'); // a bare 16+ digit run is an id, not an amount
  // account-like numbers with dashes or slashes (dates like 1405/07/09 are kept)
  // (only «-» and «/» separators: «12.500.000» is an amount written with dots)
  s = s.replace(/(?<![\d,٬.])\d{2,8}(?:[-\/]\d{2,12}){2,}(?![\d,٬])/g, (m) => (/^\d{2,4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(m) ? m : '••••'));
  return s;
}
/** Drop a URL's query and fragment (tokens, account ids) before it goes anywhere. */
export const safeUrl = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return ''; } };
