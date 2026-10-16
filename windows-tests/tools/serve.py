import http.server, os, sys, functools
root = sys.argv[1]; port = int(sys.argv[2])
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm':'application/wasm', '.js':'text/javascript', '.webp':'image/webp', '.woff2':'font/woff2', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.data':'application/octet-stream', '.json':'application/json'}
    def send_head(self):
        p = self.translate_path(self.path)
        if self.path.split('?')[0] == '/healthz':
            self.send_response(200); self.send_header('Content-Type','text/plain'); self.send_header('Content-Length','3'); self.end_headers(); self.wfile.write(b'ok\n'); return None
        if not os.path.exists(p) and not self.path.startswith('/assets/'):
            self.path = '/index.html'
        return super().send_head()
    def end_headers(self):
        self.send_header('Cache-Control','no-store'); super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=root)).serve_forever()
