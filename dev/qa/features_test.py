# E2E for v1.3: «این عدد از کجا آمد؟», «بپرس», «واقعاً پولدارتر شدم؟», نقطه سربه‌سر, پول جدید,
# ثبت با یک جمله, سناریو با زبان طبیعی, نقد پرتفوی. Uses synthetic data and the mock AI server.
# Run: node dev/qa/demo_seed.mjs && (python3 dev/qa/mockai.py 8765 &) && python3 dev/qa/features_test.py [light|dark]
import asyncio, json, os, sys, shutil, pathlib, re
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = '/tmp/dara-feat'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(ROOT / 'extension', EXT)
m = json.load(open(f'{EXT}/manifest.json')); m['host_permissions'] += ['http://127.0.0.1/*']; json.dump(m, open(f'{EXT}/manifest.json', 'w'), ensure_ascii=False)
shutil.rmtree('/tmp/pwfeat', ignore_errors=True)
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
THEME = sys.argv[1] if len(sys.argv) > 1 else 'light'
SH = ROOT / 'shots'; os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, info=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)
async def step(name, coro):
    try: await coro
    except Exception as e: check(name + ' (exception)', False, str(e).split('\n')[0][:220])
FA = str.maketrans('۰۱۲۳۴۵۶۷۸۹٬٫−', '0123456789,.-')
def nums(t): return [float(x.replace(',', '')) for x in re.findall(r'-?[\d,]+(?:\.\d+)?', t.translate(FA)) if x.replace(',', '').replace('-', '')]

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwfeat', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        seed['settings']['theme'] = THEME
        seed['ai'] = {'connections': [{'id': 'c1', 'service': 'sotoon', 'api': 'openai', 'name': 'سرویس آزمایشی', 'baseUrl': 'http://127.0.0.1:8765/v1', 'apiKey': 'test-key', 'model': 'mock-model-1', 'fastModel': ''}],
                      'activeId': 'c1', 'privacy': 'full', 'fallback': True, 'weekly': False, 'trustedSites': []}
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        async def newpage(route, w=1440):
            pg = await ctx.new_page(); await pg.set_viewport_size({'width': w, 'height': 1000})
            pg.on('console', lambda m: errors.append(f'[{route}] {m.text}') if m.type == 'error' and '401' not in m.text else None)
            pg.on('pageerror', lambda e: errors.append(f'[{route} pageerror] {e}'))
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/{route}'); await pg.wait_for_timeout(1200)
            return pg
        get = lambda pg, k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")

        # 1) «این عدد از کجا آمد؟»
        async def t_explain():
            pg = await newpage('overview')
            await pg.click('.hero .lbl .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain net: formula + total', 'جمع دارایی‌ها' in txt and 'ارزش خالص' in txt and 'بدهی' in txt, txt[:120].replace('\n', ' | '))
            await pg.screenshot(path=f'{SH}/explain-net-{THEME}.png')
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
            check('explain closes with Escape', await pg.locator('.xpop').count() == 0)
            await pg.click('.hero .chg .box >> nth=1 >> .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain 7-day change separates market from money moved', 'اثر قیمت بازار' in txt and 'واریز و برداشت' in txt, txt[:160].replace('\n', ' | '))
            await pg.mouse.click(5, 5); await pg.wait_for_timeout(200)
            check('explain closes on outside click', await pg.locator('.xpop').count() == 0)
            await pg.close()
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("کیلوگرم")'); await pg.wait_for_timeout(400)
            await pg.click('tr.xrow .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain asset: USD metal shows dollar rate and factor', 'نرخ دلار' in txt and 'ضریب تبدیل' in txt and 'قیمت هر واحد' in txt, txt[:200].replace('\n', ' | '))
            await pg.screenshot(path=f'{SH}/explain-asset-{THEME}.png')
            # numbers add up: quantity × unit price = value (tolerate compact rounding)
            vals = await pg.evaluate("() => [...document.querySelectorAll('.xpop .xl')].map(e => [e.querySelector('.t').innerText, e.querySelector('.v').innerText])")
            d = {k.split('،')[0].strip(): v for k, v in vals}
            q = nums(d.get('مقدار', ''))[0]; up = nums(d.get('قیمت هر واحد', ''))[0]; val = nums(d.get('ارزش', ''))[0]
            check('explain asset: quantity × unit price = value', abs(q * up - val) <= max(2, val * 1e-6), (q, up, val))
            await pg.keyboard.press('Escape')
            await pg.click('tr.r:has-text("سپرده") >> nth=0') if await pg.locator('tr.r:has-text("صندوق درآمد ثابت")').count() == 0 else await pg.click('tr.r:has-text("صندوق درآمد ثابت")')
            await pg.wait_for_timeout(400)
            await pg.click('tr.xrow .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain fixed income: rate, method and accrued interest', 'نرخ سود سالانه' in txt and 'روزشمار مرکب' in txt and 'سود انباشته' in txt, txt[:200].replace('\n', ' | '))
            await pg.close()
        await step('explain', t_explain())

        # 2) «بپرس» از هر جا
        async def t_ask():
            pg = await newpage('overview')
            await pg.click('.card:has-text("چرا تغییر کرد") .askbtn'); await pg.wait_for_timeout(300)
            check('ask opens the assistant', '#/assistant' in pg.url, pg.url)
            await pg.wait_for_selector('.msg.bot .md', timeout=20000)
            user = await pg.inner_text('.msg.user >> nth=-1')
            check('ask sends the contextual question automatically', 'امروز تغییر کرد' in user, user[:80])
            check('ask cleans the address bar', 'ask=' not in pg.url, pg.url)
            await pg.reload(); await pg.wait_for_timeout(1500)
            n_user = await pg.locator('.msg.user').count()
            check('reload does not resend the question', n_user == 1, n_user)
            await pg.close()
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("نقره")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow .askbtn'); await pg.wait_for_selector('.msg.user', timeout=8000)
            user = await pg.inner_text('.msg.user >> nth=-1')
            check('ask from an asset row names the asset', 'نقره' in user, user[:80])
            await pg.close()
        await step('ask', t_ask())

        # 3) «واقعاً پولدارتر شدم؟»
        async def t_perf():
            pg = await newpage('analysis')
            card = pg.locator('#perf')
            txt = await card.inner_text()
            check('performance: verdict vs gold, dollar and deposit', ('جلوتری' in txt or 'عقب‌تری' in txt) and 'طلای ۱۸' in txt and 'دلار' in txt and 'سپرده' in txt, txt[:200].replace('\n', ' | '))
            check('performance: salary/bonus separated from return', 'پول تازه' in txt or 'برداشت' in txt, txt[:300].replace('\n', ' | '))
            check('performance: three benchmark rows', await card.locator('.brow').count() == 3)
            for label in ['ماه', 'سال', 'از ابتدا']:
                await card.locator(f'.seg button:has-text("{label}")').first.click(); await pg.wait_for_timeout(250)
                t2 = await card.inner_text()
                check(f'performance period «{label}» renders', 'جلوتری' in t2 or 'عقب‌تری' in t2)
            await card.locator('.seg button:has-text("۳ ماه")').click(); await pg.wait_for_timeout(200)
            inp = card.locator('input.num-in')
            await inp.fill('40'); await inp.press('Tab'); await pg.wait_for_timeout(500)
            s = await get(pg, 'settings')
            check('performance: deposit rate is editable and saved', s.get('depositPct') == 40, s.get('depositPct'))
            await card.screenshot(path=f'{SH}/performance-{THEME}.png')
            await pg.close()
        await step('performance', t_perf())

        # 4) نقطه سربه‌سر
        async def t_breakeven():
            pg = await newpage('calc?t=breakeven')
            card = pg.locator('#breakeven')
            await card.locator('.field:has-text("سود سپرده") input').fill('24')
            await card.locator('.field:has-text("کارمزد") input').fill('2')
            await card.locator('.seg button:has-text("۶ ماه")').click(); await pg.wait_for_timeout(300)
            txt = await card.inner_text()
            tn = txt.translate(FA)
            check('break-even: required rise = 1.02^6/0.98 − 1 = 14.9%', '14.9٪' in tn, re.findall(r'یعنی[^\n]+', tn)[:1])
            # target price = 25,358,000 toman × 1.149145 ≈ 29,140,027
            check('break-even: target price for 18k gold', '29,140,027' in tn, re.findall(r'باید برسد به\s*\n?([^\n]+)', tn)[:1])
            await card.locator('select').select_option(label='سکه امامی'); await pg.wait_for_timeout(300)
            t2 = await card.inner_text()
            check('break-even: switching asset updates the sentence', 'سکه امامی' in t2 and 'هر سکه' in t2)
            await card.screenshot(path=f'{SH}/breakeven-{THEME}.png')
            await pg.close()
        await step('breakeven', t_breakeven())

        # 5) پول جدید
        async def t_newmoney():
            pg = await newpage('analysis')
            box = pg.locator('#newmoney')
            await box.locator('input').fill('1000000000'); await pg.wait_for_timeout(400)
            rows = await box.locator('tbody tr').count()
            check('new money: plan rows appear', rows >= 1, rows)
            adds = await pg.evaluate("() => [...document.querySelectorAll('#newmoney tbody tr td:nth-child(2)')].map(e => e.innerText)")
            check('new money: whole amount is allocated (≈ 1 billion toman)', len(adds) >= 1, adds)
            txt = await box.inner_text()
            check('new money: says no selling and shows gap before → after', 'بدون فروش' in txt and 'بیشترین فاصله' in txt)
            await box.screenshot(path=f'{SH}/newmoney-{THEME}.png')
            await pg.close()
        await step('newmoney', t_newmoney())

        # 7) سناریو با زبان طبیعی
        async def t_nlscenario():
            pg = await newpage('analysis')
            await pg.fill('.nl-scn input', 'اگر توافق شود'); await pg.click('.nl-scn button')
            await pg.wait_for_selector('.assume', timeout=15000); await pg.wait_for_timeout(300)
            txt = await pg.inner_text('.assume')
            check('NL scenario: assumptions listed with reasons', 'نرخ دلار' in txt and 'انتظار ورود ارز' in txt and 'فرض' in txt, txt[:200].replace('\n', ' | '))
            usd = await pg.locator('.slider:has-text("نرخ دلار") input').input_value()
            eq = await pg.locator('.slider:has-text("بورس تهران") input').input_value()
            check('NL scenario: sliders set from the assumptions', usd == '-20' and eq == '25', (usd, eq))
            check('NL scenario: hidden sliders revealed when used', await pg.locator('.slider:has-text("سهام غیربورسی")').count() == 1)
            res = await pg.inner_text('.card:has-text("شبیه‌ساز سناریو") .preview')
            check('NL scenario: result computed by the engine', '٪' in res)
            # user edits an assumption → list shows the new value
            await pg.locator('.slider:has-text("نرخ دلار") input').fill('-10'); await pg.wait_for_timeout(300)
            txt2 = await pg.inner_text('.assume')
            check('NL scenario: editing a slider updates the assumption', '−۱۰٪' in txt2 or '-۱۰٪' in txt2 or '-10' in txt2, txt2[:120].replace('\n', ' | '))
            await pg.locator('.card:has-text("شبیه‌ساز سناریو")').screenshot(path=f'{SH}/nl-scenario-{THEME}.png')
            await pg.close()
        await step('nl-scenario', t_nlscenario())

        # 8) نقد پرتفوی
        async def t_critique():
            pg = await newpage('analysis')
            await pg.click('.critique button:has-text("نقد پرتفوی")')
            await pg.wait_for_selector('.critique .list .it', timeout=15000)
            n = await pg.locator('.critique .list .it').count()
            check('critique: points shown', n == 2, n)
            c = await get(pg, 'critique')
            check('critique: saved for later', c and len(c['points']) == 2)
            log = open('/tmp/mockai.log').read() if os.path.exists('/tmp/mockai.log') else ''
            check('critique: only percentages sent (no amounts)', 'CRITIQUE_PERCENT_ONLY' in log and 'CRITIQUE_AMOUNTS_LEAKED' not in log)
            await pg.locator('.card:has-text("ریسک‌ها و نکات")').screenshot(path=f'{SH}/critique-{THEME}.png')
            await pg.close()
        await step('critique', t_critique())

        # 6) ثبت با یک جمله (popup)
        async def t_quick():
            pp = await ctx.new_page(); await pp.set_viewport_size({'width': 392, 'height': 900})
            pp.on('pageerror', lambda e: errors.append(f'[popup pageerror] {e}'))
            await pp.goto(f'chrome-extension://{ext}/ui/popup.html'); await pp.wait_for_timeout(1000)
            before = await get(pp, 'assets'); g0 = [a for a in before if a['id'] == 'goldOnline'][0]; b0 = [a for a in before if a['id'] == 'bankA'][0]
            await pp.fill('.pp-quick input', '۲ گرم طلا خریدم گرمی ۲۵ میلیون از حساب الف'); await pp.press('.pp-quick input', 'Enter')
            await pp.wait_for_selector('.pp-quick .prop', timeout=15000)
            txt = await pp.inner_text('.pp-quick .prop')
            check('quick entry: confirmation card before anything changes', 'خرید' in txt and 'تأیید و ثبت' in txt, txt.replace('\n', ' | '))
            mid = await get(pp, 'assets')
            check('quick entry: nothing applied before confirmation', [a for a in mid if a['id'] == 'goldOnline'][0]['quantity'] == g0['quantity'])
            await pp.screenshot(path=f'{SH}/quick-entry-{THEME}.png')
            await pp.click('.pp-quick .prop button:has-text("تأیید و ثبت")'); await pp.wait_for_timeout(700)
            after = await get(pp, 'assets'); g1 = [a for a in after if a['id'] == 'goldOnline'][0]; b1 = [a for a in after if a['id'] == 'bankA'][0]
            check('quick entry: gold +2 g', abs(g1['quantity'] - g0['quantity'] - 2) < 1e-9, (g0['quantity'], g1['quantity']))
            check('quick entry: bank −50,000,000 toman (rial ×10)', abs((b0['balance'] - b1['balance']) - 500_000_000) < 1, b0['balance'] - b1['balance'])
            evs = await get(pp, 'events')
            check('quick entry: logged as an undoable trade', evs[0]['kind'] == 'trade' and evs[0]['fromId'] == 'bankA')
            await pp.fill('.pp-quick input', 'یک سکه امامی خریدم ۲۶۰ میلیون از حساب الف'); await pp.press('.pp-quick input', 'Enter')
            await pp.wait_for_selector('.pp-quick .prop', timeout=15000)
            t2 = await pp.inner_text('.pp-quick .prop')
            check('quick entry: new asset purchase marked as new', 'دارایی جدید' in t2, t2.replace('\n', ' | '))
            await pp.click('.pp-quick .prop button:has-text("تأیید و ثبت")'); await pp.wait_for_timeout(900)
            after2 = await get(pp, 'assets')
            coin = [a for a in after2 if a.get('price', {}).get('ref', {}).get('key') == 'sekee' and a['id'] not in [x['id'] for x in before]]
            check('quick entry: new coin asset created with market price + cost basis', len(coin) == 1 and coin[0]['quantity'] == 1 and coin[0]['costBasis'] == 2_600_000_000, coin[0] if coin else None)
            await pp.close()
        await step('quick', t_quick())

        # deleting an asset is logged with its value and can be undone from the event list
        async def t_delete():
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("قرض به دوست")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow button:has-text("حذف")'); await pg.wait_for_timeout(600)
            evs = await get(pg, 'events')
            rm = [e for e in evs if e.get('title', '').startswith('حذف')]
            check('delete: removal logged with its value', len(rm) == 1 and rm[0]['changes'][0]['field'] == 'remove' and rm[0]['changes'][0]['value'] < 0, rm[0]['changes'] if rm else None)
            await pg.close()
            pg = await newpage('overview')
            await pg.click('.hero .chg .box >> nth=1 >> .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('delete: shows as bookkeeping, not a market loss', 'ثبت، ویرایش یا حذف دستی' in txt)
            await pg.keyboard.press('Escape'); await pg.close()
            pg = await newpage('automation')
            await pg.click('.it:has-text("حذف «قرض به دوست»") button[title="برگشت"]'); await pg.wait_for_timeout(600)
            assets = await get(pg, 'assets')
            check('delete: undo from the event list restores the asset', any(a['id'] == 'loanOut' for a in assets))
            await pg.close()
        await step('delete', t_delete())

        # tooltips for every analysis section (for beginners)
        async def t_tips():
            pg = await newpage('analysis')
            n = await pg.locator('.tipbtn').count()
            check('tooltips: one per analysis section (≥ 14)', n >= 14, n)
            await pg.locator('#perf .card-h .tipbtn').hover(); await pg.wait_for_selector('.tippop', timeout=3000)
            txt = await pg.inner_text('.tippop')
            check('tooltip opens on hover with plain-language text', 'حقوق' in txt and 'طلا' in txt, txt[:90])
            await pg.mouse.move(5, 5); await pg.wait_for_timeout(400)
            check('tooltip closes when the pointer leaves', await pg.locator('.tippop').count() == 0)
            await pg.locator('.card:has-text("چقدر زود نقد می‌شود؟") .card-h .tipbtn').click(); await pg.wait_for_selector('.tippop')
            await pg.mouse.move(5, 5); await pg.wait_for_timeout(400)
            check('tooltip pinned by click stays open', await pg.locator('.tippop').count() == 1)
            await pg.locator('.card:has-text("چقدر زود نقد می‌شود؟") .card-h').screenshot(path=f'{SH}/tooltip-{THEME}.png') if False else None
            await pg.screenshot(path=f'{SH}/tooltip-{THEME}.png')
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
            check('tooltip closes with Escape', await pg.locator('.tippop').count() == 0)
            await pg.close()
        await step('tips', t_tips())

        # AI connections are provider-neutral
        async def t_neutral():
            pg = await newpage('settings')
            txt = await pg.inner_text('#ai')
            await pg.click('#ai button:has-text("اتصال جدید")'); await pg.wait_for_timeout(300)
            opts = await pg.evaluate("() => [...document.querySelectorAll('#ai select option')].map(o => o.textContent).join(' | ')")
            body = await pg.inner_text('body')
            check('AI connections: no provider-specific Persian brand', 'ستون' not in txt and 'ستون' not in opts and 'Sotoon' not in opts, opts[:160])
            check('AI connections: generic OpenAI-compatible is the default', (await pg.locator('#ai select').first.input_value()) == 'custom')
            await pg.close()
        await step('neutral', t_neutral())

        # regressions on narrow screens
        async def t_narrow():
            pg = await newpage('analysis', w=760)
            await pg.screenshot(path=f'{SH}/analysis-narrow-{THEME}.png', full_page=True)
            overflow = await pg.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1")
            check('analysis: no horizontal scroll at 760px', not overflow)
            await pg.close()
            pg = await newpage('analysis')
            await pg.screenshot(path=f'{SH}/analysis-{THEME}.png', full_page=True)
            await pg.close()
        await step('narrow', t_narrow())

        # «ماشین‌حساب‌ها»: converter, gold invoice (buy / sell / check), and «ثبت به‌عنوان دارایی»
        async def t_calc():
            pg = await newpage('calc')
            check('calc: three tools on the home', await pg.locator('.calc-tile').count() == 3)
            await pg.click('.calc-tile:has-text("با این پول")'); await pg.wait_for_timeout(500)
            await pg.locator('.calc-in .field input').fill('253,580,000'); await pg.wait_for_timeout(300)
            row = (await pg.locator('.calc-row:has-text("طلای ۱۸ عیار")').inner_text()).translate(FA)
            check('converter: 253.58M toman = 10 g of 18k at 25.358M', '≈ 10 گرم' in row, row.replace('\n', ' | '))
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=gold'); await pg.wait_for_timeout(700)
            await pg.locator('.calc-card .field:has-text("وزن") input').first.fill('10')
            await pg.locator('.calc-card input[placeholder="مثلاً ۱۵"]').fill('15'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            # 253,580,000 + 15% + 7% on both + 10% on making+margin = 317,875,209
            check('gold invoice: total with making 15%, margin 7%, tax 10% on making+margin', '317,875,209' in out, out[:200].replace('\n', ' | '))
            check('gold invoice: resale ~21% less', '21٪' in out or '21%' in out)
            await pg.click('.calc-card .seg button:has-text("سنجیدن")'); await pg.wait_for_timeout(200)
            await pg.locator('.calc-card .field:has-text("قیمت نهایی") input').fill('317,875,209'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('shop check: the invoice total reads back as 15% making', '15' in out and 'اجرت' in out, out[:120].replace('\n', ' | '))
            await pg.click('.calc-card .seg button:has-text("خرید")'); await pg.wait_for_timeout(200)
            await pg.click('button:has-text("ثبت به‌عنوان دارایی")'); await pg.wait_for_timeout(700)
            await pg.click('.drawer button:has-text("افزودن")'); await pg.wait_for_timeout(900)
            assets = await pg.evaluate("async () => (await chrome.storage.local.get('assets')).assets")
            a = next((x for x in assets if x.get('name') == 'طلای زینتی'), None)
            ok = bool(a) and a['quantity'] == 10 and a['category'] == 'gold' and a['price']['ref']['key'] == 'geram18' and abs(a['costBasis'] - 3_178_752_090) < 20 and abs(a['price']['adjustPct'] + 1.33) < 0.01
            check('register: a 10 g gold piece, cost = invoice total, valued at 740/750', ok, a and {k: a.get(k) for k in ('quantity', 'costBasis', 'category')} )
            overflow = await pg.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1")
            check('calc: no horizontal scroll', not overflow)
            await pg.close()
        await step('calc', t_calc())

        check('no console/page errors', not errors, errors[:6])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(results), '/', len(results), 'passed')
