/**
 * #329f963f KI-Hilfe der Erweiterung: Kontext, Darstellung, Sprachen.
 *
 * Wächter (Fehltrefferzahl 0 auf dem sauberen Baum, 05.11.2026):
 *   - Das Hilfefenster liest storage.sync nie (dort liegen Benutzername und
 *     Zugriffstoken) - Quelltextprüfung über ki-hilfe.ts und ki-oeffnen.ts.
 *   - Der Kontext hat genau die erlaubten Felder.
 *   - Antworttext kann kein HTML einschleusen.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { installBrowserMock } from "../helpers/browser-mock";

installBrowserMock();
const kiHilfe = await import("../../ts/help/ki-hilfe");

describe("KI-Hilfe", () => {
    it("WAECHTER: Hilfefenster und Öffner lesen storage.sync nicht", () => {
        for (const datei of ["trashmail-addon/ts/help/ki-hilfe.ts", "trashmail-addon/ts/help/ki-oeffnen.ts"]) {
            // Nur Code zählt: Kommentare (die den Grund nennen) vorher entfernen.
            const code = readFileSync(datei, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            expect(code, datei).not.toMatch(/storage\s*\.\s*sync/);
        }
    });

    it("WAECHTER: Kontext enthält genau die erlaubten Felder, nichts Weiteres", () => {
        const k = kiHilfe.kontextFuerKi("6.1.7", "addon-firefox", false, "  NetworkError when attempting to fetch resource.  ");
        expect(Object.keys(k).sort()).toEqual(["berechtigung_websites", "browser", "erweiterung_version", "fehlermeldungen", "seite"]);
        expect(k.fehlermeldungen).toEqual(["NetworkError when attempting to fetch resource."]);
        expect(Object.keys(kiHilfe.kontextFuerKi("6.1.7", "addon-chrome", true, undefined))).not.toContain("fehlermeldungen");
    });

    it("WAECHTER: Antworttext wird maskiert, nur **fett** und `code` werden zu Markup", () => {
        const html = kiHilfe.antwortHtml("<img src=x onerror=alert(1)> **Berechtigungen** öffnen, `about:addons` eingeben");
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
        expect(html).toContain("<strong>Berechtigungen</strong>");
        expect(html).toContain("<code>about:addons</code>");
    });

    it("Kanal aus dem Browser", () => {
        expect(kiHilfe.kanalFuer("Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/159.0")).toBe("addon-firefox");
        expect(kiHilfe.kanalFuer("Mozilla/5.0 Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("addon-edge");
        expect(kiHilfe.kanalFuer("Mozilla/5.0 Chrome/141.0 Safari/537.36")).toBe("addon-chrome");
        expect(kiHilfe.kanalFuer("Mozilla/5.0 (Macintosh) Version/26.0 Safari/605.1.15")).toBe("addon-safari");
    });

    it("Sprache: pt und br getrennt, Rückfall Englisch; Hilfe nur in de/en/es/fr", () => {
        expect(kiHilfe.serverSprache("pt-BR")).toBe("br");
        expect(kiHilfe.serverSprache("pt-PT")).toBe("pt");
        expect(kiHilfe.serverSprache("de-DE")).toBe("de");
        expect(kiHilfe.serverSprache("it")).toBe("en");
        expect(kiHilfe.hilfeSprache("br")).toBe("en");
        expect(kiHilfe.hilfeSprache("fr")).toBe("fr");
    });

    it("Hilfeseite → Titel und Klartext, auf 8000 Zeichen begrenzt", () => {
        const { titel, text } = kiHilfe.hilfeText(`<h2>Browser-Erweiterung</h2><style>x{}</style><p>Schalte &quot;Auf Ihre Daten&quot; ein.</p>${"<p>a</p>".repeat(5000)}`);
        expect(titel).toBe("Browser-Erweiterung");
        expect(text.startsWith('Browser-Erweiterung Schalte "Auf Ihre Daten" ein.')).toBe(true);
        expect(text.length).toBeLessThanOrEqual(8000);
        // Titel erscheint als Text im Fenster: Entitäten entschlüsselt, &amp;lt; bleibt wörtlich "&lt;".
        expect(kiHilfe.hilfeText("<h2>Zustellung &amp; Header</h2>").titel).toBe("Zustellung & Header");
        expect(kiHilfe.hilfeText("<h2>a</h2><p>&amp;lt;b&amp;gt;</p>").text).toBe("a &lt;b&gt;");
    });
});
