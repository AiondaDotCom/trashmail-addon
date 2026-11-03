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
    const tab = await b.tabs.create({ "url": mitTabKennzeichen(url) });
    return { alsTab: true, windowId: tab?.windowId, tabId: tab?.id };
  }
  var TAB_KENNZEICHEN = "aiondaTab";
  function mitTabKennzeichen(url) {
    return `${url}${url.includes("?") ? "&" : "?"}${TAB_KENNZEICHEN}=1`;
  }

  // trashmail-addon/ts/public-suffix.ts
  var browserApi = globalThis.browser ?? chrome;
  var resolverPromise = null;
  function nativePublicSuffix() {
    return browserApi?.publicSuffix;
  }
  function nativeResolver(api2) {
    return (url) => {
      const hostname = url.hostname;
      try {
        return api2.getDomain(hostname) ?? hostname;
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
      const api2 = nativePublicSuffix();
      resolverPromise = api2 ? Promise.resolve(nativeResolver(api2)) : fallbackResolver().catch((error) => {
        resolverPromise = null;
        throw error;
      });
    }
    return resolverPromise;
  }

  // trashmail-addon/ts/session-codes.ts
  var ERROR_CODE_NOT_LOGGED_IN = 2;
  var ERROR_CODE_AUTHENTICATION_ERROR = 61;
  var SESSION_REJECTED_CODES = [ERROR_CODE_NOT_LOGGED_IN, ERROR_CODE_AUTHENTICATION_ERROR];
  function isSessionRejected(error) {
    const code = error?.errorCode;
    return typeof code === "number" && SESSION_REJECTED_CODES.includes(code);
  }
  var BACKGROUND_LOGIN_BLOCK_KEY = "background_login_block";
  var BLOCK_AFTER_SERVER_REJECTION_MS = 6 * 60 * 60 * 1e3;
  var BLOCK_AFTER_NETWORK_ERROR_MS = 15 * 60 * 1e3;
  function backgroundLoginBlockFor(error, now) {
    const err = error ?? {};
    const errorCode = typeof err.errorCode === "number" ? err.errorCode : void 0;
    const httpStatus = typeof err.httpStatus === "number" ? err.httpStatus : void 0;
    const reachedServer = errorCode !== void 0 || httpStatus !== void 0 || err.requires_2fa === true;
    let waitMs = reachedServer ? BLOCK_AFTER_SERVER_REJECTION_MS : BLOCK_AFTER_NETWORK_ERROR_MS;
    if (httpStatus === 429 && typeof err.remainingSeconds === "number" && err.remainingSeconds * 1e3 > waitMs) {
      waitMs = err.remainingSeconds * 1e3;
    }
    const block = { until: now + waitMs };
    if (errorCode !== void 0) {
      block.error_code = errorCode;
    }
    if (httpStatus !== void 0) {
      block.http_status = httpStatus;
    }
    return block;
  }
  function isBackgroundLoginBlocked(stored, now) {
    const until = stored?.until;
    return typeof until === "number" && now < until;
  }

  // trashmail-addon/ts/background.ts
  var browser = globalThis.browser ?? chrome;
  if (typeof importScripts === "function") {
    importScripts("api.js", "publicsuffixlist.js", "guardian.js");
  }
  var swScope = globalThis.ServiceWorkerGlobalScope;
  if (typeof self !== "undefined" && typeof self.addEventListener === "function" && typeof swScope !== "undefined") {
    self.addEventListener("install", (event) => {
      event.waitUntil(
        browser.storage.sync.get("username").then((storage) => {
          if (!("username" in storage) || !storage["username"]) {
            browser.runtime.openOptionsPage();
          }
        })
      );
    });
  } else {
    browser.runtime.onInstalled.addListener(() => {
      browser.storage.sync.get("username").then((storage) => {
        if (!("username" in storage) || !storage["username"]) {
          browser.runtime.openOptionsPage();
        }
      });
    });
  }
  var contextMenus = browser.contextMenus;
  async function createContextMenu() {
    if (!contextMenus) {
      return;
    }
    try {
      await contextMenus.removeAll();
      await contextMenus.create({
        id: "paste-email",
        contexts: ["editable"],
        title: browser.i18n.getMessage("menuPasteAddress")
      });
    } catch (error) {
      console.error("Error while creating context menu:", error);
    }
  }
  createContextMenu();
  async function isLoggedIn() {
    const sync = await browser.storage.sync.get(["username", "password"]);
    return Boolean(sync.username && sync.password);
  }
  function openCenteredPopup(url, width, height) {
    seiteOeffnen(url, { width, height, bezug: "zuletzt-fokussiert" }).catch((err) => console.error("[Aionda Mail] Seite konnte nicht ge\xF6ffnet werden:", err));
  }
  function openCreateAddressForm(ctx) {
    const url = browser.runtime.getURL("create-address/create-address.html");
    seiteOeffnen(url, { width: 750, height: 720, bezug: "zuletzt-fokussiert" }).then((seite) => {
      const handler = (tabId, changeInfo, tab) => {
        if (tabId === seite.tabId && changeInfo.status === "complete") {
          browser.tabs.onUpdated.removeListener(handler);
          browser.tabs.sendMessage(tab.id, [ctx.url, ctx.windowId, ctx.tabId, ctx.frameId]);
        }
      };
      browser.tabs.onUpdated.addListener(handler);
    }).catch((err) => console.error("[Aionda Mail] Formular konnte nicht ge\xF6ffnet werden:", err));
  }
  async function openCreateAddress(parentTab, frameId) {
    const ctx = { url: parentTab.url, windowId: parentTab.windowId, tabId: parentTab.id, frameId };
    if (!await isLoggedIn()) {
      const pending = { ...ctx, ts: Date.now() };
      await browser.storage.local.set({ "pending_create_address": pending });
      openCenteredPopup(browser.runtime.getURL("options/welcome.html"), 600, 720);
      return;
    }
    openCreateAddressForm(ctx);
  }
  async function resumePendingCreateAddress() {
    const stored = await browser.storage.local.get("pending_create_address");
    const pending = stored.pending_create_address;
    if (!pending) {
      return;
    }
    await browser.storage.local.remove("pending_create_address");
    if (typeof pending.ts !== "number" || Date.now() - pending.ts > 12e4) {
      return;
    }
    openCreateAddressForm(pending);
  }
  contextMenus?.onClicked.addListener((event, parentTab) => {
    if (event.menuItemId === "paste-email") {
      openCreateAddress(parentTab, event.frameId || 0);
    } else {
      browser.tabs.sendMessage(
        parentTab.id,
        event.menuItemId,
        { "frameId": event.frameId }
      );
    }
  });
  var currentDomain = "";
  var previousAddressMenus = [];
  browser.storage.onChanged.addListener((changes, area) => {
    if ("previous_addresses" in changes) {
      currentDomain = "*invalid*";
    }
    if (area === "sync" && ("username" in changes || "password" in changes)) {
      browser.storage.local.remove(BACKGROUND_LOGIN_BLOCK_KEY);
    }
  });
  async function updateContextMenu(tabId, changeInfo, tab) {
    if (!contextMenus) {
      return;
    }
    try {
      if (!tab.url) {
        return;
      }
      let domain;
      try {
        domain = new URL(tab.url).hostname;
      } catch (e) {
        console.error("Error while parsing the URL:", tab.url, e);
        return;
      }
      if (domain === currentDomain) {
        return;
      }
      currentDomain = domain;
      await createContextMenu();
      previousAddressMenus = [];
      if (!currentDomain) {
        return;
      }
      const storage = await browser.storage.local.get("previous_addresses");
      const storedPreviousAddresses = storage["previous_addresses"] || {};
      let addresses = [];
      let p = currentDomain.length;
      while (p >= 0) {
        p = currentDomain.lastIndexOf(".", p - 1);
        const domainPart = currentDomain.slice(p + 1);
        if (domainPart in storedPreviousAddresses) {
          addresses = storedPreviousAddresses[domainPart];
          break;
        }
      }
      for (const [email, urlValue] of addresses) {
        let url = urlValue;
        let urlDetail;
        try {
          url = new URL(url);
          urlDetail = currentDomain === url.hostname ? url.pathname : url.hostname;
        } catch (e) {
          console.error("Fehlerhafte URL:", url, e);
          continue;
        }
        const id = contextMenus.create({
          id: email,
          contexts: ["editable"],
          title: `${browser.i18n.getMessage("menuPastePrevious", email)} (${urlDetail})`
        });
        previousAddressMenus.push(id);
      }
    } catch (error) {
      console.error("Error on creating context menu:", error);
    }
  }
  browser.tabs.onUpdated.addListener(updateContextMenu);
  browser.tabs.onActivated.addListener((activeInfo) => {
    browser.tabs.get(activeInfo.tabId).then((tab) => updateContextMenu(tab.id, {}, tab));
  });
  function isPAT(password) {
    return Boolean(password) && typeof password === "string" && password.startsWith("tmpat_") && password.length > 6;
  }
  var SilentSkip = class extends Error {
    constructor() {
      super(...arguments);
      this.silent = true;
    }
  };
  async function classicLoginAndStore(username, password) {
    const login = await callAPI({
      "cmd": "login",
      "fe-login-user": username,
      "fe-login-pass": password
    });
    const sessionId = String(login["session_id"] ?? "");
    const update = { "session_id": sessionId };
    if (login["domain_name_list"] && login["real_email_list"]) {
      update["domains"] = Array.isArray(login["domain_name_list"]) ? login["domain_name_list"] : Object.keys(login["domain_name_list"]);
      update["real_emails"] = Object.keys(login["real_email_list"]);
    }
    await browser.storage.local.set(update);
    return sessionId;
  }
  async function backgroundLogin(username, password) {
    const local = await browser.storage.local.get([BACKGROUND_LOGIN_BLOCK_KEY]);
    if (isBackgroundLoginBlocked(local[BACKGROUND_LOGIN_BLOCK_KEY], Date.now())) {
      console.log("[TrashMail] Background login blocked after an earlier failure, waiting for new credentials");
      throw new SilentSkip("blocked");
    }
    let sessionId;
    try {
      sessionId = await classicLoginAndStore(username, password);
    } catch (error) {
      await browser.storage.local.set({ [BACKGROUND_LOGIN_BLOCK_KEY]: backgroundLoginBlockFor(error, Date.now()) });
      throw error;
    }
    if (BACKGROUND_LOGIN_BLOCK_KEY in local) {
      await browser.storage.local.remove(BACKGROUND_LOGIN_BLOCK_KEY);
    }
    return sessionId;
  }
  function readDea(sessionId) {
    const data = {
      "cmd": "read_dea",
      "session_id": sessionId
    };
    return Promise.all([callAPI(data), getOrgDomainResolver()]);
  }
  async function loadAddressesWithStoredSession() {
    const storage = await browser.storage.sync.get(["username", "password"]);
    const username = storage.username;
    const password = storage.password;
    if (!username || !password) {
      console.log("[TrashMail] No stored credentials, skipping auto-login");
      throw new SilentSkip("skip");
    }
    const patAccount = isPAT(password);
    const local = await browser.storage.local.get(["session_id"]);
    const storedSession = local.session_id;
    if (!storedSession) {
      if (patAccount) {
        console.log("[TrashMail] No stored session for PAT account, user needs to login via Options");
        throw new SilentSkip("skip");
      }
      return readDea(await backgroundLogin(username, password));
    }
    try {
      return await readDea(storedSession);
    } catch (error) {
      if (patAccount || !isSessionRejected(error)) {
        throw error;
      }
      console.log("[TrashMail] Stored session rejected by server, logging in once");
      return readDea(await backgroundLogin(username, password));
    }
  }
  loadAddressesWithStoredSession().then((values) => {
    const currentPrevAddresses = {};
    const [addresses, orgDomain] = values;
    for (const address of addresses) {
      if (address["website"]) {
        let domain;
        try {
          let urlString = address["website"].trim();
          if (!/^https?:\/\//i.test(urlString)) {
            urlString = `https://${urlString}`;
          }
          domain = new URL(urlString);
        } catch (e) {
          console.warn("Ung\xFCltige URL:", address["website"], e);
          continue;
        }
        domain = orgDomain(domain);
        const email = [`${address["disposable_name"]}@${address["disposable_domain"]}`, address["website"]];
        if (domain in currentPrevAddresses) {
          currentPrevAddresses[domain].push(email);
        } else {
          currentPrevAddresses[domain] = [email];
        }
      }
    }
    browser.storage.local.set({ "previous_addresses": currentPrevAddresses });
  }).catch((error) => {
    const err = error;
    if (err && err.silent) {
      return;
    }
    if (err && err.requires_2fa) {
      console.log("[TrashMail] 2FA required, manual login needed");
      return;
    }
    console.warn("[TrashMail] Auto-login failed:", err.message || err);
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "auth_completed") {
      resumePendingCreateAddress();
      return;
    }
    if (message.action === "update_menu") {
      (async () => {
        try {
          if (message.tabId) {
            const tab = await browser.tabs.get(message.tabId);
            console.log("\u2705 Tab aus Nachricht erhalten:", tab.url);
            await updateContextMenu(message.tabId, {}, tab);
            return { status: "success" };
          }
          const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (activeTab) {
            await updateContextMenu(activeTab.id, {}, activeTab);
            return { status: "success" };
          } else {
            return { status: "error", message: "No active tab available." };
          }
        } catch (error) {
          return { status: "error", message: error.toString() };
        }
      })().then(sendResponse);
      return true;
    }
    if (message.action === "get_guardian_status") {
      console.log("[Background] Handling get_guardian_status");
      (async () => {
        try {
          const tabs = await browser.tabs.query({ active: true, currentWindow: true });
          if (tabs.length === 0) {
            return {
              enabled: self.guardianEnabled || false,
              initialized: self.guardianInitialized || false,
              keysLoaded: self.publicKeys ? self.publicKeys.size : 0,
              isProtected: false,
              status: null
            };
          }
          const tab = tabs[0];
          let hostname = null;
          let isProtected = false;
          try {
            hostname = new URL(tab.url).hostname;
            isProtected = self.isProtectedHost ? self.isProtectedHost(hostname) : false;
          } catch (e) {
          }
          const securityStatus = self.tabSecurityStatus ? self.tabSecurityStatus.get(tab.id) : null;
          const webRequestApi = browser.webRequest;
          const response = {
            tabId: tab.id,
            hostname,
            isProtected,
            enabled: self.guardianEnabled || false,
            status: securityStatus || null,
            keysLoaded: self.publicKeys ? self.publicKeys.size : 0,
            initialized: self.guardianInitialized || false,
            isFirefox: typeof webRequestApi?.getSecurityInfo === "function",
            ed25519Supported: self.ed25519Supported,
            limitedMode: typeof webRequestApi?.getSecurityInfo !== "function"
          };
          console.log("[Background] Sending guardian status:", response);
          return response;
        } catch (err) {
          console.error("[Background] Error in get_guardian_status:", err);
          return {
            initialized: false,
            keysLoaded: 0,
            isProtected: false,
            status: null,
            error: err.message
          };
        }
      })().then(sendResponse);
      return true;
    }
    return false;
  });
})();
