// Static catalog: asset categories, market indicators, presets, templates.

/** exposure: rial | gold | fx | crypto | equity | real | commodity | other */
export const CATEGORIES = [
  { id: 'bank', name: 'حساب بانکی و نقد', short: 'بانک', color: '#12B5D9', icon: 'bank', exposure: 'rial', liquidity: 'high', defaultMode: 'balance' },
  { id: 'fixed', name: 'سپرده و درآمد ثابت', short: 'سپرده و درآمد ثابت', color: '#3D7BF7', icon: 'shield', exposure: 'rial', liquidity: 'high', defaultMode: 'rate' },
  { id: 'gold_online', name: 'طلای آب‌شده آنلاین', short: 'طلای آنلاین', color: '#F2B705', icon: 'gold', exposure: 'gold', liquidity: 'mid', defaultMode: 'units' },
  { id: 'gold', name: 'طلای فیزیکی و سکه', short: 'طلا و سکه', color: '#C98A0B', icon: 'coin', exposure: 'gold', liquidity: 'mid', defaultMode: 'units' },
  { id: 'metal', name: 'نقره، مس و سایر فلزات', short: 'فلزات', color: '#6E8CA8', icon: 'weight', exposure: 'commodity', liquidity: 'mid', defaultMode: 'units' },
  { id: 'fx', name: 'ارز نقدی', short: 'ارز', color: '#1FB57A', icon: 'cash', exposure: 'fx', liquidity: 'high', defaultMode: 'units' },
  { id: 'stock', name: 'سهام و صندوق بورسی', short: 'بورس', color: '#7A5AF8', icon: 'chart', exposure: 'equity', liquidity: 'high', defaultMode: 'units' },
  { id: 'crypto', name: 'رمزارز', short: 'رمزارز', color: '#F2762E', icon: 'crypto', exposure: 'crypto', liquidity: 'high', defaultMode: 'units' },
  { id: 'private', name: 'سهام غیربورسی و استارتاپ', short: 'سهام خصوصی', color: '#D946A8', icon: 'building', exposure: 'equity', liquidity: 'low', defaultMode: 'units' },
  { id: 'property', name: 'ملک و خودرو', short: 'ملک و خودرو', color: '#9B6B4E', icon: 'home', exposure: 'real', liquidity: 'low', defaultMode: 'balance' },
  { id: 'receivable', name: 'مطالبات و شراکت', short: 'مطالبات', color: '#14A89B', icon: 'handshake', exposure: 'rial', liquidity: 'low', defaultMode: 'balance' },
  { id: 'other', name: 'سایر دارایی‌ها', short: 'سایر', color: '#8C93A8', icon: 'box', exposure: 'other', liquidity: 'mid', defaultMode: 'balance' },
  { id: 'debt', name: 'بدهی و وام', short: 'بدهی', color: '#EF4D6B', icon: 'debt', exposure: 'rial', liquidity: 'high', defaultMode: 'balance', liability: true },
];
export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const EXPOSURES = {
  rial: { name: 'ریالی', color: '#8C93A8' },
  gold: { name: 'طلا', color: '#F2B705' },
  fx: { name: 'ارز', color: '#1FB57A' },
  crypto: { name: 'رمزارز', color: '#F2762E' },
  equity: { name: 'سهام', color: '#7A5AF8' },
  commodity: { name: 'فلزات', color: '#6E8CA8' },
  real: { name: 'ملک', color: '#9B6B4E' },
  other: { name: 'سایر', color: '#B9BED0' },
};

export const LIQUIDITY = { high: 'بالا', mid: 'متوسط', low: 'پایین' };

/** Indicators from tgju. Prices are Rial unless `usd: true` (then USD, converted with the dollar rate). */
export const TGJU = [
  { key: 'geram18', name: 'طلای ۱۸ عیار', unit: 'هر گرم', group: 'gold' },
  { key: 'geram24', name: 'طلای ۲۴ عیار', unit: 'هر گرم', group: 'gold' },
  { key: 'mesghal', name: 'مثقال طلا', unit: 'هر مثقال', group: 'gold' },
  { key: 'sekee', name: 'سکه امامی', unit: 'هر عدد', group: 'coin' },
  { key: 'sekeb', name: 'سکه بهار آزادی', unit: 'هر عدد', group: 'coin' },
  { key: 'nim', name: 'نیم سکه', unit: 'هر عدد', group: 'coin' },
  { key: 'rob', name: 'ربع سکه', unit: 'هر عدد', group: 'coin' },
  { key: 'retail_gerami', name: 'سکه گرمی', unit: 'هر عدد', group: 'coin' },
  // currencies: the first six are always on the market page; `more` ones show once held or watched (the price board
  // brings them all in one request, so pickers still show today's price). `alias`: words a name or unit may use.
  { key: 'price_dollar_rl', name: 'دلار آمریکا', unit: 'هر دلار', group: 'fx', alias: ['دلار', 'usd', 'dollar'] },
  { key: 'price_eur', name: 'یورو', unit: 'هر یورو', group: 'fx', alias: ['یورو', 'eur', 'euro'] },
  { key: 'price_gbp', name: 'پوند انگلیس', unit: 'هر پوند', group: 'fx', alias: ['پوند', 'gbp'] },
  { key: 'price_aed', name: 'درهم امارات', unit: 'هر درهم', group: 'fx', alias: ['درهم', 'aed', 'dirham'] },
  { key: 'price_try', name: 'لیر ترکیه', unit: 'هر لیر', group: 'fx', alias: ['لیر', 'لیره', 'لیرا', 'lira'] },
  { key: 'price_cny', name: 'یوان چین', unit: 'هر یوان', group: 'fx', alias: ['یوان', 'رنمینبی', 'cny', 'rmb', 'yuan'] },
  { key: 'price_cad', name: 'دلار کانادا', unit: 'هر دلار کانادا', group: 'fx', more: true, alias: ['دلار کانادا', 'cad'] },
  { key: 'price_aud', name: 'دلار استرالیا', unit: 'هر دلار استرالیا', group: 'fx', more: true, alias: ['دلار استرالیا', 'aud'] },
  { key: 'price_nzd', name: 'دلار نیوزیلند', unit: 'هر دلار نیوزیلند', group: 'fx', more: true, alias: ['دلار نیوزیلند', 'nzd'] },
  { key: 'price_hkd', name: 'دلار هنگ‌کنگ', unit: 'هر دلار هنگ‌کنگ', group: 'fx', more: true, alias: ['دلار هنگ‌کنگ', 'دلار هنگ کنگ', 'hkd'] },
  { key: 'price_sgd', name: 'دلار سنگاپور', unit: 'هر دلار سنگاپور', group: 'fx', more: true, alias: ['دلار سنگاپور', 'sgd'] },
  { key: 'price_chf', name: 'فرانک سوئیس', unit: 'هر فرانک', group: 'fx', more: true, alias: ['فرانک', 'chf'] },
  { key: 'price_sek', name: 'کرون سوئد', unit: 'هر کرون سوئد', group: 'fx', more: true, alias: ['کرون سوئد', 'sek'] },
  { key: 'price_nok', name: 'کرون نروژ', unit: 'هر کرون نروژ', group: 'fx', more: true, alias: ['کرون نروژ'] },
  { key: 'price_dkk', name: 'کرون دانمارک', unit: 'هر کرون دانمارک', group: 'fx', more: true, alias: ['کرون دانمارک', 'dkk'] },
  { key: 'price_rub', name: 'روبل روسیه', unit: 'هر روبل', group: 'fx', more: true, alias: ['روبل', 'ruble'] },
  { key: 'price_inr', name: 'روپیه هند', unit: 'هر روپیه هند', group: 'fx', more: true, alias: ['روپیه هند', 'روپیه', 'inr', 'rupee'] },
  { key: 'price_pkr', name: 'روپیه پاکستان', unit: 'هر روپیه پاکستان', group: 'fx', more: true, alias: ['روپیه پاکستان', 'pkr'] },
  { key: 'price_krw', name: 'وون کره جنوبی', unit: 'هر وون', group: 'fx', more: true, alias: ['وون کره', 'krw'] },
  { key: 'price_myr', name: 'رینگیت مالزی', unit: 'هر رینگیت', group: 'fx', more: true, alias: ['رینگیت', 'myr', 'ringgit'] },
  { key: 'price_thb', name: 'بات تایلند', unit: 'هر بات', group: 'fx', more: true, alias: ['بات تایلند', 'thb', 'baht'] },
  { key: 'price_sar', name: 'ریال عربستان', unit: 'هر ریال عربستان', group: 'fx', more: true, alias: ['ریال عربستان', 'ریال سعودی'] },
  { key: 'price_qar', name: 'ریال قطر', unit: 'هر ریال قطر', group: 'fx', more: true, alias: ['ریال قطر', 'qar'] },
  { key: 'price_omr', name: 'ریال عمان', unit: 'هر ریال عمان', group: 'fx', more: true, alias: ['ریال عمان', 'omr'] },
  { key: 'price_kwd', name: 'دینار کویت', unit: 'هر دینار کویت', group: 'fx', more: true, alias: ['دینار کویت', 'kwd'] },
  { key: 'price_bhd', name: 'دینار بحرین', unit: 'هر دینار بحرین', group: 'fx', more: true, alias: ['دینار بحرین', 'bhd'] },
  { key: 'price_iqd', name: 'دینار عراق', unit: 'هر دینار عراق', group: 'fx', more: true, alias: ['دینار عراق', 'دینار', 'iqd'] },
  { key: 'price_afn', name: 'افغانی', unit: 'هر افغانی', group: 'fx', more: true, alias: ['افغانی', 'afn'] },
  { key: 'price_amd', name: 'درام ارمنستان', unit: 'هر درام', group: 'fx', more: true, alias: ['درام ارمنستان'] },
  { key: 'price_gel', name: 'لاری گرجستان', unit: 'هر لاری', group: 'fx', more: true, alias: ['لاری گرجستان'] },
  { key: 'price_azn', name: 'منات آذربایجان', unit: 'هر منات آذربایجان', group: 'fx', more: true, alias: ['منات آذربایجان', 'azn'] },
  { key: 'price_tmt', name: 'منات ترکمنستان', unit: 'هر منات ترکمنستان', group: 'fx', more: true, alias: ['منات ترکمنستان', 'tmt'] },
  { key: 'silver_999', name: 'نقره ۹۹۹', unit: 'هر گرم', group: 'metal' },
  { key: 'silver_925', name: 'نقره ۹۲۵', unit: 'هر گرم', group: 'metal' },
  { key: 'base_global_copper', name: 'مس جهانی', unit: 'هر تن (دلار)', group: 'metal', usd: true },
  { key: 'silver', name: 'انس نقره', unit: 'هر اونس (دلار)', group: 'metal', usd: true },
  { key: 'platinum', name: 'پلاتین', unit: 'هر اونس (دلار)', group: 'metal', usd: true },
  { key: 'palladium', name: 'پالادیوم', unit: 'هر اونس (دلار)', group: 'metal', usd: true },
  { key: 'ons', name: 'انس جهانی طلا', unit: 'هر اونس (دلار)', group: 'global', usd: true },
];
export const TGJU_BY_KEY = Object.fromEntries(TGJU.map((t) => [t.key, t]));
/** Currencies, and the tgju key a name or unit refers to («دلار کانادا» → CAD, a bare «دلار» → USD). Longer names are
 *  tried first so the generic word never wins over the specific one. Every alias matches only as a whole word («لیر» is
 *  not in «علیرضا», «یوان» not in «دیوان»); Latin codes that are also ordinary words or tickers (try, amd…) are left out. */
export const FX = TGJU.filter((t) => t.group === 'fx');
const FX_ALIASES = FX.flatMap((t) => (t.alias || []).map((a) => ({ a: a.toLowerCase(), key: t.key }))).sort((x, y) => y.a.length - x.a.length);
export function fxKeyOf(text) {
  const s = String(text || '').toLowerCase().replace(/‌/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  for (const { a, key } of FX_ALIASES) {
    const L = /^[a-z]+$/.test(a) ? 'a-z' : '\u0621-\u064a\u067e\u0686\u0698\u06a9\u06af\u06cc' /* Persian letters, not digits */;
    if (new RegExp(`(^|[^${L}])${a.replace(/\u200c/g, ' ')}([^${L}]|$)`).test(s)) return key;
  }
  return null;
}

/** Crypto catalog. Price chain: Nobitex (Rial) → tgju USD × dollar → CoinGecko USD × dollar.
 *  key = Nobitex symbol, tgju = tgju slug, cg = CoinGecko id. Anything else can be added from search. */
export const NOBITEX = [
  { key: 'usdt', name: 'تتر', sym: 'USDT', tgju: 'crypto-tether', cg: 'tether' },
  { key: 'btc', name: 'بیت‌کوین', sym: 'BTC', tgju: 'crypto-bitcoin', cg: 'bitcoin' },
  { key: 'eth', name: 'اتریوم', sym: 'ETH', tgju: 'crypto-ethereum', cg: 'ethereum' },
  { key: 'ton', name: 'تون‌کوین', sym: 'TON', tgju: 'crypto-toncoin', cg: 'the-open-network' },
  { key: 'sol', name: 'سولانا', sym: 'SOL', tgju: 'crypto-solana', cg: 'solana' },
  { key: 'xrp', name: 'ریپل', sym: 'XRP', tgju: 'crypto-ripple', cg: 'ripple' },
  { key: 'bnb', name: 'بایننس‌کوین', sym: 'BNB', tgju: 'crypto-binance-coin', cg: 'binancecoin' },
  { key: 'doge', name: 'دوج‌کوین', sym: 'DOGE', tgju: 'crypto-dogecoin', cg: 'dogecoin' },
  { key: 'trx', name: 'ترون', sym: 'TRX', tgju: 'crypto-tron', cg: 'tron' },
  { key: 'ada', name: 'کاردانو', sym: 'ADA', tgju: 'crypto-cardano', cg: 'cardano' },
  { key: 'ltc', name: 'لایت‌کوین', sym: 'LTC', tgju: 'crypto-litecoin', cg: 'litecoin' },
  { key: 'usdc', name: 'یو‌اس‌دی کوین', sym: 'USDC', cg: 'usd-coin' },
  { key: 'avax', name: 'آوالانچ', sym: 'AVAX', cg: 'avalanche-2' },
  { key: 'dot', name: 'پولکادات', sym: 'DOT', cg: 'polkadot' },
  { key: 'link', name: 'چین‌لینک', sym: 'LINK', cg: 'chainlink' },
  { key: 'xlm', name: 'استلار', sym: 'XLM', cg: 'stellar' },
  { key: 'bch', name: 'بیت‌کوین کش', sym: 'BCH', cg: 'bitcoin-cash' },
  { key: 'etc', name: 'اتریوم کلاسیک', sym: 'ETC', cg: 'ethereum-classic' },
  { key: 'atom', name: 'کازماس', sym: 'ATOM', cg: 'cosmos' },
  { key: 'near', name: 'نیر', sym: 'NEAR', cg: 'near' },
  { key: 'uni', name: 'یونی‌سواپ', sym: 'UNI', cg: 'uniswap' },
  { key: 'aave', name: 'آوه', sym: 'AAVE', cg: 'aave' },
  { key: 'fil', name: 'فایل‌کوین', sym: 'FIL', cg: 'filecoin' },
  { key: 'apt', name: 'اپتوس', sym: 'APT', cg: 'aptos' },
  { key: 'arb', name: 'آربیتروم', sym: 'ARB', cg: 'arbitrum' },
  { key: 'pol', name: 'پالیگان', sym: 'POL', cg: 'polygon-ecosystem-token' },
  { key: 'paxg', name: 'پکس‌گلد', sym: 'PAXG', cg: 'pax-gold' },
  { key: 'xaut', name: 'تتر گلد', sym: 'XAUT', cg: 'tether-gold' },
  { key: 'not', name: 'نات‌کوین', sym: 'NOT', cg: 'notcoin' },
];
/** Shown in the market page's crypto card even when not held. */
export const CRYPTO_DEFAULT = ['usdt', 'btc', 'eth'];
export const NOBITEX_BY_KEY = Object.fromEntries(NOBITEX.map((t) => [t.key, t]));

/** Ready-made metal valuations: one tap sets source, unit and conversion factor. */
export const METAL_PRESETS = [
  { id: 'silver999', name: 'نقره ۹۹۹', hint: 'قیمت داخلی هر گرم', unit: 'گرم', ref: { provider: 'tgju', key: 'silver_999' }, factor: 1 },
  { id: 'silver925', name: 'نقره ۹۲۵', hint: 'قیمت داخلی هر گرم', unit: 'گرم', ref: { provider: 'tgju', key: 'silver_925' }, factor: 1 },
  { id: 'copper', name: 'مس', hint: 'قیمت جهانی، تبدیل به کیلوگرم', unit: 'کیلوگرم', ref: { provider: 'tgju', key: 'base_global_copper' }, factor: 0.001 },
  { id: 'platinum', name: 'پلاتین', hint: 'قیمت جهانی، تبدیل به گرم', unit: 'گرم', ref: { provider: 'tgju', key: 'platinum' }, factor: 1 / 31.1035 },
  { id: 'palladium', name: 'پالادیوم', hint: 'قیمت جهانی، تبدیل به گرم', unit: 'گرم', ref: { provider: 'tgju', key: 'palladium' }, factor: 1 / 31.1035 },
];

/** Quick picks for physical gold and coins: a coin is priced per piece, gold per gram. */
export const GOLD_PRESETS = [
  { id: 'sekee', name: 'سکه امامی', hint: 'قیمت هر عدد', unit: 'عدد', ref: { provider: 'tgju', key: 'sekee' }, factor: 1 },
  { id: 'sekeb', name: 'سکه بهار آزادی', hint: 'قیمت هر عدد', unit: 'عدد', ref: { provider: 'tgju', key: 'sekeb' }, factor: 1 },
  { id: 'nim', name: 'نیم سکه', hint: 'قیمت هر عدد', unit: 'عدد', ref: { provider: 'tgju', key: 'nim' }, factor: 1 },
  { id: 'rob', name: 'ربع سکه', hint: 'قیمت هر عدد', unit: 'عدد', ref: { provider: 'tgju', key: 'rob' }, factor: 1 },
  { id: 'gerami', name: 'سکه گرمی', hint: 'قیمت هر عدد', unit: 'عدد', ref: { provider: 'tgju', key: 'retail_gerami' }, factor: 1 },
  { id: 'g18', name: 'طلای ۱۸ عیار', hint: 'زیورآلات؛ قیمت هر گرم', unit: 'گرم', ref: { provider: 'tgju', key: 'geram18' }, factor: 1 },
  { id: 'g24', name: 'شمش / طلای ۲۴ عیار', hint: 'قیمت هر گرم', unit: 'گرم', ref: { provider: 'tgju', key: 'geram24' }, factor: 1 },
];

/** Gold ETFs on the Tehran exchange: their exposure is gold, not equity. */
export const GOLD_ETFS = ['عیار', 'طلا', 'کهربا', 'مثقال', 'زر', 'گوهر', 'آلتون', 'نفیس', 'لیان', 'تابان', 'زرفام', 'جواهر', 'گنج', 'قیراط', 'درخشان', 'ناب', 'زرین', 'رز', 'آتش', 'نهال', 'زمرد', 'امرالد', 'ریتون', 'گلدیس', 'جام', 'درنا', 'قلک', 'میراث', 'نگین'];

export const PROVIDERS = {
  tgju: { name: 'بازار آزاد', title: 'طلا، سکه، ارز و فلزات (tgju)' },
  tsetmc: { name: 'بورس تهران', title: 'بورس تهران (TSETMC)' },
  fipiran: { name: 'فیپیران', title: 'صندوق‌های سرمایه‌گذاری (فیپیران)' },
  nobitex: { name: 'نوبیتکس', title: 'رمزارز (نوبیتکس و بیت‌پین، با پشتیبان tgju)' },
};

/** Always-fetched refs: denominators (USD, gold), the price board and the popup. */
export const CORE_REFS = [
  { provider: 'tgju', key: 'geram18' }, { provider: 'tgju', key: 'sekee' }, { provider: 'tgju', key: 'nim' }, { provider: 'tgju', key: 'rob' },
  { provider: 'tgju', key: 'price_dollar_rl' }, { provider: 'tgju', key: 'price_eur' }, { provider: 'tgju', key: 'mesghal' }, { provider: 'tgju', key: 'ons' },
  ...CRYPTO_DEFAULT.map((key) => ({ provider: 'nobitex', key })),
];

/** Templates for recurring flows */
export const FLOW_TEMPLATES = [
  { id: 'salary', title: 'حقوق ماهانه', hint: 'واریز به حساب بانکی', dir: 'in' },
  { id: 'rent', title: 'درآمد اجاره', hint: 'واریز به حساب بانکی', dir: 'in' },
  { id: 'installment', title: 'قسط وام', hint: 'از حساب بانکی به بدهی', dir: 'transfer' },
  { id: 'dca', title: 'خرید ماهانه طلا', hint: 'از حساب بانکی به طلای آنلاین', dir: 'transfer' },
  { id: 'saving', title: 'پس‌انداز ماهانه', hint: 'انتقال به صندوق/سپرده', dir: 'transfer' },
  { id: 'expense', title: 'هزینه ثابت', hint: 'برداشت از حساب', dir: 'out' },
];

/** Scenario presets for the simulator (fractions) */
export const SCENARIOS = [
  { id: 'fxjump', name: 'جهش ارزی', shocks: { usd: 0.3 } },
  { id: 'calm', name: 'آرامش ارزی', shocks: { usd: -0.15 } },
  { id: 'goldcrash', name: 'ریزش جهانی طلا', shocks: { gold: -0.15 } },
  { id: 'cryptowinter', name: 'زمستان رمزارز', shocks: { crypto: -0.5 } },
  { id: 'bourse', name: 'رکود بورس', shocks: { equity: -0.25 } },
  { id: 'inflation', name: 'تورم شدید', shocks: { usd: 0.4, equity: 0.25, real: 0.35, private: 0.2 } },
  // shown only when coins or gold funds are held
  { id: 'bubblepop', name: 'تخلیه حباب سکه و صندوق طلا', shocks: { bubble: -1 }, needs: 'bubble' },
];

const foldName = (x) => String(x || '').replace(/[\s‌\-_.]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
/** True for an exchange account at Bitpin (custodian or page name). */
export const isBitpin = (x) => /bitpin|بیت\s*‌?پین/i.test(String(x || ''));
/**
 * A price for a coin or token someone holds: the built-in list by symbol, else Bitpin's list (coins: from
 * P.bitpinCoins()) by symbol or Persian name. Held at Bitpin → priced by Bitpin. null when nothing matches.
 */
export function cryptoRefFor({ sym, unit, name, custodian } = {}, coins = []) {
  const atBp = isBitpin(custodian);
  const keys = [...new Set([sym, unit].map((x) => String(x || '').trim().toLowerCase()).filter((k) => /^[a-z0-9]{2,15}$/.test(k)))];
  const onBp = (k) => (coins || []).find((c) => c.key === k);
  const fromCatalog = (c) => ({ provider: 'nobitex', key: c.key, ...(atBp && onBp(c.key) ? { src: 'bitpin' } : {}) });
  const fromBp = (c) => ({ provider: 'nobitex', key: c.key, sym: c.sym, name: c.name, src: 'bitpin' });
  for (const k of keys) { const c = NOBITEX.find((x) => x.key === k || x.sym.toLowerCase() === k); if (c) return fromCatalog(c); }
  for (const k of keys) { const c = onBp(k); if (c) return fromBp(c); }
  const f = foldName(name);
  if (f) {
    const c = NOBITEX.find((x) => foldName(x.name) === f); if (c) return fromCatalog(c);
    const b = (coins || []).find((x) => foldName(x.name) === f || foldName(x.en) === f); if (b) return fromBp(b);
  }
  return null;
}

/** Coins and tokens held with a hand-typed price (often 0, from a page capture) that an online price can now value. */
// (a coin priced by hand on purpose — a non-zero price, not flagged by a capture — is left alone)
export const unpricedCrypto = (assets) => (assets || []).filter((a) => !a.archived && a.category === 'crypto' && a.mode === 'units' && a.price?.source !== 'market' && (!(+a.price?.value > 0) || !!a.review));
export function cryptoFixes(assets, coins) {
  return unpricedCrypto(assets).map((a) => ({ id: a.id, name: a.name, ref: cryptoRefFor({ sym: a.unit, unit: a.unit, name: a.name, custodian: a.custodian }, coins) })).filter((x) => x.ref);
}
