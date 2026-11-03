import { getOrgDomainResolver, type OrgDomainResolver } from "./public-suffix";
import { BACKGROUND_LOGIN_BLOCK_KEY, backgroundLoginBlockFor, isBackgroundLoginBlocked, isSessionRejected } from "./session-codes";

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


/** Angemeldet, wenn Zugangsdaten hinterlegt sind (nach Logout entfernt). */
async function isLoggedIn(): Promise<boolean> {
    const sync = await browser.storage.sync.get(["username", "password"]) as { username?: string; password?: string };
    return Boolean(sync.username && sync.password);
}

/** Zentriert ueber dem zuletzt fokussierten Fenster ein Popup oeffnen. */
function openCenteredPopup(url: string, width: number, height: number): void {
    browser.windows.getLastFocused().then((focused) => {
        const left = Math.max(0, Math.round((focused.left ?? 0) + ((focused.width ?? width) - width) / 2));
        const top = Math.max(0, Math.round((focused.top ?? 0) + ((focused.height ?? height) - height) / 2));
        browser.windows.create({ "url": url, "type": "popup", "width": width, "height": height, "left": left, "top": top });
    });
}

/** Eltern-Tab-Kontext fuer das Einfuegen der Adresse in das Formularfeld. */
interface ParentContext {
    url?: string;
    windowId?: number;
    tabId?: number;
    frameId: number;
}

/** Gemerkte "Adresse einfuegen"-Absicht ueber einen Login hinweg. */
interface PendingCreateAddress extends ParentContext {
    ts: number;
}

/** Oeffnet das create-address-Formular und reicht den Eltern-Kontext durch. */
function openCreateAddressForm(ctx: ParentContext): void {
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
                browser.tabs.sendMessage(tab.id!, [ctx.url, ctx.windowId, ctx.tabId, ctx.frameId]);
            }
        };
        browser.tabs.onUpdated.addListener(handler);
    });
}

async function openCreateAddress(parentTab: chrome.tabs.Tab, frameId: number): Promise<void> {
    const ctx: ParentContext = { url: parentTab.url, windowId: parentTab.windowId, tabId: parentTab.id, frameId };
    // Abgemeldet? Absicht merken und Login zeigen - nach dem Login setzt der
    // auth_completed-Handler das Einfuegen automatisch fort (kein "im Regen
    // stehen lassen"). Ohne Session/Zugangsdaten kann keine DEA erstellt werden.
    if (!(await isLoggedIn())) {
        const pending: PendingCreateAddress = { ...ctx, ts: Date.now() };
        await browser.storage.local.set({ "pending_create_address": pending });
        openCenteredPopup(browser.runtime.getURL("options/welcome.html"), 600, 720);
        return;
    }
    openCreateAddressForm(ctx);
}

/**
 * Nach erfolgreichem Login im Welcome-Fenster: eine gemerkte "Adresse
 * einfuegen"-Absicht fortsetzen, damit der User nicht erneut das Kontextmenue
 * bemuehen muss. Nur frische Absichten (< 2 Min) fortsetzen, sonst wuerde nach
 * einem spaeteren, regulaeren Login unerwartet ein Formular aufpoppen.
 */
async function resumePendingCreateAddress(): Promise<void> {
    const stored = await browser.storage.local.get("pending_create_address") as { pending_create_address?: PendingCreateAddress };
    const pending = stored.pending_create_address;
    if (!pending) { return; }
    await browser.storage.local.remove("pending_create_address");
    if (typeof pending.ts !== "number" || Date.now() - pending.ts > 120000) { return; }
    openCreateAddressForm(pending);
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
    // Neue Zugangsdaten → die Sperre nach einem fehlgeschlagenen
    // Hintergrund-Login gilt nicht mehr (siehe session-codes.ts).
    if (area === "sync" && ("username" in changes || "password" in changes)) {
        browser.storage.local.remove(BACKGROUND_LOGIN_BLOCK_KEY);
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

/** Erwarteter Abbruch (keine Zugangsdaten/keine Sitzung) - wird still geschluckt. */
class SilentSkip extends Error {
    readonly silent = true;
}

/** Gespeicherte Zugangsdaten aus storage.sync. */
interface StoredCredentials {
    username?: string;
    password?: string;
}

/**
 * Klassische Anmeldung (cmd=login). Speichert die neue session_id sowie
 * Domains und echte E-Mail-Adressen aus der Antwort und liefert die Sitzung.
 */
async function classicLoginAndStore(username: string, password: string): Promise<string> {
    const login = await callAPI({
        "cmd": "login",
        "fe-login-user": username,
        "fe-login-pass": password,
    });
    const sessionId = String(login["session_id"] ?? "");
    const update: Record<string, unknown> = { "session_id": sessionId };
    if (login["domain_name_list"] && login["real_email_list"]) {
        update["domains"] = Array.isArray(login["domain_name_list"])
            ? login["domain_name_list"]
            : Object.keys(login["domain_name_list"]);
        update["real_emails"] = Object.keys(login["real_email_list"]);
    }
    await browser.storage.local.set(update);
    return sessionId;
}

/**
 * Anmeldung des Hintergrundskripts - höchstens eine je Aufwachen, und nach
 * einem Fehlschlag gar keine mehr, bis die Sperre aufgehoben ist
 * (BACKGROUND_LOGIN_BLOCK_KEY in session-codes.ts).
 */
async function backgroundLogin(username: string, password: string): Promise<string> {
    const local = await browser.storage.local.get([BACKGROUND_LOGIN_BLOCK_KEY]);
    if (isBackgroundLoginBlocked(local[BACKGROUND_LOGIN_BLOCK_KEY], Date.now())) {
        console.log("[TrashMail] Background login blocked after an earlier failure, waiting for new credentials");
        throw new SilentSkip("blocked");
    }
    let sessionId: string;
    try {
        sessionId = await classicLoginAndStore(username, password);
    } catch (error) {
        await browser.storage.local.set({ [BACKGROUND_LOGIN_BLOCK_KEY]: backgroundLoginBlockFor(error, Date.now()) });
        throw error;
    }
    if (BACKGROUND_LOGIN_BLOCK_KEY in local) {
        await browser.storage.local.remove(BACKGROUND_LOGIN_BLOCK_KEY);
    }
    return sessionId;
}

function readDea(sessionId: string): Promise<[TmApiResponse, OrgDomainResolver]> {
    const data = {
        "cmd": "read_dea",
        "session_id": sessionId
    };
    // On failure we deliberately let the rejection propagate through the chain
    // (instead of swallowing it with .catch(console.error), which used to make
    // the resolver arrive as undefined and blow up later). The outer .catch
    // logs it and the previous_addresses update is aborted - no bogus grouping
    // is written.
    return Promise.all([callAPI(data), getOrgDomainResolver()]);
}

/**
 * Liest die Adressen beim Start des Hintergrundskripts - mit der
 * GESPEICHERTEN Sitzung.
 *
 * Unter MV3 wird das Hintergrundskript ständig entladen und von
 * tabs.onUpdated/onActivated neu geweckt. Bis 6.1.2 stand hier ein
 * unbedingtes cmd=login: jedes Aufwachen eine neue Server-Sitzung, die nur
 * Sekunden lebte (Prod, 03.11.2026: ~48.000 Anmeldungen am Tag von ~766
 * Konten, Spitzenkonto 1.414). Jetzt wird nur angemeldet, wenn keine
 * Sitzung gespeichert ist oder der Server sie ablehnt (isSessionRejected),
 * und dann höchstens einmal: Lehnt der Server auch die frische Sitzung ab,
 * bricht das Aufwachen ab. Nach einer fehlgeschlagenen Anmeldung sperrt
 * backgroundLogin weitere Versuche (BACKGROUND_LOGIN_BLOCK_KEY).
 *
 * Konten mit gespeichertem PAT melden sich hier nie an: Der OPAQUE-Handshake
 * braucht libopaque, die im Service Worker nicht läuft. Sie bekommen ihre
 * Sitzung aus den Optionen bzw. aus create-address (loginWithStoredPat).
 */
async function loadAddressesWithStoredSession(): Promise<[TmApiResponse, OrgDomainResolver]> {
    const storage = await browser.storage.sync.get(["username", "password"]) as StoredCredentials;
    const username = storage.username;
    const password = storage.password;
    if (!username || !password) {
        console.log("[TrashMail] No stored credentials, skipping auto-login");
        throw new SilentSkip("skip");
    }

    const patAccount = isPAT(password);
    const local = await browser.storage.local.get(["session_id"]) as { session_id?: string };
    const storedSession = local.session_id;

    if (!storedSession) {
        if (patAccount) {
            console.log("[TrashMail] No stored session for PAT account, user needs to login via Options");
            throw new SilentSkip("skip");
        }
        return readDea(await backgroundLogin(username, password));
    }

    try {
        return await readDea(storedSession);
    } catch (error) {
        if (patAccount || !isSessionRejected(error)) {
            throw error;
        }
        console.log("[TrashMail] Stored session rejected by server, logging in once");
        return readDea(await backgroundLogin(username, password));
    }
}

// Update the previous-address menu each time the addon is loaded.
loadAddressesWithStoredSession().then((values) => {
    const currentPrevAddresses: Record<string, [string, string][]> = {};
    const [addresses, orgDomain] = values as unknown as [DeaAddress[], OrgDomainResolver];

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

            domain = orgDomain(domain);
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
    // Nach erfolgreichem Login: gemerkte "Adresse einfuegen"-Absicht fortsetzen.
    if (message.action === "auth_completed") {
        resumePendingCreateAddress();
        return; // undefined -> Kanal schliesst sofort, Welcome-Fenster kann schliessen
    }

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
