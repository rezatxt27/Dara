// A price's detail page (a drawer): its chart over a week to a year, high and low, changes over common periods, the
// owner's own position in it, what's special about it (a coin's bubble, a fund's NAV, gold against the world price),
// and shortcuts into the tools with this price already chosen.
import { html, useState, useEffect, useMemo, Icon, Money, Delta, Seg, Drawer, AreaChart, AskBtn, num, pct, fmtJ, money, send, refLabel, providerName } from '../components.js';
import * as E from '../../lib/engine.js';
import * as BB from '../../lib/bubble.js';
import * as K from '../../lib/calc.js';
import * as S from '../../lib/pricestats.js';
import { TGJU_BY_KEY, NOBITEX_BY_KEY } from '../../lib/catalog.js';
import { todayIso } from '../../lib/jalali.js';
import { ago, timeHM } from '../../lib/format.js';
import { AlertModal } from './market.js';

const RANGES = [[7, 'هفته'], [30, 'ماه'], [91, '۳ ماه'], [365, 'سال']];
const PERIODS = [[7, 'هفته'], [30, 'ماه'], [91, '۳ ماه'], [365, 'سال']];
const BE_IDS = new Set(['tgju:geram18', 'tgju:sekee', 'tgju:price_dollar_rl', 'nobitex:usdt']);
const DAY = 86400000;

/** «هر گرم», «هر سکه», «هر سهم», «هر تتر» */
function perUnit(ref) {
  if (ref.provider === 'tgju') return TGJU_BY_KEY[ref.key]?.unit || '';
  if (ref.provider === 'nobitex') return `هر ${NOBITEX_BY_KEY[ref.key]?.sym || String(ref.sym || ref.key).toUpperCase()}`;
  if (ref.provider === 'fipiran') return 'هر واحد';
  return 'هر سهم';
}

export function PriceDetail({ st, s, refOf, onClose }) {
  const ref = refOf;
  const id = E.quoteId(ref);
  const q = st.quotes[id];
  const usdNative = ref.provider === 'tgju' && !!TGJU_BY_KEY[ref.key]?.usd; // the ounce and other world prices are in dollars
  const canDollar = !(ref.provider === 'tgju' && ref.key === 'price_dollar_rl') && !(ref.provider === 'nobitex' && ref.key === 'usdt');
  const [range, setRange] = useState(91);
  const [view, setView] = useState(usdNative ? 'usd' : 'rial');
  const [hist, setHist] = useState(null); // null loading; { points, err }
  const [usd, setUsd] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [bubAvg, setBubAvg] = useState(null);
  const today = todayIso();
  useEffect(() => {
    let alive = true;
    send('history', { ref, days: 366 }).then((r) => { if (alive) setHist({ points: r?.ok ? r.points || [] : [], err: r?.ok ? r.error : r?.error || 'دریافت تاریخچه ممکن نشد' }); });
    if (canDollar) send('history', { ref: { provider: 'tgju', key: 'price_dollar_rl' }, days: 366 }).then((r) => { if (alive && r?.ok) setUsd(r.points || []); });
    if (BB.isCoinRef(ref)) send('bubbleStats', { keys: [ref.key], days: 90 }).then((r) => { if (alive && r?.ok) setBubAvg(r.stats?.[ref.key]?.avg ?? null); });
    return () => { alive = false; };
  }, [id]);

  const series = useMemo(() => {
    const pts = hist?.points || [];
    return view === 'usd' && canDollar ? (usd ? S.inDollars(pts, usd) : []) : pts;
  }, [hist, usd, view]);
  const shown = useMemo(() => S.slice(series, range, today), [series, range]);
  const st8 = S.stats(shown);
  const changes = useMemo(() => S.periodChanges(series, today), [series]);
  const pos = useMemo(() => S.position(st.assets, st.quotes, s, ref), [st.assets, st.quotes, id]);
  const rate = st.quotes['tgju:price_dollar_rl']?.price;
  const marks = useMemo(() => (pos ? S.marks(st.events, pos.ids, shown) : []), [pos, st.events, shown]);
  const fmtV = (v) => (view === 'usd' && canDollar ? '$' + num(v, v < 10 ? 3 : v < 1000 ? 2 : 0) : money(v, s, { compact: true }));
  const V = ({ v, big }) => (v === null || v === undefined || !isFinite(v) ? html`<span class="muted">—</span>` : view === 'usd' && canDollar ? html`<b class=${'num ltr' + (big ? ' pd-big' : '')}>${fmtV(v)}</b>` : html`<${Money} v=${v} s=${s} cls=${big ? 'pd-big' : ''} />`);

  const price = q?.price > 0 ? (usdNative ? q.price * (rate || 0) : q.price) : null; // in Rial
  const stale = !price || !!q?.error || Date.now() - (q?.at || q?.fetchedAt || 0) > 3 * DAY;
  const name = refLabel(ref);
  // what's special about this price
  const coin = BB.isCoinRef(ref) ? BB.coinBubble(ref.key, st.quotes) : null;
  const fund = ref.provider === 'tsetmc' ? BB.fundBubble(ref, st.quotes) : null;
  const pure = ref.provider === 'tgju' && ref.key === 'geram18' ? BB.purePerGram(st.quotes) : null;
  const goldGap = pure && price ? price / (0.75 * pure.price) - 1 : null; // 18k gold here vs the gold inside it at ounce × dollar
  // shortcuts into the tools, with this price chosen
  const item = K.ITEMS.find((it) => E.quoteId(it.ref) === id);
  const beId = BE_IDS.has(id) ? id : pos ? pos.ids[0] : null;
  const go = (hash) => { onClose(); location.hash = hash; };

  return html`<${Drawer} title=${name} onClose=${onClose} icon=${html`<span class="ava" style="background:var(--accent-soft);color:var(--accent)"><${Icon} n="chart" /></span>`}>
    <div class="pd">
      <div class="pd-head">
        <div class="col" style="gap:2px">
          <span class="xs muted">${perUnit(ref)}${usdNative ? ' (به دلار)' : ''}</span>
          ${usdNative ? html`<b class="num ltr pd-big">$${num(q?.price || 0, 2)}</b>` : html`<${Money} v=${price} s=${s} cls="pd-big" />`}
          <span class="small"><${Delta} p=${q?.changePct} showAbs=${false} /> <span class="xs muted">امروز</span></span>
        </div>
        <span class="xs muted" style="text-align:left">${providerName(ref.provider)}<br />${q?.at ? (Date.now() - q.at < DAY ? `ساعت ${timeHM(q.at || q.fetchedAt)}` : ago(q.at)) : ''}${stale && price ? html`<br /><span class="warn">قیمت به‌روز نیست</span>` : ''}</span>
      </div>

      <div class="pd-ctl">
        <${Seg} value=${range} onChange=${setRange} options=${RANGES} />
        ${canDollar && html`<${Seg} value=${view} onChange=${setView} options=${[['rial', s.currency === 'rial' ? 'ریال' : 'تومان'], ['usd', 'دلار']]} />`}
      </div>
      <div class="pd-chart">${hist === null ? html`<div class="empty small" style="height:200px;display:grid;place-items:center">در حال دریافت تاریخچه…</div>`
        : html`<${AreaChart} points=${shown.map(([date, value]) => ({ date, value }))} height=${200} fmt=${fmtV}
            refLine=${pos?.avg && view === 'rial' ? { value: pos.avg, label: 'میانگین خرید تو' } : null} marks=${marks}
            emptyText=${hist.err || (ref.provider === 'fipiran' ? 'برای صندوق‌های غیربورسی تاریخچه قیمت در دسترس نیست' : 'تاریخچه‌ای برای این قیمت پیدا نشد')} />`}</div>
      ${view === 'usd' && canDollar && html`<div class="xs muted">${usdNative ? 'قیمت جهانی، به دلار.' : 'قیمت هر روز ÷ نرخ دلار همان روز: اثر ارزان شدن ریال حذف شده و رشد خود دارایی دیده می‌شود.'}</div>`}

      ${st8 && html`<div class="pd-grid">
        <div class="pcell"><span class="n">بالاترین</span><span class="small sb"><${V} v=${st8.hi.v} /></span><span class="xs muted">${fmtJ(st8.hi.date, range > 91 ? 'long' : 'dm')}</span></div>
        <div class="pcell"><span class="n">پایین‌ترین</span><span class="small sb"><${V} v=${st8.lo.v} /></span><span class="xs muted">${fmtJ(st8.lo.date, range > 91 ? 'long' : 'dm')}</span></div>
        <div class="pcell"><span class="n">تغییر در این بازه</span><span class="small"><${Delta} p=${st8.change} showAbs=${false} /></span></div>
        <div class="pcell"><span class="n">فاصله از بالاترین</span><span class="small sb ltr">${Math.abs(st8.fromHigh) < 0.0005 ? 'روی بالاترین' : pct(st8.fromHigh, { digits: 1 })}</span></div>
      </div>`}
      ${series.length > 1 && html`<div class="pd-periods">${PERIODS.map(([d, t]) => html`<div><span class="xs muted">${t}</span><span class="small">${changes[d] === null ? html`<span class="faint">—</span>` : html`<${Delta} p=${changes[d]} showAbs=${false} />`}</span></div>`)}</div>`}

      ${pos && html`<div class="pd-card">
        <div class="sb small row" style="gap:6px"><${Icon} n="assets" cls="sm" />سهم تو</div>
        <div class="pd-line"><span>${pos.unit ? `${num(pos.qty, pos.qty < 10 ? 3 : 2)} ${pos.unit}` : `${num(pos.assets.length)} دارایی`}</span><b><${Money} v=${pos.value} s=${s} /></b></div>
        ${pos.avg && html`<div class="pd-line"><span>میانگین قیمت خرید</span><span><${Money} v=${pos.avg} s=${s} /></span></div>`}
        ${pos.pnl !== null && html`<div class="pd-line"><span>سود یا زیان${pos.partialCost ? html` <span class="xs muted">(فقط آن‌هایی که قیمت خرید دارند)</span>` : ''}</span><span class=${pos.pnl >= 0 ? 'pos' : 'neg'}><${Money} v=${pos.pnl} s=${s} sign /> <span class="xs ltr">(${pct(pos.ret, { digits: 1 })})</span></span></div>`}
        ${!pos.cost && html`<div class="xs muted">قیمت خرید ثبت نشده؛ برای دیدن سود و زیان و خط میانگین خرید، در ویرایش دارایی «قیمت خرید کل» را بنویس.</div>`}
        ${marks.length > 0 && html`<div class="xs muted"><span class="pd-dot buy"></span> خرید <span class="pd-dot sell"></span> فروش، روی نمودار</div>`}
      </div>`}

      ${coin && !coin.stale && html`<div class="pd-card">
        <div class="sb small">حباب سکه</div>
        <div class="pd-line"><span>حباب امروز</span><b class="ltr">${pct(coin.bubble, { digits: 1 })}</b></div>
        ${bubAvg !== null && isFinite(bubAvg) && html`<div class="pd-line"><span>میانگین ۳ ماه</span><span class="ltr">${pct(bubAvg, { digits: 1 })}</span></div>`}
        <div class="pd-line"><span>ارزش طلای داخلش</span><span><${Money} v=${coin.intrinsic} s=${s} /></span></div>
        <div class="xs muted">طلای داخل سکه با قیمت انس جهانی × دلار آزاد؛ باقی قیمت، حباب است.</div>
      </div>`}
      ${fund && html`<div class="pd-card"><div class="sb small">صندوق</div>
        <div class="pd-line"><span>NAV ابطال</span><span><${Money} v=${fund.nav} s=${s} /></span></div>
        <div class="pd-line"><span>حباب (قیمت بازار ÷ NAV)</span><b class="ltr">${pct(fund.bubble, { digits: 1 })}</b></div></div>`}
      ${goldGap !== null && pure && !pure.stale && html`<div class="pd-card"><div class="sb small">در برابر قیمت جهانی</div>
        <div class="pd-line"><span>طلای خالص هر گرم (انس × دلار)</span><span><${Money} v=${pure.price} s=${s} /></span></div>
        <div class="pd-line"><span>طلای ۱۸ عیار بازار نسبت به آن</span><b class="ltr">${pct(goldGap, { digits: 1 })}</b></div>
        <div class="xs muted">هر گرم ۱۸ عیار، ۷۵۰ از ۱۰۰۰ طلای خالص است؛ مثبت یعنی بازار داخل گران‌تر از قیمت جهانی با دلار آزاد است.</div></div>`}

      <div class="pd-tools">
        ${item && html`<button class="chip" onClick=${() => go(`#/calc?t=convert&to=${item.id}`)}><${Icon} n="swap" cls="sm" />با یک مبلغ چقدر می‌شود</button>`}
        ${ref.provider === 'tgju' && ref.key === 'geram18' && html`<button class="chip" onClick=${() => go('#/calc?t=gold')}><${Icon} n="gold" cls="sm" />فاکتور طلا</button>`}
        ${beId && html`<button class="chip" onClick=${() => go(`#/calc?t=breakeven&pick=${encodeURIComponent(beId)}`)}><${Icon} n="target" cls="sm" />نقطه سربه‌سر با سپرده</button>`}
        ${item && html`<button class="chip" onClick=${() => go(`#/analysis?cmp=${item.id}`)}><${Icon} n="analysis" cls="sm" />مقایسه با نگه‌داشتن پول</button>`}
        <button class="chip" onClick=${() => setAlertOpen(true)}><${Icon} n="bell" cls="sm" />هشدار قیمت</button>
        <${AskBtn} q=${`درباره «${name}» توضیح بده: روند قیمتش در ماه‌های اخیر${pos ? ' و وضع دارایی من در آن' : ''} چطور بوده؟`} label="از دستیار بپرس" />
      </div>
      <div class="xs muted">قیمت پایانی هر روز از ${providerName(ref.provider)}${view === 'usd' && canDollar && !usdNative ? '؛ دلار آزاد از tgju' : ''}. داده روزانه است، نه لحظه‌ای.</div>
    </div>
    ${alertOpen && html`<${AlertModal} s=${s} st=${st} init=${{ ref, price: q?.price }} onClose=${() => setAlertOpen(false)} />`}
  </${Drawer}>`;
}
