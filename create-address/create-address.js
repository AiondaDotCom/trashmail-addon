"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}
var lang = browser.i18n.getUILanguage().substring(0, 2);
var mailFaker = new MailFaker(lang);

/**
 * Check if password is a Personal Access Token
 */
function isPAT(password) {
    return password && typeof password === 'string' && password.startsWith('tmpat_') && password.length > 6;
}

var parent_url, parent_id, tab_id, frame_id;
var p1 = browser.storage.sync.get();
var p2 = browser.storage.local.get(["domains", "real_emails", "session_id"]);

// Set variables passed from background script.
browser.runtime.onMessage.addListener(function (message) {
    // Only handle array messages (from context menu / paste action)
    // Ignore other messages like {action: 'get_guardian_status'}
    if (!Array.isArray(message)) {
        return; // Not for us, ignore silently
    }

    if (message.length >= 4) {
        [parent_url, parent_id, tab_id, frame_id] = message;
    } else {
        console.error("Unexpected message format:", message);
        return;
    }

    // Event-Listener nur einmal registrieren
    function closeOnParentTabRemoved(id) {
        if (id === tab_id) {
            browser.windows.getCurrent().then((window) => {
                browser.windows.remove(window.id);
            }).catch((error) => console.error("Fenster konnte nicht geschlossen werden:", error));
        }
    }

    if (!browser.tabs.onRemoved.hasListener(closeOnParentTabRemoved)) {
        browser.tabs.onRemoved.addListener(closeOnParentTabRemoved);
    }
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


    document.getElementById("disposable-name").value = mailFaker.localPart();

    return result;  // Return both sync and local
}).then(function (result) {
    var [sync, local] = result;

    // If we have a stored session_id, use it directly
    if (local.session_id) {
        console.log("[TrashMail] Using stored session_id");
        return { session_id: local.session_id };
    }

    // Check if this is an OPAQUE account (PAT stored)
    if (isPAT(sync["password"])) {
        // Can't do OPAQUE login here, throw error to redirect user
        throw new Error("Session expired. Please log in again via Options.");
    }

    // For non-OPAQUE accounts, use classic login
    var data = {
        "cmd": "login",
        "fe-login-user": sync["username"],
        "fe-login-pass": sync["password"]
    };

    return callAPI(data).then(function(response) {
        // Store the new session_id
        browser.storage.local.set({ "session_id": response.session_id });
        return response;
    });
});

async function addressManager() {
    try {
        const baseUrl = await getApiBaseUrl();
        const url = baseUrl + "/?cmd=manager";
        const details = await login_details;

        let params = new URLSearchParams({
            "lang": lang,
            "session_id": details["session_id"]
        });

        let options = {"url": url.concat("&", params.toString()),
            "windowId": parent_id};
        await browser.tabs.create(options);
        window.close();
    } catch (error) {
        let error_msg = document.getElementById("error_msg");
        error_msg.textContent = error;
        error_msg.style.display = "block";
    }
}

async function createAddress(e) {
    e.preventDefault();

    let create_button = document.getElementById("btn-create");
    let progress = document.getElementById("progress");
    let error = document.getElementById("error_msg");
    let form = new FormData(e.target);

    create_button.disabled = true;
    progress.style.display = "block";
    error.style.display = "none";

    try {
        // Login-Daten abrufen
        let login = await login_details;

        let data = {
            "cmd": "create_dea",
            "session_id": login["session_id"]
        };

        let json = {
            "data": {
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
        };

        await callAPI(data, json);

        let address = [form.get("disposable_name") + "@" + form.get("domain"), parent_url];

        // **Suffixes und Storage abrufen**
        let [storage, suffixesResponse] = await Promise.all([
            browser.storage.local.get("previous_addresses"),
            fetch(browser.runtime.getURL("public_suffix.json"))
        ]);

        let suffixes = suffixesResponse.ok ? await suffixesResponse.json() : [[], []];
        let [rules, exceptions] = suffixes;
        let addresses = storage["previous_addresses"] || {}; // Initialisiere, falls nicht vorhanden

        let domain;
        try {
            domain = org_domain(new URL(parent_url), rules, exceptions);
        } catch (e) {
            console.error("Ungültige URL:", parent_url, e);
            domain = "trashmail.com"; // Fallback-Domain
        }

        if (domain in addresses) {
            addresses[domain].push(address);
        } else {
            addresses[domain] = [address];
        }

        await browser.storage.local.set({ "previous_addresses": addresses });

        // ** Add address into active tab **
        await browser.tabs.sendMessage(tab_id, address[0], { "frameId": frame_id });
        // Send message to the background service to update the menu
        await browser.runtime.sendMessage({
            action: "update_menu",
            tabId: tab_id
        });

        // **Popup schließen**
        let currentWindow = await browser.windows.getCurrent();
        await browser.windows.remove(currentWindow.id);

    } catch (msg) {
        error.innerText = msg;
        error.style.display = "block";
        progress.style.display = "none";
        create_button.disabled = false;
    }
}


document.querySelector("form").addEventListener("submit", createAddress);

document.getElementById("btn-address-manager").addEventListener("click", addressManager);

document.getElementById("btn-close").addEventListener("click", function () {
    window.close();
});

// Auto-resize window to fit content
document.addEventListener("DOMContentLoaded", function() {
    setTimeout(async function() {
        try {
            const card = document.querySelector('.card');
            const header = document.querySelector('.header');
            const container = document.querySelector('.container');

            const contentHeight = header.offsetHeight + container.offsetHeight + 40; // padding
            const contentWidth = Math.max(card.offsetWidth + 40, 500);

            const currentWindow = await browser.windows.getCurrent();

            // Calculate the difference between window size and viewport
            const chromeHeight = currentWindow.height - window.innerHeight;
            const chromeWidth = currentWindow.width - window.innerWidth;

            // New window size = content + browser chrome
            const newHeight = Math.min(contentHeight + chromeHeight, screen.availHeight - 100);
            const newWidth = Math.min(contentWidth + chromeWidth, 650);

            // Center on screen
            const left = Math.round((screen.width - newWidth) / 2);
            const top = Math.round((screen.height - newHeight) / 2);

            await browser.windows.update(currentWindow.id, {
                width: newWidth,
                height: newHeight,
                left: left,
                top: top
            });
        } catch (err) {
            console.log('[Create Address] Auto-resize failed:', err);
        }
    }, 100); // Small delay to ensure content is rendered
});
