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
  function beimSchliessen(seite, rueckruf) {
    const b = api();
    if (!seite.alsTab && seite.windowId !== void 0 && hat(b.windows?.onRemoved, "addListener")) {
      b.windows.onRemoved.addListener((id) => {
        if (id === seite.windowId) {
          rueckruf();
        }
      });
      return;
    }
    if (seite.tabId !== void 0 && hat(b.tabs?.onRemoved, "addListener")) {
      b.tabs.onRemoved.addListener((id) => {
        if (id === seite.tabId) {
          rueckruf();
        }
      });
    }
  }

  // trashmail-addon/ts/options/options.ts
  var browser = globalThis.browser ?? chrome;
  function elById(id) {
    const el = document.getElementById(id);
    if (el === null) {
      throw new Error(`Element #${id} not found`);
    }
    return el;
  }
  elById("btn-switch-login").onclick = function() {
    seiteOeffnen(browser.runtime.getURL("options/welcome.html"), { width: 600, height: 720, bezug: "aktuell" }).then((welcome) => {
      beimSchliessen(welcome, () => window.location.reload());
    }).catch((err) => console.error("[Aionda Mail] Anmeldung konnte nicht ge\xF6ffnet werden:", err));
  };
  function logout() {
    browser.storage.local.get(["session_id"]).then((local) => {
      const sessionId = local["session_id"];
      const requests = [];
      if (sessionId) {
        requests.push(callAPI({ "cmd": "logout", "session_id": sessionId }).catch(() => void 0));
      }
      requests.push(fetch(`${API_BASE_URL}/?api=1&cmd=logout`, {
        method: "POST",
        credentials: "include"
      }).catch(() => void 0));
      return Promise.all(requests);
    }).then(() => Promise.all([
      browser.storage.sync.remove(["username", "password"]),
      browser.storage.local.remove(["session_id", "is_opaque_account", "real_emails", "domains", "previous_addresses"])
    ])).then(() => {
      window.location.reload();
    });
  }
  elById("btn-logout").addEventListener("click", logout);
  function restoreOptions() {
    function setCurrentOptions(result) {
      const [sync, local] = result;
      const isLoggedIn = Boolean(sync["username"]);
      elById("username").textContent = isLoggedIn ? String(sync["username"]) : browser.i18n.getMessage("optionsNotLoggedIn");
      elById("btn-switch-login").textContent = browser.i18n.getMessage(
        isLoggedIn ? "optionsSwitchLoginButton" : "optionsLoginButton"
      );
      elById("btn-logout").style.display = isLoggedIn ? "" : "none";
      const pairs = [["real_emails", "default_email"], ["domains", "default_domain"]];
      for (const [list, prop] of pairs) {
        const select = elById(prop);
        const raw = local[list];
        const items = Array.isArray(raw) ? raw : Object.keys(raw || {});
        for (const item of items) {
          const option = document.createElement("option");
          option.value = option.text = item;
          if (item === sync[prop]) {
            option.selected = true;
          }
          select.add(option);
        }
      }
      let props = ["default_forwards", "default_expire"];
      for (const prop of props) {
        if (Object.prototype.hasOwnProperty.call(sync, prop)) {
          elById(prop).value = String(sync[prop]);
        }
      }
      props = [
        "default_masq",
        "default_notify",
        "default_send",
        "guardian_enabled"
      ];
      for (const prop of props) {
        if (Object.prototype.hasOwnProperty.call(sync, prop)) {
          elById(prop).checked = Boolean(sync[prop]);
        }
      }
      if ("username" in sync) {
        const selector = "#options-default input, #options-default select";
        for (const elem of document.querySelectorAll(selector)) {
          elem.disabled = false;
        }
      }
    }
    const p1 = browser.storage.sync.get();
    const p2 = browser.storage.local.get(["real_emails", "domains"]);
    Promise.all([p1, p2]).then(setCurrentOptions);
    if (sessionStorage !== null && sessionStorage.getItem("reset")) {
      const msg = elById("saved_msg");
      msg.style.display = "block";
      sessionStorage.removeItem("reset");
    }
  }
  document.addEventListener("DOMContentLoaded", restoreOptions);
  function saveOptions(e) {
    e.preventDefault();
    elById("saved_msg").style.display = "none";
    const getter = browser.storage.sync.get();
    const form = new FormData(e.target);
    const formObj = {};
    for (const [key, value] of form) {
      formObj[key] = value;
    }
    const checkboxes = [
      "default_masq",
      "default_notify",
      "default_send",
      "guardian_enabled"
    ];
    for (const prop of checkboxes) {
      if (!(prop in formObj)) {
        formObj[prop] = false;
      }
    }
    getter.then((storage) => {
      if (sessionStorage !== null) {
        sessionStorage.setItem("undo", JSON.stringify(storage));
      }
      browser.storage.sync.set(formObj).then(() => {
        const msg = elById("saved_msg");
        msg.style.display = "block";
        if (sessionStorage === null) {
          msg.querySelector("#undo").remove();
        }
      });
    });
  }
  document.querySelector("form").addEventListener("submit", saveOptions);
  function undoOptions() {
    const undo = JSON.parse(sessionStorage.getItem("undo"));
    browser.storage.sync.set(undo).then(() => {
      window.location.reload();
    });
  }
  elById("undo").addEventListener("click", undoOptions);
  function resetOptions() {
    const options = [
      "default_email",
      "default_forwards",
      "default_expire",
      "default_masq",
      "default_notify",
      "default_send",
      "default_domain"
    ];
    browser.storage.sync.get().then((storage) => {
      if (sessionStorage !== null) {
        sessionStorage.setItem("undo", JSON.stringify(storage));
        sessionStorage.setItem("reset", String(true));
      }
      browser.storage.sync.remove(options).then(() => {
        window.location.reload(true);
      });
    });
  }
  elById("btn-reset").addEventListener("click", resetOptions);
  function addressManager() {
    const progress = elById("progress");
    progress.style.display = "inline-block";
    openAddressManagerAuthenticated().then(() => {
      progress.style.display = "none";
    }).catch((error) => {
      const errorMsg = elById("error_msg");
      errorMsg.textContent = error.message || String(error);
      errorMsg.style.display = "block";
      progress.style.display = "none";
    });
  }
  elById("btn-address-manager").addEventListener("click", addressManager);
  var debugClickCount = 0;
  var debugClickTimer;
  function initDebugPanel() {
    const title = document.querySelector("h1");
    if (!title) {
      return;
    }
    title.style.cursor = "pointer";
    title.addEventListener("click", () => {
      debugClickCount++;
      console.log("[Debug] Click count:", debugClickCount);
      clearTimeout(debugClickTimer);
      debugClickTimer = setTimeout(() => {
        debugClickCount = 0;
      }, 2e3);
      if (debugClickCount >= 5) {
        debugClickCount = 0;
        console.log("[Debug] 5 clicks reached!");
        const debugPanel = document.getElementById("debug-panel");
        console.log("[Debug] Panel element:", debugPanel);
        if (!debugPanel) {
          console.error("[Debug] Panel not found!");
          return;
        }
        const isHidden = !debugPanel.style.display || debugPanel.style.display === "none";
        debugPanel.style.display = isHidden ? "block" : "none";
        console.log("[Debug] Panel toggled:", isHidden ? "shown" : "hidden");
        browser.storage.local.get("debugApiUrl").then((result) => {
          const select = elById("debug_api_url");
          if (result.debugApiUrl) {
            select.value = result.debugApiUrl;
          } else {
            select.value = "https://mail.aionda.com";
          }
          updateDebugStatus();
        });
      }
    });
  }
  document.addEventListener("DOMContentLoaded", initDebugPanel);
  function updateDebugStatus() {
    const status = elById("debug-status");
    browser.storage.local.get("debugApiUrl").then((result) => {
      if (result.debugApiUrl && result.debugApiUrl !== "https://mail.aionda.com") {
        status.textContent = `\u26A0\uFE0F Debug mode active: ${result.debugApiUrl}`;
        status.style.color = "#c00";
      } else {
        status.textContent = "\u2705 Using production server";
        status.style.color = "#080";
      }
    });
  }
  elById("btn-save-debug").addEventListener("click", () => {
    const url = elById("debug_api_url").value;
    browser.storage.local.set({ debugApiUrl: url }).then(() => {
      globalThis.API_BASE_URL = url;
      updateDebugStatus();
      alert("Debug settings saved! Please reload the extension or restart the browser for changes to take full effect.");
    });
  });
  elById("btn-reset-debug").addEventListener("click", () => {
    browser.storage.local.remove("debugApiUrl").then(() => {
      globalThis.API_BASE_URL = DEFAULT_API_URL;
      elById("debug_api_url").value = "https://mail.aionda.com";
      updateDebugStatus();
      alert("Reset to production server!");
    });
  });
})();
