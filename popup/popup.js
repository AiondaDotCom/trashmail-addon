"use strict";
(() => {
  // trashmail-addon/ts/fenster.ts
  function api() {
    return globalThis.browser ?? chrome;
  }
  function hat(objekt, name) {
    return typeof objekt === "object" && objekt !== null && typeof objekt[name] === "function";
  }
  async function position(wunsch) {
    const { width, height } = wunsch;
    const bezug = wunsch.bezug ?? "zuletzt-fokussiert";
    if (bezug === "bildschirm") {
      if (typeof screen === "undefined") {
        return void 0;
      }
      return { left: Math.round((screen.width - width) / 2), top: Math.round((screen.height - height) / 2) };
    }
    const fenster = api().windows;
    const name = bezug === "aktuell" ? "getCurrent" : "getLastFocused";
    if (!hat(fenster, name)) {
      return void 0;
    }
    try {
      const f = bezug === "aktuell" ? await fenster.getCurrent() : await fenster.getLastFocused();
      return {
        left: Math.max(0, Math.round((f.left ?? 0) + ((f.width ?? width) - width) / 2)),
        top: Math.max(0, Math.round((f.top ?? 0) + ((f.height ?? height) - height) / 2))
      };
    } catch {
      return void 0;
    }
  }
  async function seiteOeffnen(url, wunsch) {
    const b = api();
    if (hat(b.windows, "create")) {
      try {
        const pos = await position(wunsch);
        const fenster = await b.windows.create({
          "url": url,
          "type": "popup",
          "width": wunsch.width,
          "height": wunsch.height,
          ...pos
        });
        return { alsTab: false, windowId: fenster?.id, tabId: fenster?.tabs?.[0]?.id };
      } catch (err) {
        console.warn("[Aionda Mail] Kein eigenes Fenster m\xF6glich, \xF6ffne Tab:", err);
      }
    }
    const tab = await b.tabs.create({ "url": url });
    return { alsTab: true, windowId: tab?.windowId, tabId: tab?.id };
  }

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
    seiteOeffnen(
      browser.runtime.getURL(`popup/guardian-info.html?${params.toString()}`),
      { width: 450, height: 595, bezug: "bildschirm" }
    ).catch((err) => console.error("[Popup] Guardian-Info konnte nicht ge\xF6ffnet werden:", err));
  }
  elById("security-status").addEventListener("click", openGuardianInfoWindow);
  function openLoginWindow() {
    const url = browser.runtime.getURL("options/welcome.html");
    (async () => {
      try {
        await seiteOeffnen(url, { width: 600, height: 720, bezug: "aktuell" });
      } catch (err) {
        console.warn("[Popup] Anmeldung konnte nicht ge\xF6ffnet werden:", err);
      }
      window.close();
    })();
  }
  async function createAddressForPage() {
    if (!await isLoggedIn()) {
      openLoginWindow();
      return;
    }
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const params = new URLSearchParams({ "popup": "1", "frame": "0" });
    if (tab?.id !== void 0) {
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
  window.addEventListener("message", (event) => {
    const daten = event.data;
    if (event.origin !== window.location.origin || !daten || daten.aiondaAktion !== "popup-schliessen") {
      return;
    }
    window.close();
  });
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
  elById("btn-create-address").addEventListener("click", () => {
    void createAddressForPage();
  });
  elById("btn-options").addEventListener("click", () => {
    browser.runtime.openOptionsPage().then(() => {
      window.close();
    });
  });
})();
