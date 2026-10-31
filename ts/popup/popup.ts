"use strict";

import { seiteOeffnen } from "../fenster";

// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

/** Per-tab Guardian security status (from guardian.ts via background.ts). */
interface GuardianTabStatus {
    status?: string;
    verified: number;
    unsigned?: number;
    tlsVerified?: boolean;
    tlsFingerprint?: string;
    [key: string]: unknown;
}

/** Response of the `get_guardian_status` runtime message. */
interface GuardianStatusResponse {
    enabled?: boolean;
    initialized?: boolean;
    isProtected?: boolean;
    ed25519Supported?: boolean;
    isFirefox?: boolean;
    hostname?: string;
    status?: GuardianTabStatus | null;
    [key: string]: unknown;
}

/** Look up an element by id, throwing (like the original blind access) if absent. */
function elById<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (el === null) {
        throw new Error(`Element #${id} not found`);
    }
    return el as T;
}

// ============================================================
// Guardian Security Status
// ============================================================

/**
 * Guardian-Status vom Background-Script abrufen und anzeigen
 */
async function updateSecurityStatus() {
    const statusEl = document.getElementById("security-status");
    if (!statusEl) {return;}

    try {
        console.log("[Popup] Requesting guardian status...");
        const response = await browser.runtime.sendMessage({ action: "get_guardian_status" }) as GuardianStatusResponse | undefined;
        console.log("[Popup] Received response:", response);

        const iconEl = statusEl.querySelector(".status-icon")!;
        const textEl = statusEl.querySelector(".status-text")!;
        const detailEl = statusEl.querySelector(".status-detail")!;

        // Alle Status-Klassen entfernen
        statusEl.className = "";

        if (!response) {
            console.log("[Popup] No response from Guardian");
            statusEl.className = "inactive";
            iconEl.textContent = "⚠️";
            textEl.textContent = browser.i18n.getMessage("guardianNotInitialized");
            detailEl.textContent = browser.i18n.getMessage("guardianFailedToLoad");
            return;
        }

        if (!response.enabled) {
            // Guardian is opt-in and currently disabled
            statusEl.className = "inactive";
            iconEl.textContent = "🔒";
            textEl.textContent = browser.i18n.getMessage("guardianDisabled");
            detailEl.textContent = browser.i18n.getMessage("guardianEnableInOptions");
            return;
        }

        if (!response.initialized) {
            console.log("[Popup] Guardian not initialized, response:", response);
            statusEl.className = "inactive";
            iconEl.textContent = "⚠️";
            textEl.textContent = browser.i18n.getMessage("guardianNotInitialized");
            detailEl.textContent = browser.i18n.getMessage("guardianFailedToLoad");
            return;
        }

        // Ed25519 not supported (very old browser) - show warning
        if (response.ed25519Supported === false) {
            statusEl.className = "warning";
            iconEl.textContent = "⚠️";
            textEl.textContent = browser.i18n.getMessage("guardianEd25519NotSupported") || "Ed25519 not supported";
            detailEl.textContent = "Chrome 113+ required";
            return;
        }

        if (!response.isProtected) {
            // Nicht auf TrashMail-Seite
            statusEl.className = "inactive";
            iconEl.textContent = "🔒";
            textEl.textContent = browser.i18n.getMessage("guardianMitmProtection");
            detailEl.textContent = browser.i18n.getMessage("guardianVisitToActivate");
            return;
        }

        // Auf TrashMail-Seite
        const status = response.status;

        if (!status || status.status === "PROTECTED") {
            // Noch keine Verifizierung erfolgt
            statusEl.className = "protected";
            iconEl.textContent = "🛡️";
            textEl.textContent = browser.i18n.getMessage("guardianProtected");
            detailEl.textContent = response.hostname ?? "";
            return;
        }

        switch (status.status) {
            case "VERIFIED":
                statusEl.className = "verified";
                iconEl.textContent = "✅";
                textEl.textContent = browser.i18n.getMessage("guardianVerified");
                // Singular/Plural
                if (status.verified === 1) {
                    detailEl.textContent = browser.i18n.getMessage("guardianResponseVerified");
                } else {
                    detailEl.textContent = browser.i18n.getMessage("guardianResponsesVerified", [status.verified.toString()]);
                }
                break;

            case "VERIFIED_DEPRECATED":
                statusEl.className = "warning";
                iconEl.textContent = "⚠️";
                textEl.textContent = browser.i18n.getMessage("guardianKeyExpiringSoon");
                detailEl.textContent = browser.i18n.getMessage("guardianKeyNeedsRenewal");
                break;

            case "KEY_EXPIRED":
                statusEl.className = "danger";
                iconEl.textContent = "⏰";
                textEl.textContent = browser.i18n.getMessage("guardianKeyExpired");
                detailEl.textContent = browser.i18n.getMessage("guardianServerKeyNeedsRenewal");
                break;

            case "COMPROMISED":
                statusEl.className = "danger";
                iconEl.textContent = "🚨";
                textEl.textContent = browser.i18n.getMessage("guardianMitmDetected");
                detailEl.textContent = browser.i18n.getMessage("guardianSignatureVerificationFailed");
                break;

            case "UNSIGNED":
                statusEl.className = "danger";
                iconEl.textContent = "⚠️";
                textEl.textContent = browser.i18n.getMessage("guardianUnsigned");
                // Singular/Plural
                if ((status.unsigned || 0) === 1) {
                    detailEl.textContent = browser.i18n.getMessage("guardianMissingSignature");
                } else {
                    detailEl.textContent = browser.i18n.getMessage("guardianMissingSignatures", [(status.unsigned || 0).toString()]);
                }
                break;

            default:
                statusEl.className = "inactive";
                iconEl.textContent = "❓";
                textEl.textContent = browser.i18n.getMessage("guardianUnknown");
                detailEl.textContent = status.status ?? "";
        }
    } catch (err) {
        console.error("[Popup] Failed to get guardian status:", err);
        statusEl.className = "inactive";
        statusEl.querySelector(".status-icon")!.textContent = "❌";
        statusEl.querySelector(".status-text")!.textContent = browser.i18n.getMessage("guardianError");
        statusEl.querySelector(".status-detail")!.textContent = (err as { message?: string }).message || "Unknown error";
    }
}

// Security Status beim Laden aktualisieren
document.addEventListener("DOMContentLoaded", updateSecurityStatus);

/**
 * Guardian Info-Fenster öffnen (zentriert am Bildschirm)
 */
async function openGuardianInfoWindow() {
    const statusEl = elById("security-status");
    const text = statusEl.querySelector(".status-text")!.textContent ?? "";
    const detail = statusEl.querySelector(".status-detail")!.textContent ?? "";
    const statusClass = statusEl.className;

    // Status-Typ ermitteln
    let status = "unknown";
    if (statusClass.includes("verified")) {status = "verified";}
    else if (statusClass.includes("protected")) {status = "protected";}
    else if (statusClass.includes("warning")) {status = "warning";}
    else if (statusClass.includes("danger")) {status = "danger";}
    else if (statusClass.includes("inactive")) {status = "inactive";}

    // Get TLS status from guardian (Firefox only - Chrome doesn't support getSecurityInfo)
    let tlsVerified = "";
    let tlsFingerprint = "";
    let isFirefox = false;
    try {
        const response = await browser.runtime.sendMessage({ action: "get_guardian_status" }) as GuardianStatusResponse | undefined;
        if (response) {
            isFirefox = response.isFirefox === true;
            // Only include TLS info for Firefox
            if (isFirefox && response.status) {
                tlsVerified = response.status.tlsVerified ? "1" : "0";
                tlsFingerprint = response.status.tlsFingerprint || "";
            }
        }
    } catch (e) {
        console.log("[Popup] Could not get TLS status:", e);
    }

    // URL mit Parametern bauen - TLS nur für Firefox
    const params = new URLSearchParams({
        status: status,
        text: text,
        detail: detail,
    });

    // Only add TLS params for Firefox
    if (isFirefox) {
        params.set("tlsVerified", tlsVerified);
        params.set("tlsFingerprint", tlsFingerprint);
    }

    // Fenstergröße und Position berechnen (zentriert); #26f94a61: ohne
    // Fenster-API (iOS) als Tab.
    seiteOeffnen(browser.runtime.getURL(`popup/guardian-info.html?${params.toString()}`),
        { width: 450, height: 595, bezug: "bildschirm" })
        .catch((err: unknown) => console.error("[Popup] Guardian-Info konnte nicht geöffnet werden:", err));
}

// Event Listener für klickbaren Security-Status
elById("security-status").addEventListener("click", openGuardianInfoWindow);

/**
 * Open Address Manager with current session
 *
 * NOTE: We intentionally don't pass session_id as GET parameter anymore.
 * The browser's session cookie will be used automatically.
 *
 * BUG FIX (2025-01-02): Previously, passing session_id in URL would override
 * the browser's existing session cookie, causing users to be logged out of
 * their active sessions when the extension opened a new tab.
 */
/**
 * Anmelde-/Registrier-Fenster (Welcome) zentriert oeffnen.
 *
 * #26f94a61: Safari auf iOS/iPadOS hat keine eigenen Fenster. Scheitert
 * `windows.create` (oder fehlt es), oeffnet sich die Seite als Tab - sonst
 * blieb der Knopf dort ohne jede Wirkung.
 */
function openLoginWindow() {
    const url = browser.runtime.getURL("options/welcome.html");
    (async () => {
        try {
            await seiteOeffnen(url, { width: 600, height: 720, bezug: "aktuell" });
        } catch (err) {
            console.warn("[Popup] Anmeldung konnte nicht geöffnet werden:", err);
        }
        window.close();
    })();
}

/**
 * #8d29c6d5 #26f94a61: Adresse fuer die aktuelle Seite anlegen, ohne
 * Kontextmenue. Das Formular laeuft als Rahmen im Popup und bekommt den Tab
 * ueber die Adresszeile; nach dem Anlegen fuegt das Content-Script sie in das
 * zuletzt fokussierte Feld der Seite ein.
 *
 * 🚩 Ein Rahmen, keine Navigation: Safari schliesst ein Popup per
 * `window.close()` nur aus der Seite, mit der es geoeffnet wurde. Lag das
 * Formular per `location.assign` im Popup, blieb es nach dem Einfuegen offen
 * und „Abbruch" tat nichts (gemessen 28.10.2026, Safari 26.6, macOS).
 */
async function createAddressForPage() {
    if (!(await isLoggedIn())) {
        openLoginWindow();
        return;
    }
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const params = new URLSearchParams({ "popup": "1", "frame": "0" });
    if (tab?.id !== undefined) {
        params.set("tab", String(tab.id));
    }
    if (tab?.url) {
        params.set("url", tab.url);
    }
    const rahmen = document.createElement("iframe");
    rahmen.id = "create-address-frame";
    rahmen.src = `${browser.runtime.getURL("create-address/create-address.html")}?${params.toString()}`;
    document.body.replaceChildren(rahmen);
    document.body.classList.add("mit-formular");
}

/** Der Formular-Rahmen bittet um das Schliessen des Popups (siehe createAddressForPage). */
window.addEventListener("message", (event: MessageEvent) => {
    const daten = event.data as { aiondaAktion?: string } | null;
    if (event.origin !== window.location.origin || !daten || daten.aiondaAktion !== "popup-schliessen") {
        return;
    }
    window.close();
});

async function isLoggedIn(): Promise<boolean> {
    const sync = await browser.storage.sync.get(["username", "password"]) as { username?: string; password?: string };
    return Boolean(sync.username && sync.password);
}

async function addressManager() {
    // Abgemeldet? Dann direkt das Anmelde-Fenster oeffnen statt eines Fehlers
    if (!(await isLoggedIn())) {
        openLoginWindow();
        return;
    }

    try {
        // POST-Login (PAT-OPAQUE bzw. classic) setzt das Session-Cookie im
        // Browser - der Manager-Tab oeffnet direkt eingeloggt, ohne
        // session_id oder Zugangsdaten in der URL.
        await openAddressManagerAuthenticated();
        window.close();
    } catch (error) {
        const errorMsg = elById("error_msg");
        errorMsg.textContent = (error as { message?: string }).message || String(error);
        errorMsg.style.display = "block";

        // Login kaputt (z.B. PAT widerrufen)? Nach kurzem Hinweis direkt
        // das Anmelde-Fenster oeffnen - dort kann man sich neu anmelden.
        setTimeout(() => {
            openLoginWindow();
        }, 2000);
    }
}

/** Popup an den Login-Zustand anpassen: abgemeldet wird der Haupt-Button zum Anmelde-Button. */
async function updateLoginStateUI() {
    if (!(await isLoggedIn())) {
        const label = elById("btn-address-manager").querySelector("span:last-child");
        if (label) {
            label.textContent = browser.i18n.getMessage("popupLoginButton");
        }
    }
}
updateLoginStateUI();

elById("btn-address-manager").addEventListener("click", addressManager);
elById("btn-create-address").addEventListener("click", () => { void createAddressForPage(); });

elById("btn-options").addEventListener("click", () => {
    browser.runtime.openOptionsPage().then(() => {
        window.close();
    });
});

export {};
