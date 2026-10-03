// Coin and fund bubbles on screen: the market card, the small pill, and the 3-month history behind «normal».
import { html, useState, useEffect, Icon, Money, Sparkline, send, num, pct } from './components.js';
import { T } from './tips.js';
import * as BB from '../lib/bubble.js';
import { timeHM } from '../lib/format.js';

/** 90-day bubble history and average per coin, from the worker (cached there for a few hours). */
export function useBubbleStats(keys = BB.COIN_KEYS) {
  const [st, setSt] = useState(null);
  const k = keys.join(',');
  useEffect(() => {
    let alive = true;
    if (!keys.length) { setSt({}); return undefined; }
    send('bubbleStats', { keys, days: 90 }).then((r) => { if (alive) setSt(r?.ok ? r.stats || {} : {}); }).catch(() => alive && setSt({}));
    return () => { alive = false; };
  }, [k]);
  return st;
}

const LEVEL = { high: ['warn', 'بالاتر از معمول'], low: ['auto', 'پایین‌تر از معمول'], normal: ['', 'در محدوده معمول'] };
/** The bubble as a small pill, coloured by where it sits against its own 3-month average (when known). */
export function BubblePill({ b, stat, title = '' }) {
  if (!b) return html`<span class="muted">—</span>`;
  const lv = stat?.avg !== undefined && !b.stale ? LEVEL[stat.level] : null;
  const tip = [title, b.stale ? 'قیمت‌ها قدیمی است؛ حباب ممکن است دقیق نباشد' : '', lv ? `${lv[1]} (میانگین ۳ ماه ${pct(stat.avg, { sign: false })})` : ''].filter(Boolean).join(' — ');
  return html`<span class=${'pill bub ' + (b.stale ? 'stale' : lv ? lv[0] : '')} title=${tip}><span class="ltr">${pct(b.bubble, { sign: false })}</span>${lv && lv[0] ? html`<span class="xs">${stat.level === 'high' ? '▲' : '▼'}</span>` : ''}</span>`;
}

/** Bubble held: how much of the coins' and gold funds' value is bubble. */
export function heldBubble(pf, quotes) {
  let amount = 0, value = 0, n = 0;
  for (const r of pf.rows || []) {
    if (r.exposure !== 'gold') continue; // coins and gold funds (a fixed-income fund's bubble is not gold's)
    const b = BB.assetBubble(r.asset, quotes, r.value);
    if (!b || b.amount === null || b.stale) continue;
    amount += b.amount; value += r.value; n++;
  }
  return n ? { amount, value, n, share: value ? amount / value : 0 } : null;
}

/** Market page: every coin's bubble, the cheapest gram of pure gold, and the bubble inside what you hold. */
export function BubbleCard({ st, pf, s, onAlert }) {
  const stats = useBubbleStats();
  const { rows, best, gold } = BB.coinBubbles(st.quotes);
  const held = heldBubble(pf, st.quotes);
  const heldKeys = new Set(st.assets.filter((a) => !a.archived && a.mode === 'units' && a.price?.source === 'market' && BB.isCoinRef(a.price.ref)).map((a) => a.price.ref.key));
  const head = html`<div class="card-h"><h3><${Icon} n="coin" cls="sm" />حباب سکه و قیمت هر گرم طلای خالص${T('bubble')}</h3>
    ${gold && html`<span class="sub">انس <span class="ltr">$${num(gold.ounce, 0)}</span> × دلار <${Money} v=${gold.usd} s=${s} unit=${false} />، ${gold.stale ? html`<span class="warn">قیمت‌ها قدیمی است</span>` : timeHM(gold.at)}</span>`}</div>`;
  const off = s.providers?.tgju === false;
  if (!gold || !rows.length) return html`<div class="card bubcard">${head}<div class="empty small">${off ? 'منبع «طلا، سکه، ارز و فلزات (tgju)» در تنظیمات خاموش است؛ برای حساب حباب روشنش کن.' : 'برای حساب حباب، قیمت انس جهانی طلا و دلار بازار آزاد لازم است که هنوز دریافت نشده. بعد از به‌روزرسانی بعدی قیمت‌ها اینجا پر می‌شود.'}</div></div>`;
  return html`<div class="card bubcard">${head}
    ${off && html`<div class="callout warn" style="margin-bottom:12px"><${Icon} n="alert" cls="sm" /><div>منبع tgju در تنظیمات خاموش است؛ این عددها با آخرین قیمت‌های ذخیره‌شده حساب شده و به‌روز نمی‌شوند.</div></div>`}
    ${held && Math.abs(held.amount) >= 1 && html`<div class="callout" style="margin-bottom:12px"><${Icon} n="info" cls="sm" /><div>${held.amount > 0
      ? html`در دارایی‌های تو: حدود <b><${Money} v=${held.amount} s=${s} compact /></b> از ارزش سکه‌ها و صندوق‌های طلایت حباب است (<span class="ltr">${pct(held.share, { sign: false })}</span> از ارزش آن‌ها). اگر حباب‌ها صفر شوند، همین‌قدر کم می‌شود؛ حتی اگر قیمت طلا تکان نخورد.`
      : html`سکه‌ها و صندوق‌های طلایت روی‌هم حدود <b><${Money} v=${-held.amount} s=${s} compact /></b> زیر ارزش طلا (یا NAV) معامله می‌شوند؛ اگر این فاصله بسته شود، همین‌قدر به ارزششان اضافه می‌شود.`}</div></div>`}
    <table class="tbl bubtbl"><thead><tr><th>نوع</th><th class="n">قیمت بازار</th><th class="n">ارزش طلای داخلش</th><th>حباب</th><th>میانگین ۳ ماه</th><th>روند ۳ ماه</th><th class="n">هر گرم طلای خالص${T('perPure')}</th><th></th></tr></thead><tbody>
    ${rows.map((r) => {
      const stt = stats?.[r.key];
      const isRef = r.kind === 'ref';
      return html`<tr class=${'r' + (isRef ? ' refrow' : '')}>
        <td class="sb">${r.name}${heldKeys.has(r.key) ? html`<span class="tag-watch">در پرتفوی</span>` : ''}<div class="xs muted">${isRef ? 'مرجع مقایسه؛ اختلاف قیمت داخلی با جهانی' : `${num(r.pure, 2)} گرم طلای خالص${r.retail ? '، قیمت خرده‌فروشی' : ''}`}</div></td>
        <td class="n"><${Money} v=${r.price} s=${s} compact /></td>
        <td class="n"><${Money} v=${r.intrinsic} s=${s} compact /></td>
        <td><${BubblePill} b=${r} stat=${isRef ? null : stt} title=${isRef ? 'اختلاف قیمت طلای داخلی با قیمت جهانی (انس × دلار)' : ''} /></td>
        <td class="small">${isRef ? '' : stats === null ? html`<span class="muted">…</span>` : stt?.avg !== undefined ? html`<span class="ltr">${pct(stt.avg, { sign: false })}</span>` : html`<span class="muted" title=${stt?.error || 'تاریخچه کافی نیست'}>—</span>`}</td>
        <td>${isRef ? '' : stt?.series?.length > 1 ? html`<span title=${stt.min !== undefined ? `کمترین ${pct(stt.min, { sign: false })}، بیشترین ${pct(stt.max, { sign: false })}` : ''}><${Sparkline} values=${stt.series.map((p) => p[1] * 100)} w=${96} h=${26} color="var(--warn)" /></span>` : ''}</td>
        <td class="n"><${Money} v=${r.perPure} s=${s} compact />${best && r.key === best.key ? html`<div><span class="pill live">کمترین</span></div>` : r.vsBest !== null ? html`<div class="xs muted"><span class="ltr">${pct(r.vsBest, { sign: false })}</span> بیشتر</div>` : ''}</td>
        <td>${!isRef && onAlert && html`<button class="btn ghost sm icon" title="هشدار حباب" onClick=${() => onAlert({ ref: { provider: 'tgju', key: r.key }, kind: 'bubble', bubble: r.bubble })}><${Icon} n="bell" cls="sm" /></button>`}</td>
      </tr>`; })}
    </tbody></table>
    <div class="xs muted" style="margin-top:10px;line-height:1.9">ارزش طلای داخل سکه = گرم طلای خالص × قیمت جهانی هر گرم (انس × دلار بازار آزاد ÷ ۳۱٫۱). قیمت ۱۸ عیار قیمت خام بازار است؛ اجرت، کارمزد و اختلاف قیمت خرید و فروش هیچ‌کدام حساب نشده. «بالاتر یا پایین‌تر از معمول» یعنی حباب امروز بیرون از نوسان عادی همان سکه در ۳ ماه گذشته است. این‌ها توصیه خرید یا فروش نیست.</div>
  </div>`;
}
