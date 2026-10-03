// Dara assistant: system prompt, portfolio tools, weekly report and page-capture prompts.
import * as E from './engine.js';
import * as I from './insights.js';
import * as AI from './ai.js';
import * as BB from './bubble.js';
import { CAT, CATEGORIES, EXPOSURES, TGJU, TGJU_BY_KEY, NOBITEX, NOBITEX_BY_KEY } from './catalog.js';
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
/** One line about an installment loan for the assistant (amounts hidden in percent-only privacy). */
function loanLine(a, settings) {
  const st = E.loanState(a.loan);
  if (st.done) return 'وام قسطی، تسویه شده';
  return `${E.isLiability(a) ? 'وام' : 'طلب'} قسطی ${a.loan.annualPct}٪، ${st.paid + st.before} از ${st.n + st.before} قسط پرداخت شده، قسط بعدی ${fmtJ(st.next.date)}${settings ? `، مبلغ قسط ${disp(st.next.payment, settings)}` : ''}`;
}

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
        const mmv = (d) => { const c = I.marketMove(s, pf, d); return c ? { pct: pct(c.pct), ...(P() ? {} : { amount: disp(c.abs, s.settings) }) } : null; };
        return {
          unit: unitName(s.settings), ...(P() ? {} : { net: disp(pf.net, s.settings), gross: disp(pf.gross, s.settings), debt: disp(pf.debt, s.settings) }),
          // market effect only (money added or moved is left out), the same figures the dashboard shows
          change: { today: mmv(1) || { pct: pct(pf.dayChangePct) }, week: mmv(7), month: mmv(30) },
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
          price_source: r.asset.mode === 'units' ? (r.asset.price?.source === 'market' ? refName(r.asset.price.ref) : 'دستی') : r.asset.mode === 'rate' ? `نرخ ${r.asset.rate?.annualPct}٪` : r.asset.mode === 'loan' ? loanLine(r.asset, P() ? null : s.settings) : 'مانده',
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
          if (id.endsWith(':nav') && !known.has(id)) continue; // fetched only for a fund's bubble
          const [prov, key] = id.split(':');
          const usd = prov === 'tgju' && TGJU_BY_KEY[key]?.usd;
          out[refName(known.get(id) || { provider: prov, key })] = { price: usd ? q.price : disp(q.price, s.settings), unit: usd ? 'دلار' : unitName(s.settings), day_change_pct: pct(q.changePct || 0), as_of: q.asOf || fmtJ(isoFromDate(new Date(q.at || Date.now()))) };
        }
        return out;
      },
    },
    {
      name: 'get_gold_bubbles',
      description: 'حباب سکه‌ها (قیمت بازار در برابر ارزش طلای داخلش با انس × دلار آزاد)، قیمت هر گرم طلای خالص در هر گزینه و کمترین قیمت هر گرم طلای خالص، حباب صندوق‌های بورسی (قیمت در برابر NAV ابطال) که کاربر دارد یا دنبال می‌کند، و حبابی که در خریدهای ثبت‌شده پرداخته. برای سؤال‌هایی مثل «حباب سکه چقدر است؟» یا «هر گرم طلا در کدام گزینه گران‌تر است؟». توصیه خرید نده؛ اعداد و ریسک حباب را بگو.',
      schema: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const s = st(); const pf = pfOf();
        const { rows, best, gold } = BB.coinBubbles(s.quotes);
        if (!gold) return { error: 'قیمت انس جهانی یا دلار بازار آزاد در دسترس نیست' };
        // 3-month average per coin (from the worker's price history), when it can be had
        let hist = {};
        if (ctx.bubbleStats) { try { hist = (await ctx.bubbleStats(BB.COIN_KEYS)) || {}; } catch { hist = {}; } }
        const avg = (key) => (hist[key]?.avg !== undefined ? pct(hist[key].avg) : null);
        const funds = [...new Map([...s.assets.map((a) => a.price?.ref), ...(s.settings.watch || [])].filter((r) => BB.isTseRef(r)).map((r) => [r.key, r])).values()]
          .map((r) => ({ ref: r, b: BB.fundBubble(r, s.quotes) })).filter((x) => x.b)
          .map(({ ref, b }) => ({ name: refName(ref), bubble_pct: pct(b.bubble), stale: b.stale || undefined }));
        const held = pf.rows.map((r) => ({ r, b: BB.assetBubble(r.asset, s.quotes, r.value) })).filter((x) => x.b)
          .map(({ r, b }) => { const pb = BB.buyBubble(r.asset, s.events, s.quotes); return { name: r.asset.name, bubble_pct: pct(b.bubble), bubble_part: b.amount !== null ? money(b.amount, pf.net) : undefined,
            paid_bubble_pct: pb ? pct(pb.avg) : undefined, bubble_change_effect: pb?.effect !== null && pb?.effect !== undefined ? money(pb.effect, pf.net) : undefined }; });
        return {
          basis: `انس $${Math.round(gold.ounce)} × دلار آزاد ${disp(gold.usd, s.settings)?.toLocaleString('en-US')} ${unitName(s.settings)}${gold.stale ? ' (قیمت‌ها قدیمی است)' : ''}`,
          note: 'اجرت و کارمزد خرید و فروش حساب نشده. سکه‌های کوچک همیشه مقداری حباب دارند؛ حباب امروز را با میانگین همان سکه مقایسه کن. این‌ها توصیه خرید یا فروش نیست.',
          coins: rows.map((r) => ({ name: r.name, bubble_pct: pct(r.bubble), avg_3m_bubble_pct: r.kind === 'coin' ? avg(r.key) ?? undefined : undefined,
            price_per_pure_gram: disp(r.perPure, s.settings), above_lowest_per_gram_pct: r.vsBest === null ? undefined : pct(r.vsBest), reference: r.kind === 'ref' || undefined, stale: r.stale || undefined })),
          lowest_per_pure_gram: best ? best.name : null, funds, held,
        };
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
        bourse_pct: { type: 'number', description: 'تغییر بورس تهران' }, private_pct: { type: 'number', description: 'تغییر ارزش سهام غیربورسی' }, real_estate_pct: { type: 'number' },
        bubble_pct: { type: 'number', description: 'تغییر اندازه حباب سکه‌ها و صندوق‌های طلای بورسی نسبت به حباب فعلی؛ −100 یعنی حباب کاملاً تخلیه شود' } }, required: [] },
      run: (a = {}) => {
        const s = st();
        const shocks = { usd: (a.usd_pct || 0) / 100, gold: (a.gold_ounce_pct || 0) / 100, crypto: (a.crypto_pct || 0) / 100, metals: (a.metals_pct || 0) / 100, equity: (a.bourse_pct || 0) / 100, real: (a.real_estate_pct || 0) / 100 };
        if (a.private_pct !== undefined) shocks.private = a.private_pct / 100;
        if (a.bubble_pct) shocks.bubble = Math.max(-1, Math.min(1, a.bubble_pct / 100));
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
          monthly_auto: P() ? undefined : { interest: disp(auto.interest, s.settings), inflow: disp(auto.inflow, s.settings), outflow: disp(auto.outflow, s.settings),
            loan_installments_out: disp(auto.loanPay, s.settings), loan_installments_in: disp(auto.loanGet, s.settings), loan_interest_cost: disp(auto.loanInterest, s.settings), net_wealth_change: disp(auto.net, s.settings), net_cash_to_accounts: disp(auto.cash, s.settings) } };
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
      name: 'explain_value',
      description: 'ریز محاسبه یک عدد: با asset_id نشان می‌دهد ارزش آن دارایی دقیقاً چطور حساب شده (مقدار، قیمت، منبع، نرخ، روزها، فرمول)؛ بدون asset_id ترکیب ارزش خالص را می‌دهد.',
      schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: [] },
      run: ({ asset_id } = {}) => {
        const s = st(); const pf = pfOf();
        const ex = asset_id ? (() => { const a = s.assets.find((x) => x.id === asset_id); return a ? I.explainAsset(a, s.quotes, s.settings) : null; })() : I.explainNet(pf);
        if (!ex) return { error: 'دارایی با این شناسه پیدا نشد؛ اول list_assets را صدا بزن' };
        const line = (l) => {
          // Public market prices stay absolute; private amounts become a share of net worth in percent mode.
          if (l.k === 'money') return { label: l.t, ...(P() && !l.pub ? { pct_of_net: pf.net > 0 ? pct(l.v / pf.net) : null } : { amount: disp(l.v, s.settings), unit: unitName(s.settings) }) };
          if (l.k === 'usd') return { label: l.t, usd: l.v };
          if (l.k === 'pct') return { label: l.t, pct: pct(l.v) };
          if (l.k === 'date') return { label: l.t, date: fmtJ(l.v), ...(l.sub ? { note: l.sub } : {}) };
          if (l.k === 'qty') return { label: l.t, ...(P() ? {} : { quantity: l.v }), unit: l.unit };
          return { label: l.t, value: l.v, ...(l.unit ? { unit: l.unit } : {}) };
        };
        return { formula: ex.formula, lines: ex.lines.map(line), notes: ex.notes };
      },
    },
    {
      name: 'compare_performance',
      description: '«واقعاً پولدارتر شدم؟»: بازده واقعی پرتفوی (بعد از کنار گذاشتن واریز، برداشت و ثبت‌های دستی) در مقایسه با نگه‌داشتن همان پول در طلای ۱۸، دلار یا سپرده.',
      schema: { type: 'object', properties: { period: { type: 'string', enum: ['month', 'quarter', 'year', 'all'] }, deposit_rate_pct: { type: 'number' } }, required: ['period'] },
      run: ({ period = 'quarter', deposit_rate_pct } = {}) => {
        const s = st(); const pf = pfOf();
        const days = { month: 30, quarter: 90, year: 365, all: 0 }[period] ?? 90;
        const r = I.performance(s, days, { depositPct: deposit_rate_pct || I.defaultDepositPct(s), pf });
        if (!r) return { error: 'تاریخچه کافی نیست؛ «بازسازی تاریخچه» را در صفحه اصلی اجرا کن' };
        const m = (v) => (P() ? { pct_of_net: pct(v / Math.abs(r.end || 1)) } : { amount: disp(v, s.settings) });
        return { from: fmtJ(r.from), days: r.days, estimated_base: r.est || undefined, market_return_pct: r.ret !== null ? pct(r.ret) : null, annualized_pct: r.annual !== null ? pct(r.annual) : null,
          market_gain: m(r.market), money_added_or_removed: m(r.moneyIn),
          alternatives: r.bench.map((b) => ({ name: b.name, alternative_return_pct: pct(b.ret), you_are_ahead_by: m(b.diff) })) };
      },
    },
    {
      name: 'break_even',
      description: 'نقطه سربه‌سر: یک دارایی (طلا، سکه، دلار، تتر یا یک دارایی واحددار کاربر) در چند ماه باید چقدر رشد کند تا از سپرده با نرخ مشخص جلو بزند (با احتساب کارمزد خرید و فروش).',
      schema: { type: 'object', properties: { asset: { type: 'string', description: 'gold18 | coin | usd | usdt | btc یا asset_id' }, deposit_rate_pct: { type: 'number' }, months: { type: 'number' }, fee_pct: { type: 'number' } }, required: ['asset', 'deposit_rate_pct', 'months'] },
      run: ({ asset = 'gold18', deposit_rate_pct = 25, months = 6, fee_pct = 0 } = {}) => {
        const s = st();
        const refs = { gold18: 'tgju:geram18', coin: 'tgju:sekee', usd: 'tgju:price_dollar_rl', usdt: 'nobitex:usdt', btc: 'nobitex:btc' };
        let price0 = null, name = asset;
        if (refs[asset]) { price0 = s.quotes[refs[asset]]?.price || null; name = { gold18: 'طلای ۱۸ عیار (هر گرم)', coin: 'سکه امامی', usd: 'دلار', usdt: 'تتر', btc: 'بیت‌کوین' }[asset]; }
        else { const a = s.assets.find((x) => x.id === asset); if (a?.mode === 'units') { price0 = E.unitPriceOf(a, s.quotes).price; name = a.name; } }
        if (!(price0 > 0)) return { error: 'قیمت فعلی این دارایی در دسترس نیست' };
        const r = I.breakEven({ price0, ratePct: deposit_rate_pct, months, feePct: fee_pct });
        return { asset: name, months: r.months, deposit_gain_pct: pct(r.depositGain), required_rise_pct: pct(r.needed), required_annual_pct: pct(r.annualNeeded), price_now: disp(price0, s.settings), price_needed: disp(r.targetPrice, s.settings), unit: unitName(s.settings) };
      },
    },
    {
      name: 'plan_new_money',
      description: 'پول جدید را کجا بگذارم: مبلغ (به واحد نمایش) را بر اساس تخصیص هدف کاربر بین دسته‌ها پخش می‌کند تا ترکیب به هدف نزدیک شود، بدون فروش هیچ دارایی.',
      schema: { type: 'object', properties: { amount: { type: 'number', description: 'به واحد نمایش (تومان/ریال)' } }, required: ['amount'] },
      run: ({ amount } = {}) => {
        const s = st(); const pf = pfOf(); const k = s.settings.currency === 'rial' ? 1 : 10;
        const targets = Object.fromEntries(Object.entries(s.settings.targets || {}).map(([c, v]) => [c, (+v || 0) / 100]));
        const r = I.allocateNew(pf, targets, (+amount || 0) * k);
        if (!r) return { error: 'تخصیص هدف تعریف نشده یا مبلغ نامعتبر است؛ کاربر باید در صفحه «تحلیل و سناریو» درصد هدف هر دسته را تعیین کند' };
        return { ...(P() ? {} : { amount, unit: unitName(s.settings) }),
          plan: r.rows.filter((x) => x.add >= 1).map((x) => ({ category: x.cat.name, share_of_amount_pct: pct(x.add / r.amount), share_after_pct: pct(x.afterShare), target_pct: pct(x.target), example_asset: x.vehicle?.name,
            ...(P() ? {} : { add: disp(x.add, s.settings), share_now_pct: pct(x.currentShare) }) })),
          max_gap_before_pct: pct(r.maxDevBefore), max_gap_after_pct: pct(r.maxDevAfter) };
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
        // the field must be one this asset is valued by (a deposit has no «balance»; a bank account has no unit price)
        const fits = field === 'balance' ? a.mode === 'balance' : field === 'quantity' ? a.mode === 'units' : field === 'unit_price' ? a.mode === 'units' && a.price?.source === 'manual' : false;
        if (!fits) return { error: a.mode === 'rate' || a.mode === 'loan' ? 'ارزش این دارایی خودکار حساب می‌شود (سود یا قسط)؛ مستقیم عوض نمی‌شود. اگر لازم است، کاربر از ویرایش دارایی شرایطش را عوض کند.'
          : field === 'unit_price' ? 'قیمت این دارایی خودکار از بازار می‌آید و دستی عوض نمی‌شود' : `این دارایی با «${a.mode === 'units' ? 'مقدار' : 'مانده'}» به‌روز می‌شود، نه «${field}»` };
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
        if (side === 'sell' && quantity > (+a.quantity || 0) + 1e-9) return { error: `مقدار فروش از موجودی (${+a.quantity || 0} ${a.unit || ''}) بیشتر است` };
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
  const list = assets.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, symbol: refSymbol(a) || undefined, custodian: a.custodian || '', category: CAT[a.category]?.short, mode: a.mode, unit: a.unit || (a.mode === 'balance' ? 'ریال' : '') }));
  return `صفحه: ${AI.maskSensitive(page.title || '')} — ${AI.safeUrl(page.url || '')}
${page.selection ? `متن انتخاب‌شده توسط کاربر (اولویت با این است):\n${AI.maskSensitive(page.selection)}\n` : ''}
دارایی‌های فعلی کاربر (برای تطبیق):
${JSON.stringify(list)}

وظیفه: موجودی‌های **خود کاربر** را از متن صفحه استخراج کن (نه قیمت‌های عمومی بازار، نه تبلیغات). برای هر مورد مشخص کن:
- label: نام دارایی همان‌طور که در صفحه آمده
- kind: "quantity" (مقدار/تعداد مثل گرم، عدد، واحد صندوق، مقدار رمزارز) یا "balance" (مانده مبلغی حساب/کیف پول) یا "unit_price" (فقط اگر قیمت واحدِ دارایی کاربر صریحاً آمده)
- amount: عدد خالص (بدون جداکننده؛ ارقام فارسی را به انگلیسی تبدیل کن)
- unit: واحد (گرم، عدد، USDT، BTC، ریال، تومان، …)
- type: یکی از stock (سهم یا صندوق بورسی/ETF)، gold، coin، metal، crypto، fx، cash (مانده نقد، قدرت خرید، کیف پول)، deposit، other
- symbol: نماد معاملاتی دقیقاً همان‌طور که در صفحه آمده (برای سهام، صندوق بورسی و رمزارز)، وگرنه null
- avg_cost: قیمت سربه‌سر یا میانگین قیمت خرید «هر واحد» اگر در صفحه آمده، وگرنه null (به همان واحد پول صفحه)
- match_id: شناسه دارایی متناظر از فهرست بالا یا null — اگر نماد یا نام با symbol یا name یک دارایی یکی است، حتماً همان را بده
- confidence: ۰ تا ۱
همه ردیف‌های پرتفوی را برگردان، حتی آن‌هایی که در فهرست بالا نیستند (برای آن‌ها match_id را null بگذار).
اگر برای یک دارایی هم مقدار و هم ارزش ریالی آمده، برای دارایی‌های واحددار مقدار (quantity) را برگردان.
خروجی فقط JSON: {"site":"نام کوتاه سایت یا کارگزاری","currency_unit":"rial|toman|unknown","items":[{"label":"...","kind":"quantity","amount":0,"unit":"...","type":"stock","symbol":"...","avg_cost":null,"match_id":null,"confidence":0.9}]}

متن صفحه:
"""
${page.text}
"""`;
}

/** Symbol/ticker an asset is priced by (TSE symbol, crypto symbol), if any. */
function refSymbol(a) {
  const r = a?.price?.ref;
  if (!r) return '';
  if (r.provider === 'tsetmc') return r.symbol || r.label || '';
  if (r.provider === 'nobitex') return String(r.sym || NOBITEX_BY_KEY[r.key]?.sym || r.key || '').toUpperCase();
  return '';
}
/** Compare tickers loosely: Arabic/Persian letters, digits, spaces and ZWNJ don't matter. */
export const normSym = (s) => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s\u200c\u200f\u200e«»"']/g, '').toLowerCase();
const TYPE_CATEGORY = { stock: 'stock', fund: 'stock', gold: 'gold', coin: 'gold', metal: 'metal', crypto: 'crypto', fx: 'fx', cash: 'bank', deposit: 'fixed', other: 'other' };

/** Exchange-traded gold (ETF units, coin certificates) is priced like a stock even if the model calls it gold. */
function categoryOf(type, symbol, unit) {
  if (symbol && (type === 'gold' || type === 'coin' || type === 'fund') && /واحد|سهم|unit|share/i.test(String(unit || ''))) return 'stock';
  return TYPE_CATEGORY[type] || null;
}

/** Turn extracted items into concrete proposals against current assets. */
export function captureProposals(json, assets, quotes, settings) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const live = assets.filter((a) => !a.archived);
  const byId = Object.fromEntries(live.map((a) => [a.id, a]));
  const cu = json?.currency_unit;
  const used = new Set();
  // Deterministic fallback when the model didn't match: same ticker, else same name.
  const findBySymbol = (it) => {
    for (const key of [it.symbol, it.label].filter(Boolean).map(normSym)) {
      const a = live.find((x) => !used.has(x.id) && ((refSymbol(x) && normSym(refSymbol(x)) === key) || normSym(x.name) === key));
      if (a) return a;
    }
    return null;
  };
  return items.filter((it) => isFinite(+it.amount) && +it.amount >= 0).map((it, i) => {
    let a = it.match_id && byId[it.match_id] && !used.has(it.match_id) ? byId[it.match_id] : null;
    if (!a) a = findBySymbol(it);
    if (a) used.add(a.id);
    const type = String(it.type || '').toLowerCase();
    const symbol = it.symbol ? String(it.symbol).trim() : null;
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
      else if (a.mode === 'rate') { field = 'rate.principal'; value = moneyUnit === 'toman' ? amt * 10 : amt; current = a.rate?.mode === 'payout' ? +a.rate?.principal || 0 : E.valueOf(a, quotes, {}).value; } // same basis applyCapture moves it on
      else if (a.mode === 'loan') { field = 'loan.balance'; value = moneyUnit === 'toman' ? amt * 10 : amt; current = E.loanState(a.loan).value; }
    }
    const pageMoney = cu === 'toman' ? 10 : 1;
    const avgCost = isFinite(+it.avg_cost) && +it.avg_cost > 0 ? +it.avg_cost * pageMoney : null;
    return { key: i, label: it.label, kind: it.kind, amount: amt, unit: it.unit, moneyUnit, confidence: +it.confidence || 0, assetId: a?.id || null, field, value, current,
      type, symbol, avgCost, category: categoryOf(type, symbol, it.unit),
      changed: field ? Math.abs(value - current) > Math.max(1e-9, Math.abs(current) * 1e-6) : true };
  });
}

/** A new asset from a captured row: priced automatically when the row names something we can price. */
export function newAssetFromCapture(r, { site = '', category, now = Date.now(), id } = {}) {
  const c = CAT[category] || CAT.other;
  const base = { id, custodian: site, category: c.id, liquidity: c.liquidity, createdAt: now, updatedAt: now };
  const isMoney = r.kind !== 'quantity';
  const rial = (r.moneyUnit === 'toman' ? 10 : 1) * r.amount;
  if (isMoney || c.defaultMode === 'balance' || c.defaultMode === 'rate') {
    return { ...base, name: r.label, mode: 'balance', balance: isMoney ? rial : r.amount, balanceAt: now };
  }
  const qty = r.amount;
  const costBasis = r.avgCost ? Math.round(r.avgCost * qty) : undefined;
  const sym = String(r.symbol || r.label || '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  let price = null; let unit = r.unit || 'واحد';
  if (c.id === 'stock' && sym) {
    price = { source: 'market', ref: { provider: 'tsetmc', key: '', symbol: sym, label: sym, field: 'close' }, adjustPct: 0, factor: 1 };
    if (/سهم|واحد|share|unit/i.test(unit) === false) unit = 'سهم';
  } else if (c.id === 'crypto') {
    const k = normSym(sym);
    const coin = NOBITEX.find((x) => x.key === k || x.sym.toLowerCase() === k);
    if (coin) price = { source: 'market', ref: { provider: 'nobitex', key: coin.key }, adjustPct: 0, factor: 1 };
  } else if ((c.id === 'gold' || c.id === 'gold_online') && /گرم|gram/i.test(unit)) {
    price = { source: 'market', ref: { provider: 'tgju', key: 'geram18' }, adjustPct: 0, factor: 1 };
  } else if (c.id === 'fx') {
    const key = /یورو|eur/i.test(unit + sym) ? 'price_eur' : /دلار|usd/i.test(unit + sym) ? 'price_dollar_rl' : null;
    if (key) price = { source: 'market', ref: { provider: 'tgju', key }, adjustPct: 0, factor: 1 };
  }
  const name = c.id === 'stock' && r.symbol ? sym : r.label;
  return { ...base, name, mode: 'units', quantity: qty, unit, costBasis,
    price: price || { source: 'manual', value: r.avgCost || 0, updatedAt: now },
    ...(price ? {} : { review: 'از صفحه ثبت شد؛ منبع قیمت را تنظیم کن' }) };
}

/* ---------------- natural-language scenario ---------------- */
export const SCENARIO_RANGES = { usd: [-50, 150], gold: [-50, 100], equity: [-60, 150], crypto: [-80, 200], metals: [-50, 100], private: [-80, 200], real: [-50, 150], bubble: [-100, 100] };
export const SCENARIO_LABELS = { usd: 'نرخ دلار', gold: 'انس جهانی طلا', equity: 'بورس تهران', crypto: 'رمزارز (دلاری)', metals: 'نقره و مس (دلاری)', private: 'سهام غیربورسی', real: 'ملک و خودرو', bubble: 'اندازه حباب سکه و صندوق طلا' };
export function scenarioSystem() {
  return 'You turn a described economic event into explicit, editable market assumptions for an Iranian household portfolio. You do not predict; you state plausible assumptions. Output strictly one JSON object.';
}
export function scenarioPrompt(text, quotes) {
  const q = (id) => quotes[id]?.price;
  return `کاربر می‌خواهد این اتفاق را روی دارایی‌هایش امتحان کند: «${text}»
وضعیت فعلی بازار: دلار آزاد ${q('tgju:price_dollar_rl') ? Math.round(q('tgju:price_dollar_rl') / 10).toLocaleString('en-US') + ' تومان' : 'نامشخص'}، انس طلا ${q('tgju:ons') ? '$' + Math.round(q('tgju:ons')) : 'نامشخص'}.
برای هر متغیر یک فرض درصدی معقول بده (عدد صحیح، 0 یعنی بدون تغییر). متغیرها:
usd: تغییر نرخ دلار بازار آزاد ایران، gold: تغییر انس جهانی طلا به دلار (طلای داخلی خودکار = انس × دلار)، equity: بورس تهران، crypto: رمزارز به دلار، metals: نقره و مس به دلار، private: سهام غیربورسی، real: ملک و خودرو، bubble: تغییر اندازه حباب سکه و صندوق‌های طلا نسبت به حباب فعلی (−100 یعنی حباب کاملاً تخلیه شود، +100 یعنی دو برابر شود).
قواعد: فقط متغیرهایی را که این اتفاق واقعاً رویشان اثر دارد تغییر بده؛ برای هر متغیر تغییرکرده یک دلیل کوتاه یک‌جمله‌ای فارسی بنویس؛ اعداد را در بازه‌های واقع‌بینانه نگه دار؛ اگر اتفاق مبهم است، رایج‌ترین برداشت را بگیر.
خروجی فقط JSON: {"title":"عنوان کوتاه سناریو","shocks":{"usd":0,"gold":0,"equity":0,"crypto":0,"metals":0,"private":0,"real":0,"bubble":0},"reasons":{"usd":"..."}}`;
}
/** Clamp model output to the simulator's ranges; keep a reason per changed variable. */
export function parseScenario(json) {
  const shocks = {}; const assumptions = [];
  const num = (v) => +String(v ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٫]/g, '.').replace(/[%٪+\s]/g, '').replace(/[−–]/g, '-');
  const vals = Object.keys(SCENARIO_RANGES).map((k) => num(json?.shocks?.[k])).filter((v) => isFinite(v) && v !== 0);
  // Some models answer in fractions (0.2 for +20%): if every value is within ±1 and one is fractional, scale up.
  const scale = vals.length && vals.every((v) => Math.abs(v) <= 1) && vals.some((v) => !Number.isInteger(v)) ? 100 : 1;
  for (const [k, [lo, hi]] of Object.entries(SCENARIO_RANGES)) {
    const raw = num(json?.shocks?.[k]) * scale;
    const v = isFinite(raw) ? Math.round(Math.min(hi, Math.max(lo, raw))) : 0;
    shocks[k] = v;
    if (v !== 0) assumptions.push({ key: k, label: SCENARIO_LABELS[k], value: v, reason: String(json?.reasons?.[k] || '').slice(0, 160), clamped: isFinite(raw) && Math.round(raw) !== v });
  }
  return { title: String(json?.title || '').slice(0, 60), shocks, assumptions };
}

/* ---------------- AI portfolio review ---------------- */
export function critiqueSystem() {
  return 'You are a careful, neutral personal-finance reviewer for an Iranian household. You point out structural weaknesses in a portfolio using only the given percentages. No buy/sell advice, no price predictions. Output strictly one JSON object.';
}
export function critiquePrompt(facts) {
  return `این خلاصه درصدی پرتفوی یک کاربر است (هیچ مبلغی نیامده):
${JSON.stringify(facts)}
سه نقطه ضعف یا ریسک مهم این ترکیب را پیدا کن (مثلاً تمرکز روی یک دارایی یا یک محل نگهداری، سهم بالای دارایی ریالی در برابر تورم، نقدینگی کم برای شرایط اضطراری، بدهی، فاصله از تخصیص هدف، عقب ماندن از طلا یا دلار).
برای هر مورد: title (حداکثر ۸ کلمه)، detail (یک تا دو جمله با اشاره به همان درصدها)، check (یک سؤال یا بررسی عملی که کاربر خودش انجام دهد؛ توصیه خرید و فروش نده)، level: high | mid | low.
اگر ترکیب سالم است، کمتر از سه مورد بده. فقط به فارسی.
خروجی فقط JSON: {"points":[{"title":"...","detail":"...","check":"...","level":"mid"}]}`;
}
export function parseCritique(json) {
  const pts = Array.isArray(json?.points) ? json.points : [];
  return pts.slice(0, 3).filter((p) => p && p.title).map((p) => ({ title: String(p.title).slice(0, 80), detail: String(p.detail || '').slice(0, 320), check: String(p.check || '').slice(0, 200), level: ['high', 'mid', 'low'].includes(p.level) ? p.level : 'mid' }));
}

/* ---------------- one-sentence entry ---------------- */
export function quickSystem() {
  return 'You convert one Persian sentence about a personal financial transaction into structured actions against the user\'s existing assets. Never invent numbers that are not in the sentence. Output strictly one JSON object.';
}
export function quickPrompt(text, assets) {
  const list = assets.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, custodian: a.custodian || undefined, category: CAT[a.category]?.short, mode: a.mode, unit: a.unit || undefined, symbol: refSymbol(a) || undefined }));
  return `جمله کاربر: «${text}»
دارایی‌های کاربر:
${JSON.stringify(list)}

جمله را به یک یا چند action تبدیل کن:
- خرید یا فروش دارایی واحددار (mode=units): {"type":"trade","asset_id":"شناسه یا null","side":"buy|sell","quantity":عدد,"unit_price":عدد یا null,"total":عدد یا null,"money_unit":"toman|rial","cash_asset_id":"حسابی که پول از آن برداشته/به آن واریز شد یا null","new_asset":null}
  اگر دارایی در فهرست نیست و خرید است، asset_id را null بگذار و new_asset بده: {"kind":"gold18|gold24|coin_emami|coin_bahar|coin_half|coin_quarter|silver|usd|eur|crypto|stock|other","name":"نام","symbol":"نماد یا null","unit":"گرم|عدد|دلار|..."}
- اصلاح مقدار یا مانده: {"type":"set","asset_id":"...","field":"quantity|balance","value":عدد,"money_unit":"toman|rial"}
- واریز یا برداشت از یک حساب (mode=balance): {"type":"cash","asset_id":"...","direction":"in|out","amount":عدد,"money_unit":"toman|rial","note":"شرح کوتاه"}
- انتقال پول بین دو حساب: {"type":"transfer","from_id":"...","to_id":"...","amount":عدد,"money_unit":"toman|rial"}
قواعد: «میلیون/میلیارد/هزار» را به عدد کامل تبدیل کن؛ اگر واحد پول گفته نشده toman است؛ قیمت یا مبلغی را که در جمله نیامده null بگذار؛ اگر جمله مبهم است یا دارایی را نمی‌شود پیدا کرد، actions را خالی بگذار و در question یک سؤال کوتاه فارسی بپرس.
خروجی فقط JSON: {"actions":[...],"question":null}`;
}

const NEW_KIND = {
  gold18: { category: 'gold', unit: 'گرم', ref: { provider: 'tgju', key: 'geram18' }, name: 'طلای ۱۸ عیار' },
  gold24: { category: 'gold', unit: 'گرم', ref: { provider: 'tgju', key: 'geram24' }, name: 'طلای ۲۴ عیار' },
  coin_emami: { category: 'gold', unit: 'عدد', ref: { provider: 'tgju', key: 'sekee' }, name: 'سکه امامی' },
  coin_bahar: { category: 'gold', unit: 'عدد', ref: { provider: 'tgju', key: 'sekeb' }, name: 'سکه بهار آزادی' },
  coin_half: { category: 'gold', unit: 'عدد', ref: { provider: 'tgju', key: 'nim' }, name: 'نیم سکه' },
  coin_quarter: { category: 'gold', unit: 'عدد', ref: { provider: 'tgju', key: 'rob' }, name: 'ربع سکه' },
  silver: { category: 'metal', unit: 'گرم', ref: { provider: 'tgju', key: 'silver_999' }, name: 'نقره ۹۹۹' },
  usd: { category: 'fx', unit: 'دلار', ref: { provider: 'tgju', key: 'price_dollar_rl' }, name: 'دلار' },
  eur: { category: 'fx', unit: 'یورو', ref: { provider: 'tgju', key: 'price_eur' }, name: 'یورو' },
};
/** A new units asset for a purchase of something not tracked yet; priced from the market when we can. */
export function quickNewAsset(na = {}, id) {
  const base = NEW_KIND[na.kind];
  const now = Date.now();
  if (base) return { id, name: na.name || base.name, category: base.category, mode: 'units', quantity: 0, unit: na.unit || base.unit, price: { source: 'market', ref: { ...base.ref }, adjustPct: 0, factor: 1 }, liquidity: CAT[base.category].liquidity, createdAt: now };
  if (na.kind === 'crypto') {
    const k = normSym(na.symbol || na.name);
    const coin = NOBITEX.find((c) => c.key === k || c.sym.toLowerCase() === k || c.name === na.name);
    if (coin) return { id, name: na.name || coin.name, category: 'crypto', mode: 'units', quantity: 0, unit: coin.sym, price: { source: 'market', ref: { provider: 'nobitex', key: coin.key }, adjustPct: 0, factor: 1 }, liquidity: 'high', createdAt: now };
  }
  if (na.kind === 'stock' && (na.symbol || na.name)) {
    const sym = String(na.symbol || na.name).trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    return { id, name: sym, category: 'stock', mode: 'units', quantity: 0, unit: na.unit || 'سهم', price: { source: 'market', ref: { provider: 'tsetmc', key: '', symbol: sym, label: sym, field: 'close' }, adjustPct: 0, factor: 1 }, liquidity: 'high', createdAt: now };
  }
  return { id, name: na.name || 'دارایی جدید', category: 'other', mode: 'units', quantity: 0, unit: na.unit || 'واحد', price: { source: 'manual', value: 0, updatedAt: now }, liquidity: 'mid', createdAt: now, review: 'منبع قیمت را تنظیم کن' };
}

/**
 * Validate the model's actions against real assets and turn them into proposals the user confirms.
 * Proposal types: update | trade | newbuy | adjust | transfer. Invalid actions become `problems`.
 */
export function quickProposals(json, assets, quotes, { idFor = () => uid('a') } = {}) {
  const byId = Object.fromEntries(assets.filter((a) => !a.archived).map((a) => [a.id, a]));
  const k = (u) => (/rial|ریال/i.test(String(u || '')) ? 1 : 10);
  const proposals = []; const problems = [];
  const held = Object.fromEntries(Object.values(byId).map((a) => [a.id, +a.quantity || 0])); // running quantity across actions
  const sideOf = (v) => (/^(sell|فروش|فروختم)$/i.test(String(v || '').trim()) ? 'sell' : /^(buy|خرید|خریدم)$/i.test(String(v || '').trim()) ? 'buy' : null);
  for (const x of Array.isArray(json?.actions) ? json.actions : []) {
    const id = uid('p');
    if (x.type === 'trade') {
      const side = sideOf(x.side);
      if (!side) { problems.push('مشخص نیست خرید است یا فروش'); continue; }
      const qty = +x.quantity;
      if (!(qty > 0)) { problems.push('مقدار خرید یا فروش مشخص نیست'); continue; }
      const cash = x.cash_asset_id && byId[x.cash_asset_id]?.mode === 'balance' ? byId[x.cash_asset_id] : null;
      let a = x.asset_id ? byId[x.asset_id] : null;
      if (a && a.mode !== 'units') { problems.push(`«${a.name}» دارایی واحددار نیست`); continue; }
      let newAsset = null;
      if (!a) {
        if (side !== 'buy' || !x.new_asset) { problems.push('دارایی مورد نظر پیدا نشد'); continue; }
        newAsset = quickNewAsset(x.new_asset, idFor());
      }
      let price = +x.unit_price > 0 ? +x.unit_price * k(x.money_unit) : +x.total > 0 ? (+x.total * k(x.money_unit)) / qty : null;
      let priceFromMarket = false;
      if (!price) {
        const up = E.unitPriceOf(a || newAsset, quotes).price;
        if (up > 0) { price = up; priceFromMarket = true; }
      }
      if (!(price > 0)) { problems.push('قیمت معامله در جمله نیامده و قیمت بازار هم در دسترس نیست'); continue; }
      if (side === 'sell' && qty > held[a.id] + 1e-9) { problems.push(`مقدار فروش از موجودی «${a.name}» بیشتر است`); continue; }
      if (a) held[a.id] += side === 'sell' ? -qty : qty;
      proposals.push(newAsset
        ? { id, type: 'newbuy', asset: newAsset, assetName: newAsset.name, side: 'buy', qty, price, priceFromMarket, cashId: cash?.id || null, cashName: cash?.name || null, unit: newAsset.unit }
        : { id, type: 'trade', assetId: a.id, assetName: a.name, side, qty, price, priceFromMarket, cashId: cash?.id || null, cashName: cash?.name || null, unit: a.unit });
    } else if (x.type === 'set') {
      const a = byId[x.asset_id];
      const field = x.field === 'balance' ? 'balance' : 'quantity';
      if (!a || (field === 'balance' && a.mode !== 'balance') || (field === 'quantity' && a.mode !== 'units')) { problems.push('دارایی برای اصلاح مقدار پیدا نشد'); continue; }
      const v = +x.value; if (!(v >= 0)) { problems.push('مقدار جدید نامعتبر است'); continue; }
      proposals.push({ id, type: 'update', assetId: a.id, assetName: a.name, field, value: field === 'balance' ? v * k(x.money_unit) : v, unit: a.unit });
    } else if (x.type === 'cash') {
      const a = byId[x.asset_id];
      const amt = +x.amount;
      if (!a || a.mode !== 'balance') { problems.push('حساب مورد نظر پیدا نشد'); continue; }
      if (!(amt > 0)) { problems.push('مبلغ مشخص نیست'); continue; }
      proposals.push({ id, type: 'adjust', assetId: a.id, assetName: a.name, delta: (x.direction === 'out' ? -1 : 1) * amt * k(x.money_unit), note: String(x.note || '').slice(0, 60) });
    } else if (x.type === 'transfer') {
      const f = byId[x.from_id]; const t = byId[x.to_id]; const amt = +x.amount;
      if (!f || !t || f.id === t.id || f.mode === 'units' || t.mode === 'units') { problems.push('حساب‌های مبدأ و مقصد انتقال پیدا نشدند'); continue; }
      if (f.mode === 'loan' || t.mode === 'loan') { problems.push(`قسط‌های «${(f.mode === 'loan' ? f : t).name}» خودکار ثبت می‌شوند؛ پرداخت اضافه یا تسویه را از صفحه دارایی‌ها ثبت کن`); continue; }
      if (!(amt > 0)) { problems.push('مبلغ انتقال مشخص نیست'); continue; }
      proposals.push({ id, type: 'transfer', fromId: f.id, toId: t.id, fromName: f.name, toName: t.name, amount: amt * k(x.money_unit) });
    }
  }
  return { proposals, problems, question: json?.question ? String(json.question).slice(0, 200) : null };
}
