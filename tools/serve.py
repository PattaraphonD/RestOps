"""Local preview server for the app folder (correct MIME types for ES modules and the manifest).

    python tools/serve.py          # http://localhost:5173
"""
import http.server, socketserver, sys
from functools import partial
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
APP = Path(__file__).resolve().parent.parent / "app"

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                      ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
                      ".png": "image/png", ".html": "text/html", ".json": "application/json"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), partial(Handler, directory=str(APP))) as httpd:
    print(f"Serving {APP} at http://localhost:{PORT}", flush=True)
    httpd.serve_forever()
