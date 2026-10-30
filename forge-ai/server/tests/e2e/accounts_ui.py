"""E2E: first-run setup, persistence of conversations on the server, admin, isolation, logout.
Needs: API on 8787 with an EMPTY database, UI on 5173, mock LLM on 9999 (server/tests/fixtures/mock-llm.mjs)."""
import re
from playwright.sync_api import sync_playwright

UI = 'http://localhost:5173'
res = []
def check(c, name): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + name, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 860})
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(UI)
    pg.get_by_role('heading', name='Configurar o Forge').wait_for(timeout=15000)
    check(True, 'fresh server shows first-run admin setup')
    pg.screenshot(path='/home/user/forge-ai/docs/phase4-setup.png')
    pg.get_by_label('Nome').fill('Ana Teste'); pg.get_by_label('Email').fill('ana@forge.dev'); pg.get_by_label('Palavra-passe', exact=True).fill('ana-password-1')
    pg.get_by_role('button', name='Criar conta de administrador').click()
    pg.get_by_role('button', name='Menu da conta').wait_for(timeout=15000)
    check('Ana Teste' in pg.get_by_role('button', name='Menu da conta').inner_text(), 'signed in after setup; sidebar shows the user')
    check(pg.get_by_text('demo-app').count() > 0, 'first admin adopts existing projects')
    # point this account at the mock LLM
    r = pg.request.post(UI + '/api/config', data={'provider': 'openai', 'model': 'mock', 'apiKey': 'sk-test-1234', 'baseUrl': 'http://127.0.0.1:9999/v1'})
    check(r.ok, 'per-user AI config saved')
    pg.reload(); pg.get_by_role('button', name='Menu da conta').wait_for(timeout=15000)
    box = pg.get_by_role('textbox').last
    box.fill('olá do teste de contas'); box.press('Enter')
    pg.get_by_text(re.compile(r'ok \(\d+ messages')).first.wait_for(timeout=30000)
    check(True, 'agent runs for the signed-in user')
    pg.wait_for_timeout(1500)
    ls = pg.evaluate("localStorage.getItem('forge-ai-state-v1') || ''")
    check('olá do teste' not in ls, 'signed-in conversations are not stored in localStorage')
    pg.reload(); pg.get_by_role('button', name='Menu da conta').wait_for(timeout=15000)
    item = pg.get_by_text('olá do teste de contas').first
    item.wait_for(timeout=10000); item.click()
    check(pg.get_by_text(re.compile(r'ok \(\d+ messages')).count() > 0, 'conversation reloaded from the server (with the reply)')
    # usage
    pg.get_by_role('button', name='Menu da conta').click(); pg.get_by_role('menuitem', name='Utilização').click()
    pg.get_by_text('Tokens de entrada').first.wait_for(timeout=10000)
    check(pg.get_by_text('openai/mock').count() > 0, 'usage tab shows the run by model')
    pg.screenshot(path='/home/user/forge-ai/docs/phase4-usage.png')
    # admin: create bob
    pg.get_by_role('tab', name='Utilizadores').click()
    pg.get_by_label('Nome').fill('Bob'); pg.get_by_label('Email').fill('bob@forge.dev'); pg.get_by_label('Palavra-passe inicial').fill('bob-password-1')
    pg.get_by_role('button', name='Criar', exact=True).click()
    pg.get_by_text('bob@forge.dev').first.wait_for(timeout=10000)
    check(True, 'admin creates a user from the UI')
    pg.screenshot(path='/home/user/forge-ai/docs/phase4-admin.png')
    pg.get_by_role('tab', name='Conta').click()
    pg.get_by_role('button', name='Terminar sessão').click()
    pg.get_by_role('heading', name='Entrar no Forge').wait_for(timeout=10000)
    check(True, 'logout returns to the sign-in screen')
    check('olá do teste' not in pg.evaluate("localStorage.getItem('forge-ai-state-v1') || ''"), 'nothing of the account left in the browser after logout')

    # second user, separate browser
    ctx2 = b.new_context(viewport={'width': 1400, 'height': 860}); q = ctx2.new_page(); q.on('pageerror', lambda e: errs.append(str(e)))
    q.goto(UI); q.get_by_role('heading', name='Entrar no Forge').wait_for(timeout=15000)
    check(q.get_by_role('tab', name='Criar conta').count() == 0, 'public signup hidden when closed')
    q.get_by_label('Email').fill('bob@forge.dev'); q.get_by_label('Palavra-passe', exact=True).fill('wrong-password')
    q.get_by_role('button', name='Entrar', exact=True).click()
    q.get_by_role('alert').wait_for(timeout=10000)
    check('incorretos' in q.get_by_role('alert').inner_text(), 'wrong password shows an error')
    q.get_by_label('Palavra-passe', exact=True).fill('bob-password-1'); q.get_by_role('button', name='Entrar', exact=True).click()
    q.get_by_role('button', name='Menu da conta').wait_for(timeout=15000)
    q.wait_for_timeout(1000)
    check('Bob' in q.get_by_role('button', name='Menu da conta').inner_text(), 'second user signs in')
    check(q.get_by_text('olá do teste de contas').count() == 0, "second user doesn't see the admin's conversations")
    check(q.get_by_text('demo-app').count() == 0 and q.get_by_text(re.compile(r'projeto-\d+')).count() > 0, "second user sees only their own starter project")
    check(q.get_by_role('dialog', name='Definições').count() == 1, 'new user without AI provider is asked to configure one')
    q.get_by_role('button', name='Fechar').click()
    q.get_by_role('button', name='Menu da conta').click()
    check(q.get_by_role('menuitem', name='Utilizadores').count() == 0, 'non-admin has no user management')

    m = b.new_context(viewport={'width': 390, 'height': 800}).new_page(); m.goto(UI)
    m.get_by_role('heading', name='Entrar no Forge').wait_for(timeout=15000)
    m.screenshot(path='/home/user/forge-ai/docs/phase4-login-mobile.png')
    check(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
print('RESULT', sum(res), '/', len(res))
