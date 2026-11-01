"use strict";
(() => {
  // trashmail-addon/ts/fenster.ts
  function api() {
    return globalThis.browser ?? chrome;
  }
  function hat(objekt, name) {
    return typeof objekt === "object" && objekt !== null && typeof objekt[name] === "function";
  }
  var TAB_KENNZEICHEN = "aiondaTab";
  function alsTabGeoeffnet() {
    try {
      return new URLSearchParams(window.location.search).get(TAB_KENNZEICHEN) === "1";
    } catch {
      return false;
    }
  }
  async function eigenesFenster() {
    const fenster = api().windows;
    if (alsTabGeoeffnet() || !hat(fenster, "getCurrent")) {
      return void 0;
    }
    try {
      const aktuell = await fenster.getCurrent({ "populate": true });
      if (aktuell?.id === void 0 || aktuell.tabs !== void 0 && aktuell.tabs.length > 1) {
        return void 0;
      }
      return aktuell;
    } catch {
      return void 0;
    }
  }
  async function eigeneSeiteSchliessen() {
    const b = api();
    const fenster = await eigenesFenster();
    if (fenster !== void 0 && hat(b.windows, "remove")) {
      try {
        await b.windows.remove(fenster.id);
        return;
      } catch (err) {
        console.warn("[Aionda Mail] Fenster lie\xDF sich nicht schlie\xDFen:", err);
      }
    }
    if (hat(b.tabs, "getCurrent") && hat(b.tabs, "remove")) {
      try {
        const tab = await b.tabs.getCurrent();
        if (tab?.id !== void 0) {
          await b.tabs.remove(tab.id);
          return;
        }
      } catch (err) {
        console.warn("[Aionda Mail] Tab lie\xDF sich nicht schlie\xDFen:", err);
      }
    }
    window.close();
  }
  async function fensterAnpassen(berechne) {
    const b = api();
    if (!hat(b.windows, "update")) {
      return false;
    }
    const fenster = await eigenesFenster();
    if (fenster === void 0) {
      return false;
    }
    const neu = berechne(fenster);
    if (neu === void 0) {
      return false;
    }
    try {
      await b.windows.update(fenster.id, neu);
      return true;
    } catch (err) {
      console.log("[Aionda Mail] Fenstergr\xF6\xDFe lie\xDF sich nicht \xE4ndern:", err);
      return false;
    }
  }

  // trashmail-addon/ts/popup/guardian-info.ts
  var browser = globalThis.browser ?? chrome;
  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status") || "unknown";
    const text = params.get("text") || "";
    const detail = params.get("detail") || "";
    const tlsVerified = params.get("tlsVerified");
    const tlsFingerprint = params.get("tlsFingerprint") || "";
    const statusBox = document.getElementById("status-box");
    const statusValue = document.getElementById("status-value");
    const statusIcon = document.getElementById("status-icon");
    statusValue.textContent = `${text}${detail ? ` - ${detail}` : ""}`;
    switch (status) {
      case "verified":
        statusBox.className = "status-box verified";
        statusIcon.textContent = "\u2705";
        break;
      case "protected":
        statusBox.className = "status-box protected";
        statusIcon.textContent = "\u{1F6E1}\uFE0F";
        break;
      case "warning":
        statusBox.className = "status-box warning";
        statusIcon.textContent = "\u26A0\uFE0F";
        break;
      case "danger":
      case "unsigned":
        statusBox.className = "status-box danger";
        statusIcon.textContent = "\u26A0\uFE0F";
        break;
      default:
        statusBox.className = "status-box";
        statusIcon.textContent = "\u{1F512}";
    }
    if (tlsVerified) {
      const tlsStatusBox = document.getElementById("tls-status-box");
      const tlsStatusValue = document.getElementById("tls-status-value");
      const tlsFingerprintEl = document.getElementById("tls-fingerprint");
      tlsStatusBox.style.display = "block";
      if (tlsVerified === "1") {
        tlsStatusBox.className = "status-box verified";
        tlsStatusValue.textContent = `${browser.i18n.getMessage("guardianTlsVerified")} \u2713`;
        if (tlsFingerprint) {
          tlsFingerprintEl.textContent = tlsFingerprint;
        }
      } else {
        tlsStatusBox.className = "status-box inactive";
        tlsStatusValue.textContent = browser.i18n.getMessage("guardianTlsNotVerified");
      }
    }
    document.getElementById("btn-close").addEventListener("click", () => {
      eigeneSeiteSchliessen().catch((err) => console.warn("[Guardian Info] Schlie\xDFen gescheitert:", err));
    });
    setTimeout(async () => {
      try {
        const container = document.querySelector(".container");
        const contentHeight = container.offsetHeight + 32;
        const contentWidth = container.offsetWidth + 32;
        await fensterAnpassen((currentWindow) => {
          const chromeHeight = currentWindow.height - window.innerHeight;
          const chromeWidth = currentWindow.width - window.innerWidth;
          const newHeight = Math.min(contentHeight + chromeHeight, screen.availHeight - 100);
          const newWidth = Math.min(contentWidth + chromeWidth, 500);
          return {
            width: newWidth,
            height: newHeight,
            left: Math.round((screen.width - newWidth) / 2),
            top: Math.round((screen.height - newHeight) / 2)
          };
        });
      } catch (err) {
        console.log("[Guardian Info] Auto-resize failed:", err);
      }
    }, 50);
  });
})();
