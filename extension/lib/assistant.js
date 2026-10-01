// Dara assistant: system prompt, portfolio tools, weekly report and page-capture prompts.
import * as E from './engine.js';
import { CAT, CATEGORIES, EXPOSURES, TGJU_BY_KEY, NOBITEX_BY_KEY } from './catalog.js';
import { fmtJ, todayIso, addDaysIso, isoFromDate } from './jalali.js';
import { uid } from './format.js';

const unitName = (s) => (s?.currency === 'rial' ? 'ریال' : 'تومان');
/** Rial → display unit, rounded */
const disp = (rial, s) => (rial === null || rial === undefined || !isFinite(rial) ? null : Math.round(s?.currency === 'rial' ? rial : rial / 10));
const pct = (x) => (x === null || x === undefined || !isFinite(x) ? null : +(x * 100).toFixed(2));

function refName(ref) {
  if (!ref) return '';
  if (ref.provider === 'tgju') return TGJU_BY_KEY[ref.key]?.name || ref.key;
  if (ref.provider === 'nobitex') return NOBITEX_BY_KEY[ref.key]?.name || ref.name || String(ref.sym || ref.key).toUpperCase();
  return ref.label || ref.symbol || ref.name || ref.key;
}

export function systemPrompt(st, privacy = 'full') {
  const s = st.settings;
  const pf = E.portfolio(st.assets, st.quotes, s);
  const unit = unitName(s);
  const overview = privacy === 'percent'
    ? `ترکیب دارایی (درصد از کل): ${pf.cats.filter((c) => !c.liability).map((c) => `${c.short} ${pct(c.share)}٪`).join('، ')}`
    : `ارزش خالص: ${disp(pf.net, s)?.toLocaleString('en-US')} ${unit}. ترکیب: ${pf.cats.filter((c) => !c.liability).map((c) => `${c.short} ${pct(c.share)}٪`).join('، ')}${pf.debt ? `. بدهی: ${disp(pf.debt, s)?.toLocaleString('en-US')} ${unit}` : ''}`;
  return `تو «دستیار دارا» هستی؛ دستیار مالی شخصی درون افزونه مدیریت دارایی «دارا». کاربر ایرانی است و دارایی‌هایش (طلا، سکه، ارز، بورس، صندوق، رمزارز، سپرده، ملک و…) را اینجا نگه می‌دارد.

قواعد:
- به فارسی روان، دقیق و کوتاه پاسخ بده (معمولاً کمتر از ۱۸۰ کلمه). از فهرست و پاراگراف کوتاه استفاده کن.
- هر عددی را فقط از داده‌ها یا خروجی ابزارها بیاور؛ هرگز عدد نساز یا حدس نزن. اگر داده‌ای نیست، صریح بگو.
- برای هر محاسبه (سناریو، تغییرات، زمان‌بندی، تاریخچه) ابزار مربوط را صدا بزن و خودت حساب نکن.
- مبالغ را به ${unit} بنویس، با جداکننده هزارگان؛ برای اعداد بزرگ از «میلیون/میلیارد» استفاده کن.
- توصیه قطعی خرید و فروش نده؛ گزینه‌ها، اثر و ریسک هرکدام را بگو و تصمیم را به کاربر بسپار.
- برای تغییر داده‌ها فقط ابزارهای propose_* را صدا بزن؛ تغییر بعد از تأیید کاربر اعمال می‌شود. بعد از پیشنهاد، به کاربر بگو دکمه تأیید را بزند.
${privacy === 'percent' ? '- حالت حریم خصوصی «فقط درصد» فعال است: مبالغ مطلق در دسترس تو نیست؛ با درصدها پاسخ بده.\n' : ''}
امروز: ${fmtJ(todayIso())}. واحد نمایش: ${unit}.
خلاصه فعلی: ${overview}.`;
}

/** Tools the model can call. ctx: { getState: () => st, privacy, onProposal(p) } */
export function makeTools(ctx) {
  const P = () => ctx.privacy === 'percent';
  const st = () => ctx.getState();
  const money = (rial, net) => (P() ? { share_pct: net ? pct(rial / Math.abs(net)) : null } : { amount: disp(rial, st().settings) });
  const pfOf = () => { const s = st(); return E.portfolio(s.assets, s.quotes, s.settings); };
  return [
    {
      name: 'get_overview',
      description: 'خلاصه کامل پرتفوی: ارزش خالص، ترکیب دسته‌ها، مواجهه‌ها (ریالی/طلا/ارز/...)، نقدشوندگی، تغییر امروز/۷/۳۰ روز.',
      schema: { type: 'object', properties: {}, required: [] },
      run: () => {
        const s = st(); const pf = pfOf(); const g = pf.gross || 1;
        const ch = (d) => { const c = E.changeSince(s.snapshots, d, pf.net); return c ? { pct: pct(c.pct), ...(P() ? {} : { amount: disp(c.abs, s.settings) }) } : null; };
        return {
          unit: unitName(s.settings), ...(P() ? {} : { net: disp(pf.net, s.settings), gross: disp(pf.gross, s.settings), debt: disp(pf.debt, s.settings) }),
          change: { today: ch(1) || { pct: pct(pf.dayChangePct) }, week: ch(7), month: ch(30) },
          categories: pf.cats.map((c) => ({ id: c.id, name: c.name, share_pct: pct(c.value / g), ...money(c.value, pf.net), liability: !!c.liability })),
          exposures: Object.fromEntries(Object.entries(pf.byExposure).map(([k, v]) => [EXPOSURES[k]?.name || k, pct(v / g)])),
          liquidity_pct: { high: pct(pf.byLiquidity.high / g), mid: pct(pf.byLiquidity.mid / g), low: pct(pf.byLiquidity.low / g) },
          needs_attention: pf.attention.map((r) => ({ name: r.asset.name, status: r.status, error: r.error })),
        };
      },
    },
    {
      name: 'list_assets',
      description: 'فهرست دارایی‌ها با جزئیات (مقدار، قیمت واحد، ارزش، سهم، سود/زیان، منبع قیمت، وضعیت). فیلتر اختیاری با دسته یا متن.',
      schema: { type: 'object', properties: { category: { type: 'string', description: `یکی از: ${CATEGORIES.map((c) => c.id).join(', ')}` }, query: { type: 'string' } }, required: [] },
      run: ({ category, query } = {}) => {
        const s = st(); const pf = pfOf(); const g = pf.gross || 1;
        return pf.rows.filter((r) => (!category || r.asset.category === category) && (!query || `${r.asset.name} ${r.asset.custodian || ''}`.includes(query))).map((r) => ({
          id: r.asset.id, name: r.asset.name, category: r.cat.name, custodian: r.asset.custodian || '', mode: r.asset.mode,
          ...(P() ? {} : { quantity: r.asset.mode === 'units' ? +(+r.asset.quantity).toFixed(6) : undefined, unit: r.asset.unit, unit_price: r.unitPrice ? disp(r.unitPrice, s.settings) : undefined, value: disp(r.signedValue, s.settings), pnl: r.pnl !== null ? disp(r.pnl, s.settings) : undefined }),
          share_pct: r.cat.liability ? null : pct(r.value / g), return_pct: r.ret !== null ? pct(r.ret) : undefined,
          price_source: r.asset.mode === 'units' ? (r.asset.price?.source === 'market' ? refName(r.asset.price.ref) : 'دستی') : r.asset.mode === 'rate' ? `نرخ ${r.asset.rate?.annualPct}٪` : 'مانده',
          status: r.status, exposure: EXPOSURES[r.exposure]?.name,
        }));
      },
    },
    {
      name: 'get_prices',
      description: 'قیمت‌های لحظه‌ای بازار (طلا، سکه، دلار، یورو، تتر، بیت‌کوین، انس) و تغییر روزانه.',
      schema: { type: 'object', properties: {}, required: [] },
      run: () => {
        const s = st(); const out = {};
        const known = new Map([...s.assets.map((a) => a.price?.ref).filter(Boolean), ...(s.settings.watch || [])].map((r) => [E.quoteId(r), r]));
        for (const [id, q] of Object.entries(s.quotes)) {
          if (!(q.price > 0)) continue;
          const [prov, key] = id.split(':');
          const usd = prov === 'tgju' && TGJU_BY_KEY[key]?.usd;
          out[refName(known.get(id) || { provider: prov, key })] = { price: usd ? q.price : disp(q.price, s.settings), unit: usd ? 'دلار' : unitName(s.settings), day_change_pct: pct(q.changePct || 0), as_of: q.asOf || fmtJ(isoFromDate(new Date(q.at || Date.now()))) };
        }
        return out;
      },
    },
    {
      name: 'explain_change',
      description: 'تحلیل «چرا ارزش تغییر کرد» برای یک دوره: سهم اثر بازار، واریز/برداشت و ویرایش دستی، به تفکیک دسته و دارایی.',
      schema: { type: 'object', properties: { period: { type: 'string', enum: ['day', 'week', 'month'] } }, required: ['period'] },
      run: ({ period = 'day' }) => {
        const s = st(); const days = { day: 1, week: 7, month: 30 }[period] || 1;
        const at = E.attribution(s.assets, s.quotes, s.settings, s.snapshots, s.events, days);
        if (!at) return { error: 'برای این دوره هنوز تاریخچه ثبت نشده' };
        const m = (v) => (P() ? { pct_of_net: pct(v / Math.abs(at.base || 1)) } : { amount: disp(v, s.settings) });
        return { since: fmtJ(at.from), total_change_pct: pct(at.pct), total: m(at.total), market_effect: m(at.market), deposits_withdrawals: m(at.external), manual_edits: m(at.edits),
          by_category: at.cats.slice(0, 8).map((c) => ({ name: c.name, market: m(c.market), moved_money: m(c.flow) })),
          top_assets: at.rows.slice(0, 6).map((r) => ({ name: r.asset?.name, market: m(r.market) })) };
      },
    },
    {
      name: 'simulate_scenario',
      description: 'شبیه‌سازی سناریو. ورودی‌ها درصد تغییرند (مثلاً 20 یعنی +۲۰٪). طلای داخلی = انس × دلار، پس تغییر دلار روی طلا، رمزارز و فلزات هم اثر دارد.',
      schema: { type: 'object', properties: {
        usd_pct: { type: 'number', description: 'تغییر نرخ دلار در بازار آزاد' }, gold_ounce_pct: { type: 'number', description: 'تغییر انس جهانی طلا (دلاری)' },
        crypto_pct: { type: 'number', description: 'تغییر دلاری رمزارزها' }, metals_pct: { type: 'number', description: 'تغییر دلاری نقره/مس' },
        bourse_pct: { type: 'number', description: 'تغییر بورس تهران' }, private_pct: { type: 'number', description: 'تغییر ارزش سهام غیربورسی' }, real_estate_pct: { type: 'number' } }, required: [] },
      run: (a = {}) => {
        const s = st();
        const shocks = { usd: (a.usd_pct || 0) / 100, gold: (a.gold_ounce_pct || 0) / 100, crypto: (a.crypto_pct || 0) / 100, metals: (a.metals_pct || 0) / 100, equity: (a.bourse_pct || 0) / 100, real: (a.real_estate_pct || 0) / 100 };
        if (a.private_pct !== undefined) shocks.private = a.private_pct / 100;
        const r = E.simulate(s.assets, s.quotes, s.settings, shocks);
        const m = (v) => (P() ? undefined : disp(v, s.settings));
        return { change_pct: pct(r.pct), net_before: m(r.before), net_after: m(r.after), change: m(r.delta),
          in_usd_terms_change_pct: r.usdBefore ? pct(r.usdAfter / r.usdBefore - 1) : null, in_gold_terms_change_pct: r.goldBefore ? pct(r.goldAfter / r.goldBefore - 1) : null,
          by_exposure: r.exposures.map((e) => ({ name: e.name, change_pct: e.before ? pct(e.after / e.before - 1) : 0, ...(P() ? {} : { change: disp(e.after - e.before, s.settings) }) })),
          most_affected: r.rows.slice(0, 5).map((x) => ({ name: x.asset.name, change_pct: pct(x.factor - 1) })) };
      },
    },
    {
      name: 'get_schedule',
      description: 'رویدادهای خودکار آینده (واریز سود، سررسید، حقوق، قسط) و درآمد خودکار ماهانه.',
      schema: { type: 'object', properties: { days: { type: 'number' } }, required: [] },
      run: ({ days = 30 } = {}) => {
        const s = st(); const up = E.upcoming(s.assets, s.flows, Math.min(120, days || 30)); const auto = E.monthlyAuto(s.assets, s.flows);
        return { upcoming: up.slice(0, 20).map((e) => ({ date: fmtJ(e.date), title: e.title, ...(P() ? {} : { amount: disp(e.amount, s.settings) }) })),
          monthly_auto: P() ? undefined : { interest: disp(auto.interest, s.settings), inflow: disp(auto.inflow, s.settings), outflow: disp(auto.outflow, s.settings) } };
      },
    },
    {
      name: 'get_history',
      description: 'روند ارزش خالص در N روز گذشته (حداکثر ۳۰ نقطه نمونه) به همراه تغییر بر حسب تومان، دلار و طلا.',
      schema: { type: 'object', properties: { days: { type: 'number' } }, required: ['days'] },
      run: ({ days = 90 }) => {
        const s = st(); const series = E.seriesFrom(s.snapshots, 'money', Math.min(1500, days));
        if (series.length < 2) return { error: 'تاریخچه کافی ثبت نشده؛ از تنظیمات «بازسازی تاریخچه» را اجرا کن' };
        const step = Math.max(1, Math.ceil(series.length / 30));
        const first = series[0], last = series[series.length - 1];
        const usd = E.seriesFrom(s.snapshots, 'usd', days), gold = E.seriesFrom(s.snapshots, 'gold', days);
        return { from: fmtJ(first.date), to: fmtJ(last.date), change_pct: pct(last.value / first.value - 1),
          usd_terms_change_pct: usd.length > 1 ? pct(usd[usd.length - 1].value / usd[0].value - 1) : null, gold_terms_change_pct: gold.length > 1 ? pct(gold[gold.length - 1].value / gold[0].value - 1) : null,
          points: series.filter((_, i) => i % step === 0 || i === series.length - 1).map((p) => ({ date: fmtJ(p.date, 'short'), ...(P() ? { index: +(p.value / first.value * 100).toFixed(1) } : { value: disp(p.value, s.settings) }), estimated: p.est || undefined })) };
      },
    },
    {
      name: 'propose_update',
      description: 'پیشنهاد به‌روزرسانی یک دارایی (مقدار، مانده یا قیمت واحد). اعمال فقط بعد از تأیید کاربر. مبالغ به واحد نمایش (تومان/ریال).',
      schema: { type: 'object', properties: { asset_id: { type: 'string' }, field: { type: 'string', enum: ['quantity', 'balance', 'unit_price'] }, new_value: { type: 'number' }, reason: { type: 'string' } }, required: ['asset_id', 'field', 'new_value'] },
      run: ({ asset_id, field, new_value, reason }) => {
        const s = st(); const a = s.assets.find((x) => x.id === asset_id);
        if (!a) return { error: 'دارایی با این شناسه پیدا نشد؛ اول list_assets را صدا بزن' };
        if (!(new_value >= 0)) return { error: 'مقدار نامعتبر' };
        const k = s.settings.currency === 'rial' ? 1 : 10;
        const p = { id: uid('p'), type: 'update', assetId: a.id, assetName: a.name, field, value: field === 'quantity' ? new_value : new_value * k, unit: a.unit, reason: reason || '' };
        ctx.onProposal?.(p);
        return { ok: true, note: 'پیشنهاد برای تأیید کاربر نمایش داده شد' };
      },
    },
    {
      name: 'propose_trade',
      description: 'پیشنهاد ثبت خرید یا فروش یک دارایی واحددار، با برداشت/واریز اختیاری از حساب بانکی. اعمال فقط با تأیید کاربر.',
      schema: { type: 'object', properties: { asset_id: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] }, quantity: { type: 'number' }, unit_price: { type: 'number', description: 'به واحد نمایش' }, cash_asset_id: { type: 'string' } }, required: ['asset_id', 'side', 'quantity', 'unit_price'] },
      run: ({ asset_id, side, quantity, unit_price, cash_asset_id }) => {
        const s = st(); const a = s.assets.find((x) => x.id === asset_id);
        if (!a || a.mode !== 'units') return { error: 'دارایی واحددار با این شناسه پیدا نشد' };
        if (!(quantity > 0) || !(unit_price > 0)) return { error: 'مقدار یا قیمت نامعتبر' };
        const k = s.settings.currency === 'rial' ? 1 : 10;
        const cash = cash_asset_id ? s.assets.find((x) => x.id === cash_asset_id) : null;
        ctx.onProposal?.({ id: uid('p'), type: 'trade', assetId: a.id, assetName: a.name, side, qty: quantity, price: unit_price * k, cashId: cash?.id || null, cashName: cash?.name || null, unit: a.unit });
        return { ok: true, note: 'پیشنهاد برای تأیید کاربر نمایش داده شد' };
      },
    },
  ];
}

/* ---------------- weekly narrative ---------------- */
export function templateNarrative(f, s) {
  const unit = unitName(s);
  const m = (r) => { const v = Math.abs(r / (s?.currency === 'rial' ? 1 : 10)); return v >= 1e9 ? `${(v / 1e9).toFixed(2)} میلیارد ${unit}` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} میلیون ${unit}` : `${Math.round(v).toLocaleString('en-US')} ${unit}`; };
  const p = (x) => `${Math.abs(x * 100).toFixed(1)}٪`;
  const lines = [];
  if (f.change) {
    lines.push(`**خلاصه:** ارزش خالص دارایی‌ها در ${f.period.days} روز گذشته ${f.change.abs >= 0 ? 'افزایش' : 'کاهش'} ${p(f.change.pct)} داشت (${f.change.abs >= 0 ? '+' : '−'}${m(f.change.abs)}).`);
    const terms = [];
    if (f.usdPct !== null && isFinite(f.usdPct)) terms.push(`بر حسب دلار ${f.usdPct >= 0 ? '+' : '−'}${p(f.usdPct)}`);
    if (f.goldPct !== null && isFinite(f.goldPct)) terms.push(`بر حسب طلا ${f.goldPct >= 0 ? '+' : '−'}${p(f.goldPct)}`);
    if (terms.length) lines.push(`ارزش واقعی: ${terms.join('، ')}.`);
  } else lines.push('**خلاصه:** هنوز تاریخچه کافی برای مقایسه هفتگی ثبت نشده است.');
  if (f.drivers?.length) {
    lines.push('', '**چه چیزی تغییر داد:**');
    for (const d of f.drivers.slice(0, 4)) if (Math.abs(d.market) > 0) lines.push(`- ${d.name}: ${d.market >= 0 ? '+' : '−'}${m(d.market)} از تغییر قیمت`);
    if (f.external) lines.push(`- واریز و برداشت: ${f.external >= 0 ? '+' : '−'}${m(f.external)}`);
  }
  if (f.interestReceived) lines.push(`- سود دریافتی این هفته: ${m(f.interestReceived)}`);
  if (f.upcoming?.length) { lines.push('', '**هفته پیش رو:**'); for (const e of f.upcoming.slice(0, 4)) lines.push(`- ${fmtJ(e.date, 'dm')}: ${e.title}${e.amount ? ` (${m(e.amount)})` : ''}`); }
  if (f.stale?.length) lines.push('', `**نیاز به توجه:** ${f.stale.slice(0, 4).map((x) => x.name).join('، ')}`);
  if (f.topHolding?.share > 0.35) lines.push('', `**ریسک تمرکز:** ${p(f.topHolding.share)} از دارایی‌ها در «${f.topHolding.name}» است.`);
  return lines.join('\n');
}

export function weeklyPrompt(facts, s, privacy) {
  const data = privacy === 'percent' ? E.percentify(facts, facts.net) : facts;
  return `بر اساس داده‌های JSON زیر (مبالغ به ریال${privacy === 'percent' ? '؛ مبالغ به صورت درصد از ارزش خالص' : ''})، گزارش هفتگی دارایی کاربر را به فارسی بنویس.
ساختار (Markdown ساده): **خلاصه** (۲ جمله، با درصد تغییر و تغییر بر حسب دلار و طلا اگر هست) — **چه چیزی تغییر داد** (۲ تا ۴ مورد، تفکیک اثر بازار از واریز/برداشت) — **هفته پیش رو** (رویدادها) — **یک نکته** (نکته‌ای بی‌طرف درباره ریسک یا فرصت، نه توصیه خرید/فروش).
قواعد: فقط از اعداد همین داده استفاده کن؛ مبالغ را به ${unitName(s)} تبدیل کن (ریال ÷ ۱۰ برای تومان) و با میلیون/میلیارد بنویس؛ حداکثر ۱۸۰ کلمه.
DATA:
${JSON.stringify(data)}`;
}

/* ---------------- page capture ---------------- */
export function captureSystem() {
  return 'You extract a user\'s own financial holdings from the text of a web page (Iranian banks, brokers, gold platforms, crypto exchanges). Output strictly one JSON object and nothing else.';
}
export function capturePrompt(page, assets, quotesUnitHint) {
  const list = assets.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, custodian: a.custodian || '', category: CAT[a.category]?.short, mode: a.mode, unit: a.unit || (a.mode === 'balance' ? 'ریال' : '') }));
  return `صفحه: ${page.title || ''} — ${page.url || ''}
${page.selection ? `متن انتخاب‌شده توسط کاربر (اولویت با این است):\n${page.selection}\n` : ''}
دارایی‌های فعلی کاربر (برای تطبیق):
${JSON.stringify(list)}

وظیفه: موجودی‌های **خود کاربر** را از متن صفحه استخراج کن (نه قیمت‌های عمومی بازار، نه تبلیغات). برای هر مورد مشخص کن:
- label: نام دارایی همان‌طور که در صفحه آمده
- kind: "quantity" (مقدار/تعداد مثل گرم، عدد، واحد صندوق، مقدار رمزارز) یا "balance" (مانده مبلغی حساب/کیف پول) یا "unit_price" (فقط اگر قیمت واحدِ دارایی کاربر صریحاً آمده)
- amount: عدد خالص (بدون جداکننده؛ ارقام فارسی را به انگلیسی تبدیل کن)
- unit: واحد (گرم، عدد، USDT، BTC، ریال، تومان، …)
- match_id: شناسه دارایی متناظر از فهرست بالا یا null
- confidence: ۰ تا ۱
اگر برای یک دارایی هم مقدار و هم ارزش ریالی آمده، برای دارایی‌های واحددار مقدار (quantity) را برگردان.
خروجی فقط JSON: {"site":"...","currency_unit":"rial|toman|unknown","items":[{"label":"...","kind":"quantity","amount":0,"unit":"...","match_id":null,"confidence":0.9}]}

متن صفحه:
"""
${page.text}
"""`;
}

/** Turn extracted items into concrete proposals against current assets. */
export function captureProposals(json, assets, quotes, settings) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const cu = json?.currency_unit;
  return items.filter((it) => isFinite(+it.amount) && +it.amount >= 0).map((it, i) => {
    const a = it.match_id ? byId[it.match_id] : null;
    const moneyUnit = /تومان|toman/i.test(it.unit || '') ? 'toman' : /ریال|rial|irr/i.test(it.unit || '') ? 'rial' : (it.kind !== 'quantity' ? (cu === 'toman' ? 'toman' : 'rial') : null);
    const amt = +it.amount;
    let field = null, value = null, current = null;
    if (a) {
      if (a.mode === 'units') {
        if (it.kind === 'quantity') { field = 'quantity'; value = amt; current = +a.quantity || 0; }
        else if (it.kind === 'unit_price' && a.price?.source !== 'market') { field = 'unit_price'; value = moneyUnit === 'toman' ? amt * 10 : amt; current = +a.price?.value || 0; }
        else if (it.kind === 'balance') {
          // a money value for a units asset → convert to quantity with the current unit price
          const up = E.unitPriceOf(a, quotes).price;
          if (up > 0) { field = 'quantity'; value = (moneyUnit === 'toman' ? amt * 10 : amt) / up; current = +a.quantity || 0; }
        }
      } else if (a.mode === 'balance') { field = 'balance'; value = moneyUnit === 'toman' ? amt * 10 : amt; current = +a.balance || 0; }
      else if (a.mode === 'rate') { field = 'rate.principal'; value = moneyUnit === 'toman' ? amt * 10 : amt; current = +a.rate?.principal || 0; }
    }
    return { key: i, label: it.label, kind: it.kind, amount: amt, unit: it.unit, moneyUnit, confidence: +it.confidence || 0, assetId: a?.id || null, field, value, current,
      changed: field ? Math.abs(value - current) > Math.max(1e-9, Math.abs(current) * 1e-6) : true };
  });
}
