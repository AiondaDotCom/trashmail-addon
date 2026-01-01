"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

function changePanel(panel) {
    for (let p of document.querySelectorAll(".panel"))
        p.style.display = p.id == panel ? "block" : "none";
}

function register(e) {
    e.preventDefault();
    var form = new FormData(e.target);

    var confirm_password = document.getElementById("register-confirm");
    if(form.get("password") != form.get("confirm")) {
        confirm_password.setCustomValidity("Passwords Don't Match");
        return;
    }

    var register_button = document.getElementById("btn-register");
    var cancel_button = document.getElementById("btn-register-cancel");
    var progress = document.getElementById("progress-register");
    var register_error = document.getElementById("register-error");

    register_button.disabled = true;
    cancel_button.disabled = true;
    progress.style.display = "inline-block";
    register_error.style.display = "none";

    var data = {
        "cmd": "register_account",
        "user": form.get("username"),
        "pass": form.get("password"),
        "pass-cfrm": form.get("confirm"),
        "email": form.get("email"),
        "newsletter": form.get("newsletter")
    };

    callAPI(data).then(function () {
        browser.storage.local.set({
            "real_emails": [form.get("email")],
            "previous_addresses": {}  // Reset previous addresses for new account
        });
        browser.storage.sync.set({
            "username": form.get("username"),
            "password": form.get("password"),
            "default_email": form.get("email")
        });

        register_error.className = "success";
        register_error.innerHTML = browser.i18n.getMessage(
            "registerSuccess", form.get("email"));
        register_error.style.display = "block";

        progress.remove();
        cancel_button.remove();
        register_button.remove();
    }).catch(function (error) {
        register_error.textContent = error;
        register_error.style.display = "block";
        progress.style.display = "none";
        cancel_button.disabled = false;
        register_button.disabled = false;
    });
}

/**
 * Get browser name for PAT token naming
 */
function getBrowserName() {
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
        if (navigator.userAgent.includes("Firefox")) return "Firefox Extension";
        if (navigator.userAgent.includes("Chrome")) return "Chrome Extension";
        if (navigator.userAgent.includes("Safari")) return "Safari Extension";
        if (navigator.userAgent.includes("Edge")) return "Edge Extension";
    }
    return "Browser Extension";
}

/**
 * Perform classic login (password sent to server)
 * Used for PAT tokens or accounts without SRP
 */
function classicLogin(username, password) {
    return callAPI({
        "cmd": "login",
        "fe-login-user": username,
        "fe-login-pass": password
    });
}

/**
 * Handle successful login - store data and create PAT if needed
 */
function handleLoginSuccess(username, password, loginDetails, needsPAT) {
    var sessionId = loginDetails["session_id"];
    var isOpaqueAccount = isPAT(password);  // If using PAT, it's likely an OPAQUE account

    // Store session_id and auth type for popup.js to use
    var p1 = browser.storage.local.set({
        "domains": loginDetails["domain_name_list"],
        "real_emails": Object.keys(loginDetails["real_email_list"] || {}),
        "session_id": sessionId,
        "is_opaque_account": isOpaqueAccount
    });

    // If password is not a PAT, create one for future logins
    if (needsPAT && sessionId) {
        return createAccessToken(sessionId, getBrowserName()).then(function(token) {
            console.log("[TrashMail] PAT created successfully");
            return browser.storage.sync.set({
                "username": username,
                "password": token  // Store PAT instead of original password
            });
        }).then(function() {
            return p1;
        }).then(function() {
            return loginDetails;
        }).catch(function(patError) {
            // PAT creation failed, but login succeeded - store original password
            console.warn("[TrashMail] PAT creation failed:", patError);
            return browser.storage.sync.set({
                "username": username,
                "password": password
            }).then(function() {
                return p1;
            }).then(function() {
                return loginDetails;
            });
        });
    } else {
        // Password is already a PAT, just store it
        var p2 = browser.storage.sync.set({
            "username": username,
            "password": password
        });

        return Promise.all([loginDetails, p1, p2]).then(function(values) {
            return values[0];
        });
    }
}

/**
 * Load DEA addresses and close window on success
 */
function loadDEAAndClose(sessionId) {
    var data = {
        "cmd": "read_dea",
        "session_id": sessionId
    };

    var suffixes = fetch(browser.runtime.getURL("public_suffix.json")).then(function(response) {
        if (response.ok) return response.json();
    });

    return Promise.all([callAPI(data), suffixes]).then(function(values) {
        var [addresses, [rules, exceptions]] = values;
        var current_prev_addresses = {};

        for (const address of addresses) {
            if (address["website"]) {
                try {
                    var domain = new URL(address["website"]);
                } catch (e) {
                    if (e instanceof TypeError) continue;
                    throw e;
                }
                domain = org_domain(domain, rules, exceptions);
                let email = [address["disposable_name"] + "@" + address["disposable_domain"],
                             address["website"]];

                if (domain in current_prev_addresses)
                    current_prev_addresses[domain].push(email);
                else
                    current_prev_addresses[domain] = [email];
            }
        }

        return browser.storage.local.set({"previous_addresses": current_prev_addresses}).then(function() {
            browser.windows.getCurrent().then(function(w) {
                browser.windows.remove(w.id);
            });
        });
    });
}

/**
 * Main login function with OPAQUE and SRP support
 *
 * Flow:
 * 1. Check if password is a PAT (starts with 'tmpat_')
 * 2. If PAT → check if server uses OPAQUE:
 *    - OPAQUE enabled → use PAT-OPAQUE (Zero-Knowledge)
 *    - OPAQUE not enabled → use classic PAT login
 * 3. If not PAT (regular password):
 *    - Check if account uses OPAQUE → show "PAT required" message
 *    - Check if account uses SRP → use SRP login
 *    - Otherwise → use classic login
 * 4. Handle 2FA if required
 * 5. Create PAT for future logins (only for non-OPAQUE accounts)
 */
function login(e) {
    e.preventDefault();
    var login_button = document.getElementById("btn-login");
    var cancel_button = document.getElementById("btn-login-cancel");
    var progress = document.getElementById("progress-login");
    var login_error = document.getElementById("login-error");

    login_button.disabled = true;
    cancel_button.disabled = true;
    progress.style.display = "inline-block";
    login_error.style.display = "none";

    var form = new FormData(e.target);
    var username = form.get("username");
    var password = form.get("password");
    var isPatToken = isPAT(password);

    // Flow A: If password is a PAT, check if we need OPAQUE or classic
    if (isPatToken) {
        console.log("[TrashMail] PAT detected, checking auth method...");

        // Check if OPAQUE client and server support are available
        if (typeof addonOpaqueClient !== 'undefined') {
            addonOpaqueClient.checkOpaqueEnabled(username).then(function(authMethods) {
                if (authMethods.opaque_enabled) {
                    // Use PAT-OPAQUE (Zero-Knowledge)
                    console.log("[TrashMail] Using PAT-OPAQUE authentication");
                    return addonOpaqueClient.patOpaqueLogin(username, password);
                } else {
                    // Use classic PAT login (server hasn't migrated yet)
                    console.log("[TrashMail] Using classic PAT login (server not OPAQUE yet)");
                    return classicLogin(username, password);
                }
            }).then(function(loginDetails) {
                return handleLoginSuccess(username, password, loginDetails, false);
            }).then(function(loginDetails) {
                return loadDEAAndClose(loginDetails["session_id"]);
            }).catch(function(error) {
                // Fallback to classic PAT login on OPAQUE errors
                if (error.message && error.message.includes('OPAQUE')) {
                    console.warn("[TrashMail] OPAQUE failed, trying classic PAT login:", error.message);
                    classicLogin(username, password)
                        .then(function(loginDetails) {
                            return handleLoginSuccess(username, password, loginDetails, false);
                        })
                        .then(function(loginDetails) {
                            return loadDEAAndClose(loginDetails["session_id"]);
                        })
                        .catch(function(fallbackError) {
                            showLoginError(fallbackError, login_error, progress, cancel_button, login_button);
                        });
                    return;
                }
                showLoginError(error, login_error, progress, cancel_button, login_button);
            });
        } else {
            // No OPAQUE client, use classic PAT login
            console.log("[TrashMail] OPAQUE client not available, using classic PAT login");
            classicLogin(username, password)
                .then(function(loginDetails) {
                    return handleLoginSuccess(username, password, loginDetails, false);
                })
                .then(function(loginDetails) {
                    return loadDEAAndClose(loginDetails["session_id"]);
                })
                .catch(function(error) {
                    showLoginError(error, login_error, progress, cancel_button, login_button);
                });
        }
        return;
    }

    // Flow B: Regular password - check auth method
    console.log("[TrashMail] Checking authentication method...");

    // First check if OPAQUE is enabled for this account
    checkAuthMethodAndLogin(username, password, login_button, cancel_button, progress, login_error);
}

/**
 * Helper to display login errors
 */
function showLoginError(error, login_error, progress, cancel_button, login_button) {
    login_error.textContent = error.message || error;
    login_error.style.display = "block";
    progress.style.display = "none";
    cancel_button.disabled = false;
    login_button.disabled = false;
}

/**
 * Check auth method (OPAQUE/SRP/Classic) and perform appropriate login
 */
function checkAuthMethodAndLogin(username, password, login_button, cancel_button, progress, login_error) {
    // Check OPAQUE first (if client available)
    var opaqueCheckPromise;
    if (typeof addonOpaqueClient !== 'undefined') {
        opaqueCheckPromise = addonOpaqueClient.checkOpaqueEnabled(username);
    } else {
        opaqueCheckPromise = Promise.resolve({ opaque_enabled: false, srp_enabled: false });
    }

    opaqueCheckPromise.then(function(authMethods) {
        // If OPAQUE is enabled, user MUST use PAT
        if (authMethods.opaque_enabled) {
            console.log("[TrashMail] Account uses OPAQUE - PAT required");
            showOpaquePatRequired(username);
            return;
        }

        // If OPAQUE not enabled, try SRP
        if (typeof addonSrpClient === 'undefined') {
            console.log("[TrashMail] SRP client not available, using classic login");
            performClassicLoginWithMigration(username, password, login_button, cancel_button, progress, login_error);
            return;
        }

        // Check SRP
        return addonSrpClient.checkSrpEnabled(username).then(function(result) {
            if (result && result.success !== false && result.srp_enabled) {
                // SRP Login (Zero-Knowledge)
                console.log("[TrashMail] Using SRP (Zero-Knowledge) authentication");
                return addonSrpClient.login(username, password).then(function(loginDetails) {
                    if (loginDetails.requires_2fa) {
                        show2FAInput(username, password);
                        throw { handled: true };
                    }
                    return handleLoginSuccess(username, password, loginDetails, true);
                }).then(function(loginDetails) {
                    return loadDEAAndClose(loginDetails["session_id"]);
                });
            } else {
                // Classic login
                console.log("[TrashMail] Using classic login");
                return performClassicLoginWithMigrationAsync(username, password);
            }
        });
    }).catch(function(error) {
        if (error.handled) return;

        if (error.requires_2fa) {
            show2FAInput(username, password);
            return;
        }

        // If check failed, try classic login as fallback
        if (error.message && (error.message.includes('opaque_check') || error.message.includes('srp_check') || error.message.includes('fetch'))) {
            console.warn("[TrashMail] Auth check failed, falling back to classic login:", error.message);
            performClassicLoginWithMigrationAsync(username, password).catch(function(fallbackError) {
                showLoginError(fallbackError, login_error, progress, cancel_button, login_button);
            });
            return;
        }

        showLoginError(error, login_error, progress, cancel_button, login_button);
    });
}

/**
 * Show message that OPAQUE account requires PAT
 */
function showOpaquePatRequired(username) {
    var loginPanel = document.getElementById("login-panel");
    var progress = document.getElementById("progress-login");
    var login_button = document.getElementById("btn-login");
    var cancel_button = document.getElementById("btn-login-cancel");

    if (progress) progress.style.display = "none";
    if (login_button) login_button.disabled = false;
    if (cancel_button) cancel_button.disabled = false;

    var panelOpaque = document.getElementById("opaque-pat-required-panel");
    if (!panelOpaque) {
        panelOpaque = document.createElement("div");
        panelOpaque.id = "opaque-pat-required-panel";
        panelOpaque.className = "panel";

        var lang = browser.i18n.getUILanguage().substr(0, 2);
        var title, info, step1, step2, step3, step4, step5, btnOpen, btnCancel;

        if (lang === "de") {
            title = "Personal Access Token erforderlich";
            info = "Ihr Konto verwendet die neue OPAQUE-Authentifizierung. Diese bietet maximale Sicherheit, erfordert aber einen Personal Access Token (PAT) für die Browser-Erweiterung:";
            step1 = "Öffnen Sie trashmail.com und melden Sie sich an";
            step2 = "Klicken Sie im Adress-Manager rechts oben auf Ihren Benutzernamen";
            step3 = "Wählen Sie <strong>Konto → Personal Access Tokens</strong>";
            step4 = "Erstellen Sie ein neues Token und kopieren Sie es";
            step5 = "Kommen Sie hierher zurück: <strong>Benutzername bleibt gleich</strong>, aber im Feld <strong>\"Passwort\"</strong> geben Sie das kopierte Token ein";
            btnOpen = "TrashMail öffnen";
            btnCancel = "Abbrechen";
        } else if (lang === "fr") {
            title = "Personal Access Token requis";
            info = "Votre compte utilise la nouvelle authentification OPAQUE. Cela offre une sécurité maximale mais nécessite un Personal Access Token (PAT) pour l'extension du navigateur :";
            step1 = "Ouvrez trashmail.com et connectez-vous";
            step2 = "Cliquez sur votre nom d'utilisateur en haut à droite du gestionnaire d'adresses";
            step3 = "Sélectionnez <strong>Compte → Personal Access Tokens</strong>";
            step4 = "Créez un nouveau token et copiez-le";
            step5 = "Revenez ici : <strong>le nom d'utilisateur reste le même</strong>, mais dans le champ <strong>« Mot de passe »</strong> entrez le token copié";
            btnOpen = "Ouvrir TrashMail";
            btnCancel = "Annuler";
        } else {
            title = "Personal Access Token Required";
            info = "Your account uses the new OPAQUE authentication. This provides maximum security but requires a Personal Access Token (PAT) for the browser extension:";
            step1 = "Open trashmail.com and log in";
            step2 = "Click on your username in the top right of the Address Manager";
            step3 = "Select <strong>Account → Personal Access Tokens</strong>";
            step4 = "Create a new token and copy it";
            step5 = "Come back here: <strong>Username stays the same</strong>, but in the <strong>\"Password\"</strong> field enter the copied token";
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

        document.getElementById("btn-open-trashmail-opaque").onclick = function() {
            browser.tabs.create({ url: API_BASE_URL + "/?cmd=manager" });
        };
        document.getElementById("btn-opaque-cancel").onclick = function() {
            changePanel("login-panel");
        };
    }

    changePanel("opaque-pat-required-panel");
}

/**
 * Perform classic login with optional SRP migration (async version)
 * Migration only happens if server explicitly requests it via migrate_to_srp flag
 */
function performClassicLoginWithMigrationAsync(username, password) {
    return classicLogin(username, password).then(function(loginDetails) {
        // Handle 2FA if required
        if (loginDetails.requires_2fa) {
            show2FAInput(username, password);
            throw { handled: true };
        }

        // Check if server suggests migration to SRP (only if server supports it)
        if (loginDetails.migrate_to_srp && typeof addonSrpClient !== 'undefined') {
            console.log("[TrashMail] Server supports SRP, migrating account...");
            // Fire and forget - don't block login on migration
            addonSrpClient.migrateToSrp(username, password).then(function() {
                console.log("[TrashMail] SRP migration successful");
            }).catch(function(err) {
                console.warn("[TrashMail] SRP migration failed (non-fatal):", err.message || err);
            });
        }

        return handleLoginSuccess(username, password, loginDetails, true);
    }).then(function(loginDetails) {
        return loadDEAAndClose(loginDetails["session_id"]);
    });
}

/**
 * Perform classic login (fallback when SRP client not available)
 */
function performClassicLoginWithMigration(username, password, login_button, cancel_button, progress, login_error) {
    classicLogin(username, password)
        .then(function(loginDetails) {
            return handleLoginSuccess(username, password, loginDetails, true);
        })
        .then(function(loginDetails) {
            return loadDEAAndClose(loginDetails["session_id"]);
        })
        .catch(function(error) {
            if (error.requires_2fa) {
                show2FAInput(username, password);
                return;
            }

            login_error.textContent = error.message || error;
            login_error.style.display = "block";
            progress.style.display = "none";
            cancel_button.disabled = false;
            login_button.disabled = false;
        });
}

/**
 * Show 2FA/SRP PAT required message
 * Instead of OTP input, we now show instructions to create a PAT
 */
function show2FAInput(username, password) {
    var loginPanel = document.getElementById("login-panel");
    var progress = document.getElementById("progress-login");
    var login_button = document.getElementById("btn-login");
    var cancel_button = document.getElementById("btn-login-cancel");

    // Hide progress
    if (progress) progress.style.display = "none";
    if (login_button) login_button.disabled = false;
    if (cancel_button) cancel_button.disabled = false;

    // Create PAT info panel if it doesn't exist
    var panelPat = document.getElementById("pat-required-panel");
    if (!panelPat) {
        panelPat = document.createElement("div");
        panelPat.id = "pat-required-panel";
        panelPat.className = "panel";

        var lang = browser.i18n.getUILanguage().substr(0, 2);
        var title, info, step1, step2, step3, step4, step5, btnOpen, btnCancel;

        if (lang === "de") {
            title = "Zwei-Faktor-Authentifizierung aktiv";
            info = "Ihr Konto hat 2FA aktiviert. Browser-Erweiterungen unterstützen keine direkte 2FA-Eingabe. Bitte erstellen Sie ein Personal Access Token:";
            step1 = "Öffnen Sie trashmail.com und melden Sie sich an";
            step2 = "Klicken Sie im Adress-Manager rechts oben auf Ihren Benutzernamen";
            step3 = "Wählen Sie <strong>Konto → Personal Access Tokens</strong>";
            step4 = "Erstellen Sie ein neues Token und kopieren Sie es";
            step5 = "Kommen Sie hierher zurück: <strong>Benutzername bleibt gleich</strong>, aber im Feld <strong>\"Passwort\"</strong> geben Sie das kopierte Token ein";
            btnOpen = "TrashMail öffnen";
            btnCancel = "Abbrechen";
        } else if (lang === "fr") {
            title = "Authentification à deux facteurs active";
            info = "Votre compte a 2FA activé. Les extensions de navigateur ne prennent pas en charge la saisie directe du 2FA. Veuillez créer un Personal Access Token :";
            step1 = "Ouvrez trashmail.com et connectez-vous";
            step2 = "Cliquez sur votre nom d'utilisateur en haut à droite du gestionnaire d'adresses";
            step3 = "Sélectionnez <strong>Compte → Personal Access Tokens</strong>";
            step4 = "Créez un nouveau token et copiez-le";
            step5 = "Revenez ici : <strong>le nom d'utilisateur reste le même</strong>, mais dans le champ <strong>« Mot de passe »</strong> entrez le token copié";
            btnOpen = "Ouvrir TrashMail";
            btnCancel = "Annuler";
        } else {
            title = "Two-Factor Authentication Active";
            info = "Your account has 2FA enabled. Browser extensions do not support direct 2FA input. Please create a Personal Access Token:";
            step1 = "Open trashmail.com and log in";
            step2 = "Click on your username in the top right of the Address Manager";
            step3 = "Select <strong>Account → Personal Access Tokens</strong>";
            step4 = "Create a new token and copy it";
            step5 = "Come back here: <strong>Username stays the same</strong>, but in the <strong>\"Password\"</strong> field enter the copied token";
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

        // Add event listeners
        document.getElementById("btn-open-trashmail").onclick = function() {
            browser.tabs.create({ url: API_BASE_URL + "/?cmd=manager" });
        };
        document.getElementById("btn-pat-cancel").onclick = function() {
            changePanel("login-panel");
        };
    }

    // Show PAT info panel
    changePanel("pat-required-panel");
}

function resetPassword(e) {
    e.preventDefault();
    var reset_button = document.getElementById("btn-reset-password");
    var cancel_button = document.getElementById("btn-lost-cancel");
    var progress = document.getElementById("progress-lost");
    var lost_error = document.getElementById("lost-error");

    reset_button.disabled = true;
    cancel_button.disabled = true;
    progress.style.display = "inline-block";
    lost_error.style.display = "none";

    var form = new FormData(e.target);
    var data = {
        "cmd": "reset_password",
        "username": form.get("username"),
        "email": form.get("email")
    };

    callAPI(data).then(function () {
        lost_error.className = "success";
        lost_error.innerHTML = browser.i18n.getMessage(
            "lostPasswordSuccess", form.get("email"));
        lost_error.style.display = "block";

        progress.remove();
        cancel_button.remove();
        reset_button.remove();
    }).catch(function (error) {
        lost_error.textContent = error;
        lost_error.style.display = "block";
        progress.style.display = "none";
        cancel_button.disabled = false;
        reset_button.disabled = false;
    });
}

document.getElementById("btn-show-register").onclick = function () {
    changePanel("register-panel");
}
document.getElementById("btn-show-login").onclick = function() {
    changePanel("login-panel");
}
document.getElementById("btn-register-cancel").onclick = function() {
    changePanel("welcome-panel");
}
document.getElementById("btn-login-cancel").onclick = function() {
    changePanel("welcome-panel");
}
document.getElementById("lost-password").onclick = function() {
    changePanel("lost-password-panel");
}
document.getElementById("btn-lost-cancel").onclick = function() {
    changePanel("login-panel");
}

document.getElementById("form-login").addEventListener("submit", login);

document.getElementById("form-register").addEventListener("submit", register);

document.getElementById("register-confirm").addEventListener("change", function (e) {
    e.target.setCustomValidity("");
});

document.getElementById("form-lost").addEventListener("submit", resetPassword);
