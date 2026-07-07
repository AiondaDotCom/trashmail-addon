"use strict";
(() => {
  // trashmail-addon/ts/popup/popup.ts
  var browser = globalThis.browser ?? chrome;
  function elById(id) {
    const el = document.getElementById(id);
    if (el === null) {
      throw new Error(`Element #${id} not found`);
    }
    return el;
  }
  async function updateSecurityStatus() {
    const statusEl = document.getElementById("security-status");
    if (!statusEl) {
      return;
    }
    try {
      console.log("[Popup] Requesting guardian status...");
      const response = await browser.runtime.sendMessage({ action: "get_guardian_status" });
      console.log("[Popup] Received response:", response);
      const iconEl = statusEl.querySelector(".status-icon");
      const textEl = statusEl.querySelector(".status-text");
      const detailEl = statusEl.querySelector(".status-detail");
      statusEl.className = "";
      if (!response) {
        console.log("[Popup] No response from Guardian");
        statusEl.className = "inactive";
        iconEl.textContent = "\u26A0\uFE0F";
        textEl.textContent = browser.i18n.getMessage("guardianNotInitialized");
        detailEl.textContent = browser.i18n.getMessage("guardianFailedToLoad");
        return;
      }
      if (!response.enabled) {
        statusEl.className = "inactive";
        iconEl.textContent = "\u{1F512}";
        textEl.textContent = browser.i18n.getMessage("guardianDisabled");
        detailEl.textContent = browser.i18n.getMessage("guardianEnableInOptions");
        return;
      }
      if (!response.initialized) {
        console.log("[Popup] Guardian not initialized, response:", response);
        statusEl.className = "inactive";
        iconEl.textContent = "\u26A0\uFE0F";
        textEl.textContent = browser.i18n.getMessage("guardianNotInitialized");
        detailEl.textContent = browser.i18n.getMessage("guardianFailedToLoad");
        return;
      }
      if (response.ed25519Supported === false) {
        statusEl.className = "warning";
        iconEl.textContent = "\u26A0\uFE0F";
        textEl.textContent = browser.i18n.getMessage("guardianEd25519NotSupported") || "Ed25519 not supported";
        detailEl.textContent = "Chrome 113+ required";
        return;
      }
      if (!response.isProtected) {
        statusEl.className = "inactive";
        iconEl.textContent = "\u{1F512}";
        textEl.textContent = browser.i18n.getMessage("guardianMitmProtection");
        detailEl.textContent = browser.i18n.getMessage("guardianVisitToActivate");
        return;
      }
      const status = response.status;
      if (!status || status.status === "PROTECTED") {
        statusEl.className = "protected";
        iconEl.textContent = "\u{1F6E1}\uFE0F";
        textEl.textContent = browser.i18n.getMessage("guardianProtected");
        detailEl.textContent = response.hostname ?? "";
        return;
      }
      switch (status.status) {
        case "VERIFIED":
          statusEl.className = "verified";
          iconEl.textContent = "\u2705";
          textEl.textContent = browser.i18n.getMessage("guardianVerified");
          if (status.verified === 1) {
            detailEl.textContent = browser.i18n.getMessage("guardianResponseVerified");
          } else {
            detailEl.textContent = browser.i18n.getMessage("guardianResponsesVerified", [status.verified.toString()]);
          }
          break;
        case "VERIFIED_DEPRECATED":
          statusEl.className = "warning";
          iconEl.textContent = "\u26A0\uFE0F";
          textEl.textContent = browser.i18n.getMessage("guardianKeyExpiringSoon");
          detailEl.textContent = browser.i18n.getMessage("guardianKeyNeedsRenewal");
          break;
        case "KEY_EXPIRED":
          statusEl.className = "danger";
          iconEl.textContent = "\u23F0";
          textEl.textContent = browser.i18n.getMessage("guardianKeyExpired");
          detailEl.textContent = browser.i18n.getMessage("guardianServerKeyNeedsRenewal");
          break;
        case "COMPROMISED":
          statusEl.className = "danger";
          iconEl.textContent = "\u{1F6A8}";
          textEl.textContent = browser.i18n.getMessage("guardianMitmDetected");
          detailEl.textContent = browser.i18n.getMessage("guardianSignatureVerificationFailed");
          break;
        case "UNSIGNED":
          statusEl.className = "danger";
          iconEl.textContent = "\u26A0\uFE0F";
          textEl.textContent = browser.i18n.getMessage("guardianUnsigned");
          if ((status.unsigned || 0) === 1) {
            detailEl.textContent = browser.i18n.getMessage("guardianMissingSignature");
          } else {
            detailEl.textContent = browser.i18n.getMessage("guardianMissingSignatures", [(status.unsigned || 0).toString()]);
          }
          break;
        default:
          statusEl.className = "inactive";
          iconEl.textContent = "\u2753";
          textEl.textContent = browser.i18n.getMessage("guardianUnknown");
          detailEl.textContent = status.status ?? "";
      }
    } catch (err) {
      console.error("[Popup] Failed to get guardian status:", err);
      statusEl.className = "inactive";
      statusEl.querySelector(".status-icon").textContent = "\u274C";
      statusEl.querySelector(".status-text").textContent = browser.i18n.getMessage("guardianError");
      statusEl.querySelector(".status-detail").textContent = err.message || "Unknown error";
    }
  }
  document.addEventListener("DOMContentLoaded", updateSecurityStatus);
  async function openGuardianInfoWindow() {
    const statusEl = elById("security-status");
    const text = statusEl.querySelector(".status-text").textContent ?? "";
    const detail = statusEl.querySelector(".status-detail").textContent ?? "";
    const statusClass = statusEl.className;
    let status = "unknown";
    if (statusClass.includes("verified")) {
      status = "verified";
    } else if (statusClass.includes("protected")) {
      status = "protected";
    } else if (statusClass.includes("warning")) {
      status = "warning";
    } else if (statusClass.includes("danger")) {
      status = "danger";
    } else if (statusClass.includes("inactive")) {
      status = "inactive";
    }
    let tlsVerified = "";
    let tlsFingerprint = "";
    let isFirefox = false;
    try {
      const response = await browser.runtime.sendMessage({ action: "get_guardian_status" });
      if (response) {
        isFirefox = response.isFirefox === true;
        if (isFirefox && response.status) {
          tlsVerified = response.status.tlsVerified ? "1" : "0";
          tlsFingerprint = response.status.tlsFingerprint || "";
        }
      }
    } catch (e) {
      console.log("[Popup] Could not get TLS status:", e);
    }
    const params = new URLSearchParams({
      status,
      text,
      detail
    });
    if (isFirefox) {
      params.set("tlsVerified", tlsVerified);
      params.set("tlsFingerprint", tlsFingerprint);
    }
    const width = 450;
    const height = 595;
    const left = Math.round((screen.width - width) / 2);
    const top = Math.round((screen.height - height) / 2);
    browser.windows.create({
      url: browser.runtime.getURL(`popup/guardian-info.html?${params.toString()}`),
      type: "popup",
      width,
      height,
      left,
      top
    });
  }
  elById("security-status").addEventListener("click", openGuardianInfoWindow);
  function openLoginWindow() {
    const width = 600;
    const height = 720;
    browser.windows.getCurrent().then((current) => {
      const left = Math.max(0, Math.round((current.left ?? 0) + ((current.width ?? width) - width) / 2));
      const top = Math.max(0, Math.round((current.top ?? 0) + ((current.height ?? height) - height) / 2));
      return browser.windows.create({
        "url": browser.runtime.getURL("options/welcome.html"),
        "width": width,
        "height": height,
        "left": left,
        "top": top,
        "type": "popup"
      });
    }).then(() => {
      window.close();
    });
  }
  async function isLoggedIn() {
    const sync = await browser.storage.sync.get(["username", "password"]);
    return Boolean(sync.username && sync.password);
  }
  async function addressManager() {
    if (!await isLoggedIn()) {
      openLoginWindow();
      return;
    }
    try {
      await openAddressManagerAuthenticated();
      window.close();
    } catch (error) {
      const errorMsg = elById("error_msg");
      errorMsg.textContent = error.message || String(error);
      errorMsg.style.display = "block";
      setTimeout(() => {
        openLoginWindow();
      }, 2e3);
    }
  }
  async function updateLoginStateUI() {
    if (!await isLoggedIn()) {
      const label = elById("btn-address-manager").querySelector("span:last-child");
      if (label) {
        label.textContent = browser.i18n.getMessage("popupLoginButton");
      }
    }
  }
  updateLoginStateUI();
  elById("btn-address-manager").addEventListener("click", addressManager);
  elById("btn-options").addEventListener("click", () => {
    browser.runtime.openOptionsPage().then(() => {
      window.close();
    });
  });
})();
