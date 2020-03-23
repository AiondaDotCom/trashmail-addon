"use strict";

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
    var data = {
        "cmd": "login",
        "fe-login-user": form.get("username"),
        "fe-login-pass": form.get("password")
    };

    callAPI(data).then(function (login_details) {
        var p1 = browser.storage.local.set({
            "domains": login_details["domain_name_list"],
            "real_emails": Object.keys(login_details["real_email_list"])
        });
        var p2 = browser.storage.sync.set({
            "username": data["fe-login-user"],
            "password": data["fe-login-pass"]
        });

        return Promise.all([login_details, p1, p2]);
    }).then(function (values) {
        let login_details = values[0];
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
                let email = address["disposable_name"] + "@" + address["disposable_domain"];

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
        login_error.textContent = error;
        login_error.style.display = "block";
        progress.style.display = "none";
        cancel_button.disabled = false;
        login_button.disabled = false;
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
