"use strict";
(() => {
  // trashmail-addon/ts/translate.ts
  var browser = globalThis.browser ?? chrome;
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
