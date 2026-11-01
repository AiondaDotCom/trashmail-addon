"use strict";
(() => {
  // trashmail-addon/ts/ios.ts
  function plattformAbfrage() {
    const erweiterung = globalThis.browser ?? globalThis.chrome;
    const runtime = erweiterung?.runtime;
    if (typeof runtime?.getPlatformInfo !== "function") {
      return void 0;
    }
    return () => runtime.getPlatformInfo();
  }
  function uaSagtIos(nav) {
    return /iPhone|iPad|iPod/.test(nav.userAgent);
  }
  function koennteIosSein(nav) {
    return uaSagtIos(nav) || /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
  }
  var PLATTFORM_WARTEZEIT_MS = 500;
  async function istIos(nav = navigator, plattform = plattformAbfrage()) {
    if (!koennteIosSein(nav)) {
      return false;
    }
    if (plattform) {
      try {
        const info = await Promise.race([
          plattform(),
          new Promise((fertig) => setTimeout(() => fertig(void 0), PLATTFORM_WARTEZEIT_MS))
        ]);
        if (typeof info?.os === "string") {
          return info.os === "ios";
        }
      } catch {
      }
    }
    return uaSagtIos(nav);
  }
  function feldVorbereiten(feld) {
    if (feld.type === "checkbox") {
      feld.setAttribute("switch", "");
      return;
    }
    if (feld.type === "text" || feld.type === "email" || feld.type === "password") {
      if (!feld.hasAttribute("autocapitalize")) {
        feld.setAttribute("autocapitalize", "off");
      }
      if (!feld.hasAttribute("autocorrect")) {
        feld.setAttribute("autocorrect", "off");
      }
      if (!feld.hasAttribute("spellcheck")) {
        feld.setAttribute("spellcheck", "false");
      }
    }
  }
  function alleFelderVorbereiten(wurzel) {
    for (const feld of wurzel.querySelectorAll("input")) {
      feldVorbereiten(feld);
    }
  }
  async function iosVorbereiten(doc = document, nav = navigator, plattform = plattformAbfrage()) {
    if (!koennteIosSein(nav)) {
      return false;
    }
    const wurzel = doc.documentElement;
    const sichtbarkeit = wurzel.style.visibility;
    wurzel.style.visibility = "hidden";
    let ios = false;
    try {
      ios = await istIos(nav, plattform);
      if (ios) {
        einschalten(doc);
      }
    } finally {
      wurzel.style.visibility = sichtbarkeit;
      if (wurzel.getAttribute("style") === "") {
        wurzel.removeAttribute("style");
      }
    }
    return ios;
  }
  function einschalten(doc) {
    doc.documentElement.classList.add("ios");
    alleFelderVorbereiten(doc);
    if (typeof MutationObserver === "function") {
      new MutationObserver((aenderungen) => {
        for (const aenderung of aenderungen) {
          for (const knoten of aenderung.addedNodes) {
            if (knoten instanceof HTMLInputElement) {
              feldVorbereiten(knoten);
            } else if (knoten instanceof Element) {
              alleFelderVorbereiten(knoten);
            }
          }
        }
      }).observe(doc.documentElement, { childList: true, subtree: true });
    }
  }

  // trashmail-addon/ts/translate.ts
  var browser = globalThis.browser ?? chrome;
  iosVorbereiten().catch((err) => console.warn("[Aionda Mail] iOS-Erkennung gescheitert:", err));
  document.addEventListener("DOMContentLoaded", () => {
    const numFormat = new Intl.NumberFormat();
    for (const elem of document.querySelectorAll("[data-i18n]")) {
      const [rawStub, attr] = elem.dataset.i18n.split("|", 2);
      const stub = rawStub.split("?");
      const [key, formatNum] = stub[0].split("#");
      let text;
      if (key) {
        text = browser.i18n.getMessage(key, stub.slice(1));
      } else {
        text = formatNum;
      }
      if (formatNum !== void 0) {
        text = text.replace(/\d+/g, numFormat.format);
      }
      if (attr) {
        elem[attr] = text;
      } else {
        elem.insertAdjacentHTML("beforeend", text);
      }
    }
  });
})();
