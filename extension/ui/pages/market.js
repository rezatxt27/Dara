import { html, useOnce, useState, useEffect, Icon, Money, Delta, Sparkline, Modal, Seg, MoneyField, NumField, send, toast, refLabel, providerName, num, pct, fmtJ } from '../components.js';
import { TGJU, NOBITEX, NOBITEX_BY_KEY, PROVIDERS, CRYPTO_DEFAULT } from '../../lib/catalog.js';
import { TickerSearch, CryptoPicker } from '../pickers.js';
import * as E from '../../lib/engine.js';
import { ago, timeHM, money } from '../../lib/format.js';
import { act } from '../actions.js';
import * as BB from '../../lib/bubble.js';
import { BubbleCard, BubblePill } from '../bubbles.js';
import { T } from '../tips.js';


function useHistories(refs) {
  const [h, setH] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const ref of refs) {
        const r = await send('history', { ref, days: 30 });
        if (!alive) return;
        if (r?.ok && r.points?.length) setH((x) => ({ ...x, [E.quoteId(ref)]: r.points.map((p) => p[1]) }));
      }
    })();
    return () => { alive = false; };
  }, []);
  return h;
}

function AlertModal({ s, st, init, onClose }) {
  const [saving, once] = useOnce();
  const [ref] = useState(init.ref);
  // a coin, or an exchange fund whose NAV is known, can also be watched by its bubble
  const bNow = BB.refBubble(ref, st.quotes);
  const canBubble = !!bNow || BB.isCoinRef(ref);
  const [kind, setKind] = useState(init.kind === 'bubble' && canBubble ? 'bubble' : 'price');
  const [op, setOp] = useState(init.op || (init.kind === 'bubble' ? 'lt' : 'gt'));
  const [value, setValue] = useState(init.kind === 'bubble' ? null : init.value || init.price || null);
  // starts empty: a default at today's bubble would fire on the next check
  const [bval, setBval] = useState(init.kind === 'bubble' && isFinite(init.value) ? Math.round(init.value * 1000) / 10 : null);
  const usd = ref.provider === 'tgju' && TGJU.find((t) => t.key === ref.key)?.usd;
  const save = async () => {
    if (kind === 'bubble') {
      if (bval === null || !isFinite(bval)) return toast('درصد حباب را وارد کن');
      await act.saveAlert({ ...init, kind: 'bubble', ref, op, value: bval / 100, active: true, firedAt: null, bubble: undefined, price: undefined });
    } else {
      if (!(value > 0)) return;
      const { kind: _k, bubble: _b, ...rest } = init;
      await act.saveAlert({ ...rest, ref, op, value, active: true, firedAt: null });
    }
    toast('هشدار ثبت شد'); onClose();
  };
  const title = kind === 'bubble' ? `هشدار حباب — ${refLabel(ref)}` : `هشدار قیمت — ${refLabel(ref)}`;
  return html`<${Modal} title=${title} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>انصراف</button><button class="btn primary" disabled=${saving} onClick=${() => once(save)}>ثبت هشدار</button>`}>
    ${canBubble && html`<${Seg} value=${kind} onChange=${setKind} options=${[['price', 'بر اساس قیمت'], ['bubble', 'بر اساس حباب']]} />`}
    ${kind === 'bubble'
      ? html`<div class="callout"><${Icon} n="info" cls="sm" /><div>${bNow ? html`حباب فعلی: <b class="ltr">${pct(bNow.bubble, { sign: false })}</b>${bNow.stale ? html` <span class="warn">(قیمت‌ها قدیمی است)</span>` : ''}` : 'حباب هنوز حساب نشده؛ بعد از دریافت قیمت‌ها بررسی می‌شود.'}</div></div>
        <${Seg} value=${op} onChange=${setOp} options=${[['lt', 'وقتی حباب کمتر شد از'], ['gt', 'وقتی حباب بیشتر شد از']]} />
        <${NumField} label="حباب (درصد)" value=${bval} onInput=${setBval} digits=${1} suffix="٪" autoFocus placeholder=${bNow ? `مثلاً ${num(Math.round(bNow.bubble * 100) + (op === 'gt' ? 3 : -3))}` : ''} />
        <div class="xs muted">فقط وقتی بررسی می‌شود که قیمت سکه (یا صندوق)، انس و دلار تازه باشند؛ با قیمت قدیمی اعلان نمی‌دهد. حباب منفی یعنی زیر ارزش طلا (یا NAV) معامله می‌شود.</div>`
      : html`${init.price && html`<div class="callout"><${Icon} n="info" cls="sm" /><div>قیمت فعلی: <b>${usd ? '$' + num(init.price, 2) : html`<${Money} v=${init.price} s=${s} />`}</b></div></div>`}
        <${Seg} value=${op} onChange=${setOp} options=${[['gt', 'وقتی بالاتر رفت از'], ['lt', 'وقتی پایین‌تر آمد از']]} />
        ${usd ? html`<${NumField} label="قیمت (دلار)" value=${value} onInput=${setValue} digits=${2} />` : html`<${MoneyField} label="قیمت" rial=${value} onRial=${setValue} s=${s} autoFocus />`}
        <div class="xs muted">بعد از هر به‌روزرسانی قیمت بررسی می‌شود و با اعلان کروم خبرت می‌کند (یک‌بار).</div>`}
  </${Modal}>`;
}

const sameRef = (a, b) => E.quoteId(a) === E.quoteId(b);
const cleanRef = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== ''));

/** Add symbols, funds or coins to the watchlist (settings.watch). Fetches the price right away. */
function WatchModal({ st, s, kind, onClose }) {
  const [prov, setProv] = useState(kind === 'crypto' ? 'nobitex' : 'tsetmc');
  const [added, setAdded] = useState([]);
  const watch = s.watch || [];
  const held = (ref) => st.assets.some((a) => !a.archived && a.price?.ref && sameRef(a.price.ref, ref));
  const isOn = (ref) => held(ref) || watch.some((w) => sameRef(w, ref)) || added.some((w) => sameRef(w, ref)) || (ref.provider === 'nobitex' && CRYPTO_DEFAULT.includes(ref.key));
  const add = async (ref) => {
    const r = cleanRef(ref);
    setAdded((x) => [...x, r]);
    await act.watchAdd(r);
    const q = await send('quote', { ref: r });
    toast(q?.quote ? `«${refLabel(r)}» اضافه شد` : `«${refLabel(r)}» اضافه شد؛ قیمتش در به‌روزرسانی بعدی می‌آید`);
  };
  return html`<${Modal} title=${kind === 'crypto' ? 'افزودن رمزارز به دیده‌بان' : 'افزودن نماد یا صندوق به دیده‌بان'} onClose=${onClose}
    footer=${html`<span class="xs muted grow">${added.length ? `${num(added.length)} مورد اضافه شد` : 'روی هر مورد بزن تا به فهرست اضافه شود'}</span><button class="btn primary" onClick=${onClose}>تمام</button>`}>
    ${kind === 'crypto'
      ? html`<${CryptoPicker} st=${st} s=${s} isOn=${isOn} onPick=${add} />`
      : html`<${Seg} value=${prov} onChange=${setProv} options=${[['tsetmc', 'سهام و صندوق‌های بورسی'], ['fipiran', 'صندوق‌های سرمایه‌گذاری (NAV)']]} />
        <${TickerSearch} provider=${prov} s=${s} isOn=${isOn} onPick=${add} />`}
    <div class="xs muted">دیده‌بان فقط قیمت را دنبال می‌کند و به دارایی‌هایت چیزی اضافه نمی‌کند. برای هر مورد می‌توانی هشدار قیمت هم بگذاری.</div>
  </${Modal}>`;
}

export function MarketPage({ st, pf, s }) {
  const [watchFor, setWatchFor] = useState(null);
  const watch = s.watch || [];
  const unwatch = async (ref) => { await act.watchRemove(ref); toast(`«${refLabel(ref)}» از دیده‌بان حذف شد`); };
  const [alertFor, setAlertFor] = useState(null);
  const tgjuRefs = TGJU.map((t) => ({ provider: 'tgju', key: t.key }));
  const hist = useHistories(tgjuRefs);
  const held = st.assets.filter((a) => !a.archived && a.mode === 'units' && a.price?.source === 'market' && a.price.ref && (a.price.ref.provider === 'tsetmc' || a.price.ref.provider === 'fipiran'));
  const heldRefs = [...new Map(held.map((a) => [E.quoteId(a.price.ref), a.price.ref])).values()];
  const bourseRows = [...heldRefs.map((ref) => ({ ref, held: true })),
    ...watch.filter((w) => (w.provider === 'tsetmc' || w.provider === 'fipiran') && !heldRefs.some((h) => sameRef(h, w))).map((ref) => ({ ref, held: false }))];
  const heldCoins = new Map(st.assets.filter((a) => !a.archived && a.price?.ref?.provider === 'nobitex').map((a) => [a.price.ref.key, a.price.ref]));
  const coinRows = [];
  for (const k of CRYPTO_DEFAULT) if (!heldCoins.has(k)) coinRows.push({ ref: { provider: 'nobitex', key: k }, kind: 'core' });
  for (const ref of heldCoins.values()) coinRows.push({ ref, kind: 'held' });
  for (const w of watch) if (w.provider === 'nobitex' && !coinRows.some((r) => r.ref.key === w.key)) coinRows.push({ ref: w, kind: 'watch' });
  // NAVs fetched only for a fund's bubble are not «prices in use»; a fund valued at its NAV is
  const usedNav = new Set([...st.assets.map((a) => a.price?.ref), ...watch].filter((r) => r?.field === 'nav').map((r) => E.quoteId(r)));
  const anyFundBubble = bourseRows.some(({ ref }) => BB.fundBubble(ref, st.quotes));
  const m = st.meta;
  const provStatus = Object.keys(PROVIDERS).map((p) => {
    const ids = Object.keys(st.quotes).filter((k) => k.startsWith(p + ':') && !(k.endsWith(':nav') && !usedNav.has(k)));
    const ok = ids.filter((k) => st.quotes[k].price > 0 && !st.quotes[k].error);
    const last = Math.max(0, ...ids.map((k) => st.quotes[k].fetchedAt || 0));
    const err = ids.map((k) => st.quotes[k].error).find(Boolean);
    return { p, n: ids.length, ok: ok.length, last, err, enabled: s.providers[p] !== false };
  });

  const Cell = ({ ref, name, unit, usd, onRemove, tag }) => {
    const id = E.quoteId(ref); const q = st.quotes[id]; const h = hist[id];
    const up = (q?.changePct || 0) >= 0;
    return html`<div class="it" style="gap:10px">
      <div class="grow" style="min-width:0"><div class="sb">${name}${tag ? html`<span class="tag-watch">${tag}</span>` : ''}</div>
        <div class="xs muted">${unit}، ${q?.error && !q?.price ? html`<span class="neg">${q.error}</span>` : q ? (q.daily && q.asOf ? 'روزانه ' + fmtJ(q.asOf.slice(0, 10), 'dm') : timeHM(q.at)) : 'در انتظار دریافت'}${q?.approx ? html`، <span title=${q.note || ''}>تقریبی</span>` : ''}</div></div>
      <${Sparkline} values=${h} w=${84} h=${28} color=${up ? 'var(--pos)' : 'var(--neg)'} />
      <div style="text-align:left;min-width:120px"><div class="b num">${q?.price ? (usd ? '$' + num(q.price, 2) : html`<${Money} v=${q.price} s=${s} unit=${false} />`) : '—'}</div>
        <div class="xs"><${Delta} p=${q?.changePct} showAbs=${false} /></div></div>
      <button class="btn icon sm ghost" title="هشدار قیمت" onClick=${() => setAlertFor({ ref, price: q?.price })}><${Icon} n="bell" cls="sm" /></button>
      ${onRemove && html`<button class="btn icon sm ghost danger" title="حذف از دیده‌بان" onClick=${onRemove}><${Icon} n="x" cls="sm" /></button>`}
    </div>`;
  };
  const groupCard = (title, src, items, action) => html`<div class="card"><div class="card-h"><h3>${title}</h3>${action || html`<span class="sub">${src}</span>`}</div><div class="list">${items}</div></div>`;

  return html`<div class="page">
    <div class="card">
      <div class="card-h"><h3><${Icon} n="live" cls="sm" />وضعیت منابع قیمت</h3><span class="sub">به‌روزرسانی خودکار هر ${num(s.refreshMinutes)} دقیقه، آخرین اجرا ${ago(m.lastRun)}</span></div>
      <div class="grid-ov3" style="grid-template-columns:repeat(4,1fr)">${provStatus.map((p) => html`<div class="pcell">
        <span class="n"><span>${PROVIDERS[p.p].title}</span><span style=${`width:8px;height:8px;border-radius:50%;background:${!p.enabled ? 'var(--faint)' : !p.n ? 'var(--faint)' : p.err && !p.ok ? 'var(--neg)' : p.err ? 'var(--warn)' : 'var(--pos)'}`}></span></span>
        <span class="small">${!p.enabled ? 'غیرفعال' : p.n ? `${num(p.ok)} از ${num(p.n)} قیمت سالم` : 'استفاده نشده'}</span>
        <span class="xs muted ellipsis" title=${p.err || ''}>${p.err ? p.err : p.last ? ago(p.last) : ''}</span></div>`)}</div>
    </div>

    <${BubbleCard} st=${st} pf=${pf} s=${s} onAlert=${setAlertFor} />

    <div class="grid-ov" style="align-items:start">
      <div class="col" style="gap:18px">
        ${groupCard('طلا و فلزات', 'tgju، ' + (s.currency === 'rial' ? 'ریال' : 'تومان'), TGJU.filter((t) => t.group === 'gold' || t.group === 'metal' || t.group === 'global').map((t) => Cell({ ref: { provider: 'tgju', key: t.key }, name: t.name, unit: t.unit, usd: t.usd })))}
        ${groupCard('رمزارز', 'نوبیتکس', coinRows.map(({ ref, kind }) => Cell({ ref, name: refLabel(ref), unit: NOBITEX_BY_KEY[ref.key]?.sym || String(ref.sym || ref.key).toUpperCase(),
          tag: kind === 'held' ? 'در پرتفوی' : '', onRemove: kind === 'watch' ? () => unwatch(ref) : null })),
          html`<button class="btn sm" onClick=${() => setWatchFor('crypto')}><${Icon} n="plus" cls="sm" />رمزارز دیگر</button>`)}
      </div>
      <div class="col" style="gap:18px">
        ${groupCard('سکه', 'tgju', TGJU.filter((t) => t.group === 'coin').map((t) => Cell({ ref: { provider: 'tgju', key: t.key }, name: t.name, unit: t.unit })))}
        ${groupCard('ارز', 'tgju', TGJU.filter((t) => t.group === 'fx').map((t) => Cell({ ref: { provider: 'tgju', key: t.key }, name: t.name, unit: t.unit })))}
      </div>
    </div>

    <div class="card"><div class="card-h"><h3>نمادهای بورسی و صندوق‌ها</h3><span class="grow"></span><span class="sub">${heldRefs.length ? `${num(heldRefs.length)} در پرتفوی` : ''}${heldRefs.length && bourseRows.length > heldRefs.length ? '، ' : ''}${bourseRows.length > heldRefs.length ? `${num(bourseRows.length - heldRefs.length)} در دیده‌بان` : ''}</span>
      <button class="btn sm" onClick=${() => setWatchFor('bourse')}><${Icon} n="plus" cls="sm" />افزودن نماد یا صندوق</button></div>
      ${bourseRows.length ? html`<table class="tbl"><thead><tr><th>نماد / صندوق</th><th>منبع</th><th class="n">قیمت</th><th class="n">تغییر</th>${anyFundBubble && html`<th><span class="row" style="gap:2px">حباب${T('bubbleFund')}</span></th>`}<th>زمان</th><th></th></tr></thead><tbody>
      ${bourseRows.map(({ ref, held }) => { const q = st.quotes[E.quoteId(ref)]; const fb = BB.fundBubble(ref, st.quotes); return html`<tr class="r"><td class="sb">${refLabel(ref)} <span class="xs muted">${ref.name && ref.name !== ref.label ? ref.name : ''}</span>${held ? html`<span class="tag-watch">در پرتفوی</span>` : ''}</td>
        <td class="small">${providerName(ref.provider)}، ${ref.field === 'nav' || ref.field === 'cancelNav' ? 'NAV ابطال' : ref.field === 'issueNav' ? 'NAV صدور' : ref.field === 'last' ? 'آخرین معامله' : 'قیمت پایانی'}</td>
        <td class="n"><${Money} v=${q?.price || null} s=${s} /></td><td class="n small"><${Delta} p=${q?.changePct} showAbs=${false} /></td>
        ${anyFundBubble && html`<td>${fb ? html`<span title=${s.privacy ? 'قیمت بازار ÷ NAV ابطال' : `NAV ابطال: ${money(fb.nav, s)}`}><${BubblePill} b=${fb} /></span>` : html`<span class="muted">—</span>`}</td>`}
        <td class="small">${q?.error && !q?.price ? html`<span class="neg">${q.error}</span>` : !ref.key ? html`<span class="warn">در انتظار شناسایی نماد</span>` : q ? (q.asOf ? fmtJ(q.asOf.slice(0, 10), 'dm') : timeHM(q.at)) : 'در انتظار دریافت'}</td>
        <td style="white-space:nowrap"><button class="btn ghost sm icon" title=${fb ? 'هشدار قیمت یا حباب' : 'هشدار قیمت'} onClick=${() => setAlertFor({ ref, price: q?.price })}><${Icon} n="bell" cls="sm" /></button>
          ${!held && html`<button class="btn ghost sm icon danger" title="حذف از دیده‌بان" onClick=${() => unwatch(ref)}><${Icon} n="x" cls="sm" /></button>`}</td></tr>`; })}
      </tbody></table>` : html`<div class="empty small">هر نماد بورسی (سهام، صندوق طلا، ETF) یا صندوق سرمایه‌گذاری را اضافه کن تا قیمتش همراه بقیه به‌روز شود.</div>`}
    </div>

    <div class="card">
      <div class="card-h"><h3><${Icon} n="bell" cls="sm" />هشدارهای قیمت و حباب</h3><button class="btn sm" onClick=${() => setAlertFor({ ref: { provider: 'tgju', key: 'geram18' }, price: st.quotes['tgju:geram18']?.price })}><${Icon} n="plus" cls="sm" />هشدار جدید</button></div>
      ${st.alerts.length ? html`<div class="list">${st.alerts.map((al) => {
        const q = st.quotes[E.quoteId(al.ref)]; const usd = al.ref.provider === 'tgju' && TGJU.find((t) => t.key === al.ref.key)?.usd;
        if (al.kind === 'bubble') {
          const b = BB.refBubble(al.ref, st.quotes);
          return html`<div class="it"><span class="ava" style=${`background:${al.active ? 'var(--accent-soft)' : 'var(--surface-3)'};color:${al.active ? 'var(--accent)' : 'var(--muted)'}`}><${Icon} n="coin" /></span>
            <div class="grow"><div class="sb">حباب ${refLabel(al.ref)} ${al.op === 'gt' ? 'بیشتر از' : 'کمتر از'} <span class="ltr">${pct(al.value, { sign: false })}</span></div>
              <div class="xs muted">${al.active ? html`فعال، حباب فعلی ${b ? html`<span class="ltr">${pct(b.bubble, { sign: false })}</span>${b.stale ? ' (قیمت قدیمی)' : ''}` : '—'}` : html`فعال شد ${ago(al.firedAt)} در حباب <span class="ltr">${pct(al.firedPrice, { sign: false })}</span>`}</div></div>
            ${!al.active && html`<button class="btn sm" onClick=${() => act.saveAlert({ ...al, active: true, firedAt: null })}>فعال‌سازی دوباره</button>`}
            <button class="btn icon sm ghost danger" title="حذف هشدار" onClick=${() => act.deleteAlert(al.id)}><${Icon} n="trash" cls="sm" /></button></div>`;
        }
        return html`<div class="it"><span class="ava" style=${`background:${al.active ? 'var(--accent-soft)' : 'var(--surface-3)'};color:${al.active ? 'var(--accent)' : 'var(--muted)'}`}><${Icon} n="bell" /></span>
          <div class="grow"><div class="sb">${refLabel(al.ref)} ${al.op === 'gt' ? 'بالاتر از' : 'پایین‌تر از'} ${usd ? '$' + num(al.value, 2) : html`<${Money} v=${al.value} s=${s} />`}</div>
            <div class="xs muted">${al.active ? html`فعال، قیمت فعلی ${q?.price ? (usd ? '$' + num(q.price, 2) : html`<${Money} v=${q.price} s=${s} />`) : '—'}` : html`فعال شد ${ago(al.firedAt)} در قیمت ${usd ? '$' + num(al.firedPrice, 2) : html`<${Money} v=${al.firedPrice} s=${s} />`}`}</div></div>
          ${!al.active && html`<button class="btn sm" onClick=${() => act.saveAlert({ ...al, active: true, firedAt: null })}>فعال‌سازی دوباره</button>`}
          <button class="btn icon sm ghost danger" onClick=${() => act.deleteAlert(al.id)}><${Icon} n="trash" cls="sm" /></button></div>`;
      })}</div>` : html`<div class="empty small">مثلاً: «وقتی طلای ۱۸ عیار از فلان قیمت پایین‌تر آمد خبرم کن».</div>`}
    </div>
    ${alertFor && html`<${AlertModal} s=${s} st=${st} init=${alertFor} onClose=${() => setAlertFor(null)} />`}
    ${watchFor && html`<${WatchModal} st=${st} s=${s} kind=${watchFor} onClose=${() => setWatchFor(null)} />`}
  </div>`;
}
