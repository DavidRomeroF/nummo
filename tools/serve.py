#!/usr/bin/env python3
"""Servidor local de desarrollo (solo en este equipo: 127.0.0.1).

Uso:  python3 tools/serve.py        → http://127.0.0.1:8080/app/   (app)
                                      http://127.0.0.1:8080/tests/ (tests)

- Sirve la carpeta del proyecto sin caché HTTP, para ver siempre la última versión.
- Añade `?nosw` a la URL de la app para desactivar el service worker mientras desarrollas.
"""
import functools
import http.server
import os
from pathlib import Path

PORT = int(os.environ.get("PORT", "8080"))
ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Sirviendo {ROOT} en http://127.0.0.1:{PORT}/app/", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
