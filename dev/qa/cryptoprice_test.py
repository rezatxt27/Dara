# E2E: coins and tokenized stocks priced by Bitpin — fixing assets saved with no price, and searching Bitpin's list.
# Run: node dev/qa/demo_seed.mjs && PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 python3 dev/qa/cryptoprice_test.py
import asyncio, json, shutil, pathlib, os, time
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
shutil.rmtree('/tmp/pwcp', ignore_errors=True)
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
SH = ROOT / 'shots'; os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, info=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)

NOW = time.time()
TICKERS = [{'symbol': 'ZEC_IRT', 'price': '317728155', 'daily_change_price': 0.69, 'timestamp': NOW - 30},
           {'symbol': 'NVDAX_IRT', 'price': '56777882', 'daily_change_price': -0.42, 'timestamp': NOW - 30},
           {'symbol': 'XMR_IRT', 'price': '162445470', 'daily_change_price': 3.5, 'timestamp': NOW - 30},
           {'symbol': 'BTC_IRT', 'price': '21453608069', 'daily_change_price': -1.2, 'timestamp': NOW - 30}]
COINS = {'results': [
    {'code': 'ZEC', 'title': 'Zcash', 'title_fa': 'زی کش', 'tradable': True, 'price_info': {'price': '317728155'}},
    {'code': 'NVDAX', 'title': 'NVIDIA xStock', 'title_fa': 'انویدیا', 'tradable': True, 'price_info': {'price': '56777882'}},
    {'code': 'XMR', 'title': 'Monero', 'title_fa': 'مونرو', 'tradable': True, 'price_info': {'price': '162445470'}},
    {'code': 'BTC', 'title': 'Bitcoin', 'title_fa': 'بیت کوین', 'tradable': True, 'price_info': {'price': '21453608069'}}]}
def bars():
    return [{'close': 300000000 + i * 1000000, 'ts': NOW - (30 - i) * 86400, 'resolution': '1d'} for i in range(30)]

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwcp', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []; asked = []
        async def handler(route):
            u = route.request.url; asked.append(u)
            J = lambda o: route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(o, ensure_ascii=False))
            if 'api.bitpin.ir/api/v1/mkt/tickers' in u: return await J(TICKERS)
            if 'api.bitpin.ir/v1/mkt/currencies' in u: return await J(COINS)
            if 'api.bitpin.ir/v1/mkt/tv/get_bars' in u: return await J(bars())
            if 'api.nobitex.ir' in u: return await J({'status': 'ok', 'stats': {'btc-rls': {'latest': '2140000000', 'dayChange': '-1', 'isClosed': False}}})
            if 'ajax.json' in u: return await J({'current': {'price_dollar_rl': {'p': '2,650,000', 'dp': 0, 'dt': 'high', 'ts': '2026-10-25 10:00:00'}}})
            return await route.fulfill(status=503, body='x')
        for pat in ['https://api.bitpin.ir/**', 'https://api.nobitex.ir/**', 'https://cdn.tsetmc.com/**', 'https://api.coingecko.com/**', 'https://call1.tgju.org/**', 'https://api.tgju.org/**', 'https://www.fipiran.com/**']:
            await ctx.route(pat, handler)
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        now = int(NOW * 1000)
        mk = lambda i, name, unit, qty, cust: {'id': f'cp{i}', 'code': f'A-9{i}', 'name': name, 'custodian': cust, 'category': 'crypto', 'liquidity': 'high', 'mode': 'units', 'quantity': qty, 'unit': unit,
            'price': {'source': 'manual', 'value': 0, 'updatedAt': now}, 'review': 'از صفحه ثبت شد؛ منبع قیمت را تنظیم کن', 'createdAt': now, 'updatedAt': now}
        seed['assets'] = seed['assets'] + [mk(1, 'زی کش', 'ZEC', 0.0231, 'بیت‌پین'), mk(2, 'انویدیا', 'NVDAX', 0.0429, 'بیت‌پین'), mk(3, 'توکن ناشناخته', 'FOOX', 5, 'بیت‌پین')]
        seed['settings']['providers'] = {'tgju': True, 'tsetmc': True, 'fipiran': True, 'nobitex': True}
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        get = lambda pg, k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")

        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(f'chrome-extension://{ext}/ui/app.html#/overview'); await pg.wait_for_timeout(1500)
        body = await pg.inner_text('body')
        check('overview: «نیاز به توجه» says three holdings have no price', 'دارایی قیمت ندارند' in body)
        await pg.goto(f'chrome-extension://{ext}/ui/app.html#/assets'); await pg.wait_for_timeout(1200)
        call = pg.locator('.callout:has-text("قیمت آنلاین ندارند")')
        txt = await call.inner_text() if await call.count() else ''
        check('assets: a callout offers to find online prices', await call.count() == 1 and ('۳' in txt or '3' in txt), txt[:90].replace('\n', ' '))
        await call.screenshot(path=f'{SH}/crypto-fix-before.png')
        await call.locator('button:has-text("وصل کردن به قیمت آنلاین")').click()
        for _ in range(30):
            a = {x['id']: x for x in await get(pg, 'assets')}
            if a['cp1']['price'].get('source') == 'market' and a['cp2']['price'].get('source') == 'market': break
            await pg.wait_for_timeout(300)
        await pg.wait_for_timeout(1500)
        a = {x['id']: x for x in await get(pg, 'assets')}
        check('assets: ZEC and NVDAX now priced by Bitpin', a['cp1']['price'].get('ref', {}).get('src') == 'bitpin' and a['cp2']['price'].get('ref', {}).get('key') == 'nvdax' and 'review' not in a['cp1'], (a['cp1']['price'], a['cp2']['price']))
        check('assets: the unknown token is left as it was', a['cp3']['price'].get('source') == 'manual')
        qs = await get(pg, 'quotes')
        q = qs.get('nobitex:zec') or {}
        check('quotes: Bitpin toman → Rial', abs((q.get('price') or 0) - 3177281550) < 1 and q.get('source') == 'bitpin', q)
        row = await pg.locator('tr.r:has-text("زی کش")').inner_text()
        check('assets: the row says «بیت‌پین» and has a value', 'بیت‌پین' in row and 'دستی' not in row.split('\n')[0], row.replace('\n', ' | ')[:160])
        txt = await pg.locator('.callout:has-text("قیمت آنلاین ندارند")').inner_text() if await pg.locator('.callout:has-text("قیمت آنلاین ندارند")').count() else ''
        check('assets: what could not be found is named', 'توکن ناشناخته' in txt, txt[:120].replace('\n', ' '))
        evs = await get(pg, 'events') or []
        fixes = [e for e in evs if e.get('title', '').startswith('اصلاح «')]
        check('each fix is a logged correction, not a market gain', len(fixes) >= 2, len(fixes))
        await pg.screenshot(path=f'{SH}/crypto-fix-after.png', full_page=True)
        # the price page has a chart from Bitpin's daily bars
        await pg.locator('tr.r:has-text("انویدیا")').first.click(); await pg.wait_for_timeout(600)
        # editor: Bitpin search by Persian name
        await pg.goto(f'chrome-extension://{ext}/ui/app.html#/market'); await pg.wait_for_timeout(1000)
        await pg.click('button:has-text("رمزارز دیگر")'); await pg.wait_for_timeout(300)
        await pg.fill('.modal .isearch input', 'مونرو')
        await pg.wait_for_selector('.modal .opt:has-text("مونرو")', timeout=8000)
        hdr = await pg.locator('.modal .opt:has-text("از بیت‌پین")').count()
        check('search: a Persian name finds the coin in Bitpin\'s list', hdr == 1)
        await pg.screenshot(path=f'{SH}/crypto-search-bitpin.png')
        await pg.click('.modal .opt:has-text("مونرو")'); await pg.wait_for_timeout(1500)
        s = await get(pg, 'settings')
        w = [x for x in s.get('watch', []) if x.get('key') == 'xmr']
        check('search: the coin is watched with Bitpin as its source', len(w) == 1 and w[0].get('src') == 'bitpin', w)
        await pg.click('.modal button:has-text("تمام")'); await pg.wait_for_timeout(800)
        q = (await get(pg, 'quotes')).get('nobitex:xmr') or {}
        check('watched coin priced by Bitpin', abs((q.get('price') or 0) - 1624454700) < 1, q)
        # history from Bitpin
        h = await pg.evaluate("() => new Promise(res => chrome.runtime.sendMessage({type:'history', ref:{provider:'nobitex', key:'nvdax', src:'bitpin'}, days: 30}, res))")
        pts = (h or {}).get('points') or (h or {}).get('rows') or (h or {}).get('history') or []
        check('history: daily closes from Bitpin', len(pts) >= 20, {k: (len(v) if isinstance(v, list) else v) for k, v in (h or {}).items()})
        check('no page errors', not errors, errors[:3])
        await ctx.close()
    print(f'\nSUMMARY: {sum(results)} / {len(results)} passed')

asyncio.run(main())
