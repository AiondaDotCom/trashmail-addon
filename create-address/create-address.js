"use strict";
(() => {
  // trashmail-addon/ts/create-address/create-address.ts
  var browser = globalThis.browser ?? chrome;
  var lang = browser.i18n.getUILanguage().substring(0, 2);
  var mailFaker = new MailFaker(lang);
  function elById(id) {
    const el = document.getElementById(id);
    if (el === null) {
      throw new Error(`Element #${id} not found`);
    }
    return el;
  }
  function isPAT(password) {
    return Boolean(password) && typeof password === "string" && password.startsWith("tmpat_") && password.length > 6;
  }
  var parentUrl;
  var parentId;
  var tabId;
  var frameId;
  var p1 = browser.storage.sync.get();
  var p2 = browser.storage.local.get(["domains", "real_emails", "session_id"]);
  browser.runtime.onMessage.addListener((message) => {
    if (!Array.isArray(message)) {
      return;
    }
    if (message.length >= 4) {
      [parentUrl, parentId, tabId, frameId] = message;
    } else {
      console.error("Unexpected message format:", message);
      return;
    }
    function closeOnParentTabRemoved(id) {
      if (id === tabId) {
        browser.windows.getCurrent().then((window2) => {
          browser.windows.remove(window2.id);
        }).catch((error) => console.error("Fenster konnte nicht geschlossen werden:", error));
      }
    }
    if (!browser.tabs.onRemoved.hasListener(closeOnParentTabRemoved)) {
      browser.tabs.onRemoved.addListener(closeOnParentTabRemoved);
    }
  });
  var loginDetails = Promise.all([p1, p2]).then((result) => {
    const [sync, local] = result;
    const pairs = [["real_emails", "email"], ["domains", "domain"]];
    for (const [list, prop] of pairs) {
      const select = elById(prop);
      if (prop === "email") {
        const vaultOption = document.createElement("option");
        vaultOption.value = "vault";
        vaultOption.text = browser.i18n.getMessage("optionsInternalMailbox") || "Internal Mailbox";
        if (sync["default_email"] === "vault") {
          vaultOption.selected = true;
        }
        select.add(vaultOption);
      }
      const raw = local[list];
      const items = Array.isArray(raw) ? raw : Object.keys(raw || {});
      for (const item of items) {
        const option = document.createElement("option");
        option.value = option.text = item;
        if (item === sync[`default_${prop}`]) {
          option.selected = true;
        }
        select.add(option);
      }
    }
    let props = ["forwards", "expire"];
    for (const prop of props) {
      const key = `default_${prop}`;
      if (key in sync) {
        elById(prop).value = String(sync[key]);
      }
    }
    props = ["masq", "notify", "send"];
    for (const prop of props) {
      const key = `default_${prop}`;
      if (key in sync) {
        elById(prop).checked = Boolean(sync[key]);
      }
    }
    elById("disposable-name").value = mailFaker.localPart();
    return result;
  }).then((result) => {
    const [sync, local] = result;
    if (local.session_id) {
      console.log("[TrashMail] Using stored session_id");
      return { session_id: local.session_id };
    }
    if (isPAT(sync["password"])) {
      throw new Error("Session expired. Please log in again via Options.");
    }
    const data = {
      "cmd": "login",
      "fe-login-user": sync["username"],
      "fe-login-pass": sync["password"]
    };
    return callAPI(data).then((response) => {
      browser.storage.local.set({ "session_id": response.session_id });
      return response;
    });
  });
  async function addressManager() {
    try {
      const baseUrl = await getApiBaseUrl();
      const url = `${baseUrl}/?cmd=manager`;
      const details = await loginDetails;
      const params = new URLSearchParams({
        "lang": lang,
        "session_id": String(details["session_id"])
      });
      const options = {
        "url": url.concat("&", params.toString()),
        "windowId": parentId
      };
      await browser.tabs.create(options);
      window.close();
    } catch (error) {
      const errorMsg = elById("error_msg");
      errorMsg.textContent = error.message || String(error);
      errorMsg.style.display = "block";
    }
  }
  async function createAddress(e) {
    e.preventDefault();
    const createButton = elById("btn-create");
    const progress = elById("progress");
    const error = elById("error_msg");
    const form = new FormData(e.target);
    createButton.disabled = true;
    progress.style.display = "block";
    error.style.display = "none";
    try {
      const login = await loginDetails;
      const data = {
        "cmd": "create_dea",
        "session_id": login["session_id"]
      };
      const destination = form.get("email");
      const isVault = destination === "vault";
      const json = {
        "data": {
          "disposable_name": form.get("disposable_name"),
          "disposable_domain": form.get("domain"),
          "destination": isVault ? "" : destination,
          "forwards": form.get("forwards"),
          "expire": form.get("expire"),
          // CAPTCHA-Option (Challenge-Response) wurde aus dem Addon entfernt
          // (zu komplex fuer Einsteiger) - neue DEAs immer ohne CS
          "cs": false,
          "masq": form.get("masq") || false,
          "notify": form.get("notify") || false,
          "vault": isVault,
          "website": form.get("send") ? parentUrl : ""
        }
      };
      await callAPI(data, json);
      const address = [`${String(form.get("disposable_name"))}@${String(form.get("domain"))}`, parentUrl];
      const [storage, suffixesResponse] = await Promise.all([
        browser.storage.local.get("previous_addresses"),
        fetch(browser.runtime.getURL("public_suffix.json"))
      ]);
      const suffixes = suffixesResponse.ok ? await suffixesResponse.json() : [[], []];
      const [rules, exceptions] = suffixes;
      const addresses = storage["previous_addresses"] || {};
      let domain;
      try {
        domain = org_domain(new URL(parentUrl), rules, exceptions);
      } catch (e2) {
        console.error("Ung\xFCltige URL:", parentUrl, e2);
        domain = "mail.aionda.com";
      }
      if (domain in addresses) {
        addresses[domain].push(address);
      } else {
        addresses[domain] = [address];
      }
      await browser.storage.local.set({ "previous_addresses": addresses });
      await browser.tabs.sendMessage(tabId, address[0], { "frameId": frameId });
      await browser.runtime.sendMessage({
        action: "update_menu",
        tabId
      });
      const currentWindow = await browser.windows.getCurrent();
      await browser.windows.remove(currentWindow.id);
    } catch (msg) {
      error.innerText = String(msg);
      error.style.display = "block";
      progress.style.display = "none";
      createButton.disabled = false;
    }
  }
  document.querySelector("form").addEventListener("submit", createAddress);
  elById("btn-address-manager").addEventListener("click", addressManager);
  elById("btn-close").addEventListener("click", () => {
    window.close();
  });
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(async () => {
      try {
        const card = document.querySelector(".card");
        const header = document.querySelector(".header");
        const container = document.querySelector(".container");
        const contentHeight = header.offsetHeight + container.offsetHeight + 40;
        const contentWidth = Math.max(card.offsetWidth + 40, 500);
        const currentWindow = await browser.windows.getCurrent();
        const chromeHeight = currentWindow.height - window.innerHeight;
        const chromeWidth = currentWindow.width - window.innerWidth;
        const newHeight = Math.min(contentHeight + chromeHeight, screen.availHeight - 100);
        const newWidth = Math.min(contentWidth + chromeWidth, 650);
        const left = Math.round((screen.width - newWidth) / 2);
        const top = Math.round((screen.height - newHeight) / 2);
        await browser.windows.update(currentWindow.id, {
          width: newWidth,
          height: newHeight,
          left,
          top
        });
      } catch (err) {
        console.log("[Create Address] Auto-resize failed:", err);
      }
    }, 100);
  });
})();
