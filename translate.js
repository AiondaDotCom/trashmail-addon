"use strict";
(() => {
  // trashmail-addon/ts/ios.ts
  function istIos(nav = navigator) {
    if (/iPhone|iPad|iPod/.test(nav.userAgent)) {
      return true;
    }
    return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
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
  function iosVorbereiten(doc = document, nav = navigator) {
    if (!istIos(nav)) {
      return false;
    }
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
    return true;
  }

  // trashmail-addon/ts/translate.ts
  var browser = globalThis.browser ?? chrome;
  iosVorbereiten();
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
