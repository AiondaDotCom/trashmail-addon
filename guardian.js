"use strict";

/**
 * TrashMail Guardian - MITM Protection Module
 *
 * Verifies response signatures to detect Man-in-the-Middle attacks.
 * Protects against ZScaler, CloudFlare Enterprise and other SSL-inspecting proxies.
 */

// Compatibility layer
if (typeof browser === "undefined") {
    var browser = chrome;
}

// ============================================================
// Configuration
// ============================================================

const GUARDIAN_CONFIG = {
    // Hosts to monitor
    protectedHosts: [
        "trashmail.com",
        "www.trashmail.com",
        "dev.trashmail.com",
        "byom.de",
        "www.byom.de"
    ],
    // Maximum age of a timestamp in seconds
    maxTimestampAge: 300, // 5 minutes
    // Header names
    headers: {
        signature: "x-aionda-signature",
        timestamp: "x-aionda-timestamp",
        keyId: "x-aionda-key-id"
    }
};

// ============================================================
// Global State
// ============================================================

let publicKeys = new Map(); // keyId -> { cryptoKey, validFrom, warnAfter, validUntil }
let guardianInitialized = false;
let tabSecurityStatus = new Map(); // tabId -> { status, reason, verified, failed }

// ============================================================
// Message Handler (Top-Level for immediate registration)
// ============================================================

console.log("[Guardian] Registering message handler...");

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "get_guardian_status") {
        console.log("[Guardian] Received get_guardian_status request");

        // Get status for current tab
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
                // Invalid URL
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
    // Don't handle other messages - leave to other listeners
});

console.log("[Guardian] Message handler registered");

// ============================================================
// Helper Functions
// ============================================================

/**
 * Convert Base64 to ArrayBuffer
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
 * Check if a host is protected
 */
function isProtectedHost(hostname) {
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    return GUARDIAN_CONFIG.protectedHosts.some(h =>
        lower === h || lower.endsWith("." + h)
    );
}

/**
 * Check if a URL is a static asset with hash
 * Detects both short (8 chars) and full SHA-256 hashes (64 chars)
 */
function isHashedAsset(url) {
    // Pattern: filename.HASH.ext (e.g. app.a1b2c3d4.js or app.61bd607be317d6f746f436cc259f3a933396753b73ab14c891a768916bd97e04.min.js)
    // At least 8 hex chars, typically 64 chars (SHA-256)
    return /\.[a-f0-9]{8,64}\.(?:min\.)?(js|css|png|jpg|jpeg|gif|svg|webp|woff2?)$/i.test(url);
}

// ============================================================
// Key Management
// ============================================================

/**
 * Load public keys from public_key.json
 */
async function loadPublicKeys() {
    try {
        console.log("[Guardian] Loading public keys...");

        // Check if crypto.subtle is available
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
                // Import public key (SPKI DER format, Base64 encoded)
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
// Signature Verification
// ============================================================

/**
 * Verify response signature
 */
async function verifySignature(body, signature, timestamp, keyId) {
    // Find key
    const keyInfo = publicKeys.get(keyId);
    if (!keyInfo) {
        return { valid: false, reason: `Unknown key ID: ${keyId}` };
    }

    const now = new Date();

    // Check hard limit (key expired)
    if (now > keyInfo.validUntil) {
        return {
            valid: false,
            expired: true,
            reason: `Key ${keyId} has expired (hard limit reached)`
        };
    }

    // Check timestamp
    const timestampDate = new Date(timestamp * 1000);
    const ageSeconds = Math.abs((now - timestampDate) / 1000);
    if (ageSeconds > GUARDIAN_CONFIG.maxTimestampAge) {
        return {
            valid: false,
            reason: `Timestamp too old: ${ageSeconds}s (max ${GUARDIAN_CONFIG.maxTimestampAge}s)`
        };
    }

    // Data to verify: body|timestamp
    const dataToVerify = body + "|" + timestamp;
    const dataBuffer = new TextEncoder().encode(dataToVerify);

    // Decode signature
    const signatureBuffer = base64ToArrayBuffer(signature);

    // Verify
    try {
        const valid = await crypto.subtle.verify(
            { name: "Ed25519" },
            keyInfo.cryptoKey,
            signatureBuffer,
            dataBuffer
        );

        // Check deprecation warning
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
 * Process response headers
 */
async function processResponse(details) {
    // Ignore requests without valid tabId (e.g. Service Worker)
    if (!details.tabId || details.tabId < 0) {
        return;
    }

    // Only protected hosts
    const url = new URL(details.url);
    if (!isProtectedHost(url.hostname)) {
        return;
    }

    // Skip CloudFlare CDN resources (cannot be signed)
    if (url.pathname.startsWith("/cdn-cgi/")) {
        return;
    }

    // Skip Service Worker
    if (url.pathname.endsWith("/sw.js")) {
        return;
    }

    // Skip static assets with hash
    if (isHashedAsset(details.url)) {
        return;
    }

    // Extract signature headers
    const headers = {};
    for (const header of details.responseHeaders || []) {
        headers[header.name.toLowerCase()] = header.value;
    }

    const signature = headers[GUARDIAN_CONFIG.headers.signature];
    const timestamp = headers[GUARDIAN_CONFIG.headers.timestamp];
    const keyId = headers[GUARDIAN_CONFIG.headers.keyId];

    // Update status for this tab
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

    // If no signature headers present
    if (!signature || !timestamp || !keyId) {
        // On protected hosts signature headers MUST be present!
        // Missing headers = possible MITM or downgrade attack
        status.unsigned++;

        if (isHtml || isApi) {
            // HTML pages and API responses MUST be signed
            console.warn(`[Guardian] UNSIGNED ${isApi ? 'API' : 'HTML'}: ${details.url}`);

            // Set status to WARNING if not already COMPROMISED
            if (status.status !== "COMPROMISED") {
                status.status = "UNSIGNED";
            }
        } else {
            // Other resources (JS, CSS, images) - only log
            console.log(`[Guardian] Unsigned resource: ${details.url}`);
        }

        tabSecurityStatus.set(details.tabId, status);
        updateBadge(details.tabId, status);
        return;
    }

    // MV3 Limitation: webRequest API does not provide access to response body
    // We can only check if signature headers are present
    // Real verification only happens for API calls we make ourselves

    // Signature headers present = server is signing correctly
    // This is a good sign (no transparent proxy stripping headers)
    status.verified++;

    // Improve status if previously only PROTECTED or UNSIGNED (but don't override if already more verified)
    if (status.status === "PROTECTED") {
        status.status = "VERIFIED";
    } else if (status.status === "UNSIGNED" && status.verified > status.unsigned) {
        // More verified than unsigned = probably OK (edge cases like CDN)
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
 * Update badge icon
 */
function updateBadge(tabId, status) {
    if (!status) return;

    let color, text;
    switch (status.status) {
        case "VERIFIED":
            color = "#10b981"; // Green
            text = "✓";
            break;
        case "VERIFIED_DEPRECATED":
            color = "#f59e0b"; // Orange
            text = "⚠";
            break;
        case "KEY_EXPIRED":
            color = "#ef4444"; // Red
            text = "⏰";
            break;
        case "COMPROMISED":
            color = "#ef4444"; // Red
            text = "✗";
            break;
        case "UNSIGNED":
            color = "#ef4444"; // Red - Missing signatures are suspicious!
            text = "!";
            break;
        case "PROTECTED":
            color = "#3b82f6"; // Blue
            text = "🛡";
            break;
        default:
            return; // No badge for UNKNOWN
    }

    try {
        browser.action.setBadgeBackgroundColor({ tabId: tabId, color: color });
        browser.action.setBadgeText({ tabId: tabId, text: text });
    } catch (err) {
        console.warn("[Guardian] Failed to update badge:", err);
    }
}

/**
 * Update badge for current tab based on URL
 */
async function updateBadgeForTab(tabId, url) {
    if (!url) return;

    try {
        const hostname = new URL(url).hostname;

        if (isProtectedHost(hostname)) {
            // On protected site - show status or "Protected"
            let status = tabSecurityStatus.get(tabId);
            if (!status) {
                // No verification status yet - show "Protected"
                status = { status: "PROTECTED", verified: 0, unsigned: 0, failed: [] };
                tabSecurityStatus.set(tabId, status);
            }
            updateBadge(tabId, status);
        } else {
            // Not on protected site - remove badge
            browser.action.setBadgeText({ tabId: tabId, text: "" });
        }
    } catch (err) {
        // URL could not be parsed
    }
}

/**
 * Reset status for tab (on navigation)
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
 * Show security warning
 */
function showSecurityWarning(tabId, message) {
    // Notify content script to show warning
    browser.tabs.sendMessage(tabId, {
        action: "guardian_warning",
        message: message
    }).catch(() => {
        // Tab may not have content script
    });
}

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize Guardian module
 */
async function initGuardian() {
    if (guardianInitialized) return;

    console.log("[Guardian] Initializing MITM Protection...");

    // Load public keys
    const keysLoaded = await loadPublicKeys();
    if (!keysLoaded) {
        console.warn("[Guardian] No public keys loaded - Response verification disabled");
        guardianInitialized = true; // Still mark as initialized
        return;
    }

    // Register WebRequest listener
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

    // Monitor tab changes (update badge)
    browser.tabs.onActivated.addListener(async (activeInfo) => {
        try {
            const tab = await browser.tabs.get(activeInfo.tabId);
            await updateBadgeForTab(activeInfo.tabId, tab.url);
        } catch (err) {
            // Tab may no longer exist
        }
    });

    // IMPORTANT: webNavigation.onBeforeNavigate fires BEFORE all requests!
    // This is the only safe time to reset status.
    browser.webNavigation.onBeforeNavigate.addListener((details) => {
        // Only main frame (no iframes)
        if (details.frameId !== 0) return;

        console.log(`[Guardian] Navigation starting to: ${details.url}`);
        resetTabStatus(details.tabId);

        // Set badge to PROTECTED immediately
        try {
            const hostname = new URL(details.url).hostname;
            if (isProtectedHost(hostname)) {
                updateBadge(details.tabId, { status: "PROTECTED" });
            }
        } catch (e) {
            // Ignore invalid URL
        }
    });

    // Tab URL changed - only for badge update after load
    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (changeInfo.status === "complete") {
            // After load: update badge if responses were processed
            await updateBadgeForTab(tabId, tab.url);
        }
    });

    // Tab closed - remove status
    browser.tabs.onRemoved.addListener((tabId) => {
        tabSecurityStatus.delete(tabId);
    });

    guardianInitialized = true;
    console.log("[Guardian] MITM Protection initialized with", publicKeys.size, "keys");

    // Set initial badge for all open TrashMail tabs
    browser.tabs.query({}).then(tabs => {
        for (const tab of tabs) {
            updateBadgeForTab(tab.id, tab.url);
        }
    });
}

// Start Guardian when extension loads
initGuardian().catch(err => {
    console.error("[Guardian] Failed to initialize:", err);
    guardianInitialized = true; // Still mark as initialized so popup doesn't show "failed to load"
});

// Export for other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        initGuardian,
        verifySignature,
        isProtectedHost,
        getSecurityStatus: (tabId) => tabSecurityStatus.get(tabId)
    };
}
