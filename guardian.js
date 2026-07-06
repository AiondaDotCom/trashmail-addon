"use strict";
(() => {
  // trashmail-addon/ts/guardian.ts
  var browser = globalThis.browser ?? chrome;
  function isFirefoxBrowser() {
    return typeof browser !== "undefined" && typeof browser.webRequest !== "undefined" && typeof browser.webRequest.getSecurityInfo === "function";
  }
  var ed25519Supported = null;
  async function checkEd25519Support() {
    if (ed25519Supported !== null) {
      return ed25519Supported;
    }
    try {
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
  var GUARDIAN_CONFIG = {
    // Hosts to monitor
    protectedHosts: [
      "mail.aionda.com",
      "dev.mail.aionda.com",
      "trashmail.com",
      "www.trashmail.com",
      "dev.trashmail.com",
      "byom.de",
      "www.byom.de",
      "s.aionda.com",
      "dev.s.aionda.com"
    ],
    // Maximum age of a timestamp in seconds
    maxTimestampAge: 300,
    // 5 minutes
    // Header names
    headers: {
      signature: "x-aionda-signature",
      timestamp: "x-aionda-timestamp",
      keyId: "x-aionda-key-id"
    }
  };
  var publicKeys = /* @__PURE__ */ new Map();
  var guardianInitialized = false;
  var tabSecurityStatus = /* @__PURE__ */ new Map();
  self.publicKeys = publicKeys;
  self.guardianInitialized = guardianInitialized;
  self.tabSecurityStatus = tabSecurityStatus;
  self.ed25519Supported = ed25519Supported;
  self.isFirefoxBrowser = isFirefoxBrowser;
  self.isProtectedHost = isProtectedHost;
  console.log("[Guardian] Variables exposed on self for background.js");
  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  function isProtectedHost(hostname) {
    if (!hostname) {
      return false;
    }
    const lower = hostname.toLowerCase();
    return GUARDIAN_CONFIG.protectedHosts.some(
      (h) => lower === h || lower.endsWith(`.${h}`)
    );
  }
  function isHashedAsset(url) {
    return /\.[a-f0-9]{8,64}\.(?:min\.)?(js|css|png|jpg|jpeg|gif|svg|webp|woff2?)$/i.test(url);
  }
  var cachedCertFingerprints = {};
  var fetchingFingerprints = {};
  function isFirefox() {
    return isFirefoxBrowser();
  }
  async function fetchServerFingerprint(hostname) {
    const host = hostname || "mail.aionda.com";
    const cached = cachedCertFingerprints[host];
    if (cached) {
      return cached;
    }
    if (fetchingFingerprints[host]) {
      return null;
    }
    fetchingFingerprints[host] = true;
    try {
      console.log("[Guardian] Fetching certificate fingerprint from server for:", host);
      const apiUrl = `https://mail.aionda.com/?api=1&cmd=cert_fingerprint&hostname=${encodeURIComponent(host)}`;
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) {
        console.error("[Guardian] Failed to fetch fingerprint:", response.status);
        return null;
      }
      const signature = response.headers.get("x-aionda-signature");
      const timestamp = response.headers.get("x-aionda-timestamp");
      const keyId = response.headers.get("x-aionda-key-id");
      const body = await response.text();
      const data = JSON.parse(body);
      if (!data.success) {
        console.error("[Guardian] Server returned error:", data.error);
        return null;
      }
      if (signature && timestamp && keyId) {
        const verification = await verifySignature(body, signature, parseInt(timestamp), keyId);
        if (!verification.valid) {
          console.error("[Guardian] Fingerprint response signature INVALID:", verification.reason);
          return null;
        }
        console.log("[Guardian] Fingerprint response signature verified for:", host);
      } else {
        console.warn("[Guardian] Fingerprint response not signed - skipping verification");
      }
      cachedCertFingerprints[host] = {
        fingerprint: data.fingerprint,
        timestamp: data.timestamp,
        // issuer liefert der Server nur bei einem Cache-Miss mit (frischer
        // openssl-Aufruf); bei einem Server-seitigen Cache-Hit fehlt es. Der
        // fingerprint ist dagegen IMMER vorhanden — deshalb ist der
        // Fingerprint-Vergleich in checkCertificate der primäre Beweis.
        issuer: data.issuer
      };
      console.log("[Guardian] Server fingerprint cached for", `${host}:`, `${data.fingerprint.substring(0, 30)}...`);
      return cachedCertFingerprints[host] ?? null;
    } catch (err) {
      console.error("[Guardian] Error fetching fingerprint:", err);
      return null;
    } finally {
      fetchingFingerprints[host] = false;
    }
  }
  function getCertFingerprint(cert) {
    if (!cert || !cert.fingerprint || !cert.fingerprint.sha256) {
      return null;
    }
    const hex = cert.fingerprint.sha256.replace(/:/g, "").toLowerCase();
    return `sha256:${hex}`;
  }
  async function checkCertificate(details) {
    if (!guardianEnabled) {
      return;
    }
    console.log("[Guardian] checkCertificate called for:", details.url);
    if (!isFirefox()) {
      console.log("[Guardian] checkCertificate: Not Firefox, skipping");
      return;
    }
    if (!details.tabId || details.tabId < 0) {
      console.log("[Guardian] checkCertificate: Invalid tabId, skipping");
      return;
    }
    try {
      const url = new URL(details.url);
      if (!isProtectedHost(url.hostname)) {
        console.log("[Guardian] checkCertificate: Not protected host, skipping:", url.hostname);
        return;
      }
    } catch (e) {
      return;
    }
    const requestHostname = new URL(details.url).hostname;
    console.log("[Guardian] checkCertificate: Checking certificate for protected host:", requestHostname);
    console.log("[Guardian] Request ID:", details.requestId);
    try {
      const securityInfo = await browser.webRequest.getSecurityInfo(
        details.requestId,
        { certificateChain: true }
      );
      if (!securityInfo || !securityInfo.certificates || securityInfo.certificates.length === 0) {
        console.warn("[Guardian] No certificate info available for:", details.url);
        console.warn("[Guardian] securityInfo was:", securityInfo);
        return;
      }
      let cert = securityInfo.certificates[0];
      if (!cert) {
        return;
      }
      if (cert.subject && !cert.subject.includes("mail.aionda.com") && !cert.subject.includes("trashmail.com") && !cert.subject.includes("byom.de")) {
        console.warn("[Guardian] certificates[0] is not the leaf cert, searching...");
        for (const c of securityInfo.certificates) {
          if (c.subject && (c.subject.includes("mail.aionda.com") || c.subject.includes("trashmail.com") || c.subject.includes("byom.de"))) {
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
      const TRUSTED_ISSUERS = [
        "Google Trust Services",
        "Cloudflare",
        "Let's Encrypt",
        "DigiCert",
        "Sectigo"
      ];
      const KNOWN_MITM_ISSUERS = [
        "ZScaler",
        "Zscaler",
        "Netskope",
        "Fortinet",
        "Palo Alto",
        "Blue Coat",
        "Symantec",
        "Check Point",
        "Barracuda",
        "Sophos",
        "WatchGuard",
        "Cisco Umbrella"
      ];
      const browserIssuer = cert.issuer || "";
      const browserSubject = cert.subject || "";
      console.log("[Guardian] Cert issuer:", browserIssuer);
      console.log("[Guardian] Cert subject:", browserSubject);
      const isMitmIssuer = KNOWN_MITM_ISSUERS.some((m) => browserIssuer.toLowerCase().includes(m.toLowerCase()));
      if (isMitmIssuer) {
        console.error("[Guardian] MITM DETECTED! Known proxy issuer:", browserIssuer);
        const mitmMsg2 = `${browser.i18n.getMessage("guardianTlsMitmDetected")}

${browser.i18n.getMessage("guardianTlsBrowserCert")}: ${browserFingerprint.substring(0, 30)}...
${browser.i18n.getMessage("guardianTlsIssuer")}: ${browserIssuer}

${browser.i18n.getMessage("guardianTlsProxyWarning")}`;
        handleMitmDetected(details.tabId, mitmMsg2);
        return;
      }
      const isTrustedIssuer = TRUSTED_ISSUERS.some((t) => browserIssuer.includes(t));
      const expectedDomains = ["aionda.com", "trashmail.com", "byom.de"];
      const subjectMatchesDomain = expectedDomains.some((d) => browserSubject.toLowerCase().includes(d));
      if (isTrustedIssuer && subjectMatchesDomain) {
        console.log("[Guardian] Certificate OK \u2014 trusted issuer:", browserIssuer, "subject:", browserSubject);
        const status = tabSecurityStatus.get(details.tabId) || {
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
      const serverInfo = await fetchServerFingerprint(requestHostname);
      if (serverInfo) {
        if (serverInfo.fingerprint && serverInfo.fingerprint === browserFingerprint) {
          console.log("[Guardian] Certificate OK \u2014 fingerprint matches signed server fingerprint");
          const status = tabSecurityStatus.get(details.tabId) || {
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
        if (serverInfo.issuer) {
          const serverIssuerOrg = serverInfo.issuer.match(/O\s*=\s*([^,]+)/)?.[1]?.trim() || "";
          const browserIssuerOrg = browserIssuer.match(/O\s*=\s*([^,]+)/)?.[1]?.trim() || "";
          if (serverIssuerOrg && browserIssuerOrg && serverIssuerOrg === browserIssuerOrg && subjectMatchesDomain) {
            console.log("[Guardian] Certificate OK \u2014 issuer org matches server:", browserIssuerOrg);
            const status = tabSecurityStatus.get(details.tabId) || {
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
        }
      }
      console.error("[Guardian] MITM suspected! Untrusted issuer:", browserIssuer);
      const issuerInfo = browserIssuer || "Unknown issuer";
      const mitmMsg = `${browser.i18n.getMessage("guardianTlsMitmDetected")}

${browser.i18n.getMessage("guardianTlsBrowserCert")}: ${browserFingerprint.substring(0, 30)}...
${browser.i18n.getMessage("guardianTlsIssuer")}: ${issuerInfo}

${browser.i18n.getMessage("guardianTlsProxyWarning")}`;
      handleMitmDetected(details.tabId, mitmMsg);
    } catch (err) {
      console.error("[Guardian] Error checking certificate:", err);
      console.error("[Guardian] Error details:", err.message, err.stack);
    }
  }
  function handleMitmDetected(tabId, message) {
    const status = tabSecurityStatus.get(tabId) || {
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
    showSecurityWarning(tabId, message);
    browser.notifications.create({
      type: "basic",
      iconUrl: "images/warning-32.png",
      title: `\u26A0\uFE0F ${browser.i18n.getMessage("guardianNotificationTitle")}`,
      message: browser.i18n.getMessage("guardianNotificationMitm"),
      priority: 2
    }).catch(() => {
    });
  }
  async function loadPublicKeys() {
    try {
      console.log("[Guardian] Loading public keys...");
      if (!crypto || !crypto.subtle) {
        console.error("[Guardian] crypto.subtle not available!");
        return false;
      }
      const hasEd25519 = await checkEd25519Support();
      if (!hasEd25519) {
        console.warn("[Guardian] Ed25519 not supported - signature verification disabled");
        console.warn("[Guardian] Chrome 113+ required for full Guardian functionality");
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
            cryptoKey,
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
  async function verifySignature(body, signature, timestamp, keyId) {
    const keyInfo = publicKeys.get(keyId);
    if (!keyInfo) {
      return { valid: false, reason: `Unknown key ID: ${keyId}` };
    }
    const now = /* @__PURE__ */ new Date();
    if (now > keyInfo.validUntil) {
      return {
        valid: false,
        expired: true,
        reason: `Key ${keyId} has expired (hard limit reached)`
      };
    }
    const timestampDate = new Date(timestamp * 1e3);
    const ageSeconds = Math.abs((now.getTime() - timestampDate.getTime()) / 1e3);
    if (ageSeconds > GUARDIAN_CONFIG.maxTimestampAge) {
      return {
        valid: false,
        reason: `Timestamp too old: ${ageSeconds}s (max ${GUARDIAN_CONFIG.maxTimestampAge}s)`
      };
    }
    const dataToVerify = `${body}|${timestamp}`;
    const dataBuffer = new TextEncoder().encode(dataToVerify);
    const signatureBuffer = base64ToArrayBuffer(signature);
    try {
      const valid = await crypto.subtle.verify(
        { name: "Ed25519" },
        keyInfo.cryptoKey,
        signatureBuffer,
        dataBuffer
      );
      const deprecated = keyInfo.warnAfter && now > keyInfo.warnAfter;
      return {
        valid,
        keyId,
        deprecated,
        reason: valid ? null : "Signature mismatch - possible MITM attack!"
      };
    } catch (err) {
      return {
        valid: false,
        reason: `Verification error: ${err.message}`
      };
    }
  }
  async function processResponse(details) {
    if (!guardianEnabled) {
      return;
    }
    console.log("[Guardian] processResponse called for:", details.url);
    if (!details.tabId || details.tabId < 0) {
      console.log("[Guardian] processResponse: Invalid tabId, skipping");
      return;
    }
    const url = new URL(details.url);
    if (!isProtectedHost(url.hostname)) {
      console.log("[Guardian] processResponse: Not protected host, skipping");
      return;
    }
    if (url.pathname.startsWith("/cdn-cgi/")) {
      console.log("[Guardian] processResponse: CloudFlare CDN resource, skipping");
      return;
    }
    if (url.pathname.endsWith("/sw.js")) {
      return;
    }
    if (isHashedAsset(details.url)) {
      return;
    }
    const headers = {};
    for (const header of details.responseHeaders || []) {
      headers[header.name.toLowerCase()] = header.value;
    }
    const signature = headers[GUARDIAN_CONFIG.headers.signature];
    const timestamp = headers[GUARDIAN_CONFIG.headers.timestamp];
    const keyId = headers[GUARDIAN_CONFIG.headers.keyId];
    const status = tabSecurityStatus.get(details.tabId) || {
      status: "PROTECTED",
      verified: 0,
      unsigned: 0,
      failed: [],
      deprecated: false
    };
    const contentType = headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");
    const isApi = details.url.includes("api=1") || details.url.includes("/api/");
    if (!signature || !timestamp || !keyId) {
      status.unsigned++;
      if (isHtml || isApi) {
        console.warn(`[Guardian] UNSIGNED ${isApi ? "API" : "HTML"}: ${details.url}`);
        if (status.status !== "COMPROMISED") {
          status.status = "UNSIGNED";
          browser.notifications.create({
            type: "basic",
            iconUrl: "images/warning-32.png",
            title: `\u26A0\uFE0F ${browser.i18n.getMessage("guardianNotificationTitle")}`,
            message: `${browser.i18n.getMessage("guardianNotificationMissing")}
${details.url}`,
            priority: 2
          }).catch(() => {
          });
        }
      } else {
        console.log(`[Guardian] Unsigned resource: ${details.url}`);
      }
      tabSecurityStatus.set(details.tabId, status);
      updateBadge(details.tabId, status);
      return;
    }
    status.verified++;
    if (status.status === "PROTECTED") {
      status.status = "VERIFIED";
    } else if (status.status === "UNSIGNED" && status.verified > status.unsigned) {
      status.status = "VERIFIED";
    }
    console.log(`[Guardian] Signature headers present for: ${details.url} (Key: ${keyId})`);
    tabSecurityStatus.set(details.tabId, status);
    updateBadge(details.tabId, status);
  }
  function updateBadge(tabId, status) {
    if (!status) {
      return;
    }
    let color;
    let text;
    switch (status.status) {
      case "VERIFIED":
        color = "#10b981";
        text = "\u2713";
        break;
      case "VERIFIED_DEPRECATED":
        color = "#f59e0b";
        text = "\u26A0";
        break;
      case "KEY_EXPIRED":
        color = "#ef4444";
        text = "\u23F0";
        break;
      case "COMPROMISED":
        color = "#ef4444";
        text = "\u2717";
        break;
      case "UNSIGNED":
        color = "#ef4444";
        text = "!";
        break;
      case "PROTECTED":
        color = "#3b82f6";
        text = "\u{1F6E1}";
        break;
      default:
        return;
    }
    try {
      browser.action.setBadgeBackgroundColor({ tabId, color });
      browser.action.setBadgeText({ tabId, text });
    } catch (err) {
      console.warn("[Guardian] Failed to update badge:", err);
    }
  }
  async function updateBadgeForTab(tabId, url) {
    if (!guardianEnabled) {
      return;
    }
    if (!url) {
      return;
    }
    try {
      const hostname = new URL(url).hostname;
      if (isProtectedHost(hostname)) {
        let status = tabSecurityStatus.get(tabId);
        if (!status) {
          status = { status: "PROTECTED", verified: 0, unsigned: 0, failed: [] };
          tabSecurityStatus.set(tabId, status);
        }
        updateBadge(tabId, status);
        if (status.status === "PROTECTED" && status.verified === 0 && (hostname === "mail.aionda.com" || hostname === "dev.mail.aionda.com" || hostname === "trashmail.com" || hostname === "www.trashmail.com" || hostname === "dev.trashmail.com")) {
          pingForVerification(tabId, hostname);
        }
      } else {
        browser.action.setBadgeText({ tabId, text: "" });
      }
    } catch (err) {
    }
  }
  var pingInProgress = /* @__PURE__ */ new Set();
  async function pingForVerification(tabId, hostname) {
    if (pingInProgress.has(tabId)) {
      return;
    }
    pingInProgress.add(tabId);
    try {
      console.log("[Guardian] Ping for verification on cached page, tab:", tabId);
      const response = await fetch(`https://${hostname}/?api=1&cmd=ping`, {
        method: "GET",
        cache: "no-store"
        // Bypass cache
      });
      const signature = response.headers.get(GUARDIAN_CONFIG.headers.signature);
      const timestamp = response.headers.get(GUARDIAN_CONFIG.headers.timestamp);
      const keyId = response.headers.get(GUARDIAN_CONFIG.headers.keyId);
      console.log("[Guardian] Ping response - signature present:", Boolean(signature));
      const status = tabSecurityStatus.get(tabId) || {
        status: "PROTECTED",
        verified: 0,
        unsigned: 0,
        failed: [],
        deprecated: false
      };
      if (signature && timestamp && keyId) {
        status.verified++;
        status.status = "VERIFIED";
        console.log("[Guardian] Ping verified, updating badge to green");
      } else {
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
  function resetTabStatus(tabId) {
    tabSecurityStatus.set(tabId, {
      status: "PROTECTED",
      verified: 0,
      unsigned: 0,
      failed: [],
      deprecated: false
    });
  }
  function showSecurityWarning(tabId, message) {
    console.log("[Guardian] showSecurityWarning called for tab:", tabId, "message:", `${message.substring(0, 50)}...`);
    const warningTitle = browser.i18n.getMessage("guardianWarningTitle");
    const dismissText = browser.i18n.getMessage("guardianWarningDismiss");
    browser.tabs.sendMessage(tabId, {
      action: "guardian_warning",
      message,
      title: warningTitle,
      dismissText
    }).then(() => {
      console.log("[Guardian] Warning message sent successfully to tab:", tabId);
    }).catch((err) => {
      console.warn("[Guardian] Content script not ready, injecting warning directly:", err.message);
      browser.scripting.executeScript({
        target: { tabId },
        func: (warningMessage, title, dismiss) => {
          if (document.getElementById("trashmail-mitm-warning")) {
            return;
          }
          const overlay = document.createElement("div");
          overlay.id = "trashmail-mitm-warning";
          overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(220,38,38,0.95);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;";
          const escaped = warningMessage.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const escapedDismiss = dismiss.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          overlay.innerHTML = `${'<div style="background:white;padding:32px;border-radius:12px;max-width:500px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.25);">'}<div style="font-size:48px;margin-bottom:16px;">\u26A0\uFE0F</div>${'<h1 style="color:#dc2626;margin:0 0 16px 0;font-size:24px;">'}${escapedTitle}</h1>${'<pre style="background:#fef2f2;padding:16px;border-radius:8px;text-align:left;white-space:pre-wrap;word-break:break-word;font-size:13px;color:#7f1d1d;margin:0 0 20px 0;max-height:200px;overflow:auto;">'}${escaped}</pre>${'<button id="trashmail-mitm-dismiss" style="background:#dc2626;color:white;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer;">'}${escapedDismiss}</button>${"</div>"}`;
          document.body.appendChild(overlay);
          document.getElementById("trashmail-mitm-dismiss")?.addEventListener("click", () => {
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
  async function initGuardian() {
    if (guardianInitialized) {
      return;
    }
    console.log("[Guardian] Initializing MITM Protection...");
    const keysLoaded = await loadPublicKeys();
    if (!keysLoaded) {
      console.warn("[Guardian] No public keys loaded - Response verification disabled");
      guardianInitialized = true;
      self.guardianInitialized = true;
      return;
    }
    browser.webRequest.onResponseStarted.addListener(
      processResponse,
      {
        urls: [
          "*://mail.aionda.com/*",
          "*://*.mail.aionda.com/*",
          "*://trashmail.com/*",
          "*://*.trashmail.com/*",
          "*://byom.de/*",
          "*://*.byom.de/*"
        ]
      },
      ["responseHeaders"]
    );
    console.log("[Guardian] Checking isFirefox():", isFirefox());
    console.log("[Guardian] browser.webRequest:", typeof browser.webRequest);
    console.log("[Guardian] browser.webRequest.getSecurityInfo:", typeof browser.webRequest?.getSecurityInfo);
    if (isFirefox()) {
      console.log("[Guardian] Firefox detected - enabling TLS certificate verification");
      browser.webRequest.onHeadersReceived.addListener(
        checkCertificate,
        {
          urls: [
            "*://mail.aionda.com/*",
            "*://*.mail.aionda.com/*",
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
    browser.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await browser.tabs.get(activeInfo.tabId);
        await updateBadgeForTab(activeInfo.tabId, tab.url);
      } catch (err) {
      }
    });
    browser.webNavigation.onBeforeNavigate.addListener((details) => {
      if (details.frameId !== 0) {
        return;
      }
      console.log(`[Guardian] Navigation starting to: ${details.url}`);
      resetTabStatus(details.tabId);
      try {
        const hostname = new URL(details.url).hostname;
        if (isProtectedHost(hostname)) {
          updateBadge(details.tabId, { status: "PROTECTED" });
        }
      } catch (e) {
      }
    });
    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete") {
        updateBadgeForTab(tabId, tab.url);
        setTimeout(() => updateBadgeForTab(tabId, tab.url), 250);
        setTimeout(() => updateBadgeForTab(tabId, tab.url), 500);
      }
    });
    browser.tabs.onRemoved.addListener((tabId) => {
      tabSecurityStatus.delete(tabId);
    });
    guardianInitialized = true;
    self.guardianInitialized = true;
    console.log("[Guardian] MITM Protection initialized with", publicKeys.size, "keys");
    browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== void 0) {
          updateBadgeForTab(tab.id, tab.url);
        }
      }
    });
  }
  var guardianEnabled = false;
  self.guardianEnabled = false;
  function startGuardianIfEnabled() {
    browser.storage.sync.get("guardian_enabled").then((items) => {
      if (!items.guardian_enabled) {
        console.log("[Guardian] MITM protection disabled (opt-in setting)");
        return;
      }
      guardianEnabled = true;
      self.guardianEnabled = true;
      initGuardian().catch((err) => {
        console.error("[Guardian] Failed to initialize:", err);
        guardianInitialized = true;
        self.guardianInitialized = true;
      });
    });
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !("guardian_enabled" in changes)) {
      return;
    }
    if (changes["guardian_enabled"]?.newValue) {
      startGuardianIfEnabled();
    } else {
      guardianEnabled = false;
      self.guardianEnabled = false;
      browser.tabs.query({}).then((tabs) => {
        for (const tab of tabs) {
          try {
            browser.action.setBadgeText({ tabId: tab.id, text: "" });
          } catch (e) {
          }
        }
      });
    }
  });
  startGuardianIfEnabled();
})();
