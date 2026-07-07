"use strict";

// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

interface SyncStorage {
    username?: string;
    password?: string;
    default_email?: string;
    default_domain?: string;
    default_forwards?: string | number;
    default_expire?: string | number;
    default_masq?: boolean;
    default_notify?: boolean;
    default_send?: boolean;
    guardian_enabled?: boolean;
    [key: string]: unknown;
}

interface LocalStorage {
    real_emails?: string[] | Record<string, unknown>;
    domains?: string[] | Record<string, unknown>;
    session_id?: string;
    debugApiUrl?: string;
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

// Open welcome screen on switch login button.
elById("btn-switch-login").onclick = function () {
    const width = 600;
    const height = 720;
    // Zentriert ueber dem Browserfenster oeffnen (sonst landet das Popup oben links)
    browser.windows.getCurrent().then((current) => {
        const left = Math.max(0, Math.round((current.left ?? 0) + ((current.width ?? width) - width) / 2));
        const top = Math.max(0, Math.round((current.top ?? 0) + ((current.height ?? height) - height) / 2));
        return browser.windows.create({
            "url": browser.runtime.getURL("options/welcome.html"),
            "width": width, "height": height, "left": left, "top": top,
            "type": "popup" as const,
        });
    }).then((welcomeWindow) => {
        browser.windows.onRemoved.addListener((id) => {
            if (id === welcomeWindow!.id)
                {window.location.reload();}
        });
    });
};

/**
 * Abmelden: beendet die Addon-Session UND die Browser-Session (Cookie vom
 * Manager-Login) serverseitig, leert die gespeicherten Zugangsdaten und
 * laedt die Seite neu (zeigt dann "Nicht angemeldet" + "Anmelden").
 */
function logout() {
    browser.storage.local.get(["session_id"]).then((local) => {
        const sessionId = (local as LocalStorage)["session_id"];
        const requests: Promise<unknown>[] = [];
        if (sessionId) {
            requests.push(callAPI({ "cmd": "logout", "session_id": sessionId }).catch(() => undefined));
        }
        // Browser-Session-Cookie (falls der Manager geoeffnet wurde) mit beenden
        requests.push(fetch(`${API_BASE_URL}/?api=1&cmd=logout`, {
            method: "POST",
            credentials: "include",
        }).catch(() => undefined));
        return Promise.all(requests);
    }).then(() => Promise.all([
        browser.storage.sync.remove(["username", "password"]),
        browser.storage.local.remove(["session_id", "is_opaque_account", "real_emails", "domains", "previous_addresses"]),
    ])).then(() => {
        window.location.reload();
    });
}
elById("btn-logout").addEventListener("click", logout);

function restoreOptions() {
    function setCurrentOptions(result: [SyncStorage, LocalStorage]) {
        const [sync, local] = result;

        const isLoggedIn = Boolean(sync["username"]);
        elById("username").textContent = isLoggedIn
            ? String(sync["username"])
            : browser.i18n.getMessage("optionsNotLoggedIn");
        // Ohne Login gibt es nichts zu "wechseln" - Button heisst dann "Anmelden"
        elById("btn-switch-login").textContent = browser.i18n.getMessage(
            isLoggedIn ? "optionsSwitchLoginButton" : "optionsLoginButton");
        // Abmelden nur anbieten, wenn jemand angemeldet ist
        elById("btn-logout").style.display = isLoggedIn ? "" : "none";

        const pairs: [string, string][] = [["real_emails", "default_email"], ["domains", "default_domain"]];
        for (const [list, prop] of pairs) {
            const select = elById<HTMLSelectElement>(prop);
            const raw = local[list];
            const items = Array.isArray(raw) ? raw : Object.keys((raw as Record<string, unknown> | undefined) || {});
            for (const item of items) {
                const option = document.createElement("option");
                option.value = option.text = item;

                if (item === sync[prop])
                    {option.selected = true;}

                select.add(option);
            }
        }

        let props = ["default_forwards", "default_expire"];
        for (const prop of props) {
            if (Object.prototype.hasOwnProperty.call(sync, prop))
                {elById<HTMLInputElement>(prop).value = String(sync[prop]);}
        }

        props = ["default_masq", "default_notify",
            "default_send", "guardian_enabled"];
        for (const prop of props) {
            if (Object.prototype.hasOwnProperty.call(sync, prop))
                {elById<HTMLInputElement>(prop).checked = Boolean(sync[prop]);}
        }

        // Enable access to default options if logged in.
        if ("username" in sync) {
            const selector = "#options-default input, #options-default select";
            for (const elem of document.querySelectorAll(selector))
                {(elem as HTMLInputElement | HTMLSelectElement).disabled = false;}
        }
    }

    const p1 = browser.storage.sync.get();
    const p2 = browser.storage.local.get(["real_emails", "domains"]);
    Promise.all([p1, p2]).then(setCurrentOptions);

    // Display the saved message after a page reload.
    if (sessionStorage !== null && sessionStorage.getItem("reset")) {
        const msg = elById("saved_msg");
        msg.style.display = "block";
        sessionStorage.removeItem("reset");
    }
}
document.addEventListener("DOMContentLoaded", restoreOptions);


function saveOptions(e: Event) {
    e.preventDefault();
    elById("saved_msg").style.display = "none";

    const getter = browser.storage.sync.get();

    const form = new FormData(e.target as HTMLFormElement);

    const formObj: Record<string, FormDataEntryValue | boolean> = {};
    for (const [key, value] of form)
        {formObj[key] = value;}

    // Ensure any missing checkbox values are saved as disabled.
    const checkboxes = ["default_masq", "default_notify",
        "default_send", "guardian_enabled"];
    for (const prop of checkboxes) {
        if (!(prop in formObj))
            {formObj[prop] = false;}
    }

    getter.then((storage) => {
        // Save current options, in case user wants to undo this action.
        if (sessionStorage !== null)
            {sessionStorage.setItem("undo", JSON.stringify(storage));}

        browser.storage.sync.set(formObj).then(() => {
            const msg = elById("saved_msg");
            msg.style.display = "block";

            // If no sessionStorage, we are unable to undo, so remove option.
            if (sessionStorage === null)
                {msg.querySelector("#undo")!.remove();}
        });
    });
}
document.querySelector("form")!.addEventListener("submit", saveOptions);

function undoOptions() {
    const undo = JSON.parse(sessionStorage.getItem("undo") as string);
    browser.storage.sync.set(undo).then(() => {
        window.location.reload();
    });
}
elById("undo").addEventListener("click", undoOptions);

function resetOptions() {
    const options = [
        "default_email", "default_forwards", "default_expire",
        "default_masq", "default_notify", "default_send",
        "default_domain"];
    browser.storage.sync.get().then((storage) => {
        if (sessionStorage !== null) {
            // Save current options, in case user wants to undo this action.
            sessionStorage.setItem("undo", JSON.stringify(storage));

            // When page is reloaded, restoreOptions() will display success/undo.
            sessionStorage.setItem("reset", String(true));
        }
        browser.storage.sync.remove(options).then(() => {
            (window.location.reload as (forcedReload?: boolean) => void)(true);
        });
    });
}
elById("btn-reset").addEventListener("click", resetOptions);

function addressManager() {
    const progress = elById("progress");
    progress.style.display = "inline-block";

    // POST-Login (PAT-OPAQUE bzw. classic mit Body-Zugangsdaten) setzt das
    // Session-Cookie im Browser - der Manager-Tab oeffnet direkt eingeloggt,
    // ohne session_id oder Passwort in der URL.
    openAddressManagerAuthenticated().then(() => {
        progress.style.display = "none";
    }).catch((error: unknown) => {
        const errorMsg = elById("error_msg");
        errorMsg.textContent = (error as { message?: string }).message || String(error);
        errorMsg.style.display = "block";
        progress.style.display = "none";
    });
}
elById("btn-address-manager").addEventListener("click", addressManager);

// ============================================================
// Hidden Debug Panel - Click title 5 times to reveal
// ============================================================
let debugClickCount = 0;
let debugClickTimer: number | undefined;

function initDebugPanel() {
    const title = document.querySelector("h1");
    if (!title) {return;}

    title.style.cursor = "pointer";
    title.addEventListener("click", () => {
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
            browser.storage.local.get("debugApiUrl").then((result: { debugApiUrl?: string }) => {
                const select = elById<HTMLSelectElement>("debug_api_url");
                if (result.debugApiUrl) {
                    select.value = result.debugApiUrl;
                } else {
                    select.value = "https://mail.aionda.com";
                }
                updateDebugStatus();
            });
        }
    });
}
document.addEventListener("DOMContentLoaded", initDebugPanel);

function updateDebugStatus() {
    const status = elById("debug-status");
    browser.storage.local.get("debugApiUrl").then((result: { debugApiUrl?: string }) => {
        if (result.debugApiUrl && result.debugApiUrl !== "https://mail.aionda.com") {
            status.textContent = `⚠️ Debug mode active: ${result.debugApiUrl}`;
            status.style.color = "#c00";
        } else {
            status.textContent = "✅ Using production server";
            status.style.color = "#080";
        }
    });
}

elById("btn-save-debug").addEventListener("click", () => {
    const url = elById<HTMLSelectElement>("debug_api_url").value;
    browser.storage.local.set({ debugApiUrl: url }).then(() => {
        (globalThis as unknown as { API_BASE_URL: string }).API_BASE_URL = url;
        updateDebugStatus();
        alert("Debug settings saved! Please reload the extension or restart the browser for changes to take full effect."); // eslint-disable-line no-alert
    });
});

elById("btn-reset-debug").addEventListener("click", () => {
    browser.storage.local.remove("debugApiUrl").then(() => {
        (globalThis as unknown as { API_BASE_URL: string }).API_BASE_URL = DEFAULT_API_URL;
        elById<HTMLSelectElement>("debug_api_url").value = "https://mail.aionda.com";
        updateDebugStatus();
        alert("Reset to production server!"); // eslint-disable-line no-alert
    });
});

export {};
