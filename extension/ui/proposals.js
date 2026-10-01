// Confirm-before-apply cards for changes suggested by the assistant or the one-sentence entry.
import { html, useState, Icon, toast, num } from './components.js';
import { act } from './actions.js';

/** Plain description of a proposal in the user's display unit. */
export function describe(p, st, s) {
  const k = s.currency === 'rial' ? 1 : 10;
  const unit = s.currency === 'rial' ? 'ریال' : 'تومان';
  const m = (v) => `${num(Math.abs(v) / k)} ${unit}`;
  const a = st.assets.find((x) => x.id === p.assetId);
  if (p.type === 'update') {
    const cur = p.field === 'quantity' ? a?.quantity : p.field === 'balance' ? a?.balance : a?.price?.value;
    const f = (v) => (p.field === 'quantity' ? `${num(v, 'auto')} ${a?.unit || p.unit || ''}` : m(v));
    return { title: `اصلاح «${p.assetName}»`, detail: `${p.field === 'quantity' ? 'مقدار' : p.field === 'balance' ? 'مانده' : 'قیمت واحد'}: ${cur !== undefined && cur !== null ? f(cur) : '—'} ← ${f(p.value)}` };
  }
  if (p.type === 'trade' || p.type === 'newbuy') {
    return {
      title: `${p.side === 'sell' ? 'فروش' : 'خرید'} «${p.assetName}»${p.type === 'newbuy' ? ' (دارایی جدید)' : ''}`,
      detail: `${num(p.qty, 'auto')} ${p.unit || ''} × ${m(p.price)} = ${m(p.qty * p.price)}${p.cashName ? `، ${p.side === 'sell' ? 'واریز به' : 'از'} ${p.cashName}` : ''}`,
      hint: p.priceFromMarket ? 'قیمت در جمله نبود؛ قیمت فعلی بازار گذاشته شد.' : '',
    };
  }
  if (p.type === 'adjust') return { title: `${p.delta >= 0 ? 'واریز به' : 'برداشت از'} «${p.assetName}»`, detail: `${m(p.delta)}${p.note ? `، ${p.note}` : ''}` };
  if (p.type === 'transfer') return { title: 'انتقال بین حساب‌ها', detail: `${m(p.amount)} از «${p.fromName}» به «${p.toName}»` };
  return { title: 'پیشنهاد', detail: '' };
}

export async function applyProposal(p, st) {
  const a = st.assets.find((x) => x.id === p.assetId);
  if (p.type === 'update') {
    if (!a) throw new Error('این دارایی دیگر وجود ندارد');
    if (p.field === 'quantity') await act.patchAsset(a.id, { quantity: p.value });
    else if (p.field === 'balance') await act.patchAsset(a.id, { balance: p.value, balanceAt: Date.now() });
    else if (a.price?.source === 'market') throw new Error('قیمت این دارایی خودکار است و دستی تغییر نمی‌کند');
    else await act.patchAsset(a.id, { price: { ...a.price, value: p.value, updatedAt: Date.now() } });
  } else if (p.type === 'trade') {
    if (!a) throw new Error('این دارایی دیگر وجود ندارد');
    await act.trade({ assetId: a.id, side: p.side, qty: p.qty, price: p.price, cashId: p.cashId });
  } else if (p.type === 'newbuy') {
    await act.saveAsset({ ...p.asset, quantity: 0, costBasis: 0 });
    await act.trade({ assetId: p.asset.id, side: 'buy', qty: p.qty, price: p.price, cashId: p.cashId });
  } else if (p.type === 'adjust') {
    if (!a) throw new Error('این حساب دیگر وجود ندارد');
    await act.adjust({ assetId: a.id, delta: p.delta, note: p.note || undefined });
  } else if (p.type === 'transfer') {
    await act.transfer({ fromId: p.fromId, toId: p.toId, amount: p.amount });
  }
}

export function ProposalCard({ p, st, s, onStatus }) {
  const d = describe(p, st, s);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    if (busy) return; // a double click must not apply twice
    setBusy(true);
    try { await applyProposal(p, st); onStatus('applied'); toast('ثبت شد؛ از «گزارش رویدادها» قابل برگشت است'); }
    catch (e) { toast(e.message); setBusy(false); }
  };
  return html`<div class="prop">
    <div class="row"><${Icon} n="wand" cls="sm" /><span class="sb small grow">${d.title}</span>${p.status === 'applied' ? html`<span class="pill live">ثبت شد</span>` : p.status === 'rejected' ? html`<span class="pill">رد شد</span>` : ''}</div>
    <div class="small num">${d.detail}</div>
    ${d.hint && html`<div class="xs muted">${d.hint}</div>`}
    ${p.reason && html`<div class="xs muted">${p.reason}</div>`}
    ${!p.status && html`<div class="row"><button class="btn sm primary" disabled=${busy} onClick=${apply}><${Icon} n=${busy ? 'refresh' : 'check'} cls=${'sm' + (busy ? ' spin' : '')} />تأیید و ثبت</button><button class="btn sm ghost" disabled=${busy} onClick=${() => onStatus('rejected')}>رد</button></div>`}
  </div>`;
}
