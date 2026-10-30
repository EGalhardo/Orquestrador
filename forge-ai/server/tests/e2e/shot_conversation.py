"""Log in and screenshot a conversation by title. Usage: shot_conversation.py EMAIL PW TITLE OUT.png"""
import sys
from playwright.sync_api import sync_playwright
email, pw, title, out = sys.argv[1:5]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1300, 'height': 820})
    pg.goto('http://localhost:5173'); pg.get_by_label('Email').fill(email); pg.get_by_label('Palavra-passe', exact=True).fill(pw)
    pg.get_by_role('button', name='Entrar', exact=True).click(); pg.get_by_role('button', name='Menu da conta').wait_for(timeout=20000)
    pg.get_by_text(title).first.click(); pg.wait_for_timeout(1500)
    pg.screenshot(path=out); b.close()
