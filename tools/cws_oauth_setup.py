#!/usr/bin/env python3
"""Einmalige OAuth-Einrichtung fuer die Chrome-Web-Store-API (v2).

Holt einen refresh_token und legt ihn samt Kennungen in
~/.aionda-cws/credentials.json ab (Ordner 700, Datei 600). Die Datei liegt
bewusst NICHT im Repo.

Vorher im Google-Cloud-Projekt des Publisher-Kontos:
  1. "Chrome Web Store API" aktivieren
  2. OAuth-Zustimmungsbildschirm anlegen (External), eigene Adresse als Testnutzer
  3. OAuth-Client "Webanwendung" anlegen und als autorisierte Weiterleitungs-URI
     http://localhost:8790/ eintragen (die Doku nennt den OAuth-Playground; die
     Schleifenadresse nehmen wir, damit dieses Skript den Code selbst abholt und
     niemand einen Token durch die Gegend kopieren muss)

Aufruf:
  python3 tools/cws_oauth_setup.py --client-id ... --client-secret ... \
      [--publisher-id ...] [--extension-id ...]

Danach zeigt es die URL an, die im Browser des PUBLISHER-Kontos zu oeffnen ist.
"""

import argparse
import http.server
import json
import os
import stat
import sys
import threading
import urllib.parse
import urllib.request

SCOPE = "https://www.googleapis.com/auth/chromewebstore"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
PORT = 8790
REDIRECT = f"http://localhost:{PORT}/"

# Aionda Mail im Chrome Web Store. Publisher-ID steht im Dashboard unter
# Publisher > Settings und ist derselbe Wert wie im Devconsole-Pfad.
STANDARD_EXTENSION_ID = "fihbdpohplcdnhllhliaeapefmmpcdjo"
STANDARD_PUBLISHER_ID = "e9e716d2-132f-4447-8f40-a406a37a335c"

ZIEL = os.path.expanduser("~/.aionda-cws/credentials.json")


class Abholer(http.server.BaseHTTPRequestHandler):
    code = None
    fehler = None

    def do_GET(self):  # noqa: N802 - von der Basisklasse vorgegeben
        felder = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        Abholer.code = (felder.get("code") or [None])[0]
        Abholer.fehler = (felder.get("error") or [None])[0]
        text = "Fertig, dieses Fenster kann zu." if Abholer.code else f"Fehlgeschlagen: {Abholer.fehler}"
        antwort = f"<!doctype html><meta charset=utf-8><p>{text}</p>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(antwort)))
        self.end_headers()
        self.wfile.write(antwort)

    def log_message(self, *_args):
        pass  # kein Zugriffsprotokoll auf der Konsole


def hole_code(client_id: str) -> str:
    frage = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    })
    print("\nDiese URL im Browser des PUBLISHER-Kontos oeffnen:\n")
    print(f"{AUTH_URL}?{frage}\n")
    print(f"Ich warte auf die Weiterleitung nach {REDIRECT} ...")

    server = http.server.HTTPServer(("127.0.0.1", PORT), Abholer)
    faden = threading.Thread(target=server.serve_forever, daemon=True)
    faden.start()
    while Abholer.code is None and Abholer.fehler is None:
        threading.Event().wait(0.5)
    server.shutdown()

    if Abholer.code is None:
        raise SystemExit(f"Zustimmung fehlgeschlagen: {Abholer.fehler}")
    return Abholer.code


def tausche_code(client_id: str, client_secret: str, code: str) -> dict:
    daten = urllib.parse.urlencode({
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT,
        "grant_type": "authorization_code",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=daten)) as antwort:
        return json.loads(antwort.read())


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--client-id", required=True)
    p.add_argument("--client-secret", required=True)
    p.add_argument("--publisher-id", default=STANDARD_PUBLISHER_ID)
    p.add_argument("--extension-id", default=STANDARD_EXTENSION_ID)
    a = p.parse_args()

    antwort = tausche_code(a.client_id, a.client_secret, hole_code(a.client_id))
    if "refresh_token" not in antwort:
        # Ohne prompt=consent gibt Google beim zweiten Mal keinen refresh_token
        # zurueck. Dann ist die Datei wertlos, also gar nicht erst schreiben.
        print(json.dumps({k: v for k, v in antwort.items() if k != "access_token"}, indent=2))
        raise SystemExit("Kein refresh_token in der Antwort - Zustimmung im Google-Konto entfernen und erneut versuchen.")

    ordner = os.path.dirname(ZIEL)
    os.makedirs(ordner, exist_ok=True)
    os.chmod(ordner, stat.S_IRWXU)
    with open(ZIEL, "w", encoding="utf-8") as f:
        json.dump({
            "client_id": a.client_id,
            "client_secret": a.client_secret,
            "refresh_token": antwort["refresh_token"],
            "publisher_id": a.publisher_id,
            "extension_id": a.extension_id,
        }, f, indent=2)
    os.chmod(ZIEL, stat.S_IRUSR | stat.S_IWUSR)

    print(f"\nGeschrieben: {ZIEL} (600)")
    print("Gegenprobe:  python3 tools/cws_publish.py --status-only")
    return 0


if __name__ == "__main__":
    sys.exit(main())
