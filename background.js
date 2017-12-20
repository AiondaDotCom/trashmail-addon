"use strict";

// Open welcome screen when installing addon.
browser.runtime.onInstalled.addListener(function (details) {
    if (details.reason == "install" || details.reason == "update") {
        browser.storage.sync.get("username").then(function (storage) {
            if (!("username" in storage) || !storage["username"]) {
                var options = {"url": "options/welcome.html",
                               "width": 750, "height": 360, "type": "popup"};
                browser.windows.create(options).then(function (welcomeWindow) {
                    browser.windows.onRemoved.addListener(function handler(id) {
                        if (id == welcomeWindow.id) {
                            browser.windows.onRemoved.removeListener(handler);
                            browser.runtime.openOptionsPage();
                        }
                    });
                });
            }
        });
    }
});

browser.menus.create({
    id: "paste-email",
    contexts: ["editable"],
    title: browser.i18n.getMessage("menuPasteAddress")
});

function openCreateAddress(parent_tab) {
    var options = {"url": "../create-address/create-address.html",
                   "type": "popup", "width": 750, "height": 490};
    browser.windows.create(options).then(function (window) {
        // (FF 56) Security policy blocks running code until tab has completed loading.
        browser.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
            if (tabId == window.tabs[0].id && changeInfo.status == "complete") {
                // Send the parent url and window ID through to the new window.
                browser.tabs.sendMessage(tab.id, [parent_tab.url, parent_tab.windowId, parent_tab.id]);
            }
        });
    });
}

browser.menus.onClicked.addListener(function(info, parent_tab) {
    if (info.menuItemId == "paste-email") {
        openCreateAddress(parent_tab);
    } else {
        // Paste previous email.
        browser.tabs.sendMessage(parent_tab.id, info.menuItemId,
                                 {"frameId": info.frameId});
    }
});

// Open create address window on keyboard shortcut.
browser.commands.onCommand.addListener(function (command) {
    browser.tabs.query({
        currentWindow: true,
        active: true
    }).then(function (tabs) {
        browser.tabs.sendMessage(tabs[0].id, "check_editable").then(function (is_editable) {
            if (is_editable)
                openCreateAddress(tabs[0]);
        });
    });
});



/**
 * Paste previous address context menus.
 */

// Track current status of previous address menus.
var current_domain = "";
var previous_address_menus = [];
var previous_addresses = {};
browser.storage.local.get("previous_addresses").then(function (addresses) {
    previous_addresses = addresses;
});
browser.storage.onChanged.addListener(function (changes, area) {
    if ("previous_addresses" in changes) {
        previous_addresses = changes["previous_addresses"].newValue;
        _update_menus();
    }
});

/** Update the currently displayed previous addresses context menu items. */
function _update_menus() {
    // Remove previous menu items.
    for (const id of previous_address_menus)
        browser.menus.remove(id);
    previous_address_menus = [];

    // Add any new ones for this domain.
    if (!(current_domain in previous_addresses))
        return;

    for (const email of previous_addresses[current_domain]) {
        let id = browser.menus.create({
            id: email,
            contexts: ["editable"],
            title: browser.i18n.getMessage("menuPastePrevious", email)
        });
        previous_address_menus.push(id);
    }
}

/** Check for current domain and update previous address menus if needed. */
function update_previous_address_menu() {
    browser.tabs.query({
        currentWindow: true,
        active: true
    }).then(function (tabs) {
        return browser.tabs.sendMessage(tabs[0].id, "get_domain");
    }).catch(function () {
        // e.g. when on non-content tabs, so no content-script loaded.
        current_domain = null;
        _update_menus();
    }).then(function (domain) {
        if (domain != current_domain) {
            current_domain = domain;
            _update_menus();
        }
    });
}

// Update menu when URL is changed.
browser.tabs.onUpdated.addListener(function (tabId, changeInfo, tabInfo) {
    if (changeInfo.status == "loading")
        update_previous_address_menu();
});

// Update menu when focused tab is changed.
browser.tabs.onActivated.addListener(update_previous_address_menu);

// Update menu when focused window is changed.
browser.windows.onFocusChanged.addListener(function (windowId) {
    if (windowId >= 0)
        update_previous_address_menu();
});


// Update some settings each time the addon is loaded.
browser.storage.sync.get(["username", "password"]).then(function (storage) {
    var data = {
        "cmd": "login",
        "fe-login-user": storage["username"],
        "fe-login-pass": storage["password"]
    };

    return callAPI(data);
}).then(function (login) {
    // Update list of domains and real emails.
    browser.storage.local.set({
        "domains": login["domain_name_list"],
        "real_emails": Object.keys(login["real_email_list"])
    });

    var data = {
        "cmd": "read_dea",
        "session_id": login["session_id"]
    };

    return callAPI(data);
}).then(function (addresses) {
    // Update local storage of existing disposable addresses.
    var current_prev_addresses = {};
    for (const address of addresses) {
        if (address["website"]) {
            try {
                var domain = (new URL(address["website"])).hostname;
            } catch (e) {
                if (e instanceof TypeError)
                    continue;  // Not a valid URL.
                throw e;
            }
            let email = address["disposable_name"] + "@" + address["disposable_domain"];

            if (domain in current_prev_addresses)
                current_prev_addresses[domain].push(email);
            else
                current_prev_addresses[domain] = [email];
        }
    }

    previous_addresses = current_prev_addresses;
    browser.storage.local.set({"previous_addresses": current_prev_addresses});
});
