/**
 * Quelltext-Wächter: keine Geheimnisse in Request-URLs - für JEDEN
 * Anfrageweg des Add-ons, nicht nur für callAPI.
 *
 * Anlass: Abnahme von 3d946a9, Befund M5. Der Laufzeit-Wächter in
 * api.test.ts prüfte nur callAPI; `fe-login-pass` in die URL des
 * Cookie-Logins (api.ts, eigenes fetch) blieb grün. Dieser Wächter sucht
 * deshalb nach der BAUFORM eines URL-Parameters, egal in welcher Funktion
 * und mit welchem Werkzeug:
 *   - Text `?schluessel=` / `&schluessel=` in JEDER Codezeile (Template,
 *     `+`-Verkettung über mehrere Zeilen) - nicht nur in Zeilen mit
 *     `api=1`/`?cmd=`. Die Abnahme von 6c49902 fand diesen blinden Fleck
 *     (`?lang=de&cmd=manager&session_id=` wäre durchgerutscht).
 *   - `new URLSearchParams({ … })` und `params.append/set("…")`
 *   - `irgendwas.searchParams.append/set("…")`, also auch `new URL(…)`
 *     (zweiter blinder Fleck aus derselben Abnahme).
 *
 * Gefangen hätte er auch die Safari-Stelle aus 3582884 (opaque-client.js,
 * `'&session_id=' + encodeURIComponent(sessionId)` in der finish-Adresse):
 * Beim Merge von origin/master fiel genau diese Datei rot (gemessen
 * 03.11.2026), ebenso die neuen Rahmen-Parameter in popup.ts.
 *
 * Geprüft werden alle handgeschriebenen Quellen: ts/**\/*.ts (ohne .d.ts)
 * sowie opaque-client.js und srp-client.js. Die übrigen .js im Addon-Root
 * sind aus ts/ erzeugt (esbuild) oder Fremdbibliotheken (libopaque,
 * argon2, publicsuffixlist).
 *
 * Fehltrefferzahl auf dem sauberen Baum (03.11.2026, nach dem Merge der
 * Safari-Arbeit): 0 unbegründete Treffer; begründete Ausnahmen in
 * AUSNAHMEN (guardian.ts `hostname`, popup.ts Parameter der internen
 * Seiten guardian-info.html und create-address.html).
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
    // Parameter add-on-interner Seiten, keine Serveranfrage:
    //  - popup/guardian-info.html (status … tlsFingerprint)
    //  - create-address.html als Rahmen im Popup (popup, frame, tab, url;
    //    Safari-Arbeit #26f94a61): `url` ist die Adresse des offenen Tabs,
    //    sie bleibt in der chrome-extension://-/safari-web-extension://-URL.
    'ts/popup/popup.ts': ['status', 'text', 'detail', 'tlsVerified', 'tlsFingerprint', 'popup', 'frame', 'tab', 'url'],
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

    // 1. URL-Text: JEDE Codezeile mit `?schluessel=` oder `&schluessel=`;
    //    Verkettungen mit `+` am Zeilenende oder -anfang werden zur nächsten
    //    Zeile weiterverfolgt.
    for (let i = 0; i < zeilen.length; i++) {
        const zeile = zeilen[i]!;
        if (/^\s*(\/\/|\*)/.test(zeile)) { continue; }
        if (!/[?&][A-Za-z0-9_-]+=/.test(zeile)) { continue; }
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

    // 4. searchParams.append/set an beliebigem Empfänger (new URL(…), url.searchParams …)
    for (const treffer of quelle.matchAll(/\.searchParams\.(?:append|set)\(\s*["'`]([A-Za-z0-9_-]+)["'`]/g)) {
        stellen += 1;
        const zeile = quelle.slice(0, treffer.index).split('\n').length;
        funde.push({ schluessel: treffer[1]!, zeile, bauform: 'searchParams.append/set' });
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
        for (const pflicht of ['ts/api.ts', 'ts/options/options.ts', 'ts/options/welcome.ts', 'ts/guardian.ts', 'ts/popup/popup.ts', 'opaque-client.js', 'srp-client.js']) {
            expect(dateien).toContain(pflicht);
        }
        // Jede Zeile mit `api=1` in URL-Form muss als Fund `api` auftauchen.
        let apiZeilen = 0;
        let apiFunde = 0;
        for (const datei of dateien) {
            const quelle = readFileSync(join(ADDON, datei), 'utf8');
            apiZeilen += quelle.split('\n').filter((z) => /[?&]api=1/.test(z) && !/^\s*(\/\/|\*)/.test(z)).length;
            apiFunde += urlSchluessel(quelle).funde.filter((f) => f.schluessel === 'api').length;
        }
        expect(apiZeilen).toBeGreaterThanOrEqual(15);
        expect(apiFunde).toBe(apiZeilen);
    });

    it('rohes neben verengtem Muster: jede Zeile mit einem URL-Werkzeug, die der Wächter NICHT auswertet, ist eine Lesestelle', () => {
        // Roh: alles, womit man eine URL bauen oder lesen kann. Verengt: die
        // Zeilen mit einem Fund. Die Differenz darf nur lesen (get/has,
        // location.search, hostname/origin einer geparsten URL) - eine
        // schreibende Stelle in der Differenz wäre ein blinder Fleck.
        const ROH = /[?&][A-Za-z0-9_-]+=|URLSearchParams|searchParams|new URL\(/;
        const LESEN = /\.(?:get|has|getAll)\(|location\.search|new URL\([^)]*\)\s*\.(?:hostname|host|origin|pathname|protocol)\b|new URL\((?![^)]*\)\.searchParams\.(?:set|append))|\.searchParams\.(?:get|has)\b|\.toString\(\)/;
        const SCHREIBEN = /\.(?:append|set)\(|\.search\s*=|\.href\s*=/;
        const schreibendOhneFund: string[] = [];
        let roh = 0;
        let differenz = 0;
        for (const datei of dateien) {
            const quelle = readFileSync(join(ADDON, datei), 'utf8');
            const fundZeilen = new Set(urlSchluessel(quelle).funde.map((f) => f.zeile));
            quelle.split('\n').forEach((zeile, index) => {
                if (/^\s*(\/\/|\*)/.test(zeile) || !ROH.test(zeile)) { return; }
                roh += 1;
                if (fundZeilen.has(index + 1)) { return; }
                differenz += 1;
                // Schreibt die Zeile (append/set, search=, href=), zählt sie
                // als blinder Fleck - egal, was sie sonst noch liest.
                const schreibt = SCHREIBEN.test(zeile);
                if (schreibt || (!LESEN.test(zeile) && !/new URLSearchParams\(\s*\{?\s*$/.test(zeile) && !/new URLSearchParams\(\)/.test(zeile))) {
                    schreibendOhneFund.push(`${datei}:${index + 1} ${zeile.trim()}`);
                }
            });
        }
        console.info(`[url-waechter] roh ${roh} Zeilen, davon ${roh - differenz} mit Fund, ${differenz} ohne Fund`);
        expect(roh).toBeGreaterThan(differenz);
        expect(schreibendOhneFund).toEqual([]);
    });

    for (const datei of dateien) {
        it(`${datei}: nur ${ERLAUBT.join('/')} (plus begründete Ausnahmen) in URLs`, () => {
            const quelle = readFileSync(join(ADDON, datei), 'utf8');
            expect(unerlaubt(datei, urlSchluessel(quelle).funde)).toEqual([]);
        });
    }

    describe('Alarmproben (eigene und fremde Schreibweisen müssen fallen, saubere schweigen)', () => {
        const probe = (snippet: string): string[] => [...new Set(unerlaubt('probe.ts', urlSchluessel(snippet).funde).map((f) => f.split(' ')[1]!))];

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
        it('blinder Fleck 1 (Abnahme 6c49902): Parameter ohne api=1/?cmd= am Anfang', () => {
            expect(probe('browser.tabs.create({ url: `${base}/?lang=de&cmd=manager&session_id=${sid}` });')).toEqual(['session_id']);
            expect(probe("const ziel = basis + '?token=' + token;")).toEqual(['token']);
        });
        it('blinder Fleck 2 (Abnahme 6c49902): new URL(…) + searchParams.set/append', () => {
            expect(probe('const u = new URL(`${base}/`);\nu.searchParams.set("cmd", "login");\nu.searchParams.set("fe-login-pass", geheim);')).toEqual(['fe-login-pass']);
            expect(probe("new URL(base).searchParams.append('session_id', sid);")).toEqual(['session_id']);
        });
        it('Safari-Schreibweise aus 3582884 (vor dem Merge-Fix in opaque-client.js)', () => {
            expect(probe("const finishResponse = await fetch(baseUrl + '/?api=1&cmd=pat_opaque_create_finish&lang=' + lang + '&session_id=' + encodeURIComponent(sessionId), {")).toEqual(['session_id']);
        });
        it('saubere Bauformen schweigen', () => {
            expect(probe('await fetch(`${API_BASE_URL}/?api=1&cmd=logout&lang=${lang}`, {')).toEqual([]);
            expect(probe('const params = new URLSearchParams();\nparams.append("cmd", c);\nparams.append("client_version", v);')).toEqual([]);
        });
    });
});
