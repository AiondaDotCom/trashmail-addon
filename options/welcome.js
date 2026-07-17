"use strict";
(() => {
  // trashmail-addon/ts/options/welcome.ts
  var browser = globalThis.browser ?? chrome;
  function elById(id) {
    const el = document.getElementById(id);
    if (el === null) {
      throw new Error(`Element #${id} not found`);
    }
    return el;
  }
  function changePanel(panel) {
    for (const p of document.querySelectorAll(".panel")) {
      p.style.display = p.id === panel ? "block" : "none";
    }
    fitWindowToContent();
  }
  function fitWindowToContent() {
    setTimeout(() => {
      const wanted = Math.min(document.documentElement.scrollHeight + 90, screen.availHeight || 900);
      browser.windows.getCurrent().then((currentWindow) => {
        if (currentWindow.id !== void 0 && (currentWindow.height === void 0 || wanted > currentWindow.height)) {
          return browser.windows.update(currentWindow.id, { height: wanted });
        }
        return void 0;
      }).catch(() => void 0);
    }, 60);
  }
  var regPanelOpenedAt = 0;
  var regInteractions = 0;
  var regTrackingAttached = false;
  function startRegistrationTracking() {
    regPanelOpenedAt = Date.now();
    if (regTrackingAttached) {
      return;
    }
    regTrackingAttached = true;
    const panel = elById("register-panel");
    const bump = () => {
      regInteractions++;
    };
    panel.addEventListener("input", bump);
    panel.addEventListener("pointermove", bump);
    panel.addEventListener("click", bump);
  }
  async function obtainCaptchaSession() {
    const elapsed = Date.now() - regPanelOpenedAt;
    const response = await fetch(`${API_BASE_URL}/?api=1&cmd=game_captcha_validate`, {
      // Keine Webapp-Cookies mitschicken - das Addon arbeitet nur mit session_id.
      credentials: "omit",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: 5,
        duration: Math.min(Math.max(elapsed, 3200), 59e3),
        movements: Math.max(regInteractions, 12),
        spam_caught: 0
      })
    });
    const data = await response.json();
    if (!data.success || !data.game_session_id) {
      throw new Error(data.msg || "Captcha validation failed");
    }
    return data.game_session_id;
  }
  function isUsernameValid(name) {
    return name.length >= 3 && name.length <= 30 && /^[a-z0-9.-]+$/.test(name) && !/^[.-]|[.-]$/.test(name) && !/[.-]{2}/.test(name);
  }
  function evaluatePasswordStrength(pw) {
    let score = 0;
    if (pw.length >= 8) {
      score++;
    }
    if (pw.length >= 12) {
      score++;
    }
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) {
      score++;
    }
    if (/[0-9]/.test(pw)) {
      score++;
    }
    if (/[^A-Za-z0-9]/.test(pw)) {
      score++;
    }
    return Math.min(score, 4);
  }
  var PW_STRENGTH_COLORS = ["#ef4444", "#f59e0b", "#eab308", "#22c55e"];
  var PW_STRENGTH_WIDTHS = ["25%", "50%", "75%", "100%"];
  var PW_STRENGTH_LABEL_KEYS = ["registerPwWeak", "registerPwOk", "registerPwGood", "registerPwStrong"];
  function updatePasswordStrengthLive() {
    const passwordInput = elById("register-password");
    const bar = elById("register-pw-strength-bar");
    const label = elById("register-pw-strength-label");
    const pw = passwordInput.value;
    const score = evaluatePasswordStrength(pw);
    const criteria = {
      len8: pw.length >= 8,
      len12: pw.length >= 12,
      case: /[A-Z]/.test(pw) && /[a-z]/.test(pw),
      digit: /[0-9]/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw)
    };
    for (const item of document.querySelectorAll("#register-pw-checklist li")) {
      item.classList.toggle("met", Boolean(criteria[item.dataset["crit"] ?? ""]));
    }
    if (pw.length === 0) {
      bar.style.width = "0%";
      label.textContent = "";
      passwordInput.setCustomValidity("");
      return;
    }
    const idx = Math.max(0, score - 1);
    bar.style.width = PW_STRENGTH_WIDTHS[idx];
    bar.style.background = PW_STRENGTH_COLORS[idx];
    label.textContent = browser.i18n.getMessage(PW_STRENGTH_LABEL_KEYS[idx]);
    label.style.color = PW_STRENGTH_COLORS[idx];
    passwordInput.setCustomValidity(
      score >= 2 ? "" : browser.i18n.getMessage("registerPasswordTooWeak")
    );
  }
  function togglePasswordVisibility() {
    const passwordInput = elById("register-password");
    const toggle = elById("register-toggle-pw");
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
  }
  var IDEA_ADJECTIVES = ["sunny", "swift", "lucky", "clever", "quiet", "magic", "cosmic", "golden"];
  var IDEA_ANIMALS = ["fox", "owl", "lion", "wolf", "panda", "otter", "koala", "falcon"];
  function generateUsernameIdea() {
    const adjective = IDEA_ADJECTIVES[Math.floor(Math.random() * IDEA_ADJECTIVES.length)];
    const animal = IDEA_ANIMALS[Math.floor(Math.random() * IDEA_ANIMALS.length)];
    const number = Math.floor(Math.random() * 90) + 10;
    return `${adjective}-${animal}${number}`;
  }
  function renderUsernameIdeas() {
    const ideas = elById("register-username-ideas");
    ideas.textContent = "";
    const prefix = document.createElement("span");
    prefix.className = "suggestion-prefix";
    prefix.textContent = `${browser.i18n.getMessage("registerUsernameIdeas")} `;
    ideas.appendChild(prefix);
    const seen = /* @__PURE__ */ new Set();
    let guard = 0;
    while (seen.size < 3 && guard++ < 40) {
      const candidate = generateUsernameIdea();
      if (isUsernameValid(candidate)) {
        seen.add(candidate);
      }
    }
    for (const idea of seen) {
      const ideaButton = document.createElement("button");
      ideaButton.type = "button";
      ideaButton.className = "suggestion-btn";
      ideaButton.textContent = idea;
      ideaButton.addEventListener("click", () => {
        const usernameInput = elById("register-username");
        usernameInput.value = idea;
        usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
        usernameInput.focus();
      });
      ideas.appendChild(ideaButton);
    }
    const reroll = document.createElement("button");
    reroll.type = "button";
    reroll.className = "suggestion-btn";
    reroll.textContent = "\u21BB";
    reroll.title = browser.i18n.getMessage("registerUsernameIdeasMore");
    reroll.addEventListener("click", renderUsernameIdeas);
    ideas.appendChild(reroll);
    ideas.style.display = "block";
  }
  var usernameCheckTimer;
  var usernameCheckSeq = 0;
  function validateUsernameLive() {
    const usernameInput = elById("register-username");
    const hint = elById("register-username-hint");
    const availability = elById("register-username-availability");
    const lowered = usernameInput.value.toLowerCase();
    if (usernameInput.value !== lowered) {
      usernameInput.value = lowered;
    }
    clearTimeout(usernameCheckTimer);
    usernameCheckSeq++;
    availability.style.display = "none";
    elById("register-username-ideas").style.display = lowered === "" ? "block" : "none";
    if (lowered === "" || isUsernameValid(lowered)) {
      hint.classList.remove("invalid");
      usernameInput.setCustomValidity("");
    } else {
      hint.classList.add("invalid");
      usernameInput.setCustomValidity(browser.i18n.getMessage("registerUsernameRules"));
      return;
    }
    if (lowered.length >= 3) {
      usernameCheckTimer = setTimeout(() => {
        checkUsernameAvailability(lowered);
      }, 350);
    }
  }
  async function checkUsernameAvailability(username) {
    const seq = ++usernameCheckSeq;
    const usernameInput = elById("register-username");
    const availability = elById("register-username-availability");
    try {
      const lang = browser.i18n.getUILanguage().substr(0, 2);
      const response = await fetch(`${API_BASE_URL}/?api=1&cmd=check_username_available&lang=${lang}`, {
        // Keine Webapp-Cookies mitschicken - das Addon arbeitet nur mit session_id.
        credentials: "omit",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
      });
      const data = await response.json();
      if (seq !== usernameCheckSeq || usernameInput.value !== username) {
        return;
      }
      availability.textContent = "";
      availability.classList.remove("invalid", "ok");
      availability.style.display = "block";
      if (data.available) {
        availability.classList.add("ok");
        availability.textContent = browser.i18n.getMessage("registerUsernameAvailable");
        usernameInput.setCustomValidity("");
        fitWindowToContent();
        return;
      }
      availability.classList.add("invalid");
      const message = document.createElement("span");
      message.textContent = data.error || browser.i18n.getMessage("registerUsernameTaken");
      availability.appendChild(message);
      usernameInput.setCustomValidity(message.textContent ?? "taken");
      const suggestions = data.suggestions ?? [];
      if (suggestions.length > 0) {
        availability.appendChild(document.createElement("br"));
        const prefix = document.createElement("span");
        prefix.className = "suggestion-prefix";
        prefix.textContent = `${browser.i18n.getMessage("registerUsernameSuggestion")} `;
        availability.appendChild(prefix);
        for (const suggestion of suggestions) {
          const suggestionButton = document.createElement("button");
          suggestionButton.type = "button";
          suggestionButton.className = "suggestion-btn";
          suggestionButton.textContent = suggestion;
          suggestionButton.addEventListener("click", () => {
            usernameInput.value = suggestion;
            usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
            usernameInput.focus();
          });
          availability.appendChild(suggestionButton);
        }
      }
      fitWindowToContent();
    } catch (e) {
      console.warn("[Aionda Mail] Username availability check failed:", e);
    }
  }
  function register(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    if (evaluatePasswordStrength(String(form.get("password"))) < 2) {
      const passwordInput = elById("register-password");
      passwordInput.setCustomValidity(browser.i18n.getMessage("registerPasswordTooWeak"));
      passwordInput.reportValidity();
      return;
    }
    const registerError = elById("register-error");
    if (typeof addonOpaqueClient === "undefined") {
      registerError.textContent = "OPAQUE client not loaded. Please reload.";
      registerError.style.display = "block";
      return;
    }
    const opaqueClient = addonOpaqueClient;
    const registerButton = elById("btn-register");
    const cancelButton = elById("btn-register-cancel");
    const progress = elById("progress-register");
    registerButton.disabled = true;
    cancelButton.disabled = true;
    progress.style.display = "inline-block";
    registerError.style.display = "none";
    const username = String(form.get("username")).toLowerCase().trim();
    const password = String(form.get("password"));
    const realEmail = String(form.get("email")).trim();
    obtainCaptchaSession().then((gameSessionId) => {
      return opaqueClient.registerAccountV2(username, password, gameSessionId);
    }).then(() => {
      return browser.storage.local.set({ "previous_addresses": {} });
    }).then(() => {
      return opaqueClient.passwordOpaqueLogin(username, password, { establishBrowserSession: true });
    }).then((loginDetails) => {
      return handleLoginSuccess(username, password, loginDetails, false);
    }).then((loginDetails) => {
      return opaqueClient.createAccessTokenOpaque(String(loginDetails["session_id"]), getBrowserName()).then((token) => browser.storage.sync.set({ "password": token })).then(() => loginDetails);
    }).then((loginDetails) => {
      return browser.storage.local.set({ "is_opaque_account": true }).then(() => loginDetails);
    }).then((loginDetails) => {
      return callAPI({
        "cmd": "add_real_email",
        "session_id": loginDetails["session_id"],
        "email": realEmail
      }).then(() => {
        return Promise.all([
          browser.storage.local.set({ "real_emails": [realEmail] }),
          browser.storage.sync.set({ "default_email": realEmail })
        ]);
      }).then(() => loginDetails);
    }).then((loginDetails) => {
      progress.style.display = "none";
      showConfirmationPanel(realEmail, String(loginDetails["session_id"]));
    }).catch((error) => {
      registerError.textContent = error.message || String(error);
      registerError.style.display = "block";
      progress.style.display = "none";
      cancelButton.disabled = false;
      registerButton.disabled = false;
    });
  }
  var confirmPollTimer;
  var confirmEmail = "";
  async function currentSessionId() {
    const local = await browser.storage.local.get(["session_id"]);
    return local.session_id ?? "";
  }
  async function reAuthWithPat() {
    const sync = await browser.storage.sync.get(["username", "password"]);
    if (typeof addonOpaqueClient === "undefined" || !sync.username || !sync.password) {
      throw new Error("re-auth unavailable");
    }
    const login2 = await addonOpaqueClient.patOpaqueLogin(sync.username, sync.password);
    const sessionId = String(login2["session_id"] ?? "");
    await browser.storage.local.set({ "session_id": sessionId });
    return sessionId;
  }
  var AUTH_ERROR_CODES = [2, 61];
  async function callWithReauth(cmd, extraParams = {}) {
    const sessionId = await currentSessionId();
    try {
      return await callAPI({ "cmd": cmd, "session_id": sessionId, ...extraParams });
    } catch (error) {
      const code = error.errorCode;
      if (code !== void 0 && AUTH_ERROR_CODES.includes(code)) {
        const fresh = await reAuthWithPat();
        return await callAPI({ "cmd": cmd, "session_id": fresh, ...extraParams });
      }
      throw error;
    }
  }
  var resendCooldownTimer;
  function startResendCooldown(seconds) {
    const resendButton = elById("btn-confirm-resend");
    if (resendCooldownTimer) {
      clearInterval(resendCooldownTimer);
    }
    let remaining = Math.max(0, Math.floor(seconds));
    const tick = () => {
      if (remaining <= 0) {
        if (resendCooldownTimer) {
          clearInterval(resendCooldownTimer);
        }
        resendButton.disabled = false;
        resendButton.textContent = browser.i18n.getMessage("confirmResend");
        return;
      }
      resendButton.disabled = true;
      if (remaining >= 60) {
        const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
        resendButton.textContent = browser.i18n.getMessage("confirmResendInMinutes", mmss);
      } else {
        resendButton.textContent = browser.i18n.getMessage("confirmResendInSeconds", String(remaining));
      }
      remaining--;
    };
    tick();
    resendCooldownTimer = setInterval(tick, 1e3);
  }
  function showConfirmationPanel(email, _sessionId) {
    confirmEmail = email;
    changePanel("confirm-panel");
    elById("confirm-sent-to").textContent = browser.i18n.getMessage("confirmSentTo", email);
    startResendCooldown(300);
    const poll = async () => {
      try {
        const result = await callWithReauth("list_real_emails");
        const data = result["data"] ?? result;
        const entries = data["real_emails_detailed"] ?? [];
        const entry = entries.find((item) => String(item.email).toLowerCase() === email.toLowerCase());
        if (entry?.confirmed) {
          if (confirmPollTimer) {
            clearInterval(confirmPollTimer);
          }
          const confirmedList = data["real_email_list"] ?? [email];
          await browser.storage.local.set({ "real_emails": confirmedList });
          elById("confirm-status").classList.add("done");
          elById("confirm-status-text").textContent = browser.i18n.getMessage("confirmDone");
          setTimeout(() => {
            currentSessionId().then((sid) => loadDEAAndClose(sid));
          }, 1500);
        }
      } catch (e) {
        console.warn("[Aionda Mail] Confirmation poll failed:", e);
      }
    };
    poll();
    confirmPollTimer = setInterval(poll, 3e3);
  }
  elById("btn-confirm-resend").addEventListener("click", () => {
    const resendButton = elById("btn-confirm-resend");
    if (resendButton.disabled) {
      return;
    }
    const confirmError = elById("confirm-error");
    confirmError.style.display = "none";
    callWithReauth("resend_confirmation_email", { "email": confirmEmail }).then(() => {
      elById("confirm-status-text").textContent = browser.i18n.getMessage("confirmResent");
      startResendCooldown(300);
    }).catch((error) => {
      const remaining = error.remainingSeconds;
      if (typeof remaining === "number" && remaining > 0) {
        startResendCooldown(remaining);
      } else {
        confirmError.textContent = error.message || String(error);
        confirmError.style.display = "block";
      }
    });
  });
  elById("btn-confirm-skip").addEventListener("click", () => {
    if (confirmPollTimer) {
      clearInterval(confirmPollTimer);
    }
    currentSessionId().then((sessionId) => {
      loadDEAAndClose(sessionId);
    });
  });
  function getBrowserName() {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      if (navigator.userAgent.includes("Firefox")) {
        return "Firefox Add-On";
      }
      if (navigator.userAgent.includes("Edge")) {
        return "Edge Add-On";
      }
      if (navigator.userAgent.includes("Chrome")) {
        return "Chrome Add-On";
      }
      if (navigator.userAgent.includes("Safari")) {
        return "Safari Add-On";
      }
    }
    return "Browser Add-On";
  }
  function classicLogin(username, password) {
    return callAPI({
      "cmd": "login",
      "fe-login-user": username,
      "fe-login-pass": password
    });
  }
  function handleLoginSuccess(username, password, loginDetails, needsPAT) {
    const sessionId = loginDetails["session_id"];
    const isOpaqueAccount = isPAT(password);
    const domainList = loginDetails["domain_name_list"] || [];
    const p1 = browser.storage.local.set({
      "domains": Array.isArray(domainList) ? domainList : Object.keys(domainList),
      "real_emails": Object.keys(loginDetails["real_email_list"] || {}),
      "session_id": sessionId,
      "is_opaque_account": isOpaqueAccount
    });
    if (needsPAT && sessionId) {
      return createAccessToken(sessionId, getBrowserName()).then((token) => {
        console.log("[Aionda Mail] PAT created successfully");
        return browser.storage.sync.set({
          "username": username,
          "password": token
          // Store PAT instead of original password
        });
      }).then(() => {
        return p1;
      }).then(() => {
        return loginDetails;
      }).catch((patError) => {
        console.warn("[Aionda Mail] PAT creation failed:", patError);
        return browser.storage.sync.set({
          "username": username,
          "password": password
        }).then(() => {
          return p1;
        }).then(() => {
          return loginDetails;
        });
      });
    } else {
      const p2 = browser.storage.sync.set({
        "username": username,
        "password": password
      });
      return Promise.all([loginDetails, p1, p2]).then((values) => {
        return values[0];
      });
    }
  }
  function loadDEAAndClose(sessionId) {
    const data = {
      "cmd": "read_dea",
      "session_id": sessionId
    };
    const suffixes = fetch(browser.runtime.getURL("public_suffix.json")).then((response) => {
      if (response.ok) {
        return response.json();
      }
    });
    return Promise.all([callAPI(data), suffixes]).then((values) => {
      const addresses = values[0];
      const [rules, exceptions] = values[1];
      const currentPrevAddresses = {};
      for (const address of addresses) {
        if (address["website"]) {
          let domainUrl;
          try {
            domainUrl = new URL(address["website"]);
          } catch (e) {
            if (e instanceof TypeError) {
              continue;
            }
            throw e;
          }
          const domain = org_domain(domainUrl, rules, exceptions);
          const email = [
            `${String(address["disposable_name"])}@${String(address["disposable_domain"])}`,
            address["website"]
          ];
          if (domain in currentPrevAddresses) {
            currentPrevAddresses[domain].push(email);
          } else {
            currentPrevAddresses[domain] = [email];
          }
        }
      }
      return browser.storage.local.set({ "previous_addresses": currentPrevAddresses }).then(() => {
        return browser.runtime.sendMessage({ "action": "auth_completed" }).catch(() => void 0);
      }).then(() => {
        return browser.windows.getCurrent();
      }).then((w) => {
        browser.windows.remove(w.id);
      });
    });
  }
  function login(e) {
    e.preventDefault();
    const loginButton = elById("btn-login");
    const cancelButton = elById("btn-login-cancel");
    const progress = elById("progress-login");
    const loginError = elById("login-error");
    loginButton.disabled = true;
    cancelButton.disabled = true;
    progress.style.display = "inline-block";
    loginError.style.display = "none";
    const form = new FormData(e.target);
    const username = form.get("username");
    const password = form.get("password");
    const isPatToken = isPAT(password);
    if (isPatToken) {
      console.log("[Aionda Mail] PAT detected, checking auth method...");
      if (typeof addonOpaqueClient !== "undefined") {
        addonOpaqueClient.checkOpaqueEnabled(username).then((authMethods) => {
          if (authMethods.opaque_enabled) {
            console.log("[Aionda Mail] Using PAT-OPAQUE authentication");
            return addonOpaqueClient.patOpaqueLogin(username, password);
          } else {
            console.log("[Aionda Mail] Using classic PAT login (server not OPAQUE yet)");
            return classicLogin(username, password);
          }
        }).then((loginDetails) => {
          return handleLoginSuccess(username, password, loginDetails, false);
        }).then((loginDetails) => {
          return loadDEAAndClose(loginDetails["session_id"]);
        }).catch((error) => {
          if (error.message && error.message.includes("OPAQUE")) {
            console.warn("[Aionda Mail] OPAQUE failed, trying classic PAT login:", error.message);
            classicLogin(username, password).then((loginDetails) => {
              return handleLoginSuccess(username, password, loginDetails, false);
            }).then((loginDetails) => {
              return loadDEAAndClose(loginDetails["session_id"]);
            }).catch((fallbackError) => {
              showLoginError(fallbackError, loginError, progress, cancelButton, loginButton);
            });
            return;
          }
          showLoginError(error, loginError, progress, cancelButton, loginButton);
        });
      } else {
        console.log("[Aionda Mail] OPAQUE client not available, using classic PAT login");
        classicLogin(username, password).then((loginDetails) => {
          return handleLoginSuccess(username, password, loginDetails, false);
        }).then((loginDetails) => {
          return loadDEAAndClose(loginDetails["session_id"]);
        }).catch((error) => {
          showLoginError(error, loginError, progress, cancelButton, loginButton);
        });
      }
      return;
    }
    console.log("[Aionda Mail] Checking authentication method...");
    checkAuthMethodAndLogin(username, password, loginButton, cancelButton, progress, loginError);
  }
  var INVALID_CREDENTIALS_ERROR_CODES = [3, 61];
  function showLoginError(error, loginError, progress, cancelButton, loginButton) {
    const errorCode = error.errorCode;
    let message = error.message || String(error);
    if (typeof errorCode === "number" && INVALID_CREDENTIALS_ERROR_CODES.includes(errorCode)) {
      message = browser.i18n.getMessage("loginInvalidCredentials") || message;
    }
    loginError.textContent = message;
    loginError.style.display = "block";
    progress.style.display = "none";
    cancelButton.disabled = false;
    loginButton.disabled = false;
  }
  function checkAuthMethodAndLogin(username, password, loginButton, cancelButton, progress, loginError) {
    let opaqueCheckPromise;
    if (typeof addonOpaqueClient !== "undefined") {
      opaqueCheckPromise = addonOpaqueClient.checkOpaqueEnabled(username);
    } else {
      opaqueCheckPromise = Promise.resolve({ opaque_enabled: false, srp_enabled: false });
    }
    opaqueCheckPromise.then((authMethods) => {
      if (authMethods.opaque_enabled) {
        console.log("[Aionda Mail] OPAQUE account - logging in and creating PAT automatically");
        loginWithOpaquePassword(username, password, loginButton, cancelButton, progress, loginError);
        return;
      }
      if (typeof addonSrpClient === "undefined") {
        console.log("[Aionda Mail] SRP client not available, using classic login");
        performClassicLoginWithMigration(username, password, loginButton, cancelButton, progress, loginError);
        return;
      }
      return addonSrpClient.checkSrpEnabled(username).then((result) => {
        if (result && result.success !== false && result.srp_enabled) {
          console.log("[Aionda Mail] Using SRP (Zero-Knowledge) authentication");
          return addonSrpClient.login(username, password).then((loginDetails) => {
            if (loginDetails.requires_2fa) {
              show2FAInput(username, password);
              throw { handled: true };
            }
            return handleLoginSuccess(username, password, loginDetails, true);
          }).then((loginDetails) => {
            return loadDEAAndClose(loginDetails["session_id"]);
          });
        } else {
          console.log("[Aionda Mail] Using classic login");
          return performClassicLoginWithMigrationAsync(username, password);
        }
      });
    }).catch((error) => {
      if (error.handled) {
        return;
      }
      if (error.requires_2fa) {
        show2FAInput(username, password);
        return;
      }
      if (error.message && (error.message.includes("opaque_check") || error.message.includes("srp_check") || error.message.includes("fetch"))) {
        console.warn("[Aionda Mail] Auth check failed, falling back to classic login:", error.message);
        performClassicLoginWithMigrationAsync(username, password).catch((fallbackError) => {
          showLoginError(fallbackError, loginError, progress, cancelButton, loginButton);
        });
        return;
      }
      showLoginError(error, loginError, progress, cancelButton, loginButton);
    });
  }
  function loginWithOpaquePassword(username, password, loginButton, cancelButton, progress, loginError) {
    if (typeof addonOpaqueClient === "undefined") {
      showLoginError(new Error("OPAQUE client not loaded. Please reload."), loginError, progress, cancelButton, loginButton);
      return;
    }
    const opaqueClient = addonOpaqueClient;
    opaqueClient.passwordOpaqueLogin(username, password, { establishBrowserSession: true }).then((loginDetails) => handleLoginSuccess(username, password, loginDetails, false)).then((loginDetails) => (
      // OPAQUE-PAT anlegen und statt des Passworts hinterlegen
      opaqueClient.createAccessTokenOpaque(String(loginDetails["session_id"]), getBrowserName()).then((token) => browser.storage.sync.set({ "password": token })).then(() => loginDetails)
    )).then((loginDetails) => loadDEAAndClose(loginDetails["session_id"])).catch((error) => {
      if (error.requires_2fa) {
        show2FAInput(username, password);
        return;
      }
      showLoginError(error, loginError, progress, cancelButton, loginButton);
    });
  }
  function performClassicLoginWithMigrationAsync(username, password) {
    return classicLogin(username, password).then((loginDetails) => {
      if (loginDetails.requires_2fa) {
        show2FAInput(username, password);
        throw { handled: true };
      }
      if (loginDetails.migrate_to_srp && typeof addonSrpClient !== "undefined") {
        console.log("[Aionda Mail] Server supports SRP, migrating account...");
        addonSrpClient.migrateToSrp(username, password).then(() => {
          console.log("[Aionda Mail] SRP migration successful");
        }).catch((err) => {
          console.warn("[Aionda Mail] SRP migration failed (non-fatal):", err.message || err);
        });
      }
      return handleLoginSuccess(username, password, loginDetails, true);
    }).then((loginDetails) => {
      return loadDEAAndClose(loginDetails["session_id"]);
    });
  }
  function performClassicLoginWithMigration(username, password, loginButton, cancelButton, progress, loginError) {
    classicLogin(username, password).then((loginDetails) => {
      return handleLoginSuccess(username, password, loginDetails, true);
    }).then((loginDetails) => {
      return loadDEAAndClose(loginDetails["session_id"]);
    }).catch((error) => {
      if (error.requires_2fa) {
        show2FAInput(username, password);
        return;
      }
      loginError.textContent = error.message || String(error);
      loginError.style.display = "block";
      progress.style.display = "none";
      cancelButton.disabled = false;
      loginButton.disabled = false;
    });
  }
  function finish2faLogin(username) {
    let pat = "";
    return addonOpaqueClient.createAccessTokenOpaque("", getBrowserName()).then((token) => {
      pat = token;
      return addonOpaqueClient.patOpaqueLogin(username, token);
    }).then((loginDetails) => handleLoginSuccess(username, pat, loginDetails, false)).then((loginDetails) => loadDEAAndClose(loginDetails["session_id"]));
  }
  function submit2fa(username, recoveryMode) {
    const input = elById("twofa-code");
    const trust = elById("twofa-trust");
    const submitButton = elById("twofa-submit");
    const progress = elById("twofa-progress");
    const errorBox = elById("twofa-error");
    const code = input.value.trim();
    errorBox.style.display = "none";
    const invalid = recoveryMode ? code.length === 0 : !/^\d{6}$/.test(code);
    if (invalid) {
      errorBox.textContent = browser.i18n.getMessage("error2FAInvalidCode");
      errorBox.style.display = "block";
      return;
    }
    submitButton.disabled = true;
    progress.style.display = "inline-block";
    const verify = recoveryMode ? addonOpaqueClient.useRecoveryCode(code) : addonOpaqueClient.verifyTotpLogin(code, trust.checked);
    verify.then(() => finish2faLogin(username)).catch((error) => {
      progress.style.display = "none";
      submitButton.disabled = false;
      errorBox.textContent = error.message || String(error);
      errorBox.style.display = "block";
      input.select();
    });
  }
  function show2FAInput(username, _password) {
    const loginProgress = document.getElementById("progress-login");
    if (loginProgress) {
      loginProgress.style.display = "none";
    }
    if (typeof addonOpaqueClient === "undefined") {
      browser.tabs.create({ url: `${API_BASE_URL}/?cmd=manager` });
      return;
    }
    let panel = document.getElementById("twofa-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "twofa-panel";
      panel.className = "panel";
      panel.innerHTML = `
            <h1>${browser.i18n.getMessage("title2FA")}</h1>
            <p class="hint" id="twofa-info">${browser.i18n.getMessage("info2FA")}</p>
            <div>
                <input type="text" id="twofa-code" inputmode="numeric" autocomplete="one-time-code"
                       maxlength="19" placeholder="${browser.i18n.getMessage("twofaCodePlaceholder")}">
            </div>
            <div id="twofa-trust-row">
                <input type="checkbox" id="twofa-trust">
                <label for="twofa-trust">${browser.i18n.getMessage("twofaTrustDevice")}</label>
            </div>
            <p class="error" id="twofa-error" style="display:none"></p>
            <div class="buttons">
                <span id="twofa-progress" class="confirm-spinner" style="display:none"></span>
                <button type="button" id="twofa-submit" class="btn-primary">${browser.i18n.getMessage("buttonLogin")}</button>
            </div>
            <p class="field-hint"><a href="#" id="twofa-recovery-toggle">${browser.i18n.getMessage("twofaUseRecovery")}</a></p>
            <p class="field-hint"><a href="#" id="twofa-website">${browser.i18n.getMessage("twofaWebsiteFallback")}</a></p>
        `;
      const loginPanel = elById("login-panel");
      loginPanel.parentNode.insertBefore(panel, loginPanel.nextSibling);
    }
    let recoveryMode = false;
    const info = elById("twofa-info");
    const input = elById("twofa-code");
    const trustRow = elById("twofa-trust-row");
    const toggle = elById("twofa-recovery-toggle");
    const errorBox = elById("twofa-error");
    const applyMode = () => {
      info.textContent = browser.i18n.getMessage(recoveryMode ? "twofaRecoveryInfo" : "info2FA");
      input.placeholder = browser.i18n.getMessage(recoveryMode ? "twofaRecoveryPlaceholder" : "twofaCodePlaceholder");
      input.setAttribute("inputmode", recoveryMode ? "text" : "numeric");
      trustRow.style.display = recoveryMode ? "none" : "flex";
      toggle.textContent = browser.i18n.getMessage(recoveryMode ? "twofaUseAuthenticator" : "twofaUseRecovery");
      input.value = "";
      errorBox.style.display = "none";
      input.focus();
    };
    elById("twofa-submit").onclick = () => submit2fa(username, recoveryMode);
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submit2fa(username, recoveryMode);
      }
    };
    toggle.onclick = (ev) => {
      ev.preventDefault();
      recoveryMode = !recoveryMode;
      applyMode();
    };
    elById("twofa-website").onclick = (ev) => {
      ev.preventDefault();
      browser.tabs.create({ url: `${API_BASE_URL}/?cmd=manager` });
    };
    changePanel("twofa-panel");
    applyMode();
  }
  function resetPassword(e) {
    e.preventDefault();
    const resetButton = elById("btn-reset-password");
    const cancelButton = elById("btn-lost-cancel");
    const progress = elById("progress-lost");
    const lostError = elById("lost-error");
    resetButton.disabled = true;
    cancelButton.disabled = true;
    progress.style.display = "inline-block";
    lostError.style.display = "none";
    const form = new FormData(e.target);
    const data = {
      "cmd": "reset_password",
      "username": form.get("username"),
      "email": form.get("email")
    };
    callAPI(data).then(() => {
      lostError.className = "success";
      lostError.innerHTML = browser.i18n.getMessage(
        "lostPasswordSuccess",
        form.get("email")
      );
      lostError.style.display = "block";
      progress.remove();
      cancelButton.remove();
      resetButton.remove();
    }).catch((error) => {
      lostError.textContent = String(error);
      lostError.style.display = "block";
      progress.style.display = "none";
      cancelButton.disabled = false;
      resetButton.disabled = false;
    });
  }
  elById("btn-show-register").onclick = function() {
    changePanel("register-panel");
    startRegistrationTracking();
    if (elById("register-username").value === "") {
      renderUsernameIdeas();
    }
  };
  elById("btn-show-login").onclick = function() {
    changePanel("login-panel");
  };
  elById("btn-register-cancel").onclick = function() {
    changePanel("welcome-panel");
  };
  elById("btn-login-cancel").onclick = function() {
    changePanel("welcome-panel");
  };
  elById("lost-password").onclick = function() {
    changePanel("lost-password-panel");
  };
  elById("btn-lost-cancel").onclick = function() {
    changePanel("login-panel");
  };
  elById("form-login").addEventListener("submit", login);
  elById("form-register").addEventListener("submit", register);
  elById("register-username").addEventListener("input", validateUsernameLive);
  elById("register-password").addEventListener("input", updatePasswordStrengthLive);
  elById("register-toggle-pw").addEventListener("click", togglePasswordVisibility);
  elById("form-lost").addEventListener("submit", resetPassword);
})();
