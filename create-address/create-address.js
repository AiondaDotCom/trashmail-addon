"use strict";

function generate_name(prefix, length) {
    var name = prefix;
    for (let i=0; i < length; ++i)
        name += Math.floor(Math.random()*36).toString(36);

    return name;
}

var parent_url, parent_id, tab_id;
var p1 = browser.storage.sync.get();
var p2 = browser.storage.local.get(["domains", "real_emails"]);

// Set variables passed from background script.
browser.runtime.onMessage.addListener(function (message) {
    if (Array.isArray(message))
        [parent_url, parent_id, tab_id] = message;

    // Close window if parent tab is closed.
    browser.tabs.onRemoved.addListener(function (id) {
        if (id == tab_id)
            browser.windows.getCurrent().then(function (window) {
                browser.windows.remove(window.id);
            });
    });
});

var login_details = Promise.all([p1, p2]).then(function (result) {
    var [sync, local] = result;

    // Initialise all the fields in the window from user preferences.
    const pairs = [["real_emails","email"], ["domains", "domain"]];
    for (const [list, prop] of pairs) {
        let select = document.getElementById(prop);
        for (const item of local[list]) {
            let option = document.createElement("option");
            option.value = option.text = item;

            if (item == sync["default_" + prop])
                option.selected = true;

            select.add(option);
        }
    }

    var props = ["forwards", "expire"];
    for (const prop of props) {
        let key = "default_" + prop;
        if (key in sync)
            document.getElementById(prop).value = sync[key];
    }

    props = ["challenge", "masq", "notify", "send"];
    for (const prop of props) {
        let key = "default_" + prop;
        if (key in sync)
            document.getElementById(prop).checked = sync[key];
    }

    document.getElementById("disposable-name").value = generate_name(
        sync["default_prefix"], sync["default_random_length"] || 6);

    return sync;
}).then(function (storage) {
    var data = {
        "cmd": "login",
        "fe-login-user": storage["username"],
        "fe-login-pass": storage["password"]
    };

    return callAPI(data);
});

function addressManager() {
    const url = "https://trashmail.com/?cmd=manager";

    login_details.then(function (login_details) {
        let params = new URLSearchParams({
            "lang": browser.i18n.getUILanguage().substr(0, 2),
            "session_id": login_details["session_id"]
        });

        let options = {"url": url.concat("&", params.toString()),
                       "windowId": parent_id};
        browser.tabs.create(options);
    }).then(function () {
        window.close();
    }).catch(function (error) {
        let error_msg = document.getElementById("error_msg");
        error_msg.textContent = error;
        error_msg.style.display = "block";
    });
}

function createAddress(e) {
    e.preventDefault();

    var create_button = document.getElementById("btn-create");
    var progress = document.getElementById("progress");
    var error = document.getElementById("error_msg");
    var form = new FormData(e.target);

    create_button.disabled = true;
    progress.style.display = "block";
    error.style.display = "none";

    login_details.then(function (login) {
        var data = {
            "cmd": "create_dea",
            "session_id": login["session_id"]
        };
        var json = {"data": {
                "disposable_name": form.get("disposable_name"),
                "disposable_domain": form.get("domain"),
                "destination": form.get("email"),
                "forwards": form.get("forwards"),
                "expire": form.get("expire"),
                "cs": form.get("challenge") || false,
                "masq": form.get("masq") || false,
                "notify": form.get("notify") || false,
                "website": form.get("send") ? parent_url : ""
            }
        }

        return callAPI(data, json);
    }).then(function () {
        let address = form.get("disposable_name") + "@" + form.get("domain");

        // Update locally stored previous addresses.
        browser.storage.local.get("previous_addresses").then(function (storage) {
            let addresses = storage["previous_addresses"];
            let domain = (new URL(parent_url)).hostname;
            if (domain in addresses)
                addresses[domain].push(address);
            else
                addresses[domain] = [address];

            browser.storage.local.set({"previous_addresses": addresses});
        });

        // Paste address
        return browser.tabs.sendMessage(tab_id, address);
    }).then(function () {
        return browser.windows.getCurrent();
    }).then(function (window) {
        browser.windows.remove(window.id);
    }).catch(function (msg) {
        error.innerHTML = msg;
        error.style.display = "block";
        progress.style.display = "none";
        create_button.disabled = false;
    });
}

document.querySelector("form").addEventListener("submit", createAddress);

document.getElementById("btn-address-manager").addEventListener("click", addressManager);

document.getElementById("btn-close").addEventListener("click", function () {
    window.close();
});
