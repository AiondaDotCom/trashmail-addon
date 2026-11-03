/**
 * Quelltext-Wächter: keine Geheimnisse in Request-URLs - für JEDEN
 * Anfrageweg des Add-ons, nicht nur für callAPI.
 *
 * Anlass: Abnahme von 3d946a9, Befund M5. Der Laufzeit-Wächter in
 * api.test.ts prüfte nur callAPI; `fe-login-pass` in die URL des
 * Cookie-Logins (api.ts, eigenes fetch) blieb grün. Dieser Wächter sucht
 * deshalb nach der BAUFORM einer API- bzw. Manager-URL (`api=1`, `?cmd=`)
 * und nach URLSearchParams-Schlüsseln, egal in welcher Funktion und mit
 * welchem Werkzeug (Template, `+`-Verkettung, URLSearchParams).
 *
 * Geprüft werden alle handgeschriebenen Quellen: ts/**\/*.ts (ohne .d.ts)
 * sowie opaque-client.js und srp-client.js. Die übrigen .js im Addon-Root
 * sind aus ts/ erzeugt (esbuild) oder Fremdbibliotheken (libopaque,
 * argon2, publicsuffixlist).
 *
 * Fehltrefferzahl auf dem sauberen Baum (03.11.2026): 0 unbegründete
 * Treffer; 2 begründete Ausnahmen in AUSNAHMEN (guardian.ts `hostname`,
 * popup.ts Parameter der internen Seite guardian-info.html).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ERLAUBT = ['api', 'cmd', 'lang', 'client', 'client_version'];

/** Begründete Ausnahmen je Datei (Schlüssel, die dort in einer URL stehen dürfen). */
const AUSNAHMEN: Record<string, string[]> = {
    // cert_fingerprint: Hostname des besuchten, geschützten Aionda-Hosts -
    // öffentlich, kein Geheimnis, und nur so lässt sich das Zertifikat des
    // richtigen Hosts erfragen (siehe Kommentar in guardian.ts).
    'ts/guardian.ts': ['hostname'],
    // Parameter der add-on-internen Seite popup/guardian-info.html
    // (window.open auf eine chrome-extension://-URL), keine Serveranfrage.
    'ts/popup/popup.ts': ['status', 'text', 'detail', 'tlsVerified', 'tlsFingerprint'],
};

const ADDON = 'trashmail-addon';

function quelldateien(): string[] {
    const dateien: string[] = [];
    const laufe = (verzeichnis: string): void => {
        for (const name of readdirSync(join(ADDON, verzeichnis))) {
            const relativ = `${verzeichnis}/${name}`;
            if (statSync(join(ADDON, relativ)).isDirectory()) {
                laufe(relativ);
            } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
                dateien.push(relativ);
            }
        }
    };
    laufe('ts');
    dateien.push('opaque-client.js', 'srp-client.js');
    return dateien.sort();
}

interface Fund { schluessel: string; zeile: number; bauform: string }

/**
 * Sucht alle Schlüssel, die die Quelle in eine URL schreibt.
 * Auch von den Alarmproben unten benutzt.
 */
function urlSchluessel(quelle: string): { funde: Fund[]; stellen: number } {
    const zeilen = quelle.split('\n');
    const funde: Fund[] = [];
    let stellen = 0;

    // 1. URL-Bauform: Zeilen mit `api=1` oder `?cmd=`; Verkettungen mit `+`
    //    am Zeilenende oder -anfang werden zur nächsten Zeile weiterverfolgt.
    for (let i = 0; i < zeilen.length; i++) {
        const zeile = zeilen[i]!;
        if (/^\s*(\/\/|\*)/.test(zeile)) { continue; }
        if (!/api=1|\?cmd=/.test(zeile)) { continue; }
        stellen += 1;
        let ausschnitt = zeile;
        let j = i;
        while (j + 1 < zeilen.length && (/\+\s*$/.test(zeilen[j]!) || /^\s*\+/.test(zeilen[j + 1]!))) {
            j += 1;
            ausschnitt += `\n${zeilen[j]}`;
        }
        for (const treffer of ausschnitt.matchAll(/[?&]([A-Za-z0-9_-]+)=/g)) {
            funde.push({ schluessel: treffer[1]!, zeile: i + 1, bauform: 'URL-Text' });
        }
    }

    // 2. URLSearchParams mit Objektliteral: new URLSearchParams({ a: …, "b": … })
    for (const treffer of quelle.matchAll(/new URLSearchParams\(\s*\{([^}]*)\}/g)) {
        stellen += 1;
        const zeile = quelle.slice(0, treffer.index).split('\n').length;
        for (const schluessel of treffer[1]!.matchAll(/["'`]?([A-Za-z0-9_-]+)["'`]?\s*:/g)) {
            funde.push({ schluessel: schluessel[1]!, zeile, bauform: 'URLSearchParams({…})' });
        }
    }

    // 3. URLSearchParams-Variable mit append/set
    for (const variable of quelle.matchAll(/(\w+)\s*=\s*new URLSearchParams\(/g)) {
        const name = variable[1]!;
        const muster = new RegExp(`\\b${name}\\.(?:append|set)\\(\\s*["'\`]([A-Za-z0-9_-]+)["'\`]`, 'g');
        for (const treffer of quelle.matchAll(muster)) {
            stellen += 1;
            const zeile = quelle.slice(0, treffer.index).split('\n').length;
            funde.push({ schluessel: treffer[1]!, zeile, bauform: `${name}.append/set` });
        }
    }

    return { funde, stellen };
}

function unerlaubt(datei: string, funde: Fund[]): string[] {
    const erlaubt = [...ERLAUBT, ...(AUSNAHMEN[datei] ?? [])];
    return funde.filter((f) => !erlaubt.includes(f.schluessel)).map((f) => `${datei}:${f.zeile} ${f.schluessel} (${f.bauform})`);
}

describe('Quelltext-Wächter: keine Geheimnisse in Request-URLs (alle Anfragewege)', () => {
    const dateien = quelldateien();

    it('findet die bekannten Anfragewege überhaupt (Nenner, nicht nur „0 Treffer")', () => {
        for (const pflicht of ['ts/api.ts', 'ts/options/options.ts', 'ts/options/welcome.ts', 'ts/guardian.ts', 'opaque-client.js', 'srp-client.js']) {
            expect(dateien).toContain(pflicht);
        }
        // Rohes Muster daneben: jede Zeile mit `api=1` außerhalb von Kommentaren
        // muss der Wächter als Stelle gezählt haben.
        // Stand 03.11.2026: 19 Zeilen roh, davon 1 ohne URL-Bau
        // (`details.url.includes("api=1")` in guardian.ts), also 18 Stellen.
        let roh = 0;
        let ohneUrlBau = 0;
        let gezaehlt = 0;
        for (const datei of dateien) {
            const quelle = readFileSync(join(ADDON, datei), 'utf8');
            const zeilen = quelle.split('\n').filter((z) => /api=1/.test(z) && !/^\s*(\/\/|\*)/.test(z));
            roh += zeilen.length;
            ohneUrlBau += zeilen.filter((z) => !/[?&]api=1/.test(z)).length;
            gezaehlt += urlSchluessel(quelle).funde.filter((f) => f.schluessel === 'api').length;
        }
        expect(roh).toBeGreaterThanOrEqual(15);
        expect(ohneUrlBau).toBe(1);
        expect(gezaehlt).toBe(roh - ohneUrlBau);
    });

    for (const datei of dateien) {
        it(`${datei}: nur ${ERLAUBT.join('/')} (plus begründete Ausnahmen) in URLs`, () => {
            const quelle = readFileSync(join(ADDON, datei), 'utf8');
            expect(unerlaubt(datei, urlSchluessel(quelle).funde)).toEqual([]);
        });
    }

    describe('Alarmproben (eigene und fremde Schreibweisen müssen fallen, saubere schweigen)', () => {
        const probe = (snippet: string): string[] => unerlaubt('probe.ts', urlSchluessel(snippet).funde).map((f) => f.split(' ')[1]!);

        it('Template-String im Cookie-Login (Befund M5)', () => {
            expect(probe('const r = await fetch(`${baseUrl}/?api=1&cmd=login&lang=${lang}&fe-login-pass=${secret}`, {')).toEqual(['fe-login-pass']);
        });
        it('Verkettung mit + über mehrere Zeilen', () => {
            expect(probe("const r = await fetch(baseUrl + '/?api=1&cmd=x&lang=' + lang +\n    '&session_id=' + encodeURIComponent(sid), {")).toEqual(['session_id']);
        });
        it('Navigation zum Manager mit Sitzung', () => {
            expect(probe('browser.tabs.create({ url: `${base}/?cmd=manager&session_id=${sid}` });')).toEqual(['session_id']);
        });
        it('URLSearchParams mit Objektliteral', () => {
            expect(probe('const params = new URLSearchParams({\n  "lang": lang,\n  "session_id": String(sid),\n});')).toEqual(['session_id']);
        });
        it('URLSearchParams mit append/set', () => {
            expect(probe('const p = new URLSearchParams();\np.append("cmd", c);\np.set("fe-login-user", u);')).toEqual(['fe-login-user']);
        });
        it('saubere Bauformen schweigen', () => {
            expect(probe('await fetch(`${API_BASE_URL}/?api=1&cmd=logout&lang=${lang}`, {')).toEqual([]);
            expect(probe('const params = new URLSearchParams();\nparams.append("cmd", c);\nparams.append("client_version", v);')).toEqual([]);
        });
    });
});
