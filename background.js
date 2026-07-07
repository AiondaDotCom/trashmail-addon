"use strict";
(() => {
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
  async function createContextMenu() {
    try {
      await browser.contextMenus.removeAll();
      await browser.contextMenus.create({
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
    browser.windows.getLastFocused().then((focused) => {
      const left = Math.max(0, Math.round((focused.left ?? 0) + ((focused.width ?? width) - width) / 2));
      const top = Math.max(0, Math.round((focused.top ?? 0) + ((focused.height ?? height) - height) / 2));
      browser.windows.create({ "url": url, "type": "popup", "width": width, "height": height, "left": left, "top": top });
    });
  }
  function openCreateAddressForm(ctx) {
    const width = 750;
    const height = 720;
    browser.windows.getLastFocused().then((focused) => {
      const left = Math.max(0, Math.round((focused.left ?? 0) + ((focused.width ?? width) - width) / 2));
      const top = Math.max(0, Math.round((focused.top ?? 0) + ((focused.height ?? height) - height) / 2));
      const options = {
        "url": "../create-address/create-address.html",
        "type": "popup",
        "width": width,
        "height": height,
        "left": left,
        "top": top
      };
      return browser.windows.create(options);
    }).then((window) => {
      const handler = (tabId, changeInfo, tab) => {
        if (tabId === window.tabs[0].id && changeInfo.status === "complete") {
          browser.tabs.onUpdated.removeListener(handler);
          browser.tabs.sendMessage(tab.id, [ctx.url, ctx.windowId, ctx.tabId, ctx.frameId]);
        }
      };
      browser.tabs.onUpdated.addListener(handler);
    });
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
  browser.contextMenus.onClicked.addListener((event, parentTab) => {
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
  });
  async function updateContextMenu(tabId, changeInfo, tab) {
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
        const id = browser.contextMenus.create({
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
  browser.storage.sync.get(["username", "password"]).then((storage) => {
    if (!storage["username"] || !storage["password"]) {
      console.log("[TrashMail] No stored credentials, skipping auto-login");
      return Promise.reject({ silent: true });
    }
    if (isPAT(storage["password"])) {
      console.log("[TrashMail] PAT detected (OPAQUE account), checking for stored session...");
      return browser.storage.local.get(["session_id"]).then((localData) => {
        if (localData.session_id) {
          console.log("[TrashMail] Using stored session_id for auto-refresh");
          return { session_id: localData.session_id };
        } else {
          console.log("[TrashMail] No stored session for OPAQUE account, user needs to login via Options");
          return Promise.reject({ silent: true });
        }
      });
    }
    const data = {
      "cmd": "login",
      "fe-login-user": storage["username"],
      "fe-login-pass": storage["password"]
    };
    return callAPI(data);
  }).then((login) => {
    console.log("[TrashMail] Auto-login response:", login);
    console.log("[TrashMail] Session ID:", login["session_id"]);
    if (login["domain_name_list"] && login["real_email_list"]) {
      const domains = Array.isArray(login["domain_name_list"]) ? login["domain_name_list"] : Object.keys(login["domain_name_list"]);
      browser.storage.local.set({
        "domains": domains,
        "real_emails": Object.keys(login["real_email_list"])
      });
    }
    const data = {
      "cmd": "read_dea",
      "session_id": login["session_id"]
    };
    console.log("[TrashMail] read_dea request:", data);
    const suffixes = fetch(browser.runtime.getURL("public_suffix.json")).then((response) => response.ok ? response.json() : Promise.reject(new Error("Public Suffix List konnte nicht geladen werden")));
    return Promise.all([callAPI(data), suffixes]);
  }).then((values) => {
    const currentPrevAddresses = {};
    const [addresses, [rules, exceptions]] = values;
    const orgDomain = globalThis.org_domain;
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
        domain = orgDomain(domain, rules, exceptions);
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
