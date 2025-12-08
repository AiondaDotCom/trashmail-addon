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

    var data = {
        "cmd": "login",
        "fe-login-user": username,
        "fe-login-pass": password
    };

    // Track if we need to create a PAT after login
    var needsPAT = !isPAT(password);
    var sessionId = null;

    callAPI(data).then(function (login_details) {
        sessionId = login_details["session_id"];

        var p1 = browser.storage.local.set({
            "domains": login_details["domain_name_list"],
            "real_emails": Object.keys(login_details["real_email_list"])
        });

        // Flow A: If password is not a PAT, create one for future logins
        if (needsPAT && sessionId) {
            // Determine browser name for token
            var browserName = "Browser Extension";
            if (typeof navigator !== 'undefined' && navigator.userAgent) {
                if (navigator.userAgent.includes("Firefox")) {
                    browserName = "Firefox Extension";
                } else if (navigator.userAgent.includes("Chrome")) {
                    browserName = "Chrome Extension";
                } else if (navigator.userAgent.includes("Safari")) {
                    browserName = "Safari Extension";
                } else if (navigator.userAgent.includes("Edge")) {
                    browserName = "Edge Extension";
                }
            }

            // Create PAT and store it as the new password
            return createAccessToken(sessionId, browserName).then(function(token) {
                console.log("PAT created successfully, storing for future logins");
                return browser.storage.sync.set({
                    "username": username,
                    "password": token  // Store PAT instead of original password
                });
            }).then(function() {
                return p1;
            }).then(function() {
                return login_details;
            }).catch(function(patError) {
                // PAT creation failed, but login succeeded - store original password
                console.warn("PAT creation failed, using original password:", patError);
                return browser.storage.sync.set({
                    "username": username,
                    "password": password
                }).then(function() {
                    return p1;
                }).then(function() {
                    return login_details;
                });
            });
        } else {
            // Password is already a PAT, just store it
            var p2 = browser.storage.sync.set({
                "username": username,
                "password": password
            });

            return Promise.all([login_details, p1, p2]).then(function(values) {
                return values[0];
            });
        }
    }).then(function (login_details) {
        var data = {
            "cmd": "read_dea",
            "session_id": login_details["session_id"]
        };

        // Load public suffix data from file.
        var suffixes = fetch(browser.runtime.getURL("public_suffix.json")).then(function (response) {
            if (response.ok)
                return response.json();
        });

        return Promise.all([callAPI(data), suffixes]);
    }).then(function (values) {
        var [addresses, [rules, exceptions]] = values;
        // Update local storage of existing disposable addresses.
        var current_prev_addresses = {};
        for (const address of addresses) {
            if (address["website"]) {
                try {
                    var domain = new URL(address["website"]);
                } catch (e) {
                    if (e instanceof TypeError)
                        continue;  // Not a valid URL.
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

        browser.storage.local.set({"previous_addresses": current_prev_addresses}).then(function () {
            browser.windows.getCurrent().then(function (w) {
                browser.windows.remove(w.id);
            });
        });
    }).catch(function (error) {
        // Flow B: Handle 2FA required error - show OTP input
        if (error.requires_2fa) {
            show2FAInput(username, password);
        } else {
            login_error.textContent = error.message || error;
            login_error.style.display = "block";
        }

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

    // Determine browser name for PAT
    var browserName = "Browser Extension";
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
        if (navigator.userAgent.includes("Firefox")) {
            browserName = "Firefox Extension";
        } else if (navigator.userAgent.includes("Chrome")) {
            browserName = "Chrome Extension";
        } else if (navigator.userAgent.includes("Safari")) {
            browserName = "Safari Extension";
        } else if (navigator.userAgent.includes("Edge")) {
            browserName = "Edge Extension";
        }
    }

    var data = {
        "cmd": "verify_2fa_extension",
        "username": username,
        "password": password,
        "otp_code": otpCode,
        "token_name": browserName
    };

    callAPI(data).then(function(result) {
        // Success! Store PAT and login data
        var patToken = result["pat_token"];

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
            return result;
        });
    }).then(function(result) {
        // Load DEA addresses for previous_addresses
        var data = {
            "cmd": "read_dea",
            "fe-login-user": username,
            "fe-login-pass": result["pat_token"]
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
