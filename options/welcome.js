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
      console.warn("[TrashMail] Username availability check failed:", e);
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
  var confirmSessionId = "";
  var confirmEmail = "";
  function showConfirmationPanel(email, sessionId) {
    confirmEmail = email;
    confirmSessionId = sessionId;
    changePanel("confirm-panel");
    elById("confirm-sent-to").textContent = browser.i18n.getMessage("confirmSentTo", email);
    const poll = async () => {
      try {
        const result = await callAPI({ "cmd": "list_real_emails", "session_id": sessionId });
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
            loadDEAAndClose(sessionId);
          }, 1500);
        }
      } catch (e) {
        console.warn("[TrashMail] Confirmation poll failed:", e);
      }
    };
    poll();
    confirmPollTimer = setInterval(poll, 3e3);
  }
  elById("btn-confirm-resend").addEventListener("click", () => {
    const confirmError = elById("confirm-error");
    confirmError.style.display = "none";
    callAPI({ "cmd": "resend_confirmation_email", "session_id": confirmSessionId, "email": confirmEmail }).then(() => {
      elById("confirm-status-text").textContent = browser.i18n.getMessage("confirmResent");
    }).catch((error) => {
      confirmError.textContent = error.message || String(error);
      confirmError.style.display = "block";
    });
  });
  elById("btn-confirm-skip").addEventListener("click", () => {
    if (confirmPollTimer) {
      clearInterval(confirmPollTimer);
    }
    loadDEAAndClose(confirmSessionId);
  });
  function getBrowserName() {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      if (navigator.userAgent.includes("Firefox")) {
        return "Firefox Extension";
      }
      if (navigator.userAgent.includes("Chrome")) {
        return "Chrome Extension";
      }
      if (navigator.userAgent.includes("Safari")) {
        return "Safari Extension";
      }
      if (navigator.userAgent.includes("Edge")) {
        return "Edge Extension";
      }
    }
    return "Browser Extension";
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
        console.log("[TrashMail] PAT created successfully");
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
        console.warn("[TrashMail] PAT creation failed:", patError);
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
        browser.windows.getCurrent().then((w) => {
          browser.windows.remove(w.id);
        });
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
      console.log("[TrashMail] PAT detected, checking auth method...");
      if (typeof addonOpaqueClient !== "undefined") {
        addonOpaqueClient.checkOpaqueEnabled(username).then((authMethods) => {
          if (authMethods.opaque_enabled) {
            console.log("[TrashMail] Using PAT-OPAQUE authentication");
            return addonOpaqueClient.patOpaqueLogin(username, password);
          } else {
            console.log("[TrashMail] Using classic PAT login (server not OPAQUE yet)");
            return classicLogin(username, password);
          }
        }).then((loginDetails) => {
          return handleLoginSuccess(username, password, loginDetails, false);
        }).then((loginDetails) => {
          return loadDEAAndClose(loginDetails["session_id"]);
        }).catch((error) => {
          if (error.message && error.message.includes("OPAQUE")) {
            console.warn("[TrashMail] OPAQUE failed, trying classic PAT login:", error.message);
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
        console.log("[TrashMail] OPAQUE client not available, using classic PAT login");
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
    console.log("[TrashMail] Checking authentication method...");
    checkAuthMethodAndLogin(username, password, loginButton, cancelButton, progress, loginError);
  }
  function showLoginError(error, loginError, progress, cancelButton, loginButton) {
    loginError.textContent = error.message || String(error);
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
        console.log("[TrashMail] Account uses OPAQUE - PAT required");
        showOpaquePatRequired(username);
        return;
      }
      if (typeof addonSrpClient === "undefined") {
        console.log("[TrashMail] SRP client not available, using classic login");
        performClassicLoginWithMigration(username, password, loginButton, cancelButton, progress, loginError);
        return;
      }
      return addonSrpClient.checkSrpEnabled(username).then((result) => {
        if (result && result.success !== false && result.srp_enabled) {
          console.log("[TrashMail] Using SRP (Zero-Knowledge) authentication");
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
          console.log("[TrashMail] Using classic login");
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
        console.warn("[TrashMail] Auth check failed, falling back to classic login:", error.message);
        performClassicLoginWithMigrationAsync(username, password).catch((fallbackError) => {
          showLoginError(fallbackError, loginError, progress, cancelButton, loginButton);
        });
        return;
      }
      showLoginError(error, loginError, progress, cancelButton, loginButton);
    });
  }
  function showOpaquePatRequired(username) {
    const loginPanel = elById("login-panel");
    const progress = document.getElementById("progress-login");
    const loginButton = document.getElementById("btn-login");
    const cancelButton = document.getElementById("btn-login-cancel");
    if (progress) {
      progress.style.display = "none";
    }
    if (loginButton) {
      loginButton.disabled = false;
    }
    if (cancelButton) {
      cancelButton.disabled = false;
    }
    let panelOpaque = document.getElementById("opaque-pat-required-panel");
    if (!panelOpaque) {
      panelOpaque = document.createElement("div");
      panelOpaque.id = "opaque-pat-required-panel";
      panelOpaque.className = "panel";
      const lang = browser.i18n.getUILanguage().substr(0, 2);
      let title, info, step1, step2, step3, step4, step5, btnOpen, btnCancel;
      if (lang === "de") {
        title = "Personal Access Token erforderlich";
        info = "Ihr Konto verwendet die neue OPAQUE-Authentifizierung. Diese bietet maximale Sicherheit, erfordert aber einen Personal Access Token (PAT) f\xFCr die Browser-Erweiterung:";
        step1 = "\xD6ffnen Sie mail.aionda.com und melden Sie sich an";
        step2 = "Klicken Sie im Adress-Manager rechts oben auf Ihren Benutzernamen";
        step3 = "W\xE4hlen Sie <strong>Konto \u2192 Personal Access Tokens</strong>";
        step4 = "Erstellen Sie ein neues Token und kopieren Sie es";
        step5 = 'Kommen Sie hierher zur\xFCck: <strong>Benutzername bleibt gleich</strong>, aber im Feld <strong>"Passwort"</strong> geben Sie das kopierte Token ein';
        btnOpen = "TrashMail \xF6ffnen";
        btnCancel = "Abbrechen";
      } else if (lang === "fr") {
        title = "Personal Access Token requis";
        info = "Votre compte utilise la nouvelle authentification OPAQUE. Cela offre une s\xE9curit\xE9 maximale mais n\xE9cessite un Personal Access Token (PAT) pour l'extension du navigateur :";
        step1 = "Ouvrez mail.aionda.com et connectez-vous";
        step2 = "Cliquez sur votre nom d'utilisateur en haut \xE0 droite du gestionnaire d'adresses";
        step3 = "S\xE9lectionnez <strong>Compte \u2192 Personal Access Tokens</strong>";
        step4 = "Cr\xE9ez un nouveau token et copiez-le";
        step5 = "Revenez ici : <strong>le nom d'utilisateur reste le m\xEAme</strong>, mais dans le champ <strong>\xAB Mot de passe \xBB</strong> entrez le token copi\xE9";
        btnOpen = "Ouvrir TrashMail";
        btnCancel = "Annuler";
      } else {
        title = "Personal Access Token Required";
        info = "Your account uses the new OPAQUE authentication. This provides maximum security but requires a Personal Access Token (PAT) for the browser extension:";
        step1 = "Open mail.aionda.com and log in";
        step2 = "Click on your username in the top right of the Address Manager";
        step3 = "Select <strong>Account \u2192 Personal Access Tokens</strong>";
        step4 = "Create a new token and copy it";
        step5 = 'Come back here: <strong>Username stays the same</strong>, but in the <strong>"Password"</strong> field enter the copied token';
        btnOpen = "Open TrashMail";
        btnCancel = "Cancel";
      }
      panelOpaque.innerHTML = `
            <h2>${title}</h2>
            <p>${info}</p>
            <ol style="text-align: left; margin: 15px auto; max-width: 400px;">
                <li>${step1}</li>
                <li>${step2}</li>
                <li>${step3}</li>
                <li>${step4}</li>
                <li>${step5}</li>
            </ol>
            <div style="margin-top: 20px;">
                <input type="button" id="btn-open-trashmail-opaque" class="button"
                       style="height: 32px; min-width: 140px; background-color: #0066cc; color: white;"
                       value="${btnOpen}">
                <input type="button" id="btn-opaque-cancel" class="button"
                       style="height: 32px; min-width: 100px;"
                       value="${btnCancel}">
            </div>
        `;
      loginPanel.parentNode.insertBefore(panelOpaque, loginPanel.nextSibling);
      elById("btn-open-trashmail-opaque").onclick = function() {
        browser.tabs.create({ url: `${API_BASE_URL}/?cmd=manager` });
      };
      elById("btn-opaque-cancel").onclick = function() {
        changePanel("login-panel");
      };
    }
    changePanel("opaque-pat-required-panel");
  }
  function performClassicLoginWithMigrationAsync(username, password) {
    return classicLogin(username, password).then((loginDetails) => {
      if (loginDetails.requires_2fa) {
        show2FAInput(username, password);
        throw { handled: true };
      }
      if (loginDetails.migrate_to_srp && typeof addonSrpClient !== "undefined") {
        console.log("[TrashMail] Server supports SRP, migrating account...");
        addonSrpClient.migrateToSrp(username, password).then(() => {
          console.log("[TrashMail] SRP migration successful");
        }).catch((err) => {
          console.warn("[TrashMail] SRP migration failed (non-fatal):", err.message || err);
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
  function show2FAInput(username, password) {
    const loginPanel = elById("login-panel");
    const progress = document.getElementById("progress-login");
    const loginButton = document.getElementById("btn-login");
    const cancelButton = document.getElementById("btn-login-cancel");
    if (progress) {
      progress.style.display = "none";
    }
    if (loginButton) {
      loginButton.disabled = false;
    }
    if (cancelButton) {
      cancelButton.disabled = false;
    }
    let panelPat = document.getElementById("pat-required-panel");
    if (!panelPat) {
      panelPat = document.createElement("div");
      panelPat.id = "pat-required-panel";
      panelPat.className = "panel";
      const lang = browser.i18n.getUILanguage().substr(0, 2);
      let title, info, step1, step2, step3, step4, step5, btnOpen, btnCancel;
      if (lang === "de") {
        title = "Zwei-Faktor-Authentifizierung aktiv";
        info = "Ihr Konto hat 2FA aktiviert. Browser-Erweiterungen unterst\xFCtzen keine direkte 2FA-Eingabe. Bitte erstellen Sie ein Personal Access Token:";
        step1 = "\xD6ffnen Sie mail.aionda.com und melden Sie sich an";
        step2 = "Klicken Sie im Adress-Manager rechts oben auf Ihren Benutzernamen";
        step3 = "W\xE4hlen Sie <strong>Konto \u2192 Personal Access Tokens</strong>";
        step4 = "Erstellen Sie ein neues Token und kopieren Sie es";
        step5 = 'Kommen Sie hierher zur\xFCck: <strong>Benutzername bleibt gleich</strong>, aber im Feld <strong>"Passwort"</strong> geben Sie das kopierte Token ein';
        btnOpen = "TrashMail \xF6ffnen";
        btnCancel = "Abbrechen";
      } else if (lang === "fr") {
        title = "Authentification \xE0 deux facteurs active";
        info = "Votre compte a 2FA activ\xE9. Les extensions de navigateur ne prennent pas en charge la saisie directe du 2FA. Veuillez cr\xE9er un Personal Access Token :";
        step1 = "Ouvrez mail.aionda.com et connectez-vous";
        step2 = "Cliquez sur votre nom d'utilisateur en haut \xE0 droite du gestionnaire d'adresses";
        step3 = "S\xE9lectionnez <strong>Compte \u2192 Personal Access Tokens</strong>";
        step4 = "Cr\xE9ez un nouveau token et copiez-le";
        step5 = "Revenez ici : <strong>le nom d'utilisateur reste le m\xEAme</strong>, mais dans le champ <strong>\xAB Mot de passe \xBB</strong> entrez le token copi\xE9";
        btnOpen = "Ouvrir TrashMail";
        btnCancel = "Annuler";
      } else {
        title = "Two-Factor Authentication Active";
        info = "Your account has 2FA enabled. Browser extensions do not support direct 2FA input. Please create a Personal Access Token:";
        step1 = "Open mail.aionda.com and log in";
        step2 = "Click on your username in the top right of the Address Manager";
        step3 = "Select <strong>Account \u2192 Personal Access Tokens</strong>";
        step4 = "Create a new token and copy it";
        step5 = 'Come back here: <strong>Username stays the same</strong>, but in the <strong>"Password"</strong> field enter the copied token';
        btnOpen = "Open TrashMail";
        btnCancel = "Cancel";
      }
      panelPat.innerHTML = `
            <h2>${title}</h2>
            <p>${info}</p>
            <ol style="text-align: left; margin: 15px auto; max-width: 400px;">
                <li>${step1}</li>
                <li>${step2}</li>
                <li>${step3}</li>
                <li>${step4}</li>
                <li>${step5}</li>
            </ol>
            <div style="margin-top: 20px;">
                <input type="button" id="btn-open-trashmail" class="button"
                       style="height: 32px; min-width: 140px; background-color: #0066cc; color: white;"
                       value="${btnOpen}">
                <input type="button" id="btn-pat-cancel" class="button"
                       style="height: 32px; min-width: 100px;"
                       value="${btnCancel}">
            </div>
        `;
      loginPanel.parentNode.insertBefore(panelPat, loginPanel.nextSibling);
      elById("btn-open-trashmail").onclick = function() {
        browser.tabs.create({ url: `${API_BASE_URL}/?cmd=manager` });
      };
      elById("btn-pat-cancel").onclick = function() {
        changePanel("login-panel");
      };
    }
    changePanel("pat-required-panel");
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
