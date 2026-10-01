// Smart capture: read holdings from the page the user was on, show a reviewable diff, apply on confirmation.
import { html, useState, useEffect, useMemo, Icon, Money, Ava, toast, num, hasChrome } from '../components.js';
import * as AI from '../../lib/ai.js';
import * as A from '../../lib/assistant.js';
import * as E from '../../lib/engine.js';
import { CAT } from '../../lib/catalog.js';
import { parseNum, toEnDigits, uid, ago } from '../../lib/format.js';
import { act } from '../actions.js';

const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };

function guessCategory(unit, site) {
  const u = String(unit || '');
  if (/گرم|gram/i.test(u)) return /طلا|gold|talayin|milli/i.test(site) ? 'gold_online' : 'gold';
  if (/usdt|btc|eth|ton|sol|trx|doge|xrp/i.test(u)) return 'crypto';
  if (/دلار|usd|یورو|eur/i.test(u)) return 'fx';
  if (/واحد|سهم/.test(u)) return 'stock';
  return 'bank';
}

/** Fallback without AI: numbers with the text right before them */
function numberCandidates(text) {
  const out = []; const seen = new Set();
  const re = /([\d۰-۹][\d۰-۹,٬.٫]*[\d۰-۹]|[\d۰-۹])/g; let m;
  while ((m = re.exec(text)) && out.length < 60) {
    const v = parseNum(m[1]);
    if (!isFinite(v) || v < 1 || String(Math.round(v)).length < 2) continue;
    const before = text.slice(Math.max(0, m.index - 48), m.index).split('\n').pop().trim();
    const after = text.slice(m.index + m[1].length, m.index + m[1].length + 16).split('\n')[0].trim();
    const key = before + '|' + v;
    if (seen.has(key) || !before) continue; seen.add(key);
    out.push({ key: out.length, label: before.slice(-40), amount: v, unit: after.slice(0, 12) });
  }
  return out;
}

export function CapturePage({ st, s }) {
  const [page, setPage] = useState(undefined);
  const [state, setState] = useState('idle'); // idle | running | done | error
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [showText, setShowText] = useState(false);
  const [trust, setTrust] = useState(false);
  const conns = AI.orderedConnections(st.ai);
  const site = page ? hostOf(page.url) : '';
  const masked = useMemo(() => (page ? AI.maskSensitive(page.text) : ''), [page]);
  const assets = st.assets.filter((a) => !a.archived);

  useEffect(() => {
    if (!hasChrome || !chrome.storage?.session) { setPage(null); return; }
    chrome.storage.session.get('capture').then((r) => setPage(r.capture || null));
  }, []);
  useEffect(() => { if (page && conns.length && (st.ai.trustedSites || []).includes(hostOf(page.url))) run(); }, [page]);

  const run = async () => {
    setState('running'); setErr('');
    try {
      const res = await AI.extract({ ai: st.ai, system: A.captureSystem(), prompt: A.capturePrompt({ ...page, text: masked.slice(0, 24000) }, assets) });
      const props = A.captureProposals(res.json, assets, st.quotes, s).map((p) => ({ ...p, on: !!p.assetId && p.changed && p.confidence >= 0.5, create: false, category: guessCategory(p.unit, site + ' ' + page.title) }));
      setRows(props); setMeta({ conn: res.conn.name, model: res.model, site: res.json.site, unit: res.json.currency_unit });
      setState('done');
      if (trust) act.setAI({ trustedSites: [...new Set([...(st.ai.trustedSites || []), site])] });
    } catch (e) { setErr(e.message); setState('error'); }
  };
  const manual = () => { setRows(numberCandidates(page.selection || page.text).map((c) => ({ ...c, kind: null, assetId: null, field: null, value: null, current: null, on: false, manual: true }))); setMeta({ manual: true }); setState('done'); };

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r;
    const n = { ...r, ...patch };
    if ('assetId' in patch || 'field' in patch) {
      const a = assets.find((x) => x.id === n.assetId);
      if (a) {
        const isMoney = n.moneyUnit || /ریال|تومان/.test(n.unit || '') || n.manual;
        const k = (n.moneyUnit || (/تومان/.test(n.unit || '') ? 'toman' : 'rial')) === 'toman' ? 10 : 1;
        if (!('field' in patch)) n.field = a.mode === 'units' ? 'quantity' : a.mode === 'rate' ? 'rate.principal' : 'balance';
        n.current = n.field === 'quantity' ? +a.quantity || 0 : n.field === 'balance' ? +a.balance || 0 : n.field === 'rate.principal' ? +a.rate?.principal || 0 : +a.price?.value || 0;
        n.value = n.field === 'quantity' ? n.amount : n.amount * (n.manual ? (s.currency === 'rial' ? 1 : 10) : k);
        n.on = true; n.create = false;
      }
    }
    return n;
  }));

  const apply = async () => {
    const chosen = rows.filter((r) => r.on && ((r.assetId && r.field && isFinite(r.value)) || r.create));
    if (!chosen.length) return toast('موردی برای ثبت انتخاب نشده');
    const updates = chosen.filter((r) => !r.create);
    const news = chosen.filter((r) => r.create).map((r) => {
      const c = CAT[r.category] || CAT.other;
      const money = r.kind !== 'quantity';
      const rial = (r.moneyUnit === 'toman' ? 10 : 1) * r.amount;
      return money || c.defaultMode === 'balance'
        ? { id: uid('a'), name: r.label, category: r.category, custodian: site, mode: 'balance', balance: money ? rial : r.amount, balanceAt: Date.now(), liquidity: c.liquidity }
        : { id: uid('a'), name: r.label, category: r.category, custodian: site, mode: 'units', quantity: r.amount, unit: r.unit || 'واحد', price: { source: 'manual', value: 0, updatedAt: Date.now() }, liquidity: c.liquidity, review: 'از صفحه ثبت شد؛ منبع قیمت را تنظیم کن' };
    });
    await act.applyCapture(updates, news, site);
    await chrome.storage.session.remove('capture');
    toast(`${num(updates.length + news.length)} مورد ثبت شد`);
    location.hash = '#/assets';
  };

  if (page === undefined) return html`<div class="page"><div class="card muted">در حال خواندن…</div></div>`;
  if (!page) return html`<div class="page" style="max-width:820px"><div class="card"><div class="empty"><div class="ico"><${Icon} n="scan" /></div>
    <div class="sb" style="margin-bottom:6px">صفحه‌ای برای ثبت انتخاب نشده</div>
    <div class="small">در سایت بانک، کارگزاری، طلای آنلاین یا صرافی روی آیکون دارا بزن و «ثبت از این صفحه» را انتخاب کن، یا روی صفحه راست‌کلیک کن و «ثبت موجودی از این صفحه در دارا» را بزن.</div></div></div></div>`;

  const changedCount = rows.filter((r) => r.on).length;
  return html`<div class="page" style="max-width:980px">
    <div class="card">
      <div class="row" style="gap:12px">
        <span class="ava" style="background:var(--accent-soft);color:var(--accent);width:44px;height:44px"><${Icon} n="globe" /></span>
        <div class="grow" style="min-width:0"><div class="sb ellipsis">${page.title || site}</div><div class="xs muted ltr latin">${site}</div><div class="xs muted">خوانده‌شده ${ago(page.at)}، ${num(page.text.length)} نویسه${page.selection ? '، شامل متن انتخاب‌شده' : ''}</div></div>
        <button class="btn sm ghost" onClick=${() => setShowText(!showText)}><${Icon} n="eye" cls="sm" />${showText ? 'پنهان کردن متن' : 'متن ارسالی'}</button>
      </div>
      ${showText && html`<pre style="max-height:220px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:10px;font-size:11.5px;white-space:pre-wrap;margin:12px 0 0">${masked.slice(0, 6000)}</pre>`}
      ${state === 'idle' && html`<div style="margin-top:14px">
        ${conns.length ? html`<div class="callout"><${Icon} n="lock" cls="sm" /><div>متن این صفحه — با پوشاندن شماره کارت، شبا و موبایل — برای «${conns[0].name}» ارسال می‌شود تا موجودی‌هایت شناسایی شود. هیچ تغییری بدون تأیید تو ثبت نمی‌شود.</div></div>
          <div class="row" style="margin-top:12px"><button class="btn primary" onClick=${run}><${Icon} n="sparkles" cls="sm" />خواندن موجودی‌ها</button>
            <label class="row small" style="cursor:pointer"><input type="checkbox" checked=${trust} onChange=${(e) => setTrust(e.target.checked)} />برای ${site} دیگر نپرس</label>
            <span class="grow"></span><button class="btn ghost" onClick=${manual}>انتخاب دستی اعداد</button></div>`
        : html`<div class="callout warn"><${Icon} n="info" cls="sm" /><div>بدون هوش مصنوعی هم می‌توانی عددها را دستی به دارایی‌ها وصل کنی. برای تشخیص خودکار، در تنظیمات یک اتصال هوش مصنوعی اضافه کن.</div></div>
          <div class="row" style="margin-top:12px"><button class="btn primary" onClick=${manual}>انتخاب دستی اعداد</button><a class="btn" href="#/settings">افزودن اتصال هوش مصنوعی</a></div>`}
      </div>`}
      ${state === 'running' && html`<div class="row" style="margin-top:14px"><span class="typing"><i></i><i></i><i></i></span><span class="small muted">در حال خواندن صفحه با ${conns[0]?.name}…</span></div>`}
      ${state === 'error' && html`<div class="callout err" style="margin-top:14px"><${Icon} n="circleX" cls="sm" /><div>${err}<div class="row" style="margin-top:8px"><button class="btn sm" onClick=${run}>تلاش دوباره</button><button class="btn sm ghost" onClick=${manual}>انتخاب دستی اعداد</button></div></div></div>`}
    </div>

    ${state === 'done' && html`<div class="card">
      <div class="card-h"><h3>${meta?.manual ? 'عددهای پیدا شده در صفحه' : 'موجودی‌های شناسایی‌شده'}</h3><span class="sub">${meta?.manual ? 'هر عدد را به یک دارایی وصل کن' : `با ${meta?.conn}، ${num(rows.length)} مورد`}</span></div>
      ${rows.length ? html`<div>
        <div class="cap-row xs muted sb" style="padding-top:0"><span></span><span>در صفحه</span><span>دارایی در دارا</span><span>فعلی</span><span>جدید</span></div>
        ${rows.map((r) => {
          const a = assets.find((x) => x.id === r.assetId);
          const fmtV = (v) => (v === null || v === undefined ? '—' : r.field === 'quantity' ? `${num(v, 'auto')} ${a?.unit || ''}` : html`<${Money} v=${v} s=${s} compact />`);
          return html`<div class="cap-row" style=${r.on ? '' : 'opacity:.6'}>
            <input type="checkbox" checked=${r.on} onChange=${(e) => setRow(r.key, { on: e.target.checked })} />
            <div style="min-width:0"><div class="sb ellipsis small">${r.label}</div><div class="xs muted num">${num(r.amount, 'auto')} ${r.unit || ''}${r.confidence ? `، اطمینان ${num(r.confidence * 100)}٪` : ''}</div></div>
            <div class="col" style="gap:4px">
              <select class="input" value=${r.create ? '__new' : r.assetId || ''} onChange=${(e) => e.target.value === '__new' ? setRow(r.key, { create: true, assetId: null, on: true }) : setRow(r.key, { assetId: e.target.value || null })}>
                <option value="">— نادیده گرفتن —</option>
                ${assets.map((x) => html`<option value=${x.id}>${x.name}${x.custodian && x.custodian !== x.name ? ' — ' + x.custodian : ''}</option>`)}
                <option value="__new">＋ افزودن به‌عنوان دارایی جدید</option>
              </select>
              ${r.create && html`<select class="input" value=${r.category} onChange=${(e) => setRow(r.key, { category: e.target.value })}>${Object.values(CAT).map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>`}
              ${r.manual && a && a.mode === 'units' && html`<select class="input" value=${r.field} onChange=${(e) => setRow(r.key, { field: e.target.value })}><option value="quantity">مقدار</option>${a.price?.source !== 'market' ? html`<option value="unit_price">قیمت واحد</option>` : ''}</select>`}
            </div>
            <span class="small">${r.create ? html`<span class="muted">جدید</span>` : fmtV(r.current)}</span>
            <span class="small sb">${r.create ? (r.kind === 'quantity' ? `${num(r.amount, 'auto')} ${r.unit || ''}` : html`<${Money} v=${(r.moneyUnit === 'toman' ? 10 : 1) * r.amount} s=${s} compact />`) : fmtV(r.value)}
              ${!r.create && r.current !== null && r.value !== null && Math.abs(r.value - r.current) > 1e-9 ? html`<div class=${'xs ' + (r.value >= r.current ? 'pos' : 'neg')}>${r.value >= r.current ? '▲' : '▼'} ${r.current ? num(Math.abs(r.value / r.current - 1) * 100, 1) + '٪' : ''}</div>` : !r.create && r.assetId ? html`<div class="xs muted">بدون تغییر</div>` : ''}</span>
          </div>`;
        })}
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" onClick=${apply} disabled=${!changedCount}><${Icon} n="check" cls="sm" />ثبت ${num(changedCount)} مورد</button>
        <span class="xs muted">همه تغییرها در «گزارش رویدادها» ثبت می‌شوند و قابل برگشت‌اند.</span></div>`
      : html`<div class="empty small">موجودی‌ای در این صفحه پیدا نشد. اگر موجودی‌ها در صفحه دیگری‌اند، آن صفحه را باز کن و دوباره امتحان کن.</div>`}
    </div>`}
  </div>`;
}
