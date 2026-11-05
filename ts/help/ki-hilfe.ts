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
const MAX_RUNDEN = 3;
const HILFE_ZEICHEN = 8000;

interface Nachricht { role: "user" | "assistant" | "tool"; content: string; tool_calls?: unknown[]; tool_call_id?: string }

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
export function hilfeText(html: string): { titel: string; text: string } {
    const titel = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const text = html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
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
        zeige("blase du", t);
        verlauf.push({ role: "user", content: t.slice(0, 1900) });
        eingabe.value = "";
        senden.disabled = true;
        const denkt = zeige("denkt", msg("kiDenkt"));
        try {
            for (let runde = 0; runde < MAX_RUNDEN; runde++) {
                const antwort = await client.senden("ai_assistant_public", {
                    messages: verlauf, installation_id: installation, kanal, persona: "nova", sprache, kontext,
                });
                if (antwort.success !== true) {
                    const code = Number(antwort.error_code);
                    zeige("fehler", msg(code === 145 ? "kiFehlerLimit" : code === 171 ? "kiFehlerBesetzt" : "kiFehlerAllgemein"));
                    verlauf.pop();
                    return;
                }
                const daten = (antwort.data ?? antwort) as { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
                if (!daten.tool_calls || daten.tool_calls.length === 0) {
                    zeige("blase ki", antwortHtml(daten.content ?? ""), true);
                    verlauf.push({ role: "assistant", content: daten.content ?? "" });
                    return;
                }
                verlauf.push({ role: "assistant", content: daten.content ?? "", tool_calls: daten.tool_calls });
                for (const aufruf of daten.tool_calls) {
                    const thema = String((JSON.parse(aufruf.function.arguments) as { topic?: string }).topic ?? "");
                    let inhalt = { titel: thema, text: "" };
                    if (/^[a-z-]+$/.test(thema)) {
                        const r = await fetch(`${basis}/help/${hilfeSprache(sprache)}/${thema}.html`, { credentials: "omit" });
                        if (r.ok) {inhalt = hilfeText(await r.text());}
                    }
                    zeige("quelle", msg("kiLiestHilfe", inhalt.titel || thema));
                    verlauf.push({ role: "tool", tool_call_id: aufruf.id, content: JSON.stringify({ topic: thema, content: inhalt.text || "Help topic not found." }) });
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
