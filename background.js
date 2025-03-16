"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

// Import additional scripts
importScripts("api.js", "publicsuffixlist.js");

// Open welcome screen when installing addon.
self.addEventListener("install", function (event) {
    event.waitUntil(
        browser.storage.sync.get("username").then(function (storage) {
            if (!("username" in storage) || !storage["username"]) {
                browser.runtime.openOptionsPage();
            }
        })
    );
});

// Check if the context menu item already exists before creating it
browser.contextMenus.removeAll(function () {
    browser.contextMenus.create({
        id: "paste-email",
        contexts: ["editable"],
        title: browser.i18n.getMessage("menuPasteAddress")
    });
});

function openCreateAddress(parent_tab, frameId) {
    var options = {"url": "../create-address/create-address.html",
        "type": "popup", "width": 750, "height": 490};
    browser.windows.create(options).then(function (window) {
        // (FF 56) Security policy blocks running code until tab has completed loading.
        browser.tabs.onUpdated.addListener(function handler(tabId, changeInfo, tab) {
            if (tabId == window.tabs[0].id && changeInfo.status == "complete") {
                browser.tabs.onUpdated.removeListener(handler);
                // Send the parent url and window ID through to the new window.
                browser.tabs.sendMessage(
                    tab.id, [parent_tab.url, parent_tab.windowId, parent_tab.id, frameId]);
            }
        });
    });
}

browser.contextMenus.onClicked.addListener(function (event, parent_tab) {
    if (event.menuItemId === "paste-email") {
        openCreateAddress(parent_tab, event.frameId || 0);
    } else {
        // Paste previous email.
        browser.tabs.sendMessage(parent_tab.id, info.menuItemId,
            {"frameId": info.frameId});
    }
});

/**
 * Paste previous address context menus.
 */
var current_domain = "";
var previous_address_menus = [];
var previous_addresses = {};

browser.storage.local.get("previous_addresses").then(function (addresses) {
    previous_addresses = addresses;
});

browser.storage.onChanged.addListener(function (changes, area) {
    if ("previous_addresses" in changes) {
        previous_addresses = changes["previous_addresses"].newValue;
        current_domain = "*invalid*";  // Force context menu to reload.
    }
});

// Update the currently displayed previous addresses context menu items.
self.addEventListener("shown", function (event) {
    if (!event.editable) return;

    let domain;
    try {
        domain = new URL(event.tab.url).hostname;
    } catch (e) {
        console.error("Fehler beim Parsen der URL:", event.tab.url, e);
        return;
    }

    if (domain === current_domain) return;

    current_domain = domain;

    // Remove previous menu items.
    for (const id of previous_address_menus) browser.menus.remove(id);
    previous_address_menus = [];

    if (!current_domain) {
        browser.menus.refresh();
        return;
    }

    let addresses = [];
    let p = current_domain.length;
    while (p >= 0) {
        p = current_domain.lastIndexOf(".", p - 1);
        let domainPart = current_domain.slice(p + 1);
        if (domainPart in previous_addresses) {
            addresses = previous_addresses[domainPart];
            break;
        }
    }

    for (let [email, url] of addresses) {
        let url_detail;
        try {
            url = new URL(url);
            url_detail = current_domain == url.hostname ? url.pathname : url.hostname;
        } catch (e) {
            console.error("Fehlerhafte URL:", url, e);
            continue;
        }

        let id = browser.menus.create({
            id: email,
            contexts: ["editable"],
            title: browser.i18n.getMessage("menuPastePrevious", email) + " (" + url_detail + ")"
        });

        previous_address_menus.push(id);
    }

    browser.menus.refresh();
});

// Update some settings each time the addon is loaded.
browser.storage.sync.get(["username", "password"]).then(function (storage) {
    let data = {
        "cmd": "login",
        "fe-login-user": storage["username"],
        "fe-login-pass": storage["password"]
    };

    return callAPI(data);
}).then(function (login) {
    browser.storage.local.set({
        "domains": login["domain_name_list"],
        "real_emails": Object.keys(login["real_email_list"])
    });

    let data = {
        "cmd": "read_dea",
        "session_id": login["session_id"]
    };

    let suffixes = fetch(browser.runtime.getURL("public_suffix.json"))
        .then(response => response.ok ? response.json() : Promise.reject("Fehler beim Laden der Public Suffix List"))
        .catch(console.error);

    return Promise.all([callAPI(data), suffixes]);
}).then(function (values) {
    let current_prev_addresses = {};
    let [addresses, [rules, exceptions]] = values;

    for (const address of addresses) {
        if (address["website"]) {
            let domain;
            try {
                domain = new URL(address["website"]);
            } catch (e) {
                console.warn("Ungültige URL:", address["website"], e);
                continue;
            }

            domain = org_domain(domain, rules, exceptions);
            let email = [address["disposable_name"] + "@" + address["disposable_domain"], address["website"]];

            if (domain in current_prev_addresses) {
                current_prev_addresses[domain].push(email);
            } else {
                current_prev_addresses[domain] = [email];
            }
        }
    }

    previous_addresses = current_prev_addresses;
    browser.storage.local.set({ "previous_addresses": current_prev_addresses });
});
