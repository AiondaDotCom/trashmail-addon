"use strict";

Raven.config('https://f70e8fb95ab7485884ca24a4623dd57d@sentry.io/265192').install();

Raven.context(function () {
// Open welcome screen on switch login button.
    document.getElementById("btn-switch-login").onclick = function () {
        var options = {"url": "welcome.html", "width": 750, "height": 420, "type": "popup"};
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

            // If no default prefix has been set, pick one at random and save it.
            if (!("default_prefix" in sync)) {
                sync["default_prefix"] = PREFIXES[Math.floor(Math.random() * PREFIXES.length)] + "_";
                browser.storage.sync.set({"default_prefix": sync["default_prefix"]});
            }

            const pairs = [["real_emails","default_email"], ["domains","default_domain"]];
            for (const [list, prop] of pairs) {
                let select = document.getElementById(prop);
                for (const item of local[list]) {
                    let option = document.createElement("option");
                    option.value = option.text = item;

                    if (item == sync[prop])
                        option.selected = true;

                    select.add(option);
                }
            }

            var props = ["default_forwards", "default_expire", "default_prefix",
                "default_random_length"];
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
        if (sessionStorage.getItem("reset")) {
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
            sessionStorage.setItem("undo", JSON.stringify(storage));

            browser.storage.sync.set(form_obj).then(function () {
                var msg = document.getElementById("saved_msg");
                msg.style.display = "block";
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
            "default_domain", "default_prefix", "default_random_length"];
        browser.storage.sync.get().then(function (storage) {
            // Save current options, in case user wants to undo this action.
            sessionStorage.setItem("undo", JSON.stringify(storage));

            // When page is reloaded, restoreOptions() will display success/undo.
            sessionStorage.setItem("reset", true);
            browser.storage.sync.remove(options).then(function () {
                window.location.reload(true);
            });
        });
    }
    document.getElementById("btn-reset").addEventListener("click", resetOptions);

    function addressManager() {
        const url = "https://trashmail.com/?cmd=manager";
        var progress = document.getElementById("progress");
        progress.style.display = "inline-block";

        browser.storage.sync.get(["username", "password"]).then(function (storage) {
            var data = {
                "cmd": "login",
                "fe-login-user": storage["username"],
                "fe-login-pass": storage["password"]
            };

            callAPI(data).then(function (login_details) {
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
});
