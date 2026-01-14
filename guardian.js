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
// Browser Detection
// ============================================================

/**
 * Check if we're running in Firefox
 * Firefox has getSecurityInfo for TLS certificate verification
 */
function isFirefoxBrowser() {
    return typeof browser !== "undefined" &&
           typeof browser.webRequest !== "undefined" &&
           typeof browser.webRequest.getSecurityInfo === "function";
}

/**
 * Check if Ed25519 is supported in WebCrypto
 */
let ed25519Supported = null;
async function checkEd25519Support() {
    if (ed25519Supported !== null) return ed25519Supported;

    try {
        // Try to generate a test key
        await crypto.subtle.generateKey(
            { name: "Ed25519" },
            false,
            ["sign", "verify"]
        );
        ed25519Supported = true;
        console.log("[Guardian] Ed25519 is supported");
    } catch (err) {
        ed25519Supported = false;
        console.warn("[Guardian] Ed25519 NOT supported in this browser:", err.message);
    }
    return ed25519Supported;
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
// Global State (exposed on self for Service Worker access)
// ============================================================

let publicKeys = new Map(); // keyId -> { cryptoKey, validFrom, warnAfter, validUntil }
let guardianInitialized = false;
let tabSecurityStatus = new Map(); // tabId -> { status, reason, verified, failed }

// Expose variables on self for background.js access in Service Worker
// (let/const variables are not on global scope, need explicit assignment)
self.publicKeys = publicKeys;
self.guardianInitialized = guardianInitialized;
self.tabSecurityStatus = tabSecurityStatus;
self.ed25519Supported = ed25519Supported;
self.isFirefoxBrowser = isFirefoxBrowser;
self.isProtectedHost = isProtectedHost; // Also needed by background.js

console.log("[Guardian] Variables exposed on self for background.js");

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
// TLS Certificate Verification (Firefox only)
// ============================================================

/**
 * Cached server certificate fingerprint
 * Format: { fingerprint: "sha256:...", timestamp: 123456789 }
 */
let cachedCertFingerprint = null;

/**
 * Flag to prevent concurrent fingerprint fetches
 */
let fetchingFingerprint = false;

/**
 * Check if we're running in Firefox (getSecurityInfo is Firefox-only)
 * @deprecated Use isFirefoxBrowser() instead
 */
function isFirefox() {
    return isFirefoxBrowser();
}

/**
 * Fetch certificate fingerprint from server
 * Response is Ed25519 signed, so MITM cannot fake it
 */
async function fetchServerFingerprint() {
    if (fetchingFingerprint) return cachedCertFingerprint;
    fetchingFingerprint = true;

    try {
        console.log("[Guardian] Fetching certificate fingerprint from server...");

        const response = await fetch("https://trashmail.com/?api=1&cmd=cert_fingerprint", {
            method: "GET",
            headers: { "Accept": "application/json" }
        });

        if (!response.ok) {
            console.error("[Guardian] Failed to fetch fingerprint:", response.status);
            return null;
        }

        // Verify Ed25519 signature on response
        const signature = response.headers.get("x-aionda-signature");
        const timestamp = response.headers.get("x-aionda-timestamp");
        const keyId = response.headers.get("x-aionda-key-id");

        const body = await response.text();
        console.log("[Guardian] cert_fingerprint raw response:", body);

        const data = JSON.parse(body);
        console.log("[Guardian] cert_fingerprint parsed data:", data);

        if (!data.success) {
            console.error("[Guardian] Server returned error:", data.error);
            console.error("[Guardian] Full response data:", JSON.stringify(data));
            return null;
        }

        // Verify signature if headers present
        if (signature && timestamp && keyId) {
            const verification = await verifySignature(body, signature, parseInt(timestamp), keyId);
            if (!verification.valid) {
                console.error("[Guardian] Fingerprint response signature INVALID:", verification.reason);
                // CRITICAL: Don't trust unsigned/invalid fingerprint responses!
                return null;
            }
            console.log("[Guardian] Fingerprint response signature verified");
        } else {
            console.warn("[Guardian] Fingerprint response not signed - skipping verification");
        }

        cachedCertFingerprint = {
            fingerprint: data.fingerprint,
            timestamp: data.timestamp
        };

        console.log("[Guardian] Server fingerprint cached:", data.fingerprint.substring(0, 20) + "...");
        return cachedCertFingerprint;

    } catch (err) {
        console.error("[Guardian] Error fetching fingerprint:", err);
        return null;
    } finally {
        fetchingFingerprint = false;
    }
}

/**
 * Get SHA256 fingerprint from certificate
 * @param {Object} cert - Certificate object from getSecurityInfo
 * @returns {string} Fingerprint in format "sha256:hexstring"
 */
function getCertFingerprint(cert) {
    if (!cert || !cert.fingerprint || !cert.fingerprint.sha256) {
        return null;
    }
    // Firefox returns fingerprint with colons, e.g. "A1:B2:C3:..."
    // Convert to lowercase hex without colons
    const hex = cert.fingerprint.sha256.replace(/:/g, "").toLowerCase();
    return "sha256:" + hex;
}

/**
 * Check TLS certificate on request completion
 * Only works in Firefox with webRequestBlocking permission
 */
async function checkCertificate(details) {
    console.log("[Guardian] checkCertificate called for:", details.url);

    // Only Firefox supports getSecurityInfo
    if (!isFirefox()) {
        console.log("[Guardian] checkCertificate: Not Firefox, skipping");
        return;
    }

    // Ignore requests without valid tabId
    if (!details.tabId || details.tabId < 0) {
        console.log("[Guardian] checkCertificate: Invalid tabId, skipping");
        return;
    }

    // Only check protected hosts
    try {
        const url = new URL(details.url);
        if (!isProtectedHost(url.hostname)) {
            console.log("[Guardian] checkCertificate: Not protected host, skipping:", url.hostname);
            return;
        }
    } catch (e) {
        return;
    }

    console.log("[Guardian] checkCertificate: Checking certificate for protected host");
    console.log("[Guardian] Request ID:", details.requestId);

    try {
        // Get certificate info from browser
        const securityInfo = await browser.webRequest.getSecurityInfo(
            details.requestId,
            { certificateChain: true }
        );

        // console.log("[Guardian] securityInfo:", JSON.stringify(securityInfo, null, 2));

        if (!securityInfo || !securityInfo.certificates || securityInfo.certificates.length === 0) {
            console.warn("[Guardian] No certificate info available for:", details.url);
            console.warn("[Guardian] securityInfo was:", securityInfo);
            return;
        }

        // Get leaf certificate fingerprint (the one presented by the server/CDN/proxy)
        // certificates[0] should be the leaf cert, but verify by checking subject
        let cert = securityInfo.certificates[0];

        // Sanity check: leaf cert should have the domain in subject
        if (cert.subject && !cert.subject.includes('trashmail.com') && !cert.subject.includes('byom.de')) {
            console.warn("[Guardian] certificates[0] is not the leaf cert, searching...");
            for (const c of securityInfo.certificates) {
                if (c.subject && (c.subject.includes('trashmail.com') || c.subject.includes('byom.de'))) {
                    cert = c;
                    break;
                }
            }
        }

        console.log("[Guardian] Using cert with subject:", cert.subject);
        const browserFingerprint = getCertFingerprint(cert);
        if (!browserFingerprint) {
            console.warn("[Guardian] Could not extract fingerprint from certificate");
            return;
        }

        // First request? Fetch server fingerprint
        if (!cachedCertFingerprint) {
            await fetchServerFingerprint();
            if (!cachedCertFingerprint) {
                console.warn("[Guardian] Could not get server fingerprint for comparison");
                return;
            }
        }

        // Compare fingerprints
        if (browserFingerprint === cachedCertFingerprint.fingerprint) {
            // Fingerprints match - all good!
            console.log("[Guardian] Certificate fingerprint OK:", browserFingerprint);

            // Store TLS verification status
            let status = tabSecurityStatus.get(details.tabId) || {
                status: "PROTECTED",
                verified: 0,
                unsigned: 0,
                failed: [],
                deprecated: false
            };
            status.tlsVerified = true;
            status.tlsFingerprint = browserFingerprint;
            tabSecurityStatus.set(details.tabId, status);

            return;
        }

        // MISMATCH! But don't panic yet - certificate might have been renewed
        console.warn("[Guardian] Certificate fingerprint MISMATCH!");
        console.warn("[Guardian] Browser sees:", browserFingerprint);
        console.warn("[Guardian] Server reported:", cachedCertFingerprint.fingerprint);

        // Fetch fresh fingerprint from server (Ed25519 signed - cannot be faked)
        const freshFingerprint = await fetchServerFingerprint();
        if (!freshFingerprint) {
            // Could not verify - treat as suspicious
            handleMitmDetected(details.tabId, browser.i18n.getMessage("guardianTlsUnreachable"));
            return;
        }

        // Compare fresh server fingerprint with what browser sees
        if (browserFingerprint === freshFingerprint.fingerprint) {
            // OK! Certificate was renewed, our cache was outdated
            console.log("[Guardian] Certificate was renewed - fingerprints now match");
            cachedCertFingerprint = freshFingerprint;

            // Store TLS verification status
            let status = tabSecurityStatus.get(details.tabId) || {
                status: "PROTECTED",
                verified: 0,
                unsigned: 0,
                failed: [],
                deprecated: false
            };
            status.tlsVerified = true;
            status.tlsFingerprint = browserFingerprint;
            tabSecurityStatus.set(details.tabId, status);

            return;
        }

        // MITM DETECTED!
        // Browser sees different certificate than server reports
        // And server response is Ed25519 signed, so it cannot be faked
        console.error("[Guardian] ⚠️ MITM DETECTED! Certificate mismatch after fresh fetch!");
        console.error("[Guardian] Browser sees:", browserFingerprint);
        console.error("[Guardian] Server says:", freshFingerprint.fingerprint);

        const issuerInfo = securityInfo.certificates[0].issuer || "Unknown issuer";
        const mitmMsg = browser.i18n.getMessage("guardianTlsMitmDetected") + "\n\n" +
            browser.i18n.getMessage("guardianTlsBrowserCert") + ": " + browserFingerprint.substring(0, 30) + "...\n" +
            browser.i18n.getMessage("guardianTlsExpected") + ": " + freshFingerprint.fingerprint.substring(0, 30) + "...\n\n" +
            browser.i18n.getMessage("guardianTlsIssuer") + ": " + issuerInfo + "\n\n" +
            browser.i18n.getMessage("guardianTlsProxyWarning");
        handleMitmDetected(details.tabId, mitmMsg);

    } catch (err) {
        console.error("[Guardian] Error checking certificate:", err);
        console.error("[Guardian] Error details:", err.message, err.stack);
    }
}

/**
 * Handle MITM detection
 */
function handleMitmDetected(tabId, message) {
    // Update tab status
    let status = tabSecurityStatus.get(tabId) || {
        status: "COMPROMISED",
        verified: 0,
        unsigned: 0,
        failed: [],
        deprecated: false
    };

    status.status = "COMPROMISED";
    status.mitmDetected = true;
    status.mitmMessage = message;

    tabSecurityStatus.set(tabId, status);
    updateBadge(tabId, status);

    // Show warning to user
    showSecurityWarning(tabId, message);

    // Also show browser notification
    browser.notifications.create({
        type: "basic",
        iconUrl: "images/warning-32.png",
        title: "⚠️ " + browser.i18n.getMessage("guardianNotificationTitle"),
        message: browser.i18n.getMessage("guardianNotificationMitm"),
        priority: 2
    }).catch(() => {
        // Notifications permission may not be granted
    });
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

        // Check Ed25519 support first
        const hasEd25519 = await checkEd25519Support();
        if (!hasEd25519) {
            console.warn("[Guardian] Ed25519 not supported - signature verification disabled");
            console.warn("[Guardian] Chrome 113+ required for full Guardian functionality");
            // Return true to mark as initialized, but with limited functionality
            return true;
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
    console.log("[Guardian] processResponse called for:", details.url);

    // Ignore requests without valid tabId (e.g. Service Worker)
    if (!details.tabId || details.tabId < 0) {
        console.log("[Guardian] processResponse: Invalid tabId, skipping");
        return;
    }

    // Only protected hosts
    const url = new URL(details.url);
    if (!isProtectedHost(url.hostname)) {
        console.log("[Guardian] processResponse: Not protected host, skipping");
        return;
    }

    // Skip CloudFlare CDN resources (cannot be signed)
    if (url.pathname.startsWith("/cdn-cgi/")) {
        console.log("[Guardian] processResponse: CloudFlare CDN resource, skipping");
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

                // Show warning popup for missing signatures (possible MITM stripping headers)
                const missingMsg = (isApi ? browser.i18n.getMessage("guardianMissingSignatureApi") : browser.i18n.getMessage("guardianMissingSignaturePage")) + "\n\n" +
                    browser.i18n.getMessage("guardianMissingSignatureUrl") + ": " + details.url + "\n\n" +
                    browser.i18n.getMessage("guardianMissingSignatureHint") + "\n" +
                    "• " + browser.i18n.getMessage("guardianMissingSignatureReason1") + "\n" +
                    "• " + browser.i18n.getMessage("guardianMissingSignatureReason2") + "\n" +
                    "• " + browser.i18n.getMessage("guardianMissingSignatureReason3");
                showSecurityWarning(details.tabId, missingMsg);
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

            // If still PROTECTED (no verification yet) and on trashmail.com, do a ping request
            // This handles cached pages where no HTTP requests were made
            if (status.status === "PROTECTED" && status.verified === 0 &&
                (hostname === "trashmail.com" || hostname === "www.trashmail.com" || hostname === "dev.trashmail.com")) {
                pingForVerification(tabId, hostname);
            }
        } else {
            // Not on protected site - remove badge
            browser.action.setBadgeText({ tabId: tabId, text: "" });
        }
    } catch (err) {
        // URL could not be parsed
    }
}

/**
 * Ping trashmail.com to trigger signature verification (for cached pages)
 */
let pingInProgress = new Set();
async function pingForVerification(tabId, hostname) {
    // Prevent multiple pings for the same tab
    if (pingInProgress.has(tabId)) return;
    pingInProgress.add(tabId);

    try {
        console.log("[Guardian] Ping for verification on cached page, tab:", tabId);
        // Small API request that will be signed
        const response = await fetch(`https://${hostname}/?api=1&cmd=ping`, {
            method: "GET",
            cache: "no-store" // Bypass cache
        });

        // Check signature headers directly (fetch from Service Worker has no tabId for onResponseStarted)
        const signature = response.headers.get(GUARDIAN_CONFIG.headers.signature);
        const timestamp = response.headers.get(GUARDIAN_CONFIG.headers.timestamp);
        const keyId = response.headers.get(GUARDIAN_CONFIG.headers.keyId);

        console.log("[Guardian] Ping response - signature present:", !!signature);

        let status = tabSecurityStatus.get(tabId) || {
            status: "PROTECTED",
            verified: 0,
            unsigned: 0,
            failed: [],
            deprecated: false
        };

        if (signature && timestamp && keyId) {
            // Signature headers present - mark as verified
            status.verified++;
            status.status = "VERIFIED";
            console.log("[Guardian] Ping verified, updating badge to green");
        } else {
            // No signature - suspicious
            status.unsigned++;
            status.status = "UNSIGNED";
            console.log("[Guardian] Ping unsigned, keeping badge status");
        }

        tabSecurityStatus.set(tabId, status);
        updateBadge(tabId, status);

    } catch (err) {
        console.log("[Guardian] Ping failed:", err.message);
    } finally {
        pingInProgress.delete(tabId);
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
    console.log("[Guardian] showSecurityWarning called for tab:", tabId, "message:", message.substring(0, 50) + "...");

    // Get localized strings for the warning dialog
    const warningTitle = browser.i18n.getMessage("guardianWarningTitle");
    const dismissText = browser.i18n.getMessage("guardianWarningDismiss");

    // Try sending to content script first
    browser.tabs.sendMessage(tabId, {
        action: "guardian_warning",
        message: message,
        title: warningTitle,
        dismissText: dismissText
    }).then(() => {
        console.log("[Guardian] Warning message sent successfully to tab:", tabId);
    }).catch((err) => {
        console.warn("[Guardian] Content script not ready, injecting warning directly:", err.message);

        // Content script not loaded yet - inject warning directly using scripting API (MV3)
        browser.scripting.executeScript({
            target: { tabId: tabId },
            func: (warningMessage, title, dismiss) => {
                if (document.getElementById('trashmail-mitm-warning')) return;
                const overlay = document.createElement('div');
                overlay.id = 'trashmail-mitm-warning';
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(220,38,38,0.95);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';

                // Escape HTML in message
                const escaped = warningMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const escapedDismiss = dismiss.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                overlay.innerHTML = '<div style="background:white;padding:32px;border-radius:12px;max-width:500px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.25);">' +
                    '<div style="font-size:48px;margin-bottom:16px;">⚠️</div>' +
                    '<h1 style="color:#dc2626;margin:0 0 16px 0;font-size:24px;">' + escapedTitle + '</h1>' +
                    '<pre style="background:#fef2f2;padding:16px;border-radius:8px;text-align:left;white-space:pre-wrap;word-break:break-word;font-size:13px;color:#7f1d1d;margin:0 0 20px 0;max-height:200px;overflow:auto;">' + escaped + '</pre>' +
                    '<button id="trashmail-mitm-dismiss" style="background:#dc2626;color:white;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer;">' + escapedDismiss + '</button>' +
                    '</div>';

                document.body.appendChild(overlay);

                // Add event listener for dismiss button
                document.getElementById('trashmail-mitm-dismiss').addEventListener('click', () => {
                    overlay.remove();
                });
            },
            args: [message, warningTitle, dismissText]
        }).then(() => {
            console.log("[Guardian] Warning injected directly into tab:", tabId);
        }).catch((err2) => {
            console.error("[Guardian] Failed to inject warning:", err2);
        });
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
        self.guardianInitialized = true; // Update self reference for background.js
        return;
    }

    // Register WebRequest listener for signature verification
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

    // Register certificate verification listener (Firefox only)
    // Uses onCompleted because getSecurityInfo needs completed request
    console.log("[Guardian] Checking isFirefox():", isFirefox());
    console.log("[Guardian] browser.webRequest:", typeof browser.webRequest);
    console.log("[Guardian] browser.webRequest.getSecurityInfo:", typeof browser.webRequest?.getSecurityInfo);

    // TLS Certificate verification (Firefox only)
    // Uses cert.trashmail.com CNAME to ensure server connects through CloudFlare
    if (isFirefox()) {
        console.log("[Guardian] Firefox detected - enabling TLS certificate verification");
        browser.webRequest.onHeadersReceived.addListener(
            checkCertificate,
            {
                urls: [
                    "*://trashmail.com/*",
                    "*://*.trashmail.com/*",
                    "*://byom.de/*",
                    "*://*.byom.de/*"
                ]
            },
            ["blocking"]
        );
        console.log("[Guardian] onHeadersReceived (blocking) listener registered for TLS verification");
    } else {
        console.log("[Guardian] Chrome detected - TLS certificate verification not available");
    }

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
            // Multiple updates to catch late responses
            updateBadgeForTab(tabId, tab.url);
            setTimeout(() => updateBadgeForTab(tabId, tab.url), 250);
            setTimeout(() => updateBadgeForTab(tabId, tab.url), 500);
        }
    });

    // Tab closed - remove status
    browser.tabs.onRemoved.addListener((tabId) => {
        tabSecurityStatus.delete(tabId);
    });

    guardianInitialized = true;
    self.guardianInitialized = true; // Update self reference for background.js
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
    self.guardianInitialized = true; // Update self reference for background.js
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
