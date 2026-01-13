"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

// ============================================================
// Guardian Security Status
// ============================================================

/**
 * Guardian-Status vom Background-Script abrufen und anzeigen
 */
async function updateSecurityStatus() {
    const statusEl = document.getElementById("security-status");
    if (!statusEl) return;

    try {
        const response = await browser.runtime.sendMessage({ action: "get_guardian_status" });

        const iconEl = statusEl.querySelector(".status-icon");
        const textEl = statusEl.querySelector(".status-text");
        const detailEl = statusEl.querySelector(".status-detail");

        // Alle Status-Klassen entfernen
        statusEl.className = "";

        if (!response || !response.initialized) {
            // Guardian nicht initialisiert
            statusEl.className = "inactive";
            iconEl.textContent = "⚠️";
            textEl.textContent = browser.i18n.getMessage("guardianNotInitialized");
            detailEl.textContent = browser.i18n.getMessage("guardianFailedToLoad");
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
            detailEl.textContent = response.hostname;
            return;
        }

        switch (status.status) {
            case "VERIFIED":
                statusEl.className = "verified";
                iconEl.textContent = "✅";
                textEl.textContent = browser.i18n.getMessage("guardianVerified");
                detailEl.textContent = browser.i18n.getMessage("guardianResponsesVerified", [status.verified.toString()]);
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
                detailEl.textContent = browser.i18n.getMessage("guardianMissingSignatures", [(status.unsigned || 0).toString()]);
                break;

            default:
                statusEl.className = "inactive";
                iconEl.textContent = "❓";
                textEl.textContent = browser.i18n.getMessage("guardianUnknown");
                detailEl.textContent = status.status;
        }
    } catch (err) {
        console.error("[Popup] Failed to get guardian status:", err);
        statusEl.className = "inactive";
        statusEl.querySelector(".status-icon").textContent = "❌";
        statusEl.querySelector(".status-text").textContent = browser.i18n.getMessage("guardianError");
        statusEl.querySelector(".status-detail").textContent = err.message || "Unknown error";
    }
}

// Security Status beim Laden aktualisieren
document.addEventListener("DOMContentLoaded", updateSecurityStatus);

/**
 * Guardian Info-Fenster öffnen (zentriert am Bildschirm)
 */
function openGuardianInfoWindow() {
    const statusEl = document.getElementById("security-status");
    const text = statusEl.querySelector(".status-text").textContent;
    const detail = statusEl.querySelector(".status-detail").textContent;
    const statusClass = statusEl.className;

    // Status-Typ ermitteln
    let status = 'unknown';
    if (statusClass.includes('verified')) status = 'verified';
    else if (statusClass.includes('protected')) status = 'protected';
    else if (statusClass.includes('warning')) status = 'warning';
    else if (statusClass.includes('danger')) status = 'danger';
    else if (statusClass.includes('inactive')) status = 'inactive';

    // URL mit Parametern bauen
    const params = new URLSearchParams({
        status: status,
        text: text,
        detail: detail
    });

    // Fenstergröße und Position berechnen (zentriert)
    const width = 450;
    const height = 595;
    const left = Math.round((screen.width - width) / 2);
    const top = Math.round((screen.height - height) / 2);

    // Neues Fenster öffnen
    browser.windows.create({
        url: browser.runtime.getURL("popup/guardian-info.html?" + params.toString()),
        type: "popup",
        width: width,
        height: height,
        left: left,
        top: top
    });
}

// Event Listener für klickbaren Security-Status
document.getElementById("security-status").addEventListener("click", openGuardianInfoWindow);

/**
 * Get session details - either from stored session_id or by logging in
 *
 * For OPAQUE accounts: Uses stored session_id (created during PAT-OPAQUE login)
 * For non-OPAQUE accounts: Uses classic login with stored credentials
 */
async function getSessionDetails() {
    // First check if we have a stored session_id
    var localStorage = await browser.storage.local.get(["session_id", "is_opaque_account"]);
    var syncStorage = await browser.storage.sync.get(["username", "password"]);

    // If we have a session_id, use it directly
    if (localStorage.session_id) {
        console.log("[TrashMail] Using stored session_id");
        return { session_id: localStorage.session_id };
    }

    // No stored session - need to login
    if (!syncStorage.username || !syncStorage.password) {
        throw new Error("Not logged in. Please log in first.");
    }

    // Check if this is an OPAQUE account (PAT stored)
    if (isPAT(syncStorage.password)) {
        // For OPAQUE accounts with PAT, we need to re-authenticate via OPAQUE
        // But we can't do that in popup without loading the OPAQUE library
        // Redirect user to options page to re-login
        throw new Error("Session expired. Please log in again via Options.");
    }

    // For non-OPAQUE accounts, use classic login
    var data = {
        "cmd": "login",
        "fe-login-user": syncStorage.username,
        "fe-login-pass": syncStorage.password
    };

    var response = await callAPI(data);

    // Store the new session_id
    await browser.storage.local.set({ "session_id": response.session_id });

    return response;
}

/**
 * Check if password is a Personal Access Token
 */
function isPAT(password) {
    return password && typeof password === 'string' && password.startsWith('tmpat_') && password.length > 6;
}

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
async function addressManager() {
    try {
        const baseUrl = await getApiBaseUrl();
        // Only pass language, let the browser use its session cookie
        const url = baseUrl + "/?cmd=manager&lang=" + browser.i18n.getUILanguage().substr(0, 2);
        await browser.tabs.create({"url": url});
        window.close();
    } catch (error) {
        let error_msg = document.getElementById("error_msg");
        error_msg.textContent = error.message || error;
        error_msg.style.display = "block";

        // If session expired for OPAQUE account, offer to re-login
        if (error.message && error.message.includes("log in")) {
            setTimeout(function() {
                browser.runtime.openOptionsPage();
                window.close();
            }, 2000);
        }
    }
}

document.getElementById("btn-address-manager").addEventListener("click", addressManager);

document.getElementById("btn-options").addEventListener("click", function () {
    browser.runtime.openOptionsPage().then(function () {
        window.close();
    });
});
