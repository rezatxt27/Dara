# E2E: installment loans (وام/طلب قسطی) and «پولش از کجا آمد؟» when adding. Synthetic data only.
# Run: node dev/qa/demo_seed.mjs && python3 dev/qa/loans_test.py [light|dark]
import asyncio, json, os, sys, shutil, pathlib, re, time
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = '/tmp/dara-loans'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(ROOT / 'extension', EXT)
shutil.rmtree('/tmp/pwloans', ignore_errors=True)
THEME = sys.argv[1] if len(sys.argv) > 1 else 'light'
SH = ROOT / 'shots'; os.makedirs(SH, exist_ok=True)
FA = str.maketrans('۰۱۲۳۴۵۶۷۸۹٬٫−', '0123456789,.-')
results = []
def check(name, ok, info=''):
    ok = bool(ok); results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)
async def step(name, coro):
    try: await coro
    except Exception as e: check(name + ' (exception)', False, str(e).split('\n')[0][:220])
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
seed['settings']['theme'] = THEME

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwloans', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        get = lambda pg, k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")
        async def pf(pg):
            return await pg.evaluate("""async () => { const E = await import('/lib/engine.js'); const st = await chrome.storage.local.get(['assets','quotes','settings']);
              const p = E.portfolio(st.assets, st.quotes, st.settings); return { net: p.net, rows: Object.fromEntries(p.rows.map((r) => [r.asset.id, { v: r.value, s: r.signedValue, st: r.status }])) }; }""")
        async def by_name(pg, name):
            return next((x for x in await get(pg, 'assets') if x['name'] == name), None)
        pg = await ctx.new_page()
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
        await pg.goto(f'chrome-extension://{ext}/ui/app.html#/assets'); await pg.wait_for_timeout(1300)
        D = '.drawer '

        async def t_new_loan():
            net0 = (await pf(pg))['net']; b0 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankB')['balance']
            await pg.click('button:has-text("دارایی جدید")'); await pg.wait_for_timeout(500)
            await pg.click(D + '.catbtn:has-text("بدهی")'); await pg.wait_for_timeout(300)
            check('debt defaults to «وام قسطی»', await pg.locator(D + '.mode.on:has-text("وام قسطی")').count() == 1)
            await pg.fill(D + '.field:has-text("نام دارایی") input', 'وام آزمایشی')
            await pg.fill(D + '.field:has-text("مبلغ وام") input', '100,000,000')
            await pg.fill(D + '.field:has-text("نرخ سود سالانه") input', '18')
            await pg.fill(D + '.field:has-text("تعداد اقساط") input', '12'); await pg.wait_for_timeout(300)
            txt = await pg.inner_text(D + '.grid3')
            check('editor shows the bank-formula installment', '9' in txt.translate(FA) and 'قسط ماهانه' in txt, txt.replace('\n', ' | ')[:120])
            await pg.select_option(D + '.field:has-text("قسط‌ها از کدام حساب") select', 'bankA')
            await pg.click(D + '.seg >> text=به حسابم واریز شد'); await pg.wait_for_timeout(200)
            await pg.select_option(D + '.field:has-text("واریز به حساب") select', 'bankB')
            await pg.screenshot(path=f'{SH}/loan-editor-{THEME}.png', full_page=True)
            await pg.click(D + 'button:has-text("افزودن")'); await pg.wait_for_timeout(800)
            a = await by_name(pg, 'وام آزمایشی'); ev = (await get(pg, 'events'))[0]
            b1 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankB')['balance']
            check('loan saved with its terms', a and a['mode'] == 'loan' and a['loan']['amount'] == 1_000_000_000 and a['loan']['months'] == 12 and a['loan']['account'] == 'bankA', a and a.get('loan'))
            check('loan money went into the chosen account', b1 - b0 == 1_000_000_000 and ev.get('fund', {}).get('accountId') == 'bankB', (b1 - b0, ev.get('title')))
            net1 = (await pf(pg))['net']
            check('taking the loan leaves net worth unchanged', abs(net1 - net0) < 2_000_000, net1 - net0)
            row = await pg.inner_text('tr.r:has-text("وام آزمایشی")')
            check('row shows installment and progress', 'قسط' in row and '0 از 12' in row.translate(FA), row.replace('\n', ' | ')[:160])
        await step('new loan', t_new_loan())

        async def t_schedule_and_pay():
            await pg.click('tr.r:has-text("وام آزمایشی")'); await pg.wait_for_timeout(400)
            n = await pg.locator('tr.xrow .sched tbody tr').count()
            check('schedule lists every installment', n == 12, n)
            await pg.screenshot(path=f'{SH}/loan-row-{THEME}.png', full_page=True)
            id_ = (await by_name(pg, 'وام آزمایشی'))['id']
            v0 = (await pf(pg))['rows'][id_]['v']; a0 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankA')['balance']
            await pg.click('tr.xrow button:has-text("پرداخت اضافه یا تسویه")'); await pg.wait_for_timeout(300)
            await pg.fill('.modal .field:has-text("مبلغ") input >> nth=0', '10,000,000'); await pg.wait_for_timeout(200)
            hint = await pg.inner_text('.modal')
            check('pay modal previews fewer installments', 'قسط می‌ماند' in hint and 'به‌جای' in hint, hint[-120:].replace('\n', ' '))
            await pg.select_option('.modal select', 'bankA'); await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(700)
            v1 = (await pf(pg))['rows'][id_]['v']; a1 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankA')['balance']
            ev = (await get(pg, 'events'))[0]
            check('extra payment lowers the debt by exactly that much', abs((v0 - v1) - 100_000_000) < 50_000 and a0 - a1 == 100_000_000, (v0 - v1, a0 - a1))
            check('extra payment is a transfer (account → loan)', ev['fromId'] == 'bankA' and ev['toId'] == id_, (ev.get('fromId'), ev.get('toId')))
            await pg.click('tr.xrow button:has-text("پرداخت اضافه یا تسویه")'); await pg.wait_for_timeout(300)
            await pg.click('.modal .seg >> text=تسویه کامل'); await pg.select_option('.modal select', 'bankA')
            await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(700)
            P = await pf(pg)
            check('settled loan is zero and marked «تسویه شده»', P['rows'][id_]['v'] == 0 and P['rows'][id_]['st'] == 'settled' and await pg.locator('tr.r:has-text("وام آزمایشی") .pill:has-text("تسویه شده")').count() == 1, P['rows'][id_])
            await pg.click('tr.r:has-text("وام آزمایشی")'); await pg.wait_for_timeout(200)
        await step('schedule & pay', t_schedule_and_pay())

        async def t_old_loan():
            await pg.click('button:has-text("دارایی جدید")'); await pg.wait_for_timeout(500)
            await pg.click(D + '.catbtn:has-text("بدهی")'); await pg.wait_for_timeout(200)
            await pg.fill(D + '.field:has-text("نام دارایی") input', 'وام قدیمی')
            await pg.fill(D + '.field:has-text("مبلغ وام") input', '60,000,000')
            await pg.fill(D + '.field:has-text("نرخ سود سالانه") input', '0')
            await pg.fill(D + '.field:has-text("تعداد اقساط") input', '12')
            await pg.click(D + 'button:has-text("افزودن")'); await pg.wait_for_timeout(700)
            a = await by_name(pg, 'وام قدیمی')
            # move its first installment five months back the way the editor would (terms change → correction)
            await pg.evaluate("""async (id) => { const { act } = await import('/ui/actions.js'); const J = await import('/lib/jalali.js');
              const a = (await chrome.storage.local.get('assets')).assets.find((x) => x.id === id);
              await act.saveAsset({ ...a, loan: { ...a.loan, firstDue: J.addJMonthsIso(J.todayIso(), -5) } }); }""", a['id'])
            await pg.wait_for_timeout(600)
            a = await by_name(pg, 'وام قدیمی'); P = await pf(pg)
            row = await pg.inner_text('tr.r:has-text("وام قدیمی")')
            check('old loan: past installments counted as paid, none replayed', '6 از 12' in row.translate(FA) and abs(P['rows'][a['id']]['v'] - 300_000_000) < 1 and a['loan']['lastRun'], row.replace('\n', ' | ')[:120])
            ev = (await get(pg, 'events'))[0]
            check('changing loan terms is logged as a correction', ev.get('prev') and any(c['field'] == 'value' for c in ev['changes']), ev.get('title'))
        await step('old loan', t_old_loan())

        async def t_funded_buy():
            b0 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankB')['balance']; net0 = (await pf(pg))['net']
            await pg.click('button:has-text("دارایی جدید")'); await pg.wait_for_timeout(500)
            await pg.click(D + '.catbtn:has-text("طلا و سکه")'); await pg.wait_for_timeout(300)
            await pg.click(D + '.opt:has-text("ربع سکه")'); await pg.wait_for_timeout(300)
            await pg.fill(D + '.field:has-text("نام دارایی") input', 'ربع سکه آزمایشی')
            await pg.fill(D + '.field:has-text("مقدار") input', '2'); await pg.wait_for_timeout(300)
            await pg.click(D + '.seg >> text=از حسابم پرداختم'); await pg.wait_for_timeout(200)
            await pg.select_option(D + '.field:has-text("پرداخت از حساب") select', 'bankB'); await pg.wait_for_timeout(200)
            amt = await pg.input_value(D + '.field:has-text("مبلغ پرداختی") input')
            check('amount paid defaults to today\'s value', amt.translate(FA).replace(',', '') == '146000000', amt)
            await pg.fill(D + '.field:has-text("مبلغ پرداختی") input', '150,000,000')
            await pg.click(D + 'button:has-text("افزودن")'); await pg.wait_for_timeout(800)
            a = await by_name(pg, 'ربع سکه آزمایشی'); b1 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankB')['balance']
            check('bought from an account: account debited, cost recorded', b0 - b1 == 1_500_000_000 and a['costBasis'] == 1_500_000_000, (b0 - b1, a.get('costBasis')))
            net1 = (await pf(pg))['net']
            check('net worth moves only by the premium paid', abs((net1 - net0) - (1_460_000_000 - 1_500_000_000)) < 2_000_000, net1 - net0)
            # attribution sees no new money
            ext = await pg.evaluate("""async () => { const E = await import('/lib/engine.js'); const st = await chrome.storage.local.get(['assets','quotes','settings','snapshots','events']);
              const ev = st.events[0]; const ef = E.eventEffects([ev], { date: '2000-01-01', snap: { at: 1 } }, Object.fromEntries(st.assets.map((a) => [a.id, a])));
              return ef.dated.reduce((t, x) => t + x.amount, 0); }""")
            check('funded purchase is not counted as new money', abs(ext) < 1, ext)
        await step('funded buy', t_funded_buy())

        async def t_undo_funded():
            b0 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankB')['balance']
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/automation'); await pg.wait_for_timeout(1200)
            check('automation page lists installment loans', await pg.locator('.card:has-text("وام‌ها و طلب‌های قسطی") .it').count() >= 2)
            await pg.screenshot(path=f'{SH}/loan-automation-{THEME}.png', full_page=True)
            await pg.click('.card:has-text("گزارش رویدادها") .it:has-text("افزودن «ربع سکه آزمایشی»") button[title="برگشت"]'); await pg.wait_for_timeout(800)
            A = await get(pg, 'assets'); evs = await get(pg, 'events')
            b1 = next(x for x in A if x['id'] == 'bankB')['balance']
            check('undoing a funded add removes it and refunds the account', not any(x['name'] == 'ربع سکه آزمایشی' for x in A) and b1 - b0 == 1_500_000_000, b1 - b0)
            check('the original entry is marked reversed (no second undo)', any(e.get('reversedBy') for e in evs) and await pg.locator('.it:has-text("افزودن «ربع سکه آزمایشی» از") button[title="برگشت"]').count() == 0)
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/assets'); await pg.wait_for_timeout(1000)
        await step('undo funded', t_undo_funded())

        async def t_receivable():
            a0 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankA')['balance']
            await pg.click('button:has-text("دارایی جدید")'); await pg.wait_for_timeout(500)
            await pg.click(D + '.catbtn:has-text("مطالبات")'); await pg.wait_for_timeout(200)
            await pg.click(D + '.mode:has-text("طلب قسطی")'); await pg.wait_for_timeout(200)
            await pg.fill(D + '.field:has-text("نام دارایی") input', 'قرض قسطی به دوست')
            await pg.fill(D + '.field:has-text("مبلغ قرض") input', '24,000,000')
            await pg.fill(D + '.field:has-text("نرخ سود سالانه") input', '0')
            await pg.fill(D + '.field:has-text("تعداد اقساط") input', '6')
            await pg.select_option(D + '.field:has-text("قسط‌ها به کدام حساب") select', 'bankA')
            await pg.click(D + '.seg >> text=از حسابم پرداختم'); await pg.select_option(D + '.field:has-text("پرداخت از حساب") select', 'bankA')
            await pg.click(D + 'button:has-text("افزودن")'); await pg.wait_for_timeout(800)
            a = await by_name(pg, 'قرض قسطی به دوست'); a1 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankA')['balance']
            P = await pf(pg)
            check('receivable on installments: lent from the account, counted as an asset', a and a0 - a1 == 240_000_000 and P['rows'][a['id']]['s'] > 0, (a0 - a1, P['rows'].get(a['id'] if a else '')))
            await pg.screenshot(path=f'{SH}/loan-assets-{THEME}.png', full_page=True)
        await step('receivable', t_receivable())

        for route in ['overview', 'analysis', 'assistant']:
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/{route}'); await pg.wait_for_timeout(900)
        check('no page errors', not errors, errors[:4])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(results), '/', len(results), 'passed')
