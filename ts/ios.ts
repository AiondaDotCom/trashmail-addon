"use strict";

/**
 * #26f94a61: Darstellung für Safari auf iPhone/iPad.
 *
 * Auf dem iPhone zeigte Safari die Seiten der Erweiterung im Desktop-Layout
 * (gemeldet 31.10.2026): feste Breiten, winzige Checkboxen, Knöpfe
 * nebeneinander. Die Desktop-Darstellung (Chrome, Firefox, Safari auf macOS)
 * soll dabei unverändert bleiben. Deshalb setzt dieses Modul NUR auf
 * iOS/iPadOS die Klasse `ios` am <html>; alle Regeln in `ios.css` hängen an
 * `html.ios`. Ebenso nur dort bekommen Bedienelemente native Zusätze
 * (Systemschalter, Autofill-/Tastatur-Hinweise).
 *
 * Läuft über translate.js, das jede Seite als erstes Skript lädt.
 */

type Kennung = Pick<Navigator, "userAgent" | "maxTouchPoints">;

/** Liefert `runtime.getPlatformInfo()` der Erweiterung (Safari: os "ios" auf iPhone UND iPad, "mac" auf dem Mac). */
export type PlattformAbfrage = () => Promise<{ os?: string } | undefined>;

function plattformAbfrage(): PlattformAbfrage | undefined {
    const erweiterung = (globalThis as { browser?: typeof chrome; chrome?: typeof chrome }).browser
        ?? (globalThis as { chrome?: typeof chrome }).chrome;
    const runtime = erweiterung?.runtime;
    if (typeof runtime?.getPlatformInfo !== "function") {
        return undefined;
    }
    return () => runtime.getPlatformInfo() as Promise<{ os?: string }>;
}

/** Eindeutige iPhone/iPad/iPod-Kennung im User-Agent (nie „Macintosh"). */
function uaSagtIos(nav: Kennung): boolean {
    return /iPhone|iPad|iPod/.test(nav.userAgent);
}

/**
 * Könnte das iOS/iPadOS sein? iPadOS meldet sich wie ein Mac als
 * „Macintosh" - mit Touch. Ein Mac mit Touch-Bildschirm ebenso, deshalb
 * entscheidet in diesem Fall allein `getPlatformInfo`.
 */
function koennteIosSein(nav: Kennung): boolean {
    return uaSagtIos(nav) || (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
}

/** Längstens so lange wird auf `getPlatformInfo` gewartet. */
const PLATTFORM_WARTEZEIT_MS = 500;

/**
 * iOS/iPadOS? Maßgeblich ist `runtime.getPlatformInfo().os === "ios"`. Nur
 * wenn die Erweiterungs-API nicht antwortet, zählt der User-Agent - und dann
 * nur eine eindeutige iPhone/iPad/iPod-Kennung, nie „Macintosh".
 */
export async function istIos(nav: Kennung = navigator, plattform: PlattformAbfrage | undefined = plattformAbfrage()): Promise<boolean> {
    if (!koennteIosSein(nav)) {
        return false;
    }
    if (plattform) {
        try {
            const info = await Promise.race([
                plattform(),
                new Promise<undefined>((fertig) => setTimeout(() => fertig(undefined), PLATTFORM_WARTEZEIT_MS)),
            ]);
            if (typeof info?.os === "string") {
                return info.os === "ios";
            }
        } catch {
            // Keine Antwort - weiter mit dem User-Agent.
        }
    }
    return uaSagtIos(nav);
}

/** Native Zusätze an einem Eingabeelement (nur auf iOS aufgerufen). */
function feldVorbereiten(feld: HTMLInputElement): void {
    if (feld.type === "checkbox") {
        // Ein-/Aus-Einstellung als nativer iOS-Schalter (WebKit ab Safari 17.4;
        // ältere zeigen weiter die Checkbox, das Verhalten ist dasselbe).
        feld.setAttribute("switch", "");
        return;
    }
    if (feld.type === "text" || feld.type === "email" || feld.type === "password") {
        // Benutzernamen, Adressen und Codes: keine Großschreibung/Autokorrektur.
        if (!feld.hasAttribute("autocapitalize")) {
            feld.setAttribute("autocapitalize", "off");
        }
        if (!feld.hasAttribute("autocorrect")) {
            feld.setAttribute("autocorrect", "off");
        }
        if (!feld.hasAttribute("spellcheck")) {
            feld.setAttribute("spellcheck", "false");
        }
    }
}

function alleFelderVorbereiten(wurzel: ParentNode): void {
    for (const feld of wurzel.querySelectorAll<HTMLInputElement>("input")) {
        feldVorbereiten(feld);
    }
}

/**
 * Auf iOS: Klasse `ios` setzen und Felder ausstatten - auch solche, die erst
 * später entstehen (z. B. das 2FA-Feld der Anmeldung).
 *
 * Die Antwort von `getPlatformInfo` kommt asynchron. Damit iPhone und iPad
 * nicht erst das Desktop-Layout zeigen und dann umspringen, bleibt die Seite
 * bis zur Entscheidung unsichtbar - aber nur, wenn der User-Agent überhaupt
 * nach iOS aussieht. Chrome, Firefox und Safari auf einem Mac ohne Touch
 * werden gar nicht angefasst.
 *
 * @returns true, wenn iOS erkannt wurde.
 */
export async function iosVorbereiten(
    doc: Document = document,
    nav: Kennung = navigator,
    plattform: PlattformAbfrage | undefined = plattformAbfrage(),
): Promise<boolean> {
    if (!koennteIosSein(nav)) {
        return false;
    }
    const wurzel = doc.documentElement;
    const sichtbarkeit = wurzel.style.visibility;
    wurzel.style.visibility = "hidden";
    let ios = false;
    try {
        ios = await istIos(nav, plattform);
        if (ios) {
            einschalten(doc);
        }
    } finally {
        wurzel.style.visibility = sichtbarkeit;
        if (wurzel.getAttribute("style") === "") {
            wurzel.removeAttribute("style");
        }
    }
    return ios;
}

function einschalten(doc: Document): void {
    doc.documentElement.classList.add("ios");
    alleFelderVorbereiten(doc);
    if (typeof MutationObserver === "function") {
        new MutationObserver((aenderungen) => {
            for (const aenderung of aenderungen) {
                for (const knoten of aenderung.addedNodes) {
                    if (knoten instanceof HTMLInputElement) {
                        feldVorbereiten(knoten);
                    } else if (knoten instanceof Element) {
                        alleFelderVorbereiten(knoten);
                    }
                }
            }
        }).observe(doc.documentElement, { childList: true, subtree: true });
    }
}
