"""Log in as the admin, configure Ollama in Settings, ask the AI a question and capture the answer."""
import sys, time
from playwright.sync_api import sync_playwright
EMAIL, PW = sys.argv[1], sys.argv[2]
Q = 'Consegues criar uma app complexa? Responde em português.'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-gpu', '--disable-dev-shm-usage'])
    pg = b.new_page(viewport={'width': 1300, 'height': 820})
    pg.goto('http://localhost:5173')
    pg.get_by_role('heading', name='Entrar no Forge').wait_for(timeout=20000)
    pg.get_by_label('Email').fill(EMAIL); pg.get_by_label('Palavra-passe', exact=True).fill(PW)
    pg.get_by_role('button', name='Entrar', exact=True).click()
    pg.get_by_role('button', name='Menu da conta').wait_for(timeout=20000)
    print('LOGGED IN as', pg.get_by_role('button', name='Menu da conta').inner_text().replace('\n', ' | '), flush=True)
    pg.wait_for_timeout(2500)
    if pg.get_by_role('dialog', name='Definições').count() == 0:
        pg.get_by_role('button', name='Menu da conta').click(); pg.get_by_role('menuitem', name='Modelo de IA').click()
    pg.get_by_role('button', name='Ollama (local)').click()
    pg.get_by_label('Modelo').fill('qwen2.5:1.5b')
    pg.get_by_role('button', name='Guardar e ligar').click()
    pg.wait_for_timeout(1500)
    print('CONFIG', pg.request.get('http://localhost:5173/api/config').json(), flush=True)
    pg.get_by_role('button', name='New Chat').click()
    box = pg.get_by_role('textbox').last
    box.fill(Q); box.press('Enter')
    t0 = time.time()
    pg.get_by_text('Tarefa concluída').first.wait_for(timeout=480000)
    print(f'ANSWERED in {time.time()-t0:.0f}s', flush=True)
    pg.wait_for_timeout(1500)
    pg.screenshot(path='/home/user/forge-ai/docs/teste-ia-resposta.png')
    print('ANSWER:', pg.locator('main').inner_text()[-1500:], flush=True)
    b.close()
