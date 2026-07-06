"use strict";
(() => {
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
    const width = 600;
    const height = 720;
    browser.windows.getCurrent().then((current) => {
      const left = Math.max(0, Math.round((current.left ?? 0) + ((current.width ?? width) - width) / 2));
      const top = Math.max(0, Math.round((current.top ?? 0) + ((current.height ?? height) - height) / 2));
      return browser.windows.create({
        "url": browser.runtime.getURL("options/welcome.html"),
        "width": width,
        "height": height,
        "left": left,
        "top": top,
        "type": "popup"
      });
    }).then((welcomeWindow) => {
      browser.windows.onRemoved.addListener((id) => {
        if (id === welcomeWindow.id) {
          window.location.reload();
        }
      });
    });
  };
  function restoreOptions() {
    function setCurrentOptions(result) {
      const [sync, local] = result;
      const isLoggedIn = Boolean(sync["username"]);
      elById("username").textContent = isLoggedIn ? String(sync["username"]) : browser.i18n.getMessage("optionsNotLoggedIn");
      elById("btn-switch-login").textContent = browser.i18n.getMessage(
        isLoggedIn ? "optionsSwitchLoginButton" : "optionsLoginButton"
      );
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
