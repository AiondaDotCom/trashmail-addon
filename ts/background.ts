// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

// Import additional scripts (Service Worker only - Chrome)
// Firefox with background.scripts loads these via manifest
if (typeof importScripts === "function") {
    importScripts("api.js", "publicsuffixlist.js", "guardian.js");
}

/** Runtime message shapes handled by the background listener. */
interface BackgroundMessage {
    action?: string;
    tabId?: number;
}

/** A DEA record as returned by read_dea. */
interface DeaAddress {
    website?: string;
    disposable_name?: string;
    disposable_domain?: string;
    [key: string]: unknown;
}

// Open welcome screen when installing addon.
// Service Worker uses "install" event, Firefox Event Pages use "runtime.onInstalled"
const swScope = (globalThis as { ServiceWorkerGlobalScope?: unknown }).ServiceWorkerGlobalScope;
if (typeof self !== "undefined" && typeof self.addEventListener === "function" && typeof swScope !== "undefined") {
    // Chrome Service Worker
    self.addEventListener("install", (event) => {
        (event as unknown as { waitUntil(promise: Promise<unknown>): void }).waitUntil(
            browser.storage.sync.get("username").then((storage) => {
                if (!("username" in storage) || !storage["username"]) {
                    browser.runtime.openOptionsPage();
                }
            })
        );
    });
} else {
    // Firefox Event Page
    browser.runtime.onInstalled.addListener(() => {
        browser.storage.sync.get("username").then((storage) => {
            if (!("username" in storage) || !storage["username"]) {
                browser.runtime.openOptionsPage();
            }
        });
    });
}

// Check if the context menu item already exists before creating it
async function createContextMenu() {
    try {
        await browser.contextMenus.removeAll();

        await browser.contextMenus.create({
            id: "paste-email",
            contexts: ["editable"],
            title: browser.i18n.getMessage("menuPasteAddress")
        });
    } catch (error) {
        console.error("Error while creating context menu:", error);
    }
}

// Beim Start der Erweiterung ausführen
createContextMenu();


function openCreateAddress(parentTab: chrome.tabs.Tab, frameId: number) {
    const width = 750;
    const height = 720;
    // Zentriert ueber dem zuletzt fokussierten Browserfenster oeffnen
    // (im Service Worker gibt es kein `screen`-Objekt).
    browser.windows.getLastFocused().then((focused) => {
        const left = Math.max(0, Math.round((focused.left ?? 0) + ((focused.width ?? width) - width) / 2));
        const top = Math.max(0, Math.round((focused.top ?? 0) + ((focused.height ?? height) - height) / 2));
        const options: chrome.windows.CreateData = {"url": "../create-address/create-address.html",
            "type": "popup", "width": width, "height": height, "left": left, "top": top};
        return browser.windows.create(options);
    }).then((window) => {
        // (FF 56) Security policy blocks running code until tab has completed loading.
        const handler = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
            if (tabId === window!.tabs![0]!.id && changeInfo.status === "complete") {
                browser.tabs.onUpdated.removeListener(handler);
                // Send the parent url and window ID through to the new window.
                browser.tabs.sendMessage(
                    tab.id!, [parentTab.url, parentTab.windowId, parentTab.id, frameId]);
            }
        };
        browser.tabs.onUpdated.addListener(handler);
    });
}

browser.contextMenus.onClicked.addListener((event, parentTab) => {
    if (event.menuItemId === "paste-email") {
        openCreateAddress(parentTab!, event.frameId || 0);
    } else {
        // Paste previous email.
        browser.tabs.sendMessage(parentTab!.id!, event.menuItemId,
            {"frameId": event.frameId});
    }
});

/**
 * Paste previous address context menus.
 */
let currentDomain = "";
let previousAddressMenus: (number | string)[] = [];

browser.storage.onChanged.addListener((changes, area) => {
    if ("previous_addresses" in changes) {
        currentDomain = "*invalid*";  // Force context menu to reload.
    }
});

// Update the currently displayed previous addresses context menu items.
async function updateContextMenu(tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
    try {
        if (!tab.url) {
            return;
        } // Falls keine URL vorhanden ist, abbrechen.

        let domain: string;
        try {
            domain = new URL(tab.url).hostname;
        } catch (e) {
            console.error("Error while parsing the URL:", tab.url, e);
            return;
        }

        if (domain === currentDomain) {
            return;
        }
        currentDomain = domain;

        // Entferne vorherige Menüeinträge, und füge das initiale Hinzu
        await createContextMenu();
        previousAddressMenus = [];

        // Falls die Domain leer ist, beende das Update
        if (!currentDomain) {
            return;
        }

        // Lade gespeicherte Adressen aus dem Speicher
        const storage = await browser.storage.local.get("previous_addresses");
        const storedPreviousAddresses = (storage["previous_addresses"] as Record<string, [string, string][]>) || {};
        let addresses: [string, string][] = [];

        let p = currentDomain.length;
        while (p >= 0) {
            p = currentDomain.lastIndexOf(".", p - 1);
            const domainPart = currentDomain.slice(p + 1);
            if (domainPart in storedPreviousAddresses) {
                addresses = storedPreviousAddresses[domainPart]!;
                break;
            }
        }

        for (const [email, urlValue] of addresses) {
            let url: string | URL = urlValue;
            let urlDetail;
            try {
                url = new URL(url);
                urlDetail = currentDomain === url.hostname ? url.pathname : url.hostname;
            } catch (e) {
                console.error("Fehlerhafte URL:", url, e);
                continue;
            }

            const id = browser.contextMenus.create({
                id: email,
                contexts: ["editable"],
                title: `${browser.i18n.getMessage("menuPastePrevious", email)} (${urlDetail})`
            });

            previousAddressMenus.push(id);
        }
    } catch (error) {
        console.error("Error on creating context menu:", error);
    }
}

// Listener für Tab-Wechsel und Seiten-Neuladen
browser.tabs.onUpdated.addListener(updateContextMenu);
browser.tabs.onActivated.addListener((activeInfo) => {
    browser.tabs.get(activeInfo.tabId).then((tab) => updateContextMenu(tab.id!, {}, tab));
});


/**
 * Check if password is a Personal Access Token
 */
function isPAT(password: string): boolean {
    return Boolean(password) && typeof password === "string" && password.startsWith("tmpat_") && password.length > 6;
}

// Update some settings each time the addon is loaded.
// Only attempt auto-login if we have stored credentials
browser.storage.sync.get(["username", "password"]).then((storage) => {
    // Skip if no credentials stored
    if (!storage["username"] || !storage["password"]) {
        console.log("[TrashMail] No stored credentials, skipping auto-login");
        return Promise.reject({ silent: true });
    }

    // Skip auto-login for OPAQUE accounts (PAT stored)
    // OPAQUE requires the full library which can't run in Service Worker
    // User will need to login via Options page, which stores session_id
    if (isPAT(storage["password"] as string)) {
        console.log("[TrashMail] PAT detected (OPAQUE account), checking for stored session...");
        // Try to use stored session_id instead
        return browser.storage.local.get(["session_id"]).then((localData) => {
            if (localData.session_id) {
                console.log("[TrashMail] Using stored session_id for auto-refresh");
                return { session_id: localData.session_id as string };
            } else {
                console.log("[TrashMail] No stored session for OPAQUE account, user needs to login via Options");
                return Promise.reject({ silent: true });
            }
        });
    }

    const data = {
        "cmd": "login",
        "fe-login-user": storage["username"],
        "fe-login-pass": storage["password"]
    };

    return callAPI(data);
}).then((login: TmApiResponse) => {
    console.log("[TrashMail] Auto-login response:", login);
    console.log("[TrashMail] Session ID:", login["session_id"]);

    // Only update domains/emails if they're in the response (not for stored session_id)
    if (login["domain_name_list"] && login["real_email_list"]) {
        const domains = Array.isArray(login["domain_name_list"])
            ? login["domain_name_list"]
            : Object.keys(login["domain_name_list"]);
        browser.storage.local.set({
            "domains": domains,
            "real_emails": Object.keys(login["real_email_list"])
        });
    }

    const data = {
        "cmd": "read_dea",
        "session_id": login["session_id"]
    };
    console.log("[TrashMail] read_dea request:", data);

    // On failure we deliberately let the rejection propagate through the chain
    // (instead of swallowing it with .catch(console.error), which used to make
    // `suffixes` resolve to undefined and blow up later as a confusing
    // "undefined is not iterable"). The outer .catch logs it and the
    // previous_addresses update is aborted - no bogus grouping is written.
    const suffixes = fetch(browser.runtime.getURL("public_suffix.json"))
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Public Suffix List konnte nicht geladen werden")));

    return Promise.all([callAPI(data), suffixes]);
}).then((values) => {
    const currentPrevAddresses: Record<string, [string, string][]> = {};
    const [addresses, [rules, exceptions]] = values as unknown as [DeaAddress[], [PublicSuffixStore, PublicSuffixStore]];
    const orgDomain = (globalThis as unknown as PublicSuffixGlobals).org_domain;

    for (const address of addresses) {
        if (address["website"]) {
            let domain;
            try {
                let urlString = address["website"].trim(); // Remove whitespace

                // If no protocol is present, add "https://"
                if (!/^https?:\/\//i.test(urlString)) {
                    urlString = `https://${urlString}`;
                }

                domain = new URL(urlString);
            } catch (e) {
                console.warn("Ungültige URL:", address["website"], e);
                continue;
            }

            domain = orgDomain(domain, rules, exceptions);
            const email: [string, string] = [`${address["disposable_name"]}@${address["disposable_domain"]}`, address["website"]];

            if (domain in currentPrevAddresses) {
                currentPrevAddresses[domain]!.push(email);
            } else {
                currentPrevAddresses[domain] = [email];
            }
        }
    }

    browser.storage.local.set({ "previous_addresses": currentPrevAddresses });
}).catch((error: unknown) => {
    const err = error as { silent?: boolean; requires_2fa?: boolean; message?: string };
    // Silent errors are expected (no credentials stored)
    if (err && err.silent) {
        return;
    }

    // 2FA required - can't auto-login, user needs to login manually
    if (err && err.requires_2fa) {
        console.log("[TrashMail] 2FA required, manual login needed");
        return;
    }

    // Log other errors but don't crash
    console.warn("[TrashMail] Auto-login failed:", err.message || err);
});

browser.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    // Handle update_menu
    if (message.action === "update_menu") {
        (async () => {
            try {
                if (message.tabId) {
                    const tab = await browser.tabs.get(message.tabId);
                    console.log("✅ Tab aus Nachricht erhalten:", tab.url);
                    await updateContextMenu(message.tabId, {}, tab);
                    return { status: "success" };
                }
                const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
                if (activeTab) {
                    await updateContextMenu(activeTab.id!, {}, activeTab);
                    return { status: "success" };
                } else {
                    return { status: "error", message: "No active tab available." };
                }
            } catch (error) {
                return { status: "error", message: (error as Error).toString() };
            }
        })().then(sendResponse);
        return true;
    }

    // Handle get_guardian_status (for Chrome - guardian.js listener doesn't work reliably)
    // Uses self.* to access guardian.js variables exposed on Service Worker global scope
    if (message.action === "get_guardian_status") {
        console.log("[Background] Handling get_guardian_status");
        (async () => {
            try {
                const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                if (tabs.length === 0) {
                    return {
                        enabled: self.guardianEnabled || false,
                        initialized: self.guardianInitialized || false,
                        keysLoaded: self.publicKeys ? self.publicKeys.size : 0,
                        isProtected: false,
                        status: null
                    };
                }
                const tab = tabs[0]!;
                let hostname: string | null = null;
                let isProtected = false;
                try {
                    hostname = new URL(tab.url!).hostname;
                    // Use guardian.js isProtectedHost function
                    isProtected = self.isProtectedHost ? self.isProtectedHost(hostname) : false;
                } catch (e) {}

                const securityStatus = self.tabSecurityStatus ? self.tabSecurityStatus.get(tab.id!) : null;
                const webRequestApi = browser.webRequest as { getSecurityInfo?: unknown } | undefined;
                const response = {
                    tabId: tab.id,
                    hostname: hostname,
                    isProtected: isProtected,
                    enabled: self.guardianEnabled || false,
                    status: securityStatus || null,
                    keysLoaded: self.publicKeys ? self.publicKeys.size : 0,
                    initialized: self.guardianInitialized || false,
                    isFirefox: typeof webRequestApi?.getSecurityInfo === "function",
                    ed25519Supported: self.ed25519Supported,
                    limitedMode: typeof webRequestApi?.getSecurityInfo !== "function"
                };
                console.log("[Background] Sending guardian status:", response);
                return response;
            } catch (err) {
                console.error("[Background] Error in get_guardian_status:", err);
                return {
                    initialized: false,
                    keysLoaded: 0,
                    isProtected: false,
                    status: null,
                    error: (err as Error).message
                };
            }
        })().then(sendResponse);
        return true;
    }

    // Unknown message - don't handle
    return false;
});

export {};
