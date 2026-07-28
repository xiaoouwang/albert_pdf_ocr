#!/usr/bin/env python3
"""Serve the static Albert OCR UI and proxy /proxy/v1/* to Albert API (CORS)."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ALBERT_BASE = "https://albert.api.etalab.gouv.fr"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.startswith("/proxy/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Authorization, Content-Type"
            )
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        if not self.path.startswith("/proxy/"):
            self.send_error(404)
            return

        upstream_path = self.path[len("/proxy") :]
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        auth = self.headers.get("Authorization", "")

        request = urllib.request.Request(
            f"{ALBERT_BASE}{upstream_path}",
            data=body,
            method="POST",
            headers={
                "Authorization": auth,
                "Content-Type": self.headers.get("Content-Type", "application/json"),
                "Accept": "application/json",
                "User-Agent": "AlbertOCRWeb/1.0",
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = response.read()
                self.send_response(response.status)
                self.send_header(
                    "Content-Type",
                    response.headers.get("Content-Type", "application/json"),
                )
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            self.send_response(exc.code)
            self.send_header(
                "Content-Type",
                exc.headers.get("Content-Type", "application/json")
                if exc.headers
                else "application/json",
            )
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:  # noqa: BLE001
            payload = json.dumps({"detail": str(exc)}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def log_message(self, format: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Albert OCR static UI + API proxy")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Albert OCR UI: http://{args.host}:{args.port}/")
    print(f"Proxying /proxy/v1/* → {ALBERT_BASE}/v1/*")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
