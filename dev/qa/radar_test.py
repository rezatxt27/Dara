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
def stock(sym, name, growth, pe=10, eps=100, sector='27', val=2e10, last_vol=1e6, low=False, noisy=False):
    d, p = [], []
    for k in range(365, -1, -1):
        d.append(D0 - k)
        base = 100 * (1 + 0.5 * k / 365) if low else 100 * (1 + growth) ** ((365 - k) / 365)
        # a realistic day-to-day wobble (none at the year's two ends, so the returns stay exact)
        wob = 1 - (0.02 * ((k * 7) % 5) / 4 if noisy and 0 < k < 365 else 0)  # only dips: today stays the year's high
        p.append(round(base * wob, 4))
    h = [[D0 - k, 1e6, val] for k in range(20, 0, -1)] + [[D0, last_vol, val]]
    return {'sym': sym, 'name': name, 'isin': 'IRO1' + sym, 'sector': sector, 'eps': eps, 'pe': pe, 'd': d, 'p': p, 'h': h, 'need': 0,
            'today': {'day': DAY, 'close': p[-1], 'py': p[-2], 'vol': last_vol, 'val': val}}
stocks = {f'S{i}': stock(f'نماد{i}', f'شرکت نمونه {i}', i / 100, pe=8 + i % 5) for i in range(30)}
stocks.update({'HOT': stock('داغ', 'شرکت رشد تند', 2.0, pe=40, noisy=True), 'VOL': stock('حجیم', 'شرکت پرحجم', 0.05, last_vol=5e6),
               'CHEAP': stock('ارزان', 'شرکت کم‌قیمت', 0.05, pe=3), 'LOW': stock('کف', 'شرکت در کف', 0, low=True, pe=8),
               'PEND': {**stock('درراه', 'شرکت تازه', 0.1), 'need': 270, 'd': [], 'p': []}})
# more ordinary stocks so the 12-month list is long enough for «همه را ببین»
stocks.update({f'M{i}': stock(f'میانه{i}', f'شرکت میانه {i}', 0.4 + i / 100, pe=9 + i % 4) for i in range(60)})
def fund(key, name, t, y1, m3=5, m1=2, nav=100, ins='', sym='', since='2020-01-01', size=5e12):
    return {'key': key, 'name': name, 'symbol': sym, 'fundType': t, 'type': '', 'cancelNav': nav, 'date': DAY, 'size': size, 'since': since, 'traded': bool(ins), 'insCode': ins,
            'ret': {'y1': y1, 'm6': y1 / 2, 'm3': m3, 'm1': m1, 'w1': 0.5}, 'mix': {'stock': 10, 'bond': 60, 'deposit': 25, 'cash': 5, 'other': 0}}
funds = [fund('g1', 'صندوق طلای الف', 5, 60, ins='E1', sym='طلاالف'), fund('g2', 'صندوق طلای ب', 5, 55, ins='E2', sym='طلاب'), fund('g3', 'صندوق طلای پ', 5, 52, ins='E3', sym='طلاپ'),
         fund('d1', 'درآمد ثابت برتر', 4, 36), fund('d2', 'درآمد ثابت معمولی', 4, 22), fund('s1', 'سهامی نمونه', 6, 80, ins='E4', sym='سهمی')]
etf = {k: {'sym': s, 'name': s, 'close': c, 'val': 5e9, 'day': DAY, 'hist': {DAY: c}} for k, s, c in [('E1', 'طلاالف', 97), ('E2', 'طلاب', 100.5), ('E3', 'طلاپ', 101.2), ('E4', 'سهمی', 103)]}
# individual money over the last 5 sessions (share of each session's value traded; synthetic)
for i, (k, rec) in enumerate(stocks.items()):
    if k == 'PEND': continue
    shares = [0.12, 0.10, -0.02, 0.15, 0.11] if k in ('S3', 'M7') else [-0.2, -0.15, -0.1, 0.01, -0.12] if k == 'LOW' else [((i * 7 + j * 3) % 9 - 4) / 100 for j in range(5)]
    rec['fl'] = [[D0 - (4 - j), round(sh * rec['h'][-5 + j][2]), 1.4] for j, sh in enumerate(shares)]
# the radar's own record: what it showed each session from 90 to 31 days ago (synthetic), so the scorecards have something to say
TRACK = {}
for k in range(90, 30, -1):
    dd = (datetime.date(1970, 1, 1) + datetime.timedelta(days=D0 - k)).isoformat()
    TRACK[dd] = {sig: [[f's:{x}', stocks[x]['p'][365 - k]] for x in ids] for sig, ids in
                 {'top': [f'M{i}' for i in range(10)], 'momentum12': [f'M{i}' for i in range(10, 20)], 'cheap': [f'S{i}' for i in range(20, 30)], 'inflow': [f'M{i}' for i in range(30, 40)]}.items()}
FLOW_DAYS = [(datetime.date(1970, 1, 1) + datetime.timedelta(days=D0 - j)).isoformat() for j in range(4, -1, -1)]
bench_rows = lambda f: {'d': [D0 - 399 + k for k in range(400)], 'p': [f(k) for k in range(400)]}
radar = {'v': 1, 'bench': {'index': bench_rows(lambda k: 1000 + k), 'usd': bench_rows(lambda k: 500 + k / 4)}, 'day': DAY, 'at': 1, 'stocks': stocks, 'etf': etf, 'funds': funds, 'fundsAt': 9e12, 'sectorsAt': 9e12, 'sectors': {'27': 'فلزات اساسی'},
         'results': {'day': DAY, 'ids': [], 'before': ['s:S29', 's:S28']}, 'ruleHits': {}, 'error': None, 'flowDays': FLOW_DAYS, 'flowFor': DAY, 'track': TRACK}

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
        # the owner holds two of the synthetic stocks and a fixed-income fund (synthetic, for «دارایی‌های تو در رادار»)
        hold = lambda i, name, prov, key, sym: {'id': i, 'code': i, 'name': name, 'category': 'stock' if prov == 'tsetmc' else 'fund', 'mode': 'units', 'quantity': 100, 'unit': 'واحد',
                                                 'price': {'source': 'market', 'ref': {'provider': prov, 'key': key, 'symbol': sym, 'label': sym or name, 'field': 'close' if prov == 'tsetmc' else 'cancelNav'}}}
        seed['assets'] = [a for a in seed['assets'] if not str(a.get('id', '')).startswith('rh')] + [hold('rh1', 'سهم داغ', 'tsetmc', 'HOT', 'داغ'), hold('rh2', 'سهم کف', 'tsetmc', 'LOW', 'کف'), hold('rh3', 'صندوق درآمد ثابت', 'fipiran', 'd2', '')]
        # the gold yardsticks priced just now (synthetic): ounce, dollar, coins, 18k
        import time; nowms = int(time.time() * 1000)
        for k, v in {'ons': 4000, 'price_dollar_rl': 1_000_000, 'sekee': 1_050_000_000, 'nim': 540_000_000, 'rob': 300_000_000, 'retail_gerami': 125_000_000, 'geram18': 99_000_000}.items():
            seed['quotes']['tgju:' + k] = {'price': v, 'changePct': 0, 'at': nowms, 'fetchedAt': nowms, 'source': 'mock'}
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

        async def t_new():
            pg = await newpage('radar')
            mine = pg.locator('.rd-sec:has(h4:has-text("دارایی‌های تو در رادار"))')
            nrow = await mine.locator('.rd-mrow').count()
            # three synthetic holdings in the radar, plus the sample's gold ETF that the synthetic market doesn't have
            check('holdings: a section of the owner\'s stocks and funds', await mine.count() == 1 and nrow == 4, nrow)
            check('holdings: one the radar doesn\'t know yet says so', await mine.locator('.rd-mrow:has-text("هنوز در داده‌های رادار نیست")').count() == 1)
            low = await mine.locator('.rd-mrow:has(b:text-is("کف"))').inner_text()
            check('holdings: a stock far under its high is flagged (once, not twice)', 'پایین‌تر از سقف سال' in low and 'نزدیک کمترین قیمت سال' not in low, low.replace('\n', ' | '))
            hot = await mine.locator('.rd-mrow:has(b:text-is("داغ"))').inner_text()
            check('holdings: the cards it is in today', 'روند قوی، ۱۲ ماه' in hot, hot.replace('\n', ' | '))
            dep = await mine.locator('.rd-mrow:has-text("درآمد ثابت معمولی")').inner_text()
            check('holdings: a fixed-income fund under the deposit is flagged', 'کمتر از سپرده' in dep, dep.replace('\n', ' | '))
            last = await mine.locator('.rd-mrow').last.inner_text()
            check('holdings: rows with warnings first, unknown ones last', 'هنوز در داده‌های رادار نیست' in last or 'پوشش نمی‌دهد' in last, last[:80])
            card = pg.locator('.rd-card:has-text("شرکت رشد تند")').first
            check('cards: a year sparkline and the year bar', await card.locator('.rd-spark svg path').count() >= 1 and await card.locator('.yb-t i').count() == 1)
            pos = await card.locator('.yb-t i').evaluate("e => parseFloat(e.style.left)")
            check('year bar: a stock at its high sits at the right end', pos >= 99, pos)
            fr = await pg.locator('.rd-card:has-text("درآمد ثابت برتر") .rd-rets').inner_text()
            check('cards: a fund shows its returns in the same row as a stock', all(t in fr for t in ['۱ ماه', '۳ ماه', '۶ ماه', '۱۲ ماه']), fr.replace('\n', ' | '))
            sr = await card.locator('.rd-rets').inner_text()
            check('cards: a stock\'s returns row under its chart (and no repeat in «why»)', '۶ ماه' in sr and '۱۲ ماه' in sr and '۳ ماه' not in await card.locator('.rd-why').inner_text(), sr.replace('\n', ' | '))
            # search
            await pg.keyboard.press('/'); await pg.wait_for_timeout(200)
            check('search: «/» focuses it', await pg.evaluate("document.activeElement?.getAttribute('role')") == 'combobox')
            await pg.keyboard.type('طلا'); await pg.wait_for_timeout(300)
            n = await pg.locator('#rd-sres [role=option]').count()
            check('search: finds every gold fund', n == 3, n)
            await pg.screenshot(path=f'{SH}/radar-search-{THEME}.png')
            await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(900)
            dr = await pg.locator('.drawer').inner_text() if await pg.locator('.drawer').count() else ''
            check('search: Enter opens the chosen one\'s page', await pg.locator('.drawer .pd').count() == 1 and ('طلاب' in dr or 'طلای ب' in dr), dr[:160].replace('\n', ' | '))
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
            if await pg.locator('.drawer').count(): await pg.locator('.drawer [aria-label="بستن"]').first.click(); await pg.wait_for_timeout(300)
            box = pg.locator('.rd-sbox input'); await box.fill('داغ'); await pg.wait_for_timeout(300)
            first = await pg.locator('#rd-sres [role=option]').first.inner_text()
            check('search: a symbol match comes first, with numbers and «in the radar»', 'داغ' in first.split('\n')[0] and 'در رادار امروز' in first and '۱۲ ماه' in first, first.replace('\n', ' | '))
            await box.fill('ناموجود'); await pg.wait_for_timeout(300)
            check('search: nothing found says so', 'پیدا نشد' in await pg.locator('#rd-sres').inner_text())
            await box.fill(''); await pg.wait_for_timeout(200)
            await pg.screenshot(path=f'{SH}/radar-mine-{THEME}.png', full_page=True)
            # six additions: show-all, tips, benchmarks, risk & earnings yield, alerts, freshness
            sec = pg.locator('.rd-sec:has(h4:text-is("روند قوی، ۱۲ ماه"))')
            n0 = await sec.locator('.rd-card').count()
            more = sec.locator('.rd-more')
            mtxt = await more.inner_text() if await more.count() else ''
            check('«همه را ببین (n)» under a long section', n0 == 6 and 'همه را ببین' in mtxt, (n0, mtxt))
            await more.click(); await pg.wait_for_timeout(400)
            n1 = await sec.locator('.rd-card').count()
            check('it opens the whole list', n1 > 6 and str(n1) in mtxt.translate(FA), (n1, mtxt))
            await more.click(); await pg.wait_for_timeout(300)
            check('every section has its ⓘ', await pg.locator('.rd-sec-h .tipbtn').count() >= 6)
            hot = await pg.locator('.rd-card:has-text("شرکت رشد تند")').first.inner_text()
            check('momentum card: index and dollar over the same 12 months', 'در همین ۱۲ ماه: شاخص کل' in hot and 'دلار' in hot, hot[:300].replace('\n', ' | '))
            check('card: earnings yield against the deposit, and risk in plain words', 'سود برآوردی سالانهٔ هر سهم' in hot and 'نوسان روزانه' in hot, hot[:400].replace('\n', ' | '))
            check('header: how fresh the funds are', 'صندوق‌ها' in ' '.join(await pg.locator('.rd-top .sub').all_inner_texts()))
            await pg.locator('.rd-card:has-text("شرکت رشد تند") .rd-name').first.click(); await pg.wait_for_timeout(900)
            rep = await pg.locator('.drawer .pd-card:has-text("کارنامهٔ نماد")').inner_text()
            check('report card: index and dollar rows, worst fall, daily swing, earnings yield', all(t in rep for t in ['شاخص کل', 'دلار', 'بدترین افت', 'نوسان روزانه', 'سود سالانهٔ شرکت']), rep[:300].replace('\n', ' | '))
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
            if await pg.locator('.drawer').count(): await pg.locator('.drawer [aria-label="بستن"]').first.click(); await pg.wait_for_timeout(300)
            await pg.click('.seg button:has-text("پیگیری")'); await pg.wait_for_timeout(400)
            await pg.locator('.rd-mark button[aria-label^="هشدار قیمت"]').first.click(); await pg.wait_for_timeout(300)
            await pg.locator('.rd-alert-ed input').nth(2).fill('10'); await pg.wait_for_timeout(200)
            await pg.click('.rd-alert-ed button:has-text("ذخیره")'); await pg.wait_for_timeout(600)
            mk = (await get(pg, 'radarUser'))['marks'][0]
            check('a followed item gets a price alert', mk.get('alert', {}).get('fall') == 10 and mk.get('fired') == {}, mk.get('alert'))
            mt = (await pg.locator('.rd-mark').first.inner_text()).translate(FA)
            check('…and the follow list says so', '10٪ افت' in mt, mt.replace('\n', ' | '))
            await pg.screenshot(path=f'{SH}/radar-marks-{THEME}.png', full_page=True)
            await pg.close()
        await step('new', t_new())

        async def t_plus():
            pg = await newpage('radar')
            txt = await pg.inner_text('.page')
            pulse = await pg.inner_text('.rd-pulse')
            check('market pulse at the top: index, breadth, individual money, market P/E', all(w in pulse for w in ['نبض بازار', 'شاخص کل', 'مثبت / منفی', 'پول حقیقی امروز', 'P/E بازار', 'سپرده']), pulse.replace('\n', ' | ')[:240])
            order = await pg.evaluate("() => { const a = document.querySelector('.rd-pulse'), b = document.querySelector('.rd-sec'); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }")
            check('…before every section', order)
            check('section «برترین‌های امروز»', 'برترین‌های امروز' in txt)
            top = pg.locator('.rd-sec:has(h4:has-text("برترین‌های امروز")) .rd-card')
            n = await top.count()
            scores = [int((await top.nth(i).locator('.rd-sc-n b').inner_text()).translate(FA)) for i in range(n)]
            check('top cards: score ≥ 65, best first, at most 6 before «همه»', n > 0 and n <= 6 and all(x >= 65 for x in scores) and scores == sorted(scores, reverse=True), scores)
            check('top card shows the five parts as bars', await top.first.locator('.rd-part').count() >= 4)
            check('other stock cards show their score in one line', await pg.locator('.rd-sec:has(h4:has-text("روند قوی، ۱۲ ماه")) .rd-score:not(.full)').count() > 0)
            check('section «ورود پول حقیقی» with the steady-inflow stocks', 'ورود پول حقیقی' in txt and await pg.locator('.rd-sec:has(h4:has-text("ورود پول حقیقی")) .rd-card:has-text("نماد3")').count() == 1)
            check('flow line on stock cards', await pg.locator('.rd-flow').count() > 3)
            gold = await pg.inner_text('.rd-gold')
            check('cheapest way to buy gold: ranked, cheapest marked, funds approximate', 'ارزان‌ترین امروز' in gold and 'حدودی' in gold and '۱۸ عیار' in gold, gold.replace('\n', ' | ')[:240])
            tr = await pg.locator('.rd-track').all_inner_texts()
            check('scorecard line visible under stock sections, with the result once a month has passed', len(tr) >= 3 and any('یک ماه بعد میانگین' in t and 'شاخص کل' in t for t in tr), tr[:3])
            mine = await pg.inner_text('.rd-mine')
            check('a holding on steady outflow gets a warning', 'خروج پول حقیقی' in mine, mine.replace('\n', ' | ')[:200])
            await pg.screenshot(path=f'{SH}/radar-plus-{THEME}.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 2000}, full_page=True)
            await pg.locator('.rd-sec:has(h4:has-text("ارزان‌ترین راه خرید طلا"))').screenshot(path=f'{SH}/radar-gold-{THEME}.png')
            await pg.locator('.rd-sec:has(h4:has-text("برترین‌های امروز"))').screenshot(path=f'{SH}/radar-top-{THEME}.png')
            await pg.locator('.rd-sec:has(h4:has-text("ورود پول حقیقی"))').screenshot(path=f'{SH}/radar-inflow-{THEME}.png')
            # a rule on the combined score
            await pg.click('.seg >> text=قاعده‌های من'); await pg.wait_for_timeout(200)
            await pg.click('text=قاعدهٔ تازه'); await pg.wait_for_timeout(200)
            opts = await pg.locator('.modal select[aria-label="معیار"] option').all_inner_texts()
            check('rules can use the score and individual money', any('امتیاز ترکیبی' in o for o in opts) and any('پول حقیقی' in o for o in opts), opts)
            await pg.close()
        await step('plus', t_plus())

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
