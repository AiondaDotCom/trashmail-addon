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

    var p1 = browser.storage.local.set({
        "domains": loginDetails["domain_name_list"],
        "real_emails": Object.keys(loginDetails["real_email_list"] || {})
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
 * Main login function with SRP support
 *
 * Flow:
 * 1. If password is PAT → use classic login (PATs bypass SRP)
 * 2. Check if account uses SRP
 * 3. If SRP enabled → use Zero-Knowledge SRP login
 * 4. If not SRP → use classic login + silent migration
 * 5. Handle 2FA if required
 * 6. Create PAT for future logins
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
    var needsPAT = !isPAT(password);

    // Flow A: If password is already a PAT, use classic login (PATs bypass SRP/2FA)
    if (!needsPAT) {
        console.log("[TrashMail] Using PAT token for login");
        classicLogin(username, password)
            .then(function(loginDetails) {
                return handleLoginSuccess(username, password, loginDetails, false);
            })
            .then(function(loginDetails) {
                return loadDEAAndClose(loginDetails["session_id"]);
            })
            .catch(function(error) {
                login_error.textContent = error.message || error;
                login_error.style.display = "block";
                progress.style.display = "none";
                cancel_button.disabled = false;
                login_button.disabled = false;
            });
        return;
    }

    // Flow B: New login with password - check for SRP if available
    console.log("[TrashMail] Attempting login...");

    // Check if SRP client is available
    if (typeof addonSrpClient === 'undefined') {
        console.log("[TrashMail] SRP client not available, using classic login");
        performClassicLoginWithMigration(username, password, login_button, cancel_button, progress, login_error);
        return;
    }

    // Try to check if account uses SRP (with graceful fallback)
    addonSrpClient.checkSrpEnabled(username).then(function(result) {
        // Only use SRP if explicitly enabled and endpoint returned success
        if (result && result.success !== false && result.srp_enabled) {
            // SRP Login (Zero-Knowledge - password never sent to server!)
            console.log("[TrashMail] Using SRP (Zero-Knowledge) authentication");
            return addonSrpClient.login(username, password).then(function(loginDetails) {
                // Handle 2FA if required
                if (loginDetails.requires_2fa) {
                    show2FAInput(username, password);
                    throw { handled: true };  // Prevent further processing
                }

                return handleLoginSuccess(username, password, loginDetails, true);
            }).then(function(loginDetails) {
                return loadDEAAndClose(loginDetails["session_id"]);
            });
        } else {
            // Classic login (SRP not enabled or endpoint not available)
            console.log("[TrashMail] Using classic login");
            return performClassicLoginWithMigrationAsync(username, password);
        }
    }).catch(function(error) {
        // If SRP check failed, fall back to classic login
        if (error.message && (error.message.includes('srp_check') || error.message.includes('fetch'))) {
            console.warn("[TrashMail] SRP check failed, falling back to classic login:", error.message);
            return performClassicLoginWithMigrationAsync(username, password);
        }

        if (error.handled) return;  // 2FA flow, already handled

        // Handle 2FA required from SRP or classic login
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
 * Show 2FA OTP input form
 */
function show2FAInput(username, password) {
    var loginPanel = document.getElementById("login-panel");

    // Create 2FA panel if it doesn't exist
    var panel2fa = document.getElementById("2fa-panel");
    if (!panel2fa) {
        panel2fa = document.createElement("div");
        panel2fa.id = "2fa-panel";
        panel2fa.className = "panel";
        panel2fa.innerHTML = `
            <h2>${browser.i18n.getMessage("title2FA") || "Two-Factor Authentication"}</h2>
            <p>${browser.i18n.getMessage("info2FA") || "Enter the 6-digit code from your authenticator app."}</p>
            <form id="form-2fa">
                <input type="hidden" id="2fa-username" name="username">
                <input type="hidden" id="2fa-password" name="password">
                <div>
                    <input type="text" id="otp-code" name="otp_code"
                           placeholder="000000" maxlength="6" pattern="[0-9]{6}"
                           autocomplete="one-time-code" inputmode="numeric"
                           style="font-size: 24px; text-align: center; letter-spacing: 8px; width: 180px;">
                </div>
                <p id="2fa-error" class="error" style="display: none;"></p>
                <span id="progress-2fa" class="progress" style="display: none;"></span>
                <div style="margin-top: 15px;">
                    <input type="submit" id="btn-verify-2fa" class="button"
                           style="height: 32px; min-width: 100px;"
                           value="${browser.i18n.getMessage("buttonVerify") || "Verify"}">
                    <input type="button" id="btn-2fa-cancel" class="button"
                           style="height: 32px; min-width: 100px;"
                           value="${browser.i18n.getMessage("buttonCancel") || "Cancel"}">
                </div>
            </form>
        `;
        loginPanel.parentNode.insertBefore(panel2fa, loginPanel.nextSibling);

        // Add event listeners
        document.getElementById("form-2fa").addEventListener("submit", verify2FA);
        document.getElementById("btn-2fa-cancel").onclick = function() {
            changePanel("login-panel");
        };
    }

    // Store credentials
    document.getElementById("2fa-username").value = username;
    document.getElementById("2fa-password").value = password;
    document.getElementById("otp-code").value = "";
    document.getElementById("2fa-error").style.display = "none";

    // Show 2FA panel
    changePanel("2fa-panel");

    // Focus OTP input
    setTimeout(function() {
        document.getElementById("otp-code").focus();
    }, 100);
}

/**
 * Verify 2FA code and get PAT
 */
function verify2FA(e) {
    e.preventDefault();

    var username = document.getElementById("2fa-username").value;
    var password = document.getElementById("2fa-password").value;
    var otpCode = document.getElementById("otp-code").value;
    var verifyButton = document.getElementById("btn-verify-2fa");
    var cancelButton = document.getElementById("btn-2fa-cancel");
    var progress = document.getElementById("progress-2fa");
    var errorEl = document.getElementById("2fa-error");

    // Validate OTP format
    if (!/^\d{6}$/.test(otpCode)) {
        errorEl.textContent = browser.i18n.getMessage("error2FAInvalidCode") || "Please enter a 6-digit code.";
        errorEl.style.display = "block";
        return;
    }

    verifyButton.disabled = true;
    cancelButton.disabled = true;
    progress.style.display = "inline-block";
    errorEl.style.display = "none";

    var data = {
        "cmd": "verify_2fa_extension",
        "username": username,
        "password": password,
        "otp_code": otpCode,
        "token_name": getBrowserName()
    };

    callAPI(data).then(function(result) {
        // Success! Store PAT and login data
        var patToken = result["pat_token"];
        var sessionId = result["session_id"];

        return Promise.all([
            browser.storage.local.set({
                "domains": result["domain_name_list"],
                "real_emails": Object.keys(result["real_email_list"] || {})
            }),
            browser.storage.sync.set({
                "username": username,
                "password": patToken  // Store PAT for future logins
            })
        ]).then(function() {
            // Backward compatibility: Old backend returns "pat_auth" instead of real session
            // New backend returns a real session ID
            if (sessionId === 'pat_auth') {
                // Old backend - need to login with PAT to get a real session
                return classicLogin(username, patToken).then(function(loginDetails) {
                    return loginDetails["session_id"];
                });
            }
            return sessionId;
        });
    }).then(function(sessionId) {
        // Load DEA addresses for previous_addresses
        var data = {
            "cmd": "read_dea",
            "session_id": sessionId
        };

        var suffixes = fetch(browser.runtime.getURL("public_suffix.json")).then(function(response) {
            if (response.ok) return response.json();
        });

        return Promise.all([callAPI(data), suffixes]);
    }).then(function(values) {
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

        browser.storage.local.set({"previous_addresses": current_prev_addresses}).then(function() {
            browser.windows.getCurrent().then(function(w) {
                browser.windows.remove(w.id);
            });
        });
    }).catch(function(error) {
        errorEl.textContent = error.message || error;
        errorEl.style.display = "block";
        progress.style.display = "none";
        verifyButton.disabled = false;
        cancelButton.disabled = false;
    });
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
