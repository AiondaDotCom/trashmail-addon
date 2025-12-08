"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

// Open welcome screen on switch login button.
document.getElementById("btn-switch-login").onclick = function () {
    var options = {"url": "options/welcome.html", "width": 950, "height": 420, "type": "popup"};
    browser.windows.create(options).then(function (welcomeWindow) {
        browser.windows.onRemoved.addListener(function (id) {
            if (id == welcomeWindow.id)
                window.location.reload();
        });
    });
}

function restoreOptions() {
    function setCurrentOptions(result) {
        var [sync, local] = result;

        document.getElementById("username").textContent = sync["username"] || "Not logged in";

        const pairs = [["real_emails","default_email"], ["domains","default_domain"]];
        for (const [list, prop] of pairs) {
            let select = document.getElementById(prop);
            const items = local[list] || [];
            for (const item of items) {
                let option = document.createElement("option");
                option.value = option.text = item;

                if (item == sync[prop])
                    option.selected = true;

                select.add(option);
            }
        }

        var props = ["default_forwards", "default_expire"];
        for (const prop of props) {
            if (sync.hasOwnProperty(prop))
                document.getElementById(prop).value = sync[prop];
        }

        props = ["default_challenge", "default_masq", "default_notify",
            "default_send"];
        for (const prop of props) {
            if (sync.hasOwnProperty(prop))
                document.getElementById(prop).checked = sync[prop];
        }

        // Enable access to default options if logged in.
        if ("username" in sync) {
            const selector = "#options-default input, #options-default select";
            for (const elem of document.querySelectorAll(selector))
                elem.disabled = false;
        }
    }

    var p1 = browser.storage.sync.get();
    var p2 = browser.storage.local.get(["real_emails", "domains"]);
    Promise.all([p1, p2]).then(setCurrentOptions);

    // Display the saved message after a page reload.
    if (sessionStorage !== null && sessionStorage.getItem("reset")) {
        var msg = document.getElementById("saved_msg");
        msg.style.display = "block";
        sessionStorage.removeItem("reset");
    }
}
document.addEventListener("DOMContentLoaded", restoreOptions);


function saveOptions(e) {
    e.preventDefault();
    document.getElementById("saved_msg").style.display = "none";

    var getter = browser.storage.sync.get();

    var form = new FormData(e.target);

    var form_obj = {};
    for (const [key, value] of form)
        form_obj[key] = value;

    // Ensure any missing checkbox values are saved as disabled.
    const checkboxes = ["default_challenge", "default_masq", "default_notify",
        "default_send"];
    for (const prop of checkboxes) {
        if (!(prop in form_obj))
            form_obj[prop] = false;
    }

    getter.then(function (storage) {
        // Save current options, in case user wants to undo this action.
        if (sessionStorage !== null)
            sessionStorage.setItem("undo", JSON.stringify(storage));

        browser.storage.sync.set(form_obj).then(function () {
            var msg = document.getElementById("saved_msg");
            msg.style.display = "block";

            // If no sessionStorage, we are unable to undo, so remove option.
            if (sessionStorage === null)
                msg.querySelector("#undo").remove();
        });
    });
}
document.querySelector("form").addEventListener("submit", saveOptions);

function undoOptions() {
    var undo = JSON.parse(sessionStorage.getItem("undo"));
    browser.storage.sync.set(undo).then(function () {
        window.location.reload();
    });
}
document.getElementById("undo").addEventListener("click", undoOptions);

function resetOptions() {
    const options = [
        "default_email", "default_forwards", "default_expire",
        "default_challenge", "default_masq", "default_notify", "default_send",
        "default_domain"];
    browser.storage.sync.get().then(function (storage) {
        if (sessionStorage !== null) {
            // Save current options, in case user wants to undo this action.
            sessionStorage.setItem("undo", JSON.stringify(storage));

            // When page is reloaded, restoreOptions() will display success/undo.
            sessionStorage.setItem("reset", true);
        }
        browser.storage.sync.remove(options).then(function () {
            window.location.reload(true);
        });
    });
}
document.getElementById("btn-reset").addEventListener("click", resetOptions);

function addressManager() {
    var progress = document.getElementById("progress");
    progress.style.display = "inline-block";

    browser.storage.sync.get(["username", "password"]).then(function (storage) {
        var data = {
            "cmd": "login",
            "fe-login-user": storage["username"],
            "fe-login-pass": storage["password"]
        };

        callAPI(data).then(function (login_details) {
            // Use API_BASE_URL for manager link
            const url = API_BASE_URL + "/?cmd=manager";
            let params = new URLSearchParams({
                "lang": browser.i18n.getUILanguage().substr(0, 2),
                "session_id": login_details["session_id"]
            });
            browser.tabs.create({"url": url.concat("&", params.toString())}).then(function () {
                progress.style.display = "none";
            });
        }).catch(function (error) {
            let error_msg = document.getElementById("error_msg");
            error_msg.textContent = error;
            error_msg.style.display = "block";
            progress.style.display = "none";
        });

    });
}
document.getElementById("btn-address-manager").addEventListener("click", addressManager);

// ============================================================
// Hidden Debug Panel - Click title 5 times to reveal
// ============================================================
let debugClickCount = 0;
let debugClickTimer = null;

function initDebugPanel() {
    const title = document.querySelector("h1");
    if (!title) return;

    title.style.cursor = "pointer";
    title.addEventListener("click", function() {
        debugClickCount++;
        console.log("[Debug] Click count:", debugClickCount);

        // Reset counter after 2 seconds of no clicks
        clearTimeout(debugClickTimer);
        debugClickTimer = setTimeout(() => { debugClickCount = 0; }, 2000);

        // Show debug panel after 5 clicks
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

            // Load current debug URL setting
            browser.storage.local.get('debugApiUrl').then(function(result) {
                const select = document.getElementById("debug_api_url");
                if (result.debugApiUrl) {
                    select.value = result.debugApiUrl;
                } else {
                    select.value = "https://trashmail.com";
                }
                updateDebugStatus();
            });
        }
    });
}
document.addEventListener("DOMContentLoaded", initDebugPanel);

function updateDebugStatus() {
    const status = document.getElementById("debug-status");
    browser.storage.local.get('debugApiUrl').then(function(result) {
        if (result.debugApiUrl && result.debugApiUrl !== "https://trashmail.com") {
            status.textContent = "⚠️ Debug mode active: " + result.debugApiUrl;
            status.style.color = "#c00";
        } else {
            status.textContent = "✅ Using production server";
            status.style.color = "#080";
        }
    });
}

document.getElementById("btn-save-debug").addEventListener("click", function() {
    const url = document.getElementById("debug_api_url").value;
    browser.storage.local.set({ debugApiUrl: url }).then(function() {
        API_BASE_URL = url;
        updateDebugStatus();
        alert("Debug settings saved! Please reload the extension or restart the browser for changes to take full effect.");
    });
});

document.getElementById("btn-reset-debug").addEventListener("click", function() {
    browser.storage.local.remove('debugApiUrl').then(function() {
        API_BASE_URL = DEFAULT_API_URL;
        document.getElementById("debug_api_url").value = "https://trashmail.com";
        updateDebugStatus();
        alert("Reset to production server!");
    });
});
