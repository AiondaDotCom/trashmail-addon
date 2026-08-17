# Release in den Chrome Web Store

## Warum per API und nicht im Browser

Die Dashboard-Seiten liegen unter `chrome.google.com/webstore/*`. Chrome verbietet
**jeder** Erweiterung das Skripten dieser Herkunft, also auch dem Aionda-Browser-Relay:

```
browser_attach -> "The extensions gallery cannot be scripted."   (17.08.2026 gemessen)
```

⚠️ `browser_list_tabs` meldet fuer genau diese Seite `scriptable: true`. Das ist
eine Auskunft, die beruhigt, ohne etwas zu belegen - erst der Attach-Versuch sagt
die Wahrheit. Wer sich auf das Feld verlaesst, plant einen Weg ein, den es nicht gibt.

Automatisierbar ist deshalb nur die REST-API (v2).

## Einmalige Einrichtung

Im Google-Cloud-Projekt **des Publisher-Kontos** (nicht irgendeines):

1. „Chrome Web Store API" aktivieren.
2. OAuth-Zustimmungsbildschirm anlegen (External), eigene Adresse als Testnutzer
   eintragen - dann braucht es keine Google-Pruefung.
3. OAuth-Client **Webanwendung** anlegen. Als autorisierte Weiterleitungs-URI
   **`http://localhost:8790/`** eintragen. (Die Doku nennt den OAuth-Playground;
   die Schleifenadresse nehmen wir, damit das Skript den Code selbst abholt und
   niemand einen Token durch die Gegend kopiert.)
4. Zweistufige Anmeldung muss am Google-Konto aktiv sein, sonst verweigert die
   API jedes Update.

Dann:

```bash
cd src/trashmail-addon
python3 tools/cws_oauth_setup.py --client-id <ID> --client-secret <SECRET>
```

Das Skript zeigt eine URL, die im Browser des Publisher-Kontos zu oeffnen ist,
faengt die Weiterleitung selbst ab und legt

```
~/.aionda-cws/credentials.json      (Ordner 700, Datei 600)
```

an: `client_id`, `client_secret`, `refresh_token`, `publisher_id`, `extension_id`.
**Diese Datei gehoert nicht ins Repo** und steht deshalb im Home.

Gegenprobe, veraendert nichts:

```bash
python3 tools/cws_publish.py --status-only
```

## Release

```bash
./build.sh chrome                                              # Paket bauen
python3 tools/cws_publish.py --zip aionda-mail-chrome-<v>.zip   # nur hochladen
python3 tools/cws_publish.py --zip aionda-mail-chrome-<v>.zip --publish
```

Ohne `--publish` liegt der Upload als Entwurf im Dashboard - so laesst sich der
Stand ansehen, bevor die Pruefung laeuft.

## Was das Skript prueft, statt es zu glauben

- **HTTP 200 gilt nicht als Erfolg.** Entschieden wird an `uploadState`
  (`SUCCEEDED` / `IN_PROGRESS` / `FAILED`); `IN_PROGRESS` wird ueber
  `:fetchStatus` nachgehalten, alles andere bricht ab.
- **`fetchStatus` vor und nach dem Vorgang**, also eine Messung ausserhalb der
  eigenen Antwort. Bleibt `submittedItemRevisionStatus` nach `:publish` leer,
  meldet das Skript einen Fehler statt Erfolg.
- **Versionsvergleich**: `crxVersion` aus der Store-Antwort gegen die Version im
  `manifest.json` des Pakets. Weichen sie ab, wird nichts eingereicht.
- **Ohne Zugangsdaten Rueckgabewert 1** mit Hinweis auf die Einrichtung, nicht
  ein stiller Durchlauf.

## Store-Stand ohne Anmeldung nachsehen

Welche Version wirklich ausgeliefert wird, sagt der Update-Endpunkt - unabhaengig
von Dashboard und API:

```bash
curl -sS "https://clients2.google.com/service/update2/crx?response=updatecheck\
&prodversion=148.0&acceptformat=crx3&x=id%3Dfihbdpohplcdnhllhliaeapefmmpcdjo%26uc"
```

Am 17.08.2026 stand dort `version="6.0.1"`, obwohl im Repo schon 6.1.0 lag: Die
6.1.0 war nur bei Firefox ausgeliefert. **Der Repo-Stand ist kein Beleg dafuer,
was die Kunden haben.**
