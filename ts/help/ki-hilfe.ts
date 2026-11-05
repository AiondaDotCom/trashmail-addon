/**
 * #329f963f KI-Hilfe der Erweiterung („KI fragen“).
 *
 * Spricht `ai_assistant_public` über den eigenen /e-Client an - funktioniert
 * ohne Anmeldung und ohne Host-Berechtigung. Den einzigen Werkzeugaufruf
 * `read_help` führt dieses Fenster aus: Es lädt die öffentliche Hilfeseite
 * (`/help/<sprache>/<thema>.html`, Antwort mit Access-Control-Allow-Origin *,
 * gemessen 05.11.2026) und schickt den Text zurück.
 *
 * Was die KI zu sehen bekommt, steht offen im Fenster (Version, Browser,
 * Websitezugriff, letzte Meldung der Erweiterung). Passwort und Zugangsdaten
 * haben in `kontextFuerKi()` keinen Platz - Vitest bewacht das.
 */
import { EClient, TransportFehler } from "../e-client";

import { SPEICHER_INSTALLATION, SPEICHER_LETZTE_MELDUNG, SPEICHER_VORGABE_FRAGE } from "./ki-hilfe-konstanten";

const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

export const STANDARD_BASIS = "https://mail.aionda.com";
const HILFE_SPRACHEN = ["de", "en", "es", "fr"];
/** Der Server erzwingt nach 2 Leserunden die Antwort (MAX_LESERUNDEN), die dritte Anfrage antwortet also. */
const MAX_RUNDEN = 3;
const HILFE_ZEICHEN = 8000;

/**
 * Grenzen des Servers (AiPublicAssistantService::pruefeNachrichten), in
 * UTF-8-Bytes wie dort gezählt; jeweils mit etwas Abstand.
 */
export const GRENZEN = { nachrichten: 16, frageBytes: 1900, werkzeugBytes: 8800, gesamtBytes: 38000, aufrufeJeZug: 4 } as const;
/** Ältere Frage/Antwort-Paare, die als Gesprächsgedächtnis mitgehen. */
const MAX_VERLAUF_NACHRICHTEN = 6;

interface Werkzeugaufruf { id: string; type?: string; function: { name: string; arguments: string } }
export interface Nachricht { role: "user" | "assistant" | "tool"; content: string; tool_calls?: Werkzeugaufruf[]; tool_call_id?: string }

const kodierer = new TextEncoder();
const bytes = (s: string): number => kodierer.encode(s).length;

/** Auf höchstens maxBytes UTF-8 kürzen, ohne ein Zeichen zu zerschneiden. */
export function utf8Kuerzen(text: string, maxBytes: number): string {
    if (bytes(text) <= maxBytes) {return text;}
    let aus = "";
    let n = 0;
    for (const zeichen of text) {
        const b = bytes(zeichen);
        if (n + b > maxBytes) {break;}
        aus += zeichen;
        n += b;
    }
    return aus;
}

/** Ergebnis von read_help als Werkzeugnachricht, innerhalb von maxBytes. */
export function werkzeugNachricht(id: string, thema: string, text: string, maxBytes: number = GRENZEN.werkzeugBytes): Nachricht {
    const leer = bytes(JSON.stringify({ topic: thema, content: "" }));
    let inhalt = utf8Kuerzen(text, Math.max(0, maxBytes - leer));
    // JSON-Maskierung (" \ Steuerzeichen) kann das Ergebnis verlängern - nachkürzen.
    while (bytes(JSON.stringify({ topic: thema, content: inhalt })) > maxBytes && inhalt.length > 0) {
        inhalt = utf8Kuerzen(inhalt, bytes(inhalt) - 64);
    }
    return { role: "tool", tool_call_id: id, content: JSON.stringify({ topic: thema, content: inhalt }) };
}

/** Höchstens GRENZEN.aufrufeJeZug read_help-Aufrufe je Zug, Dubletten fallen weg (wie der Server). */
export function aufrufeBegrenzen(aufrufe: Werkzeugaufruf[]): Werkzeugaufruf[] {
    const gesehen = new Set<string>();
    const aus: Werkzeugaufruf[] = [];
    for (const a of aufrufe) {
        if (aus.length >= GRENZEN.aufrufeJeZug || gesehen.has(a.function.arguments)) {continue;}
        gesehen.add(a.function.arguments);
        aus.push(a);
    }
    return aus;
}

/** Bytes wie der Server: Inhalt + Werkzeug-Kennungen + Aufrufargumente. */
export function serverBytes(nachrichten: Nachricht[]): number {
    let summe = 0;
    for (const m of nachrichten) {
        summe += bytes(m.content);
        if (m.tool_call_id) {summe += bytes(m.tool_call_id);}
        for (const c of m.tool_calls ?? []) {summe += bytes(c.id) + bytes(c.function.arguments);}
    }
    return summe;
}

/**
 * Was an den Server geht: die laufende Runde (Frage + Leserunden) und davor so
 * viele ältere Frage/Antwort-Paare, wie in die Grenzen passen. Der Verlauf
 * enthält nur Text - Hilfetexte früherer Fragen gehen nie erneut mit, sonst
 * lehnte der Server spätestens die zweite Frage als zu lang ab.
 * Passt die Runde allein nicht, werden ihre Hilfetexte gleichmäßig gekürzt.
 */
export function gespraechFuerServer(verlauf: Nachricht[], runde: Nachricht[]): Nachricht[] {
    let alt = verlauf.filter((m) => m.role !== "tool" && !m.tool_calls).slice(-MAX_VERLAUF_NACHRICHTEN);
    const passt = (v: Nachricht[]): boolean => v.length + runde.length <= GRENZEN.nachrichten && serverBytes([...v, ...runde]) <= GRENZEN.gesamtBytes;
    while (alt.length > 0 && !passt(alt)) {
        alt = alt.slice(2);
    }
    if (passt(alt)) {return [...alt, ...runde];}
    const werkzeuge = runde.filter((m) => m.role === "tool");
    const rest = serverBytes(runde.filter((m) => m.role !== "tool")) + werkzeuge.reduce((s, m) => s + bytes(m.tool_call_id ?? ""), 0);
    const jeWerkzeug = Math.floor((GRENZEN.gesamtBytes - rest) / Math.max(1, werkzeuge.length));
    return runde.map((m) => {
        if (m.role !== "tool") {return m;}
        const { topic, content } = JSON.parse(m.content) as { topic: string; content: string };
        return werkzeugNachricht(m.tool_call_id ?? "", topic, content, jeWerkzeug);
    });
}

/** Kanal für die KPI, aus dem Browser abgeleitet. */
export function kanalFuer(ua: string): string {
    if (ua.includes("Firefox")) {return "addon-firefox";}
    if (ua.includes("Edg/")) {return "addon-edge";}
    if (ua.includes("OPR/")) {return "addon-opera";}
    if (ua.includes("Chrome")) {return "addon-chrome";}
    if (ua.includes("Safari")) {return "addon-safari";}
    return "addon-chrome";
}

/** Sprache für den Server (pt und br sind verschieden, Rückfall Englisch). */
export function serverSprache(ui: string): string {
    const l = ui.toLowerCase();
    if (l.startsWith("pt-br") || l === "pt_br") {return "br";}
    if (l.startsWith("pt")) {return "pt";}
    const kurz = l.slice(0, 2);
    return ["de", "en", "es", "fr"].includes(kurz) ? kurz : "en";
}

export function hilfeSprache(serverSpr: string): string {
    return HILFE_SPRACHEN.includes(serverSpr) ? serverSpr : "en";
}

export interface KiKontext {
    erweiterung_version: string;
    browser: string;
    berechtigung_websites: boolean;
    fehlermeldungen?: string[];
    seite: string;
}

/**
 * Der Kontext, den die KI bekommt. Bewusst eine feste Liste von Feldern -
 * nichts aus storage.sync (dort liegen Benutzername und Zugriffstoken).
 */
export function kontextFuerKi(version: string, kanal: string, zugriff: boolean, letzteMeldung: string | undefined): KiKontext {
    const k: KiKontext = { erweiterung_version: version, browser: kanal, berechtigung_websites: zugriff, seite: "erweiterung" };
    if (letzteMeldung && letzteMeldung.trim() !== "") {
        k.fehlermeldungen = [letzteMeldung.trim().slice(0, 300)];
    }
    return k;
}

/** HTML einer Hilfeseite → Klartext (wie read_help im Web-Manager) und Titel. */
const entitaeten = (s: string): string =>
    s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

export function hilfeText(html: string): { titel: string; text: string } {
    // Auch der Titel wird entschlüsselt - er erscheint als Text im Fenster ("Zustellung &amp; Header", 05.11.2026).
    const titel = entitaeten((html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "").replace(/<[^>]+>/g, "")).trim();
    const text = entitaeten(html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, HILFE_ZEICHEN);
    return { titel, text };
}

/** Antworttext sicher darstellen: erst maskieren, dann **fett** und `code`. */
export function antwortHtml(text: string): string {
    const sicher = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return sicher.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

function msg(schluessel: string, ...ersatz: string[]): string {
    return browser.i18n.getMessage(schluessel, ersatz) || schluessel;
}

async function basisAdresse(): Promise<string> {
    try {
        const r = await browser.storage.local.get("debugApiUrl") as { debugApiUrl?: string };
        return typeof r.debugApiUrl === "string" && r.debugApiUrl !== "" ? r.debugApiUrl : STANDARD_BASIS;
    } catch {
        return STANDARD_BASIS;
    }
}

async function installationsKennung(): Promise<string> {
    const r = await browser.storage.local.get(SPEICHER_INSTALLATION) as Record<string, string | undefined>;
    const vorhanden = r[SPEICHER_INSTALLATION];
    if (typeof vorhanden === "string" && /^[0-9a-f-]{36}$/.test(vorhanden)) {return vorhanden;}
    const neu = crypto.randomUUID();
    await browser.storage.local.set({ [SPEICHER_INSTALLATION]: neu });
    return neu;
}

async function main(): Promise<void> {
    const verlaufEl = document.getElementById("verlauf")!;
    const eingabe = document.getElementById("eingabe") as HTMLTextAreaElement;
    const senden = document.getElementById("senden") as HTMLButtonElement;
    const kontextEl = document.getElementById("kontext")!;

    const basis = await basisAdresse();
    const sprache = serverSprache(browser.i18n.getUILanguage());
    const kanal = kanalFuer(navigator.userAgent);
    const version = browser.runtime.getManifest().version;
    let zugriff = false;
    try { zugriff = await browser.permissions.contains({ origins: [`${basis}/*`] }); } catch { zugriff = false; }
    const gespeichert = await browser.storage.local.get(SPEICHER_LETZTE_MELDUNG) as Record<string, string | undefined>;
    const kontext = kontextFuerKi(version, kanal, zugriff, gespeichert[SPEICHER_LETZTE_MELDUNG]);
    const installation = await installationsKennung();
    const client = new EClient(basis, sprache);
    const verlauf: Nachricht[] = [];

    const teile = [`Aionda Mail ${version}`, kanal.replace("addon-", ""), msg(zugriff ? "kiKontextZugriffAn" : "kiKontextZugriffAus")];
    if (kontext.fehlermeldungen) {teile.push(msg("kiKontextFehler", kontext.fehlermeldungen[0]!));}
    kontextEl.textContent = `${msg("kiKontextTitel")} ${teile.join(" · ")}`;

    const zeige = (klasse: string, inhalt: string, alsHtml = false): HTMLElement => {
        const el = document.createElement("div");
        el.className = klasse;
        if (alsHtml) {el.innerHTML = inhalt;} else {el.textContent = inhalt;}
        verlaufEl.appendChild(el);
        verlaufEl.scrollTop = verlaufEl.scrollHeight;
        return el;
    };
    zeige("blase ki", msg("kiBegruessung"));

    const frage = async (text: string): Promise<void> => {
        const t = text.trim();
        if (t === "" || senden.disabled) {return;}
        document.getElementById("vorschlaege")?.remove();
        // Die Blase zeigt, was die KI wirklich bekommt (lange Fragen werden gekürzt).
        const gesendet = utf8Kuerzen(t, GRENZEN.frageBytes);
        zeige("blase du", gesendet === t ? t : `${gesendet} …`);
        // Die laufende Runde wird erst bei einer Antwort in den Verlauf übernommen -
        // ein Fehler mitten in einer Leserunde hinterlässt so keinen halben Verlauf.
        const runde: Nachricht[] = [{ role: "user", content: gesendet }];
        eingabe.value = "";
        senden.disabled = true;
        const denkt = zeige("denkt", msg("kiDenkt"));
        try {
            for (let zug = 0; zug < MAX_RUNDEN; zug++) {
                const antwort = await client.senden("ai_assistant_public", {
                    messages: gespraechFuerServer(verlauf, runde), installation_id: installation, kanal, persona: "nova", sprache, kontext,
                });
                if (antwort.success !== true) {
                    const code = Number(antwort.error_code);
                    zeige("fehler", msg(code === 145 ? "kiFehlerLimit" : code === 171 ? "kiFehlerBesetzt" : "kiFehlerAllgemein"));
                    return;
                }
                const daten = (antwort.data ?? antwort) as { content?: string; tool_calls?: Werkzeugaufruf[] };
                if (!daten.tool_calls || daten.tool_calls.length === 0) {
                    zeige("blase ki", antwortHtml(daten.content ?? ""), true);
                    verlauf.push(runde[0]!, { role: "assistant", content: daten.content ?? "" });
                    return;
                }
                const aufrufe = aufrufeBegrenzen(daten.tool_calls);
                runde.push({ role: "assistant", content: daten.content ?? "", tool_calls: aufrufe });
                for (const aufruf of aufrufe) {
                    const thema = String((JSON.parse(aufruf.function.arguments) as { topic?: string }).topic ?? "");
                    let inhalt = { titel: thema, text: "" };
                    if (/^[a-z-]+$/.test(thema)) {
                        const r = await fetch(`${basis}/help/${hilfeSprache(sprache)}/${thema}.html`, { credentials: "omit" });
                        if (r.ok) {inhalt = hilfeText(await r.text());}
                    }
                    zeige("quelle", msg("kiLiestHilfe", inhalt.titel || thema));
                    runde.push(werkzeugNachricht(aufruf.id, thema, inhalt.text || "Help topic not found."));
                }
            }
            zeige("fehler", msg("kiFehlerAllgemein"));
        } catch (fehler) {
            console.warn("[KI-Hilfe]", fehler instanceof TransportFehler ? fehler.message : fehler);
            zeige("fehler", msg("kiFehlerAllgemein"));
        } finally {
            denkt.remove();
            senden.disabled = false;
            eingabe.focus();
        }
    };

    document.getElementById("formular")!.addEventListener("submit", (e) => { e.preventDefault(); void frage(eingabe.value); });
    eingabe.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void frage(eingabe.value); }
    });
    for (const knopf of document.querySelectorAll<HTMLButtonElement>("#vorschlaege button")) {
        knopf.addEventListener("click", () => { void frage(msg(knopf.dataset.frageI18n!)); });
    }
    document.getElementById("support")!.addEventListener("click", () => {
        void browser.tabs.create({ url: "https://aionda.com/kontakt/" });
    });

    // Vom Anmeldefenster mitgegebene Frage (Fehlermeldung) gleich stellen - einmalig.
    const vorgabe = await browser.storage.local.get(SPEICHER_VORGABE_FRAGE) as Record<string, string | undefined>;
    await browser.storage.local.remove(SPEICHER_VORGABE_FRAGE);
    const vorgegeben = vorgabe[SPEICHER_VORGABE_FRAGE];
    if (vorgegeben) {void frage(vorgegeben);} else {eingabe.focus();}
}

if (typeof document !== "undefined" && document.getElementById("verlauf")) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => { void main(); });
    } else {
        void main();
    }
}
