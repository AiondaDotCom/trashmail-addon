/**
 * #329f963f Dialog „KI fragen“ über das echte main() und das echte HTML.
 * Nachgestellt sind nur der /e-Transport (EClient) und fetch für die Hilfeseiten.
 *
 * Wächter (Fehltrefferzahl 0 auf dem sauberen Baum, 05.11.2026):
 *   - Jede Anfrage hält die Servergrenzen ein (Bytes wie der Server zählt) -
 *     vorher lehnte der Server spätestens die zweite Frage als zu lang ab.
 *   - Folgefragen schicken frühere Hilfetexte nicht erneut mit.
 *   - Ein Fehler mitten in einer Frage hinterlässt keinen halben Verlauf.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installBrowserMock, type BrowserMock } from "../helpers/browser-mock";

import { loadHtmlBody, tick } from "./_helpers";

interface Gesendet { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }

const senden = vi.fn();
vi.mock("../../ts/e-client", () => ({
    EClient: class { senden = senden; },
    TransportFehler: class extends Error {},
}));

let mock: BrowserMock;
let ki: typeof import("../../ts/help/ki-hilfe");
const anfragen: Gesendet[][] = [];

const aufruf = (id: string, thema: string) => ({ id, type: "function", function: { name: "read_help", arguments: JSON.stringify({ topic: thema }) } });
const leserunde = (...a: ReturnType<typeof aufruf>[]) => ({ success: true, data: { content: "", tool_calls: a } });
const antwort = (text: string) => ({ success: true, data: { content: text } });

async function stelle(text: string): Promise<void> {
    (document.getElementById("eingabe") as HTMLTextAreaElement).value = text;
    document.getElementById("formular")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(30);
}

beforeEach(async () => {
    vi.resetModules();
    mock = installBrowserMock();
    anfragen.length = 0;
    senden.mockReset();
    senden.mockImplementation(async (_cmd: string, p: { messages: Gesendet[] }) => {
        anfragen.push(structuredClone(p.messages));
        return antwort("Standard");
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => `<h2>Thema</h2><p>${"Ä\"ö".repeat(2700)}</p>` })));
    loadHtmlBody("help/ki-hilfe.html");
    ki = await import("../../ts/help/ki-hilfe");
    await tick(10);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("Dialog KI fragen", () => {
    it("WAECHTER: zwei Leserunden mit vier langen Hilfetexten bleiben in den Servergrenzen", async () => {
        senden
            .mockImplementationOnce(async (_c: string, p: { messages: Gesendet[] }) => { anfragen.push(structuredClone(p.messages)); return leserunde(aufruf("a", "logging"), aufruf("b", "deliverability")); })
            .mockImplementationOnce(async (_c: string, p: { messages: Gesendet[] }) => { anfragen.push(structuredClone(p.messages)); return leserunde(aufruf("c", "addresses"), aufruf("d", "mailbox")); })
            .mockImplementationOnce(async (_c: string, p: { messages: Gesendet[] }) => { anfragen.push(structuredClone(p.messages)); return antwort("Antwort 1"); });
        await stelle(`Weiterleitung kommt nicht an ${"ü".repeat(1500)}`);

        expect(anfragen).toHaveLength(3);
        const enc = new TextEncoder();
        for (const nachrichten of anfragen) {
            expect(nachrichten.length).toBeLessThanOrEqual(16);
            expect(ki.serverBytes(nachrichten as never)).toBeLessThanOrEqual(38000);
            for (const m of nachrichten) {
                if (m.role === "user") {expect(enc.encode(m.content).length).toBeLessThanOrEqual(2000);}
                if (m.role === "tool") {expect(enc.encode(m.content).length).toBeLessThanOrEqual(9000);}
            }
        }
        // Die Hilfe kam wirklich an (nicht leer gekürzt).
        const werkzeug = anfragen[2]!.filter((m) => m.role === "tool");
        expect(werkzeug).toHaveLength(4);
        for (const w of werkzeug) {expect((JSON.parse(w.content) as { content: string }).content.length).toBeGreaterThan(3000);}
        expect(document.getElementById("verlauf")!.textContent).toContain("Antwort 1");
    });

    it("WAECHTER: Folgefrage schickt nur Frage und Antwort mit, keine alten Hilfetexte", async () => {
        senden
            .mockImplementationOnce(async (_c: string, p: { messages: Gesendet[] }) => { anfragen.push(structuredClone(p.messages)); return leserunde(aufruf("a", "logging")); })
            .mockImplementationOnce(async (_c: string, p: { messages: Gesendet[] }) => { anfragen.push(structuredClone(p.messages)); return antwort("Antwort 1"); });
        await stelle("Frage 1");
        await stelle("Frage 2");

        expect(anfragen.at(-1)).toEqual([
            { role: "user", content: "Frage 1" },
            { role: "assistant", content: "Antwort 1" },
            { role: "user", content: "Frage 2" },
        ]);
    });

    it("WAECHTER: Fehler mitten in der Frage hinterlässt keinen halben Verlauf", async () => {
        await stelle("Frage 1");
        senden
            .mockImplementationOnce(async (_c: string, p: { messages: Gesendet[] }) => { anfragen.push(structuredClone(p.messages)); return leserunde(aufruf("a", "logging")); })
            .mockImplementationOnce(async (_c: string, p: { messages: Gesendet[] }) => { anfragen.push(structuredClone(p.messages)); return { success: false, error_code: 145 }; });
        await stelle("Frage 2");
        await stelle("Frage 3");

        expect(anfragen.at(-1)).toEqual([
            { role: "user", content: "Frage 1" },
            { role: "assistant", content: "Standard" },
            { role: "user", content: "Frage 3" },
        ]);
        expect([...document.querySelectorAll("#verlauf .fehler")].map((e) => e.textContent)).toEqual(["kiFehlerLimit"]);
    });
});

describe("Öffnen", () => {
    it("ohne aktuelle Meldung (Popup, Einstellungen) geht keine alte Meldung als Kontext mit", async () => {
        const { kiHilfeOeffnen } = await import("../../ts/help/ki-oeffnen");
        await kiHilfeOeffnen("Frage", "NetworkError");
        expect(mock.storage.local.data.get("ki_letzte_meldung")).toBe("NetworkError");
        await kiHilfeOeffnen();
        expect(mock.storage.local.data.has("ki_letzte_meldung")).toBe(false);
    });
});

describe("Zuschnitt", () => {
    it("utf8Kuerzen zerschneidet kein Zeichen", () => {
        const k = ki.utf8Kuerzen("ä".repeat(1000), 1901);
        expect(k).toBe("ä".repeat(950));
    });

    it("passt die Runde allein nicht, werden die Hilfetexte gleichmäßig gekürzt", () => {
        const runde = [
            { role: "user" as const, content: "x" },
            { role: "assistant" as const, content: "", tool_calls: ["a", "b", "c", "d", "e"].map((id) => aufruf(id, "logging")) },
            ...["a", "b", "c", "d", "e"].map((id) => ki.werkzeugNachricht(id, "logging", "ö".repeat(8000))),
        ];
        const aus = ki.gespraechFuerServer([{ role: "user", content: "alt" }, { role: "assistant", content: "alt" }], runde);
        expect(ki.serverBytes(aus)).toBeLessThanOrEqual(38000);
        expect(aus.filter((m) => m.role === "tool")).toHaveLength(5);
        expect(aus[0]).toEqual({ role: "user", content: "x" });
    });
});
