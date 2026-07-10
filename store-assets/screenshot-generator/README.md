# Store-Screenshot-Generator

Generiert die lokalisierten Store-Screenshots (Chrome Web Store / Firefox AMO) fuer alle
Addon-Sprachen (`de`, `en`, `fr`, `es`, `pt`, `br`) in 1280x800 (24-bit PNG, kein Alpha).

Die drei Motive:

| Name      | Motiv                                                        |
|-----------|--------------------------------------------------------------|
| `paste`   | "Wegwerfadresse erstellen"-Dialog (create-address)           |
| `toolbar` | Browser-Toolbar mit geoeffnetem Addon-Popup                  |
| `menu`    | Kontextmenue mit Addon-Submenue auf einem Anmeldeformular    |

**Alle Addon-UI-Texte kommen 1:1 aus `_locales/<lang>/messages.json`** - bei
Textaenderungen im Addon einfach neu generieren. Nur die OS-/Browser-Beschriftungen
(macOS-Kontextmenue, Beispiel-Anmeldeseite) sind im `OS`-Dict in `gen_screenshots.py`
pro Sprache gepflegt.

## Usage

```bash
cd store-assets/screenshot-generator
python3 gen_screenshots.py     # erzeugt HTML-Mockups nach out/screens/
node render_screenshots.cjs    # rendert PNGs nach out/screens/png/<lang>/  (braucht Playwright)
```

Playwright wird aus `src/node_modules` bzw. dem Repo-Root-`node_modules` aufgeloest.

Ergebnis danach ins Doku-Repo kopieren:

```bash
for lang in de en fr es pt br; do
  mkdir -p ../../../docs/trashmail-addons/chrome/$lang/webstore
  /bin/cp -f out/screens/png/$lang/*.png ../../../docs/trashmail-addons/chrome/$lang/webstore/
done
```

## Wichtig

- `store-assets/` ist in `build.sh` von den Extension-ZIPs ausgeschlossen -
  dieser Generator (und `out/`) darf NIE in der ausgelieferten Extension landen.
- `out/` ist Build-Output und nicht eingecheckt (`.gitignore`).
- Neue Sprache? Locale-Ordner unter `_locales/` anlegen, Sprache in `LANGS` +
  `OS`-Dict in `gen_screenshots.py` ergaenzen.
