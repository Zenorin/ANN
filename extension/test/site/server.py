import http.server, json, os, sys, urllib.parse
ROOT = os.path.dirname(os.path.abspath(__file__))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def _json(self, obj, status=200):
        b = json.dumps(obj).encode(); self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/api/products': return self._json({'products': [{'id': 1, 'name': 'AI 포스터', 'price': 19000}, {'id': 2, 'name': 'AI 티셔츠', 'price': 29000}]})
        if u.path == '/api/config': return self._json({'currency': 'KRW', 'features': ['ai-poster']})
        if u.path.startswith('/_next/static/testbuild123/chunks/react'):
            # React UMD bundles are served straight from node_modules (npm install in extension/test)
            name = u.path.rsplit('/', 1)[1]
            pkg = 'react-dom' if name.startswith('react-dom') else 'react'
            f = os.path.join(ROOT, '..', 'node_modules', pkg, 'umd', name)
            if not os.path.exists(f): f = os.path.join(ROOT, '..', '..', '..', 'node_modules', pkg, 'umd', name)
            if os.path.exists(f):
                b = open(f, 'rb').read(); self.send_response(200); self.send_header('Content-Type', 'text/javascript'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
            self.send_error(404); return
        if u.path == '/_next/image':
            q = urllib.parse.parse_qs(u.query); self.path = q.get('url', ['/img/hero.png'])[0]; return super().do_GET()
        if u.path == '/': self.path = '/index.html'
        elif u.path in ('/about', '/contact'): self.path = u.path + '.html'
        elif u.path.startswith('/products/'): self.path = '/about.html'
        return super().do_GET()
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n)
        return self._json({'ok': True})
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8123), H).serve_forever()
