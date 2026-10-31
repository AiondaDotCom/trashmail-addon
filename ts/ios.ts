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

/** iPhone/iPod/iPad - auch iPadOS, das sich als „Macintosh" mit Touch meldet. */
export function istIos(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
    if (/iPhone|iPad|iPod/.test(nav.userAgent)) {
        return true;
    }
    return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
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
 * @returns true, wenn iOS erkannt wurde.
 */
export function iosVorbereiten(doc: Document = document, nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
    if (!istIos(nav)) {
        return false;
    }
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
    return true;
}
