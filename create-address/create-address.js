"use strict";
(() => {
  // trashmail-addon/ts/public-suffix.ts
  var browserApi = globalThis.browser ?? chrome;
  var resolverPromise = null;
  function nativePublicSuffix() {
    return browserApi?.publicSuffix;
  }
  function nativeResolver(api) {
    return (url) => {
      const hostname = url.hostname;
      try {
        return api.getDomain(hostname) ?? hostname;
      } catch {
        return hostname;
      }
    };
  }
  async function fallbackResolver() {
    const response = await fetch(browserApi.runtime.getURL("public_suffix.json"));
    if (!response.ok) {
      throw new Error("Public Suffix List konnte nicht geladen werden");
    }
    const [rules, exceptions] = await response.json();
    const orgDomain = globalThis.org_domain;
    return (url) => orgDomain(url, rules, exceptions);
  }
  function getOrgDomainResolver() {
    if (!resolverPromise) {
      const api = nativePublicSuffix();
      resolverPromise = api ? Promise.resolve(nativeResolver(api)) : fallbackResolver().catch((error) => {
        resolverPromise = null;
        throw error;
      });
    }
    return resolverPromise;
  }

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
  var ERROR_CODE_UNREGISTERED_REAL_EMAIL_ADDRESS = 25;
  var ERROR_CODE_NOT_LOGGED_IN = 2;
  var SESSION_EXPIRED_CODES = [ERROR_CODE_UNREGISTERED_REAL_EMAIL_ADDRESS, ERROR_CODE_NOT_LOGGED_IN];
  async function reauthAndGetSession() {
    const sync = await browser.storage.sync.get(["username", "password"]);
    const username = sync["username"];
    const password = sync["password"];
    if (!username || !password) {
      throw new Error(browser.i18n.getMessage("errorSessionExpired") || "Sitzung abgelaufen. Bitte in den Optionen erneut anmelden.");
    }
    if (isPAT(password)) {
      const login = await loginWithStoredPat(username, password);
      const sessionId2 = String(login["session_id"]);
      await browser.storage.local.set({ "session_id": sessionId2 });
      return sessionId2;
    }
    const response = await callAPI({
      "cmd": "login",
      "fe-login-user": username,
      "fe-login-pass": password
    });
    const sessionId = String(response.session_id);
    await browser.storage.local.set({ "session_id": sessionId });
    return sessionId;
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
      return reauthAndGetSession().then((sessionId) => ({ session_id: sessionId }));
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
          // Vault-Ziel: der Server erkennt "__VAULT__" in destination als
          // internes Postfach. NICHT leer lassen - sonst ersetzt der Server
          // es durch die Default-E-Mail (dann landet die DEA nicht im Vault).
          "destination": isVault ? "__VAULT__" : destination,
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
      try {
        await callAPI(data, json);
      } catch (err) {
        const code = err.errorCode;
        if (typeof code === "number" && SESSION_EXPIRED_CODES.includes(code)) {
          data.session_id = await reauthAndGetSession();
          await callAPI(data, json);
        } else {
          throw err;
        }
      }
      const address = [`${String(form.get("disposable_name"))}@${String(form.get("domain"))}`, parentUrl];
      const [storage, orgDomain] = await Promise.all([
        browser.storage.local.get("previous_addresses"),
        getOrgDomainResolver()
      ]);
      const addresses = storage["previous_addresses"] || {};
      let domain;
      try {
        domain = orgDomain(new URL(parentUrl));
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
      let pasted = true;
      try {
        const antwort = await browser.tabs.sendMessage(tabId, address[0], { "frameId": frameId });
        if (antwort && antwort.pasted === false) {
          pasted = false;
        }
      } catch (err) {
        console.warn("[Aionda Mail] Adresse konnte nicht ins Feld eingetragen werden:", err);
        pasted = false;
      }
      try {
        await browser.runtime.sendMessage({
          action: "update_menu",
          tabId
        });
      } catch (err) {
        console.warn("[Aionda Mail] Menue konnte nicht aktualisiert werden:", err);
      }
      if (!pasted) {
        error.innerText = browser.i18n.getMessage("errorAddressNotPasted", [address[0]]) || `The address ${address[0]} was created, but could not be inserted into the form. Please copy it manually.`;
        error.style.display = "block";
        progress.style.display = "none";
        createButton.disabled = false;
        return;
      }
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
