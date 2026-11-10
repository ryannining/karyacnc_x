"""
Tiny static server + RajaOngkir proxy for KaryaCNC Invoice Generator.

Cara pakai:
    python server.py

Lalu buka di browser:
    http://localhost:8000/invoice.html

API endpoint proxy:
    GET  /api/destination?search=<query>&limit=10&offset=0
    POST /api/cost  (form-urlencoded: origin, destination, weight, courier, price)

API key hardcoded di bawah ini. JANGAN di-share file ini kalau tidak ingin
key tersebar.
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------- Konfigurasi ----------
RAJAONGKIR_KEY = "87f1bef2655d3725f9f68d478668887c"
RAJAONGKIR_BASE = "https://rajaongkir.komerce.id/api/v1"
PORT = 8000
# Direktori file static (HTML, CSS, JS, dsb)
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

# Origin default: kelurahan Sukorejo, kecamatan Gunungpati, Semarang (50221)
# ID dari hasil search "50221" di RajaOngkir V2.
DEFAULT_ORIGIN_ID = 64967
DEFAULT_ORIGIN_LABEL = "SUKOREJO, GUNUNGPATI, SEMARANG"


# ---------- Helpers ----------
def http_json(url, method="GET", data=None, headers=None, timeout=20):
    """Lakukan HTTP request dan kembalikan JSON body + status."""
    if headers is None:
        headers = {}
    headers.setdefault("key", RAJAONGKIR_KEY)
    headers.setdefault("User-Agent", "KaryaCNC-Invoice/1.0")
    if data is not None and method != "GET":
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    body = None
    if data is not None:
        if isinstance(data, dict):
            body = urllib.parse.urlencode(data).encode("utf-8")
        else:
            body = data
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"meta": {"message": raw or e.reason, "code": e.code, "status": "error"}}
        return e.code, payload
    except Exception as e:
        return 500, {"meta": {"message": str(e), "code": 500, "status": "error"}}


# ---------- HTTP Handler ----------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # CORS untuk development (aman karena local)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path):
        # Default ke invoice.html
        if path == "/" or path == "":
            path = "/invoice.html"
        full = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        # Batasi hanya file dalam STATIC_DIR (anti path traversal)
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self.send_error(404, "Not found")
            return
        ext = os.path.splitext(full)[1].lower()
        mime = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/origin":
            return self._send_json(200, {
                "meta": {"message": "OK", "code": 200, "status": "success"},
                "data": {"id": DEFAULT_ORIGIN_ID, "label": DEFAULT_ORIGIN_LABEL},
            })
        if parsed.path == "/api/destination":
            qs = urllib.parse.parse_qs(parsed.query)
            search = (qs.get("search", [""])[0] or "").strip()
            limit = int(qs.get("limit", ["10"])[0] or "10")
            offset = int(qs.get("offset", ["0"])[0] or "0")
            if not search:
                return self._send_json(400, {
                    "meta": {"message": "Parameter 'search' wajib", "code": 400, "status": "error"},
                    "data": None,
                })
            url = f"{RAJAONGKIR_BASE}/destination/domestic-destination"
            url += "?" + urllib.parse.urlencode({
                "search": search, "limit": limit, "offset": offset,
            })
            status, payload = http_json(url, "GET")
            return self._send_json(status, payload)
        return self._send_static(parsed.path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/cost":
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length).decode("utf-8") if length else ""
            try:
                data = urllib.parse.parse_qs(raw) if raw else {}
            except Exception:
                return self._send_json(400, {
                    "meta": {"message": "Body tidak valid", "code": 400, "status": "error"},
                    "data": None,
                })

            # Normalisasi ke single value
            def get(k):
                v = data.get(k, [""])
                return v[0] if v else ""

            origin = get("origin")
            destination = get("destination")
            weight = get("weight")
            courier = get("courier")
            price = get("price") or "lowest"

            if not (origin and destination and weight and courier):
                return self._send_json(400, {
                    "meta": {"message": "Field origin, destination, weight, courier wajib",
                             "code": 400, "status": "error"},
                    "data": None,
                })

            url = f"{RAJAONGKIR_BASE}/calculate/domestic-cost"
            status, payload = http_json(url, "POST", data={
                "origin": origin, "destination": destination,
                "weight": weight, "courier": courier, "price": price,
            })
            return self._send_json(status, payload)
        return self._send_static(parsed.path)


def main():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Server jalan di http://localhost:{PORT}/invoice.html")
    print(f"Static dir: {STATIC_DIR}")
    print("Tekan Ctrl+C untuk berhenti.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBerhenti.")
        httpd.server_close()


if __name__ == "__main__":
    main()
