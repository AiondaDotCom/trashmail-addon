#!/usr/bin/env python3
"""Paket in den Chrome Web Store hochladen und zur Pruefung einreichen (API v2).

Warum ueberhaupt ein Skript: Die Dashboard-Seiten liegen unter
chrome.google.com/webstore/*, und Chrome verbietet JEDER Erweiterung das
Skripten dieser Herkunft ("The extensions gallery cannot be scripted", am
17.08.2026 mit dem Browser-Relay nachgemessen). Der einzige automatisierbare
Weg ist die REST-API.

Endpunkte wortgetreu aus der Doku vom 13.08.2026
(developer.chrome.com/docs/webstore/using-api und .../api/reference/rest/v2):

  POST https://chromewebstore.googleapis.com/upload/v2/{name}:upload
  POST https://chromewebstore.googleapis.com/v2/{name}:publish
  GET  https://chromewebstore.googleapis.com/v2/{name}:fetchStatus
  mit name = publishers/{publisherId}/items/{itemId}

Zwei Dinge, die dieses Skript bewusst NICHT tut:
  - aus HTTP 200 auf Erfolg schliessen. Entschieden wird an `uploadState`
    (SUCCEEDED/IN_PROGRESS/FAILED) und an fetchStatus, das den Zustand
    unabhaengig von der eigenen Antwort meldet.
  - stillschweigend veroeffentlichen. Ohne --publish wird nur hochgeladen.

Aufruf:
  python3 tools/cws_publish.py --status-only
  python3 tools/cws_publish.py --zip aionda-mail-chrome-6.1.1.zip
  python3 tools/cws_publish.py --zip aionda-mail-chrome-6.1.1.zip --publish
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

TOKEN_URL = "https://oauth2.googleapis.com/token"
BASIS = "https://chromewebstore.googleapis.com"
CREDS = os.path.expanduser("~/.aionda-cws/credentials.json")


def lade_zugangsdaten() -> dict:
    if not os.path.exists(CREDS):
        raise SystemExit(f"{CREDS} fehlt. Einmalige Einrichtung: tools/cws_oauth_setup.py")
    with open(CREDS, encoding="utf-8") as f:
        d = json.load(f)
    fehlt = [k for k in ("client_id", "client_secret", "refresh_token", "publisher_id", "extension_id") if not d.get(k)]
    if fehlt:
        raise SystemExit(f"In {CREDS} fehlen: {', '.join(fehlt)}")
    return d


def hole_token(d: dict) -> str:
    daten = urllib.parse.urlencode({
        "client_id": d["client_id"],
        "client_secret": d["client_secret"],
        "refresh_token": d["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=daten)) as antwort:
        return json.loads(antwort.read())["access_token"]


def ruf(url: str, token: str, *, methode: str = "GET", koerper: bytes | None = None,
        inhaltstyp: str | None = None) -> dict:
    anfrage = urllib.request.Request(url, data=koerper, method=methode)
    anfrage.add_header("Authorization", f"Bearer {token}")
    if inhaltstyp:
        anfrage.add_header("Content-Type", inhaltstyp)
    try:
        with urllib.request.urlopen(anfrage) as antwort:
            rohtext = antwort.read().decode("utf-8") or "{}"
    except urllib.error.HTTPError as fehler:
        # Der Fehlerkoerper enthaelt die eigentliche Begruendung, also mitzeigen.
        print(f"HTTP {fehler.code} von {url}:\n{fehler.read().decode('utf-8', 'replace')}", file=sys.stderr)
        raise SystemExit(1) from fehler
    return json.loads(rohtext)


def zeige_status(name: str, token: str, ueberschrift: str) -> dict:
    status = ruf(f"{BASIS}/v2/{name}:fetchStatus", token)
    print(f"\n=== {ueberschrift} ===")
    for schluessel in ("publishedItemRevisionStatus", "submittedItemRevisionStatus"):
        eintrag = status.get(schluessel)
        print(f"  {schluessel}: {json.dumps(eintrag, ensure_ascii=False) if eintrag else '(nicht gesetzt)'}")
    print(f"  lastAsyncUploadState: {status.get('lastAsyncUploadState')}")
    print(f"  takenDown={status.get('takenDown')} warned={status.get('warned')}")
    return status


def version_im_paket(pfad: str) -> str:
    with zipfile.ZipFile(pfad) as z:
        return json.loads(z.read("manifest.json"))["version"]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--zip", help="Pfad zum Chrome-Paket")
    p.add_argument("--publish", action="store_true", help="nach dem Upload zur Pruefung einreichen")
    p.add_argument("--status-only", action="store_true", help="nur den Zustand abfragen")
    a = p.parse_args()

    d = lade_zugangsdaten()
    name = f"publishers/{d['publisher_id']}/items/{d['extension_id']}"
    token = hole_token(d)

    zeige_status(name, token, "Zustand vorher")
    if a.status_only:
        return 0
    if not a.zip:
        raise SystemExit("--zip fehlt (oder --status-only nutzen)")

    erwartet = version_im_paket(a.zip)
    print(f"\nLade hoch: {a.zip} (Version {erwartet} laut manifest.json im Paket)")
    with open(a.zip, "rb") as f:
        inhalt = f.read()
    antwort = ruf(f"{BASIS}/upload/v2/{name}:upload", token, methode="POST",
                  koerper=inhalt, inhaltstyp="application/zip")
    print(json.dumps(antwort, indent=2, ensure_ascii=False))

    zustand = antwort.get("uploadState")
    for _ in range(30):
        if zustand != "IN_PROGRESS":
            break
        time.sleep(10)
        status = ruf(f"{BASIS}/v2/{name}:fetchStatus", token)
        zustand = status.get("lastAsyncUploadState")
        print(f"  ... uploadState={zustand}")

    if zustand != "SUCCEEDED":
        # Weder "unbekannt" noch "laeuft noch" darf als Erfolg durchgehen.
        raise SystemExit(f"Upload nicht bestaetigt (uploadState={zustand}) - nichts eingereicht.")

    hochgeladen = antwort.get("crxVersion")
    if hochgeladen and hochgeladen != erwartet:
        raise SystemExit(f"Der Store meldet Version {hochgeladen}, das Paket sagt {erwartet} - abgebrochen.")
    print(f"Upload bestaetigt, crxVersion={hochgeladen}")

    if not a.publish:
        print("\nNicht eingereicht (kein --publish). Der Upload liegt als Entwurf im Dashboard.")
        zeige_status(name, token, "Zustand nach dem Upload")
        return 0

    print("\nReiche zur Pruefung ein ...")
    ergebnis = ruf(f"{BASIS}/v2/{name}:publish", token, methode="POST",
                   koerper=b"{}", inhaltstyp="application/json")
    print(json.dumps(ergebnis, indent=2, ensure_ascii=False))

    nachher = zeige_status(name, token, "Zustand nachher")
    eingereicht = (nachher.get("submittedItemRevisionStatus") or {})
    if not eingereicht:
        raise SystemExit("publish gab keine Fehlermeldung, aber submittedItemRevisionStatus ist leer - bitte im Dashboard nachsehen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
