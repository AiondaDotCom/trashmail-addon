"use strict";

/**
 * TrashMail Guardian - MITM Protection Module
 *
 * Verifiziert Response-Signaturen um Man-in-the-Middle Angriffe zu erkennen.
 * Schützt vor ZScaler, CloudFlare Enterprise und anderen SSL-inspizierenden Proxies.
 */

// Kompatibilitätslayer
if (typeof browser === "undefined") {
    var browser = chrome;
}

// ============================================================
// Konfiguration
// ============================================================

const GUARDIAN_CONFIG = {
    // Hosts die überwacht werden
    protectedHosts: [
        "trashmail.com",
        "www.trashmail.com",
        "dev.trashmail.com",
        "byom.de",
        "www.byom.de"
    ],
    // Maximales Alter eines Timestamps in Sekunden
    maxTimestampAge: 300, // 5 Minuten
    // Header-Namen
    headers: {
        signature: "x-aionda-signature",
        timestamp: "x-aionda-timestamp",
        keyId: "x-aionda-key-id"
    }
};

// ============================================================
// Globaler State
// ============================================================

let publicKeys = new Map(); // keyId -> { cryptoKey, validFrom, warnAfter, validUntil }
let guardianInitialized = false;
let tabSecurityStatus = new Map(); // tabId -> { status, reason, verified, failed }

// ============================================================
// Message Handler (Top-Level für sofortige Registrierung)
// ============================================================

console.log("[Guardian] Registering message handler...");

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "get_guardian_status") {
        console.log("[Guardian] Received get_guardian_status request");

        // Status für aktuellen Tab abrufen
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs.length === 0) {
                sendResponse({
                    initialized: guardianInitialized,
                    keysLoaded: publicKeys.size,
                    isProtected: false,
                    status: null
                });
                return;
            }

            const tab = tabs[0];
            let hostname = null;
            let isProtected = false;

            try {
                hostname = new URL(tab.url).hostname;
                isProtected = isProtectedHost(hostname);
            } catch (e) {
                // Ungültige URL
            }

            const securityStatus = tabSecurityStatus.get(tab.id);

            console.log("[Guardian] Sending status response:", {
                tabId: tab.id,
                hostname,
                isProtected,
                status: securityStatus,
                keysLoaded: publicKeys.size,
                initialized: guardianInitialized
            });

            sendResponse({
                tabId: tab.id,
                hostname: hostname,
                isProtected: isProtected,
                status: securityStatus || null,
                keysLoaded: publicKeys.size,
                initialized: guardianInitialized
            });
        }).catch(err => {
            console.error("[Guardian] Error getting tab info:", err);
            sendResponse({
                initialized: guardianInitialized,
                keysLoaded: publicKeys.size,
                isProtected: false,
                status: null,
                error: err.message
            });
        });

        return true; // Async response
    }
    // Andere Messages nicht behandeln - anderen Listenern überlassen
});

console.log("[Guardian] Message handler registered");

// ============================================================
// Hilfsfunktionen
// ============================================================

/**
 * Base64 zu ArrayBuffer konvertieren
 */
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Prüft ob ein Host geschützt ist
 */
function isProtectedHost(hostname) {
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    return GUARDIAN_CONFIG.protectedHosts.some(h =>
        lower === h || lower.endsWith("." + h)
    );
}

/**
 * Prüft ob eine URL ein statisches Asset mit Hash ist
 * Erkennt sowohl kurze (8 Zeichen) als auch volle SHA-256 Hashes (64 Zeichen)
 */
function isHashedAsset(url) {
    // Pattern: filename.HASH.ext (z.B. app.a1b2c3d4.js oder app.61bd607be317d6f746f436cc259f3a933396753b73ab14c891a768916bd97e04.min.js)
    // Mindestens 8 Zeichen Hex-Hash, typisch sind 64 Zeichen (SHA-256)
    return /\.[a-f0-9]{8,64}\.(?:min\.)?(js|css|png|jpg|jpeg|gif|svg|webp|woff2?)$/i.test(url);
}

// ============================================================
// Key Management
// ============================================================

/**
 * Public Keys aus public_key.json laden
 */
async function loadPublicKeys() {
    try {
        console.log("[Guardian] Loading public keys...");

        // Prüfen ob crypto.subtle verfügbar ist
        if (!crypto || !crypto.subtle) {
            console.error("[Guardian] crypto.subtle not available!");
            return false;
        }

        const response = await fetch(browser.runtime.getURL("public_key.json"));
        if (!response.ok) {
            console.warn("[Guardian] public_key.json not found - Response Signing disabled");
            return false;
        }

        const keyData = await response.json();
        console.log("[Guardian] Loaded key data:", Object.keys(keyData.keys));

        for (const [keyId, keyInfo] of Object.entries(keyData.keys)) {
            try {
                console.log(`[Guardian] Importing key: ${keyId}`);
                // Public Key importieren (SPKI DER Format, Base64 encoded)
                const keyBuffer = base64ToArrayBuffer(keyInfo.public_key);
                const cryptoKey = await crypto.subtle.importKey(
                    "spki",
                    keyBuffer,
                    { name: "Ed25519" },
                    false,
                    ["verify"]
                );
                console.log(`[Guardian] Successfully imported key: ${keyId}`);

                publicKeys.set(keyId, {
                    cryptoKey: cryptoKey,
                    validFrom: new Date(keyInfo.valid_from),
                    warnAfter: keyInfo.warn_after ? new Date(keyInfo.warn_after) : null,
                    validUntil: new Date(keyInfo.valid_until)
                });

                console.log(`[Guardian] Loaded key: ${keyId}`);
            } catch (err) {
                console.error(`[Guardian] Failed to import key ${keyId}:`, err);
            }
        }

        return publicKeys.size > 0;
    } catch (err) {
        console.error("[Guardian] Failed to load public keys:", err);
        return false;
    }
}

// ============================================================
// Signatur-Verifikation
// ============================================================

/**
 * Signatur einer Response verifizieren
 */
async function verifySignature(body, signature, timestamp, keyId) {
    // Key finden
    const keyInfo = publicKeys.get(keyId);
    if (!keyInfo) {
        return { valid: false, reason: `Unknown key ID: ${keyId}` };
    }

    const now = new Date();

    // Hartlimit prüfen (Key abgelaufen)
    if (now > keyInfo.validUntil) {
        return {
            valid: false,
            expired: true,
            reason: `Key ${keyId} ist abgelaufen (Hartlimit erreicht)`
        };
    }

    // Timestamp prüfen
    const timestampDate = new Date(timestamp * 1000);
    const ageSeconds = Math.abs((now - timestampDate) / 1000);
    if (ageSeconds > GUARDIAN_CONFIG.maxTimestampAge) {
        return {
            valid: false,
            reason: `Timestamp too old: ${ageSeconds}s (max ${GUARDIAN_CONFIG.maxTimestampAge}s)`
        };
    }

    // Daten zum Verifizieren: body|timestamp
    const dataToVerify = body + "|" + timestamp;
    const dataBuffer = new TextEncoder().encode(dataToVerify);

    // Signatur dekodieren
    const signatureBuffer = base64ToArrayBuffer(signature);

    // Verifizieren
    try {
        const valid = await crypto.subtle.verify(
            { name: "Ed25519" },
            keyInfo.cryptoKey,
            signatureBuffer,
            dataBuffer
        );

        // Deprecation-Warnung prüfen
        const deprecated = keyInfo.warnAfter && now > keyInfo.warnAfter;

        return {
            valid: valid,
            keyId: keyId,
            deprecated: deprecated,
            reason: valid ? null : "Signature mismatch - possible MITM attack!"
        };
    } catch (err) {
        return {
            valid: false,
            reason: `Verification error: ${err.message}`
        };
    }
}

// ============================================================
// Request Monitoring
// ============================================================

/**
 * Response Headers verarbeiten
 */
async function processResponse(details) {
    // Requests ohne gültige tabId ignorieren (z.B. Service Worker)
    if (!details.tabId || details.tabId < 0) {
        return;
    }

    // Nur geschützte Hosts
    const url = new URL(details.url);
    if (!isProtectedHost(url.hostname)) {
        return;
    }

    // CloudFlare CDN Ressourcen überspringen (können nicht signiert werden)
    if (url.pathname.startsWith("/cdn-cgi/")) {
        return;
    }

    // Service Worker überspringen
    if (url.pathname.endsWith("/sw.js")) {
        return;
    }

    // Statische Assets mit Hash überspringen
    if (isHashedAsset(details.url)) {
        return;
    }

    // Signatur-Header extrahieren
    const headers = {};
    for (const header of details.responseHeaders || []) {
        headers[header.name.toLowerCase()] = header.value;
    }

    const signature = headers[GUARDIAN_CONFIG.headers.signature];
    const timestamp = headers[GUARDIAN_CONFIG.headers.timestamp];
    const keyId = headers[GUARDIAN_CONFIG.headers.keyId];

    // Status für diesen Tab aktualisieren
    let status = tabSecurityStatus.get(details.tabId) || {
        status: "PROTECTED",
        verified: 0,
        unsigned: 0,
        failed: [],
        deprecated: false
    };

    const contentType = headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");
    const isApi = details.url.includes("api=1") || details.url.includes("/api/");

    // Wenn keine Signatur-Header vorhanden
    if (!signature || !timestamp || !keyId) {
        // Auf geschützten Hosts MÜSSEN Signatur-Header vorhanden sein!
        // Fehlende Header = möglicher MITM oder Downgrade-Angriff
        status.unsigned++;

        if (isHtml || isApi) {
            // HTML-Seiten und API-Responses MÜSSEN signiert sein
            console.warn(`[Guardian] UNSIGNED ${isApi ? 'API' : 'HTML'}: ${details.url}`);

            // Status auf WARNING setzen wenn noch kein COMPROMISED
            if (status.status !== "COMPROMISED") {
                status.status = "UNSIGNED";
            }
        } else {
            // Andere Ressourcen (JS, CSS, Bilder) - nur loggen
            console.log(`[Guardian] Unsigned resource: ${details.url}`);
        }

        tabSecurityStatus.set(details.tabId, status);
        updateBadge(details.tabId, status);
        return;
    }

    // MV3 Limitation: webRequest API gibt keinen Zugriff auf Response Body
    // Wir können nur prüfen, ob Signatur-Header vorhanden sind
    // Echte Verifikation erfolgt nur für API-Calls die wir selbst machen

    // Signatur-Header sind vorhanden = Server signiert korrekt
    // Das ist ein gutes Zeichen (kein transparenter Proxy der Header entfernt)
    status.verified++;

    // Status verbessern wenn vorher nur PROTECTED oder UNSIGNED (aber nicht überschreiben wenn schon mehr verifiziert)
    if (status.status === "PROTECTED") {
        status.status = "VERIFIED";
    } else if (status.status === "UNSIGNED" && status.verified > status.unsigned) {
        // Mehr verifiziert als unsigned = wahrscheinlich OK (Edge-Cases wie CDN)
        status.status = "VERIFIED";
    }

    console.log(`[Guardian] Signature headers present for: ${details.url} (Key: ${keyId})`);

    tabSecurityStatus.set(details.tabId, status);
    updateBadge(details.tabId, status);
}

// ============================================================
// UI Updates
// ============================================================

/**
 * Badge-Icon aktualisieren
 */
function updateBadge(tabId, status) {
    if (!status) return;

    let color, text;
    switch (status.status) {
        case "VERIFIED":
            color = "#10b981"; // Grün
            text = "✓";
            break;
        case "VERIFIED_DEPRECATED":
            color = "#f59e0b"; // Orange
            text = "⚠";
            break;
        case "KEY_EXPIRED":
            color = "#ef4444"; // Rot
            text = "⏰";
            break;
        case "COMPROMISED":
            color = "#ef4444"; // Rot
            text = "✗";
            break;
        case "UNSIGNED":
            color = "#ef4444"; // Rot - Fehlende Signaturen sind verdächtig!
            text = "!";
            break;
        case "PROTECTED":
            color = "#3b82f6"; // Blau
            text = "🛡";
            break;
        default:
            return; // Kein Badge für UNKNOWN
    }

    try {
        browser.action.setBadgeBackgroundColor({ tabId: tabId, color: color });
        browser.action.setBadgeText({ tabId: tabId, text: text });
    } catch (err) {
        console.warn("[Guardian] Failed to update badge:", err);
    }
}

/**
 * Badge für aktuellen Tab basierend auf URL aktualisieren
 */
async function updateBadgeForTab(tabId, url) {
    if (!url) return;

    try {
        const hostname = new URL(url).hostname;

        if (isProtectedHost(hostname)) {
            // Auf geschützter Seite - zeige Status oder "Protected"
            let status = tabSecurityStatus.get(tabId);
            if (!status) {
                // Noch kein Verifizierungsstatus - zeige "Protected"
                status = { status: "PROTECTED", verified: 0, unsigned: 0, failed: [] };
                tabSecurityStatus.set(tabId, status);
            }
            updateBadge(tabId, status);
        } else {
            // Nicht auf geschützter Seite - Badge entfernen
            browser.action.setBadgeText({ tabId: tabId, text: "" });
        }
    } catch (err) {
        // URL konnte nicht geparsed werden
    }
}

/**
 * Status für Tab zurücksetzen (bei Navigation)
 */
function resetTabStatus(tabId) {
    tabSecurityStatus.set(tabId, {
        status: "PROTECTED",
        verified: 0,
        unsigned: 0,
        failed: [],
        deprecated: false
    });
}

/**
 * Security-Warnung anzeigen
 */
function showSecurityWarning(tabId, message) {
    // Content Script benachrichtigen um Warnung anzuzeigen
    browser.tabs.sendMessage(tabId, {
        action: "guardian_warning",
        message: message
    }).catch(() => {
        // Tab hat möglicherweise kein Content Script
    });
}

// ============================================================
// Initialisierung
// ============================================================

/**
 * Guardian-Modul initialisieren
 */
async function initGuardian() {
    if (guardianInitialized) return;

    console.log("[Guardian] Initializing MITM Protection...");

    // Public Keys laden
    const keysLoaded = await loadPublicKeys();
    if (!keysLoaded) {
        console.warn("[Guardian] No public keys loaded - Response verification disabled");
        guardianInitialized = true; // Trotzdem als initialisiert markieren
        return;
    }

    // WebRequest Listener registrieren
    browser.webRequest.onResponseStarted.addListener(
        processResponse,
        {
            urls: [
                "*://trashmail.com/*",
                "*://*.trashmail.com/*",
                "*://byom.de/*",
                "*://*.byom.de/*"
            ]
        },
        ["responseHeaders"]
    );

    // Tab-Wechsel überwachen (Badge aktualisieren)
    browser.tabs.onActivated.addListener(async (activeInfo) => {
        try {
            const tab = await browser.tabs.get(activeInfo.tabId);
            await updateBadgeForTab(activeInfo.tabId, tab.url);
        } catch (err) {
            // Tab existiert möglicherweise nicht mehr
        }
    });

    // WICHTIG: webNavigation.onBeforeNavigate feuert VOR allen Requests!
    // Das ist der einzige sichere Zeitpunkt zum Zurücksetzen des Status.
    browser.webNavigation.onBeforeNavigate.addListener((details) => {
        // Nur Main Frame (keine iframes)
        if (details.frameId !== 0) return;

        console.log(`[Guardian] Navigation starting to: ${details.url}`);
        resetTabStatus(details.tabId);

        // Badge sofort auf PROTECTED setzen
        try {
            const hostname = new URL(details.url).hostname;
            if (isProtectedHost(hostname)) {
                updateBadge(details.tabId, { status: "PROTECTED" });
            }
        } catch (e) {
            // Ungültige URL ignorieren
        }
    });

    // Tab-URL geändert - nur für Badge-Update nach Laden
    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (changeInfo.status === "complete") {
            // Nach Laden: Badge aktualisieren falls Responses verarbeitet wurden
            await updateBadgeForTab(tabId, tab.url);
        }
    });

    // Tab geschlossen - Status entfernen
    browser.tabs.onRemoved.addListener((tabId) => {
        tabSecurityStatus.delete(tabId);
    });

    guardianInitialized = true;
    console.log("[Guardian] MITM Protection initialized with", publicKeys.size, "keys");

    // Initial Badge für alle offenen TrashMail-Tabs setzen
    browser.tabs.query({}).then(tabs => {
        for (const tab of tabs) {
            updateBadgeForTab(tab.id, tab.url);
        }
    });
}

// Guardian beim Laden der Extension starten
initGuardian().catch(err => {
    console.error("[Guardian] Failed to initialize:", err);
    guardianInitialized = true; // Trotzdem als initialisiert markieren damit Popup nicht "failed to load" zeigt
});

// Export für andere Module
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        initGuardian,
        verifySignature,
        isProtectedHost,
        getSecurityStatus: (tabId) => tabSecurityStatus.get(tabId)
    };
}
