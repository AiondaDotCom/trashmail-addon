"use strict";

// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
const lang = browser.i18n.getUILanguage().substring(0, 2);
const mailFaker = new MailFaker(lang);

interface CreateAddressSync {
    username?: string;
    password?: string;
    default_email?: string;
    [key: string]: unknown;
}

interface CreateAddressLocal {
    domains?: string[] | Record<string, unknown>;
    real_emails?: string[] | Record<string, unknown>;
    session_id?: string;
    previous_addresses?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Look up an element by id, throwing (like the original blind access) if absent. */
function elById<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (el === null) {
        throw new Error(`Element #${id} not found`);
    }
    return el as T;
}

/**
 * Check if password is a Personal Access Token
 */
function isPAT(password: unknown): boolean {
    return Boolean(password) && typeof password === "string" && password.startsWith("tmpat_") && password.length > 6;
}

let parentUrl: string | undefined;
let parentId: number | undefined;
let tabId: number | undefined;
let frameId: number | undefined;
const p1 = browser.storage.sync.get();
const p2 = browser.storage.local.get(["domains", "real_emails", "session_id"]);

// Set variables passed from background script.
browser.runtime.onMessage.addListener((message) => {
    // Only handle array messages (from context menu / paste action)
    // Ignore other messages like {action: 'get_guardian_status'}
    if (!Array.isArray(message)) {
        return; // Not for us, ignore silently
    }

    if (message.length >= 4) {
        [parentUrl, parentId, tabId, frameId] = message;
    } else {
        console.error("Unexpected message format:", message);
        return;
    }

    // Event-Listener nur einmal registrieren
    function closeOnParentTabRemoved(id: number) {
        if (id === tabId) {
            browser.windows.getCurrent().then((window) => {
                browser.windows.remove(window.id!);
            }).catch((error) => console.error("Fenster konnte nicht geschlossen werden:", error));
        }
    }

    if (!browser.tabs.onRemoved.hasListener(closeOnParentTabRemoved)) {
        browser.tabs.onRemoved.addListener(closeOnParentTabRemoved);
    }
});


const loginDetails: Promise<TmApiResponse> = Promise.all([p1, p2]).then((result: [CreateAddressSync, CreateAddressLocal]) => {
    const [sync, local] = result;

    // Initialise all the fields in the window from user preferences.
    const pairs: [string, string][] = [["real_emails", "email"], ["domains", "domain"]];
    for (const [list, prop] of pairs) {
        const select = elById<HTMLSelectElement>(prop);

        // Add "Internal Mailbox" as first option for email dropdown
        if (prop === "email") {
            const vaultOption = document.createElement("option");
            vaultOption.value = "vault";
            vaultOption.text = browser.i18n.getMessage("optionsInternalMailbox") || "Internal Mailbox";
            if (sync["default_email"] === "vault")
                {vaultOption.selected = true;}
            select.add(vaultOption);
        }

        // Storage may be empty (fresh profile) or hold an object from older versions
        const raw = local[list];
        const items = Array.isArray(raw) ? raw : Object.keys((raw as Record<string, unknown> | undefined) || {});
        for (const item of items) {
            const option = document.createElement("option");
            option.value = option.text = item;

            if (item === sync[`default_${prop}`])
                {option.selected = true;}

            select.add(option);
        }
    }

    let props = ["forwards", "expire"];
    for (const prop of props) {
        const key = `default_${prop}`;
        if (key in sync)
            {elById<HTMLInputElement>(prop).value = String(sync[key]);}
    }

    props = ["masq", "notify", "send"];
    for (const prop of props) {
        const key = `default_${prop}`;
        if (key in sync)
            {elById<HTMLInputElement>(prop).checked = Boolean(sync[key]);}
    }


    elById<HTMLInputElement>("disposable-name").value = mailFaker.localPart();

    return result;  // Return both sync and local
}).then((result: [CreateAddressSync, CreateAddressLocal]) => {
    const [sync, local] = result;

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
    const data = {
        "cmd": "login",
        "fe-login-user": sync["username"],
        "fe-login-pass": sync["password"],
    };

    return callAPI(data).then((response) => {
        // Store the new session_id
        browser.storage.local.set({ "session_id": response.session_id });
        return response;
    });
});

async function addressManager() {
    try {
        const baseUrl = await getApiBaseUrl();
        const url = `${baseUrl}/?cmd=manager`;
        const details = await loginDetails;

        const params = new URLSearchParams({
            "lang": lang,
            "session_id": String(details["session_id"]),
        });

        const options = {
            "url": url.concat("&", params.toString()),
            "windowId": parentId,
        };
        await browser.tabs.create(options);
        window.close();
    } catch (error) {
        const errorMsg = elById("error_msg");
        // .message statt String(error) - sonst haengt bei Error-Objekten ein
        // "Error:"-Praefix davor.
        errorMsg.textContent = (error as { message?: string }).message || String(error);
        errorMsg.style.display = "block";
    }
}

async function createAddress(e: Event) {
    e.preventDefault();

    const createButton = elById<HTMLButtonElement>("btn-create");
    const progress = elById("progress");
    const error = elById("error_msg");
    const form = new FormData(e.target as HTMLFormElement);

    createButton.disabled = true;
    progress.style.display = "block";
    error.style.display = "none";

    try {
        // Login-Daten abrufen
        const login = await loginDetails;

        const data = {
            "cmd": "create_dea",
            "session_id": login["session_id"],
        };

        const destination = form.get("email");
        const isVault = destination === "vault";

        const json = {
            "data": {
                "disposable_name": form.get("disposable_name"),
                "disposable_domain": form.get("domain"),
                "destination": isVault ? "" : destination,
                "forwards": form.get("forwards"),
                "expire": form.get("expire"),
                // CAPTCHA-Option (Challenge-Response) wurde aus dem Addon entfernt
                // (zu komplex fuer Einsteiger) - neue DEAs immer ohne CS
                "cs": false,
                "masq": form.get("masq") || false,
                "notify": form.get("notify") || false,
                "vault": isVault,
                "website": form.get("send") ? parentUrl : "",
            },
        };

        await callAPI(data, json);

        const address: [string, string | undefined] = [`${String(form.get("disposable_name"))}@${String(form.get("domain"))}`, parentUrl];

        // **Suffixes und Storage abrufen**
        const [storage, suffixesResponse] = await Promise.all([
            browser.storage.local.get("previous_addresses"),
            fetch(browser.runtime.getURL("public_suffix.json")),
        ]);

        const suffixes = suffixesResponse.ok ? await suffixesResponse.json() : [[], []];
        const [rules, exceptions] = suffixes;
        const addresses = (storage["previous_addresses"] || {}) as Record<string, Array<[string, string | undefined]>>; // Initialisiere, falls nicht vorhanden

        let domain: string;
        try {
            domain = org_domain(new URL(parentUrl as string), rules, exceptions);
        } catch (e) {
            console.error("Ungültige URL:", parentUrl, e);
            domain = "mail.aionda.com"; // Fallback-Domain
        }

        if (domain in addresses) {
            addresses[domain]!.push(address);
        } else {
            addresses[domain] = [address];
        }

        await browser.storage.local.set({ "previous_addresses": addresses });

        // ** Add address into active tab **
        await browser.tabs.sendMessage(tabId!, address[0], { "frameId": frameId });
        // Send message to the background service to update the menu
        await browser.runtime.sendMessage({
            action: "update_menu",
            tabId: tabId,
        });

        // **Popup schließen**
        const currentWindow = await browser.windows.getCurrent();
        await browser.windows.remove(currentWindow.id!);

    } catch (msg) {
        error.innerText = String(msg);
        error.style.display = "block";
        progress.style.display = "none";
        createButton.disabled = false;
    }
}


document.querySelector("form")!.addEventListener("submit", createAddress);

elById("btn-address-manager").addEventListener("click", addressManager);

elById("btn-close").addEventListener("click", () => {
    window.close();
});

// Auto-resize window to fit content
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(async () => {
        try {
            const card = document.querySelector<HTMLElement>(".card")!;
            const header = document.querySelector<HTMLElement>(".header")!;
            const container = document.querySelector<HTMLElement>(".container")!;

            const contentHeight = header.offsetHeight + container.offsetHeight + 40; // padding
            const contentWidth = Math.max(card.offsetWidth + 40, 500);

            const currentWindow = await browser.windows.getCurrent();

            // Calculate the difference between window size and viewport
            const chromeHeight = currentWindow.height! - window.innerHeight;
            const chromeWidth = currentWindow.width! - window.innerWidth;

            // New window size = content + browser chrome
            const newHeight = Math.min(contentHeight + chromeHeight, screen.availHeight - 100);
            const newWidth = Math.min(contentWidth + chromeWidth, 650);

            // Center on screen
            const left = Math.round((screen.width - newWidth) / 2);
            const top = Math.round((screen.height - newHeight) / 2);

            await browser.windows.update(currentWindow.id!, {
                width: newWidth,
                height: newHeight,
                left: left,
                top: top,
            });
        } catch (err) {
            console.log("[Create Address] Auto-resize failed:", err);
        }
    }, 100); // Small delay to ensure content is rendered
});

export {};
