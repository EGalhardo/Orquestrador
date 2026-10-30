"""Regression: login must work when Forge runs inside a THIRD-PARTY iframe with third-party cookies blocked
(this is how hosted previews show the app). Parent page: 127.0.0.1:8899  → iframe: localhost:5173 (different site).
Usage: iframe_login.py EMAIL PASSWORD [--hostile]
  --hostile: also block localStorage in the page and strip the Authorization header (like some reverse proxies)."""
import sys, threading, http.server, functools
from playwright.sync_api import sync_playwright
EMAIL, PW = sys.argv[1], sys.argv[2]
HOSTILE = '--hostile' in sys.argv
HTML = b'<!doctype html><title>host</title><body style="margin:0"><iframe id="f" src="http://localhost:5173" style="width:100vw;height:100vh;border:0"></iframe></body>'
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self): self.send_response(200); self.send_header('content-type', 'text/html'); self.end_headers(); self.wfile.write(HTML)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8899), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
res = []
def check(c, n): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n, flush=True)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--test-third-party-cookie-phaseout'])  # block third-party cookies
        pg = b.new_page(viewport={'width': 1300, 'height': 820})
        if HOSTILE:
            pg.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError') } })")
            def strip(route):
                h = {k: v for k, v in route.request.headers.items() if k.lower() != 'authorization'}
                route.continue_(headers=h)
            pg.route('**/api/**', strip)
            print('MODE hostile: cookies blocked + localStorage blocked + Authorization stripped', flush=True)
        pg.goto('http://127.0.0.1:8899/')
        f = pg.frame_locator('#f')
        f.get_by_role('heading', name='Entrar no Forge').wait_for(timeout=20000)
        check(True, 'login screen shown inside third-party iframe')
        f.get_by_label('Email').fill(EMAIL); f.get_by_label('Palavra-passe', exact=True).fill(PW)
        f.get_by_role('button', name='Entrar', exact=True).click()
        f.get_by_role('button', name='Menu da conta').wait_for(timeout=20000)
        check('edlasiogalhardo' in f.get_by_role('button', name='Menu da conta').inner_text(), 'login succeeds inside iframe (cookies blocked)')
        frame = [x for x in pg.frames if 'localhost:5173' in x.url][0]
        check(frame.evaluate("document.cookie.includes('forge_session')") is False, 'works without any cookie (HttpOnly/blocked), via bearer token')
        check(f.get_by_text('Consegues criar uma app complexa?').count() > 0, "user's saved conversations load")
        check(f.get_by_text('demo-app').count() > 0, "user's projects load")
        if not HOSTILE:
            pg.reload(); f = pg.frame_locator('#f')
            f.get_by_role('button', name='Menu da conta').wait_for(timeout=20000)
            check(True, 'session survives a page reload')
        else:
            box = f.get_by_role('textbox').last
            check(box.count() > 0, 'app usable after login without storage/cookies/Authorization')
        pg.screenshot(path='/tmp/iframe-login.png')
        f.get_by_role('button', name='Menu da conta').click(); f.get_by_role('menuitem', name='Terminar sessão').click()
        f.get_by_role('heading', name='Entrar no Forge').wait_for(timeout=10000)
        frame = [x for x in pg.frames if 'localhost:5173' in x.url][0]
        if not HOSTILE: check(frame.evaluate("localStorage.getItem('forge-session-token')") is None, 'logout removes the token')
        pg.reload(); f = pg.frame_locator('#f')
        f.get_by_role('heading', name='Entrar no Forge').wait_for(timeout=10000)
        check(True, 'after logout + reload, stays signed out')
        f.get_by_label('Email').fill(EMAIL); f.get_by_label('Palavra-passe', exact=True).fill('senha-errada')
        f.get_by_role('button', name='Entrar', exact=True).click()
        f.get_by_role('alert').wait_for(timeout=10000)
        check('incorretos' in f.get_by_role('alert').inner_text(), 'wrong password shows a visible error (never silent)')
        b.close()
finally:
    srv.shutdown()
print('RESULT', sum(res), '/', len(res))
