/**
 * #329f963f „KI fragen“ öffnen - gemeinsam für Popup, Anmeldefenster und
 * Einstellungen, damit alle drei dasselbe Fenster gleich öffnen.
 */
import { seiteOeffnen } from "../fenster";

import { SPEICHER_LETZTE_MELDUNG, SPEICHER_VORGABE_FRAGE } from "./ki-hilfe-konstanten";

const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

/**
 * @param frage         vorbelegte Frage (z. B. aus einer Fehlermeldung), wird gleich gestellt
 * @param letzteMeldung sichtbare Meldung der Erweiterung, geht als Kontext an die KI
 */
export async function kiHilfeOeffnen(frage?: string, letzteMeldung?: string): Promise<void> {
    if (letzteMeldung !== undefined) {
        await browser.storage.local.set({ [SPEICHER_LETZTE_MELDUNG]: letzteMeldung.slice(0, 300) });
    }
    // Die Frage nicht in die Adresse (Wächter "keine Geheimnisse in der URL", 6.1.3).
    await browser.storage.local.set({ [SPEICHER_VORGABE_FRAGE]: frage ? frage.slice(0, 600) : "" });
    await seiteOeffnen(browser.runtime.getURL("help/ki-hilfe.html"), { width: 440, height: 660, bezug: "aktuell" });
}
