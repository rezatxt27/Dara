// Search pickers shared by the asset editor and the market watchlist.
import { html, useState, useEffect, useRef, Icon, Money, send } from './components.js';
import { NOBITEX } from '../lib/catalog.js';

/** Tehran exchange symbols (TSETMC) or mutual funds (Fipiran). onPick(ref) */
export function TickerSearch({ provider, s, isOn, onPick }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const search = async (text = q) => {
    if (!text.trim() && provider === 'tsetmc') return;
    setLoading(true); setErr('');
    const r = await send('search', { provider, q: text });
    setLoading(false);
    if (r?.ok) setRes(r.items); else { setRes([]); setErr(r?.error || 'جست‌وجو انجام نشد'); }
  };
  useEffect(() => { setRes(null); setErr(''); setQ(''); if (provider === 'fipiran') search(''); }, [provider]);
  const refOf = (it) => provider === 'tsetmc'
    ? { provider: 'tsetmc', key: it.insCode, symbol: it.symbol, label: it.symbol, name: it.name, field: 'close' }
    : { provider: 'fipiran', key: it.regNo, label: it.name, name: it.name, field: 'cancelNav' };
  return html`<div class="col" style="gap:8px">
    <div class="row"><input class="input" autoFocus placeholder=${provider === 'tsetmc' ? 'نماد را بنویس: فولاد، خودرو، شستا، کهربا…' : 'نام صندوق: فیروزه، آگاه، کاریزما…'} value=${q}
      onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && (e.preventDefault(), search())} />
      <button type="button" class="btn" onClick=${() => search()} disabled=${loading}><${Icon} n=${loading ? 'refresh' : 'search'} cls=${loading ? 'sm spin' : 'sm'} />جست‌وجو</button></div>
    ${err && html`<div class="callout err"><${Icon} n="wifi" cls="sm" /><div>${err}. ${provider === 'tsetmc' ? 'سایت TSETMC گاهی از خارج ایران یا با VPN پاسخ نمی‌دهد.' : ''}</div></div>`}
    ${res && html`<div class="picker"><div class="scroll">${res.length ? res.map((it) => {
      const ref = refOf(it); const on = isOn(ref);
      return provider === 'tsetmc'
        ? html`<div class=${'opt' + (on ? ' on' : '')} onClick=${() => !on && onPick(ref)}>
            <span class="grow"><span class="sb">${it.symbol}</span> <span class="xs muted">${it.name}</span></span><span class="xs muted">${it.market}${it.active ? '' : '، غیرفعال'}</span>
            ${on ? html`<${Icon} n="check" cls="sm" />` : html`<${Icon} n="plus" cls="sm" />`}</div>`
        : html`<div class=${'opt' + (on ? ' on' : '')} onClick=${() => !on && onPick(ref)}>
            <span class="grow"><span class="sb">${it.name}</span> <span class="xs muted">${it.type}</span></span><span class="small num"><${Money} v=${it.cancelNav} s=${s} /></span>
            ${on ? html`<${Icon} n="check" cls="sm" />` : html`<${Icon} n="plus" cls="sm" />`}</div>`;
    }) : html`<div class="opt muted">نتیجه‌ای پیدا نشد</div>`}</div></div>`}
  </div>`;
}

/** Cryptocurrencies: the built-in list filters instantly; Latin text also searches CoinGecko (any coin). */
export function CryptoPicker({ st, s, isOn, onPick, autoFocus = true }) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef(0);
  const t = q.trim().toLowerCase();
  const local = NOBITEX.filter((c) => !t || c.key.includes(t) || c.sym.toLowerCase().includes(t) || c.name.includes(q.trim()) || (c.cg || '').includes(t));
  const run = async (text) => {
    if (!text || /[؀-ۿ]/.test(text)) { setRemote(null); setErr(''); return; }
    setLoading(true);
    const r = await send('search', { provider: 'crypto', q: text });
    setLoading(false);
    setErr(r?.error || '');
    setRemote((r?.items || []).filter((c) => !c.catalog));
  };
  const onInput = (v) => { setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => run(v.trim().toLowerCase()), 450); };
  const row = (c, extra) => {
    const ref = { provider: 'nobitex', key: c.key, ...(extra ? { name: c.name, sym: c.sym, cg: c.cg } : {}) };
    const on = isOn(ref); const qv = st.quotes['nobitex:' + c.key];
    return html`<div class=${'opt' + (on ? ' on' : '')} onClick=${() => !on && onPick(ref)}>
      <span class="grow"><span class="sb">${c.name}</span> <span class="xs muted ltr latin">${c.sym}</span>${extra && c.rank ? html` <span class="xs muted">رتبه ${c.rank}</span>` : ''}</span>
      <span class="small num">${qv?.price ? html`<${Money} v=${qv.price} s=${s} />` : ''}</span>
      ${on ? html`<${Icon} n="check" cls="sm" />` : html`<${Icon} n="plus" cls="sm" />`}</div>`;
  };
  return html`<div class="col" style="gap:8px">
    <label class="isearch"><${Icon} n=${loading ? 'refresh' : 'search'} cls=${loading ? 'sm spin' : 'sm'} />
      <input class="input" autoFocus=${autoFocus} placeholder="نام یا نماد: بیت‌کوین، ETH، shiba، pepe…" value=${q} onInput=${(e) => onInput(e.target.value)} /></label>
    <div class="picker"><div class="scroll">
      ${local.map((c) => row(c, false))}
      ${remote && remote.length > 0 && html`<div class="opt muted xs" style="cursor:default">نتایج جهانی (CoinGecko)؛ قیمت از نوبیتکس یا دلاری × نرخ دلار</div>${remote.map((c) => row(c, true))}`}
      ${!local.length && (!remote || !remote.length) && html`<div class="opt muted">${loading ? 'در حال جست‌وجو…' : /[؀-ۿ]/.test(t) ? 'برای رمزارزهای دیگر نام یا نماد انگلیسی را بنویس' : 'نتیجه‌ای پیدا نشد'}</div>`}
    </div></div>
    ${err && html`<div class="xs muted"><${Icon} n="wifi" cls="sm" /> جست‌وجوی آنلاین در دسترس نبود (${err})؛ فهرست داخلی نمایش داده شد.</div>`}
  </div>`;
}
