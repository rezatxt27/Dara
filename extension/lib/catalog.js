// Static catalog: asset categories, market indicators, presets, templates.

/** exposure: rial | gold | fx | crypto | equity | real | commodity | other */
export const CATEGORIES = [
  { id: 'bank', name: 'حساب بانکی و نقد', short: 'بانک', color: '#12B5D9', icon: 'bank', exposure: 'rial', liquidity: 'high', defaultMode: 'balance' },
  { id: 'fixed', name: 'درآمد ثابت و سپرده', short: 'درآمد ثابت', color: '#3D7BF7', icon: 'shield', exposure: 'rial', liquidity: 'high', defaultMode: 'rate' },
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
  { key: 'price_dollar_rl', name: 'دلار آمریکا', unit: 'هر دلار', group: 'fx' },
  { key: 'price_eur', name: 'یورو', unit: 'هر یورو', group: 'fx' },
  { key: 'price_gbp', name: 'پوند انگلیس', unit: 'هر پوند', group: 'fx' },
  { key: 'price_aed', name: 'درهم امارات', unit: 'هر درهم', group: 'fx' },
  { key: 'price_try', name: 'لیر ترکیه', unit: 'هر لیر', group: 'fx' },
  { key: 'silver_999', name: 'نقره ۹۹۹', unit: 'هر گرم', group: 'metal' },
  { key: 'silver_925', name: 'نقره ۹۲۵', unit: 'هر گرم', group: 'metal' },
  { key: 'base_global_copper', name: 'مس جهانی', unit: 'هر تن (دلار)', group: 'metal', usd: true },
  { key: 'silver', name: 'انس نقره', unit: 'هر اونس (دلار)', group: 'metal', usd: true },
  { key: 'platinum', name: 'پلاتین', unit: 'هر اونس (دلار)', group: 'metal', usd: true },
  { key: 'palladium', name: 'پالادیوم', unit: 'هر اونس (دلار)', group: 'metal', usd: true },
  { key: 'ons', name: 'انس جهانی طلا', unit: 'هر اونس (دلار)', group: 'global', usd: true },
];
export const TGJU_BY_KEY = Object.fromEntries(TGJU.map((t) => [t.key, t]));

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

/** Gold ETFs on the Tehran exchange: their exposure is gold, not equity. */
export const GOLD_ETFS = ['عیار', 'طلا', 'کهربا', 'مثقال', 'زر', 'گوهر', 'آلتون', 'نفیس', 'لیان', 'تابان', 'زرفام', 'جواهر', 'گنج', 'قیراط', 'درخشان', 'ناب', 'زرین', 'رز', 'آتش', 'نهال'];

export const PROVIDERS = {
  tgju: { name: 'tgju', title: 'طلا، سکه، ارز و فلزات (tgju)' },
  tsetmc: { name: 'TSETMC', title: 'بورس تهران (TSETMC)' },
  fipiran: { name: 'فیپیران', title: 'صندوق‌های سرمایه‌گذاری (فیپیران)' },
  nobitex: { name: 'نوبیتکس', title: 'رمزارز (نوبیتکس + پشتیبان tgju)' },
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
];
