# E2E for «رادار فرصت‌ها»: the page, its cards, «پیگیری», rules, the price page's report card and the settings switch.
# The market scan is seeded (synthetic stocks and funds; no network). Run: python3 dev/qa/radar_test.py [light|dark]
import asyncio, json, os, sys, shutil, pathlib, datetime, math
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = '/tmp/dara-radar'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(ROOT / 'extension', EXT)
shutil.rmtree('/tmp/pwradar', ignore_errors=True)
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
THEME = sys.argv[1] if len(sys.argv) > 1 else 'light'
SH = ROOT / 'shots'; os.makedirs(SH, exist_ok=True)
results = []
FA = str.maketrans('۰۱۲۳۴۵۶۷۸۹', '0123456789')
def check(name, ok, info=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)
async def step(name, coro):
    try: await coro
    except Exception as e: check(name + ' (exception)', False, str(e).split('\n')[0][:220])

# ---------- a synthetic market (closes for a year, Rial) ----------
DAY = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
D0 = (datetime.date.fromisoformat(DAY) - datetime.date(1970, 1, 1)).days
def stock(sym, name, growth, pe=10, eps=100, sector='27', val=2e10, last_vol=1e6, low=False):
    d, p = [], []
    for k in range(365, -1, -1):
        d.append(D0 - k)
        p.append(round(100 * (1 + 0.5 * k / 365) if low else 100 * (1 + growth) ** ((365 - k) / 365), 4))
    h = [[D0 - k, 1e6, val] for k in range(20, 0, -1)] + [[D0, last_vol, val]]
    return {'sym': sym, 'name': name, 'isin': 'IRO1' + sym, 'sector': sector, 'eps': eps, 'pe': pe, 'd': d, 'p': p, 'h': h, 'need': 0,
            'today': {'day': DAY, 'close': p[-1], 'py': p[-2], 'vol': last_vol, 'val': val}}
stocks = {f'S{i}': stock(f'نماد{i}', f'شرکت نمونه {i}', i / 100, pe=8 + i % 5) for i in range(30)}
stocks.update({'HOT': stock('داغ', 'شرکت رشد تند', 2.0, pe=40), 'VOL': stock('حجیم', 'شرکت پرحجم', 0.05, last_vol=5e6),
               'CHEAP': stock('ارزان', 'شرکت کم‌قیمت', 0.05, pe=3), 'LOW': stock('کف', 'شرکت در کف', 0, low=True, pe=8),
               'PEND': {**stock('درراه', 'شرکت تازه', 0.1), 'need': 270, 'd': [], 'p': []}})
def fund(key, name, t, y1, m3=5, m1=2, nav=100, ins='', sym='', since='2020-01-01', size=5e12):
    return {'key': key, 'name': name, 'symbol': sym, 'fundType': t, 'type': '', 'cancelNav': nav, 'date': DAY, 'size': size, 'since': since, 'traded': bool(ins), 'insCode': ins,
            'ret': {'y1': y1, 'm6': y1 / 2, 'm3': m3, 'm1': m1, 'w1': 0.5}, 'mix': {'stock': 10, 'bond': 60, 'deposit': 25, 'cash': 5, 'other': 0}}
funds = [fund('g1', 'صندوق طلای الف', 5, 60, ins='E1', sym='طلاالف'), fund('g2', 'صندوق طلای ب', 5, 55, ins='E2', sym='طلاب'), fund('g3', 'صندوق طلای پ', 5, 52, ins='E3', sym='طلاپ'),
         fund('d1', 'درآمد ثابت برتر', 4, 36), fund('d2', 'درآمد ثابت معمولی', 4, 22), fund('s1', 'سهامی نمونه', 6, 80, ins='E4', sym='سهمی')]
etf = {k: {'sym': s, 'name': s, 'close': c, 'val': 5e9, 'day': DAY, 'hist': {DAY: c}} for k, s, c in [('E1', 'طلاالف', 97), ('E2', 'طلاب', 100.5), ('E3', 'طلاپ', 101.2), ('E4', 'سهمی', 103)]}
radar = {'v': 1, 'day': DAY, 'at': 1, 'stocks': stocks, 'etf': etf, 'funds': funds, 'fundsAt': 9e12, 'sectorsAt': 9e12, 'sectors': {'27': 'فلزات اساسی'},
         'results': {'day': DAY, 'ids': [], 'before': ['s:S29', 's:S28']}, 'ruleHits': {}, 'error': None}

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwradar', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        seed['settings']['theme'] = THEME
        seed['meta'] = {**seed.get('meta', {}), 'radar': {'day': DAY, 'newCount': 3, 'pending': 1}}
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", {**seed, 'radar': radar, 'radarUser': {'rules': [], 'marks': [], 'seenDay': None}})
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        async def newpage(route, w=1440):
            pg = await ctx.new_page(); await pg.set_viewport_size({'width': w, 'height': 1000})
            pg.on('console', lambda m: errors.append(f'[{route}] {m.text}') if m.type == 'error' and 'net::' not in m.text else None)
            pg.on('pageerror', lambda e: errors.append(f'[{route} pageerror] {e}'))
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/{route}'); await pg.wait_for_timeout(1400)
            return pg
        get = lambda pg, k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")

        async def t_nav():
            pg = await newpage('overview')
            badge = await pg.locator('.nav a[href="#/radar"] .count').count()
            check('menu has the radar, with a count of new cards', await pg.locator('.nav a[href="#/radar"]').count() == 1 and badge == 1)
            await pg.close()
        await step('nav', t_nav())

        async def t_page():
            pg = await newpage('radar')
            txt = await pg.inner_text('.page')
            for sig in ['روند قوی، ۱۲ ماه', 'حجم غیرعادی', 'ارزان نسبت به گروه', 'نزدیک کف سالانه، سودده', 'صندوق زیر NAV', 'درآمد ثابت بهتر از سپرده', 'پربازده‌ترین صندوق‌ها']:
                check(f'section «{sig}»', sig in txt)
            hot = pg.locator('.rd-card:has-text("داغ")').first
            ht = await hot.inner_text()
            check('a card says why it showed up and what to check', 'چرا دیده شد' in ht and 'پیش از تصمیم ببین' in ht and '۲۰۰٪' in ht and 'گران‌تر از هم‌گروه‌ها' in ht, ht[:200].replace('\n', ' | '))
            check('new since last session is marked «تازه»', await hot.locator('.pill:has-text("تازه")').count() == 1)
            check('no card says buy or sell', not any(w in txt for w in ['بخر ', 'بفروش']))
            check('progress while a stock\'s year is still being gathered', 'در حال جمع کردن قیمت‌های یک سال' in txt)
            check('seen: the menu count clears', (await get(pg, 'radarUser'))['seenDay'] == DAY)
            await pg.screenshot(path=f'{SH}/radar-{THEME}.png', full_page=True)
            # filter to funds
            await pg.click('.chip:has-text("صندوق‌ها")'); await pg.wait_for_timeout(200)
            check('the funds filter leaves only funds', await pg.locator('.rd-card:has-text("داغ")').count() == 0 and await pg.locator('.rd-card:has-text("درآمد ثابت برتر")').count() == 1)
            neg = await pg.locator('.rd-card:has-text("صندوق طلای الف")').first.inner_text()
            check('fund under NAV: bubble from the same day', '۳٫۰٪ کمتر از NAV' in neg or '۳٪' in neg, neg[:160].replace('\n', ' | '))
            await pg.click('.chip:has-text("همه")'); await pg.wait_for_timeout(200)
            # «پیگیری»
            await hot.locator('button[aria-label="افزودن به پیگیری"]').click(); await pg.wait_for_timeout(500)
            marks = (await get(pg, 'radarUser'))['marks']
            check('a card can be followed (price and day remembered)', len(marks) == 1 and marks[0]['id'] == 's:HOT' and marks[0]['day'] == DAY and marks[0]['price'] > 0, marks[:1])
            await pg.click('.rd-top .seg button:has-text("پیگیری")'); await pg.wait_for_timeout(300)
            check('the follow list shows it', await pg.locator('.list .it:has-text("داغ")').count() == 1)
            # rules
            await pg.click('.rd-top .seg button:has-text("قاعده‌های من")'); await pg.wait_for_timeout(300)
            await pg.click('.chip:has-text("سهم با P/E زیر ۵")'); await pg.wait_for_timeout(300)
            await pg.click('.modal button:has-text("ذخیره")'); await pg.wait_for_timeout(600)
            rules = (await get(pg, 'radarUser'))['rules']
            check('a rule from a quick start is saved', len(rules) == 1 and rules[0]['kind'] == 'stock' and rules[0]['notify'] is True, rules)
            row = await pg.locator('.list .it:has-text("سهم با P/E زیر ۵")').inner_text()
            check('the rule finds its stocks today', '1 نماد' in row.translate(FA), row.replace('\n', ' | '))
            await pg.click('.list .it:has-text("سهم با P/E زیر ۵") .rd-name'); await pg.wait_for_timeout(200)
            check('its matches can be opened', await pg.locator('.rd-hit:has-text("ارزان")').count() == 1)
            await pg.screenshot(path=f'{SH}/radar-rules-{THEME}.png')
            # the price page's report card
            await pg.click('.rd-top .seg button:has-text("امروز")'); await pg.wait_for_timeout(300)
            await pg.locator('.rd-card:has-text("داغ") .rd-name').first.click(); await pg.wait_for_timeout(1200)
            rep = await pg.locator('.drawer .pd-card:has-text("کارنامهٔ نماد")').inner_text()
            check('price page: the stock\'s report card', 'P/E' in rep and 'میانهٔ گروه' in rep and 'تعدیل شده' in rep and 'فلزات اساسی' in rep, rep[:220].replace('\n', ' | '))
            await pg.screenshot(path=f'{SH}/radar-report-{THEME}.png')
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
            await pg.click('.chip:has-text("صندوق‌ها")'); await pg.wait_for_timeout(200)
            await pg.locator('.rd-card:has-text("درآمد ثابت برتر") .rd-name').first.click(); await pg.wait_for_timeout(1000)
            rep = await pg.locator('.drawer .pd-card:has-text("کارنامهٔ صندوق")').inner_text()
            check('price page: a fund\'s report card (returns, rank, mix)', 'رتبه' in rep and '1 از 2' in rep.translate(FA) and 'ترکیب' in rep and 'فیپیران' in rep, rep[:220].replace('\n', ' | '))
            await pg.close()
        await step('page', t_page())

        async def t_narrow():
            pg = await newpage('radar', 420)
            sw_ = await pg.evaluate('document.documentElement.scrollWidth'); cw = await pg.evaluate('document.documentElement.clientWidth')
            check('narrow window: no sideways scroll', sw_ <= cw + 1, (sw_, cw))
            await pg.screenshot(path=f'{SH}/radar-narrow-{THEME}.png')
            await pg.close()
        await step('narrow', t_narrow())

        async def t_off():
            pg = await newpage('settings')
            await pg.click('[title="نمایش رادار"]'); await pg.wait_for_timeout(500)
            check('the radar can be switched off', (await get(pg, 'settings'))['radar'] is False and await pg.locator('.nav a[href="#/radar"]').count() == 0)
            await pg.click('[title="نمایش رادار"]'); await pg.wait_for_timeout(300)
            await pg.close()
        await step('off', t_off())

        check('no console/page errors', not errors, errors[:6])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(results), '/', len(results), 'passed')
