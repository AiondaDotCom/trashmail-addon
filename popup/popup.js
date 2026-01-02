"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

/**
 * Get session details - either from stored session_id or by logging in
 *
 * For OPAQUE accounts: Uses stored session_id (created during PAT-OPAQUE login)
 * For non-OPAQUE accounts: Uses classic login with stored credentials
 */
async function getSessionDetails() {
    // First check if we have a stored session_id
    var localStorage = await browser.storage.local.get(["session_id", "is_opaque_account"]);
    var syncStorage = await browser.storage.sync.get(["username", "password"]);

    // If we have a session_id, use it directly
    if (localStorage.session_id) {
        console.log("[TrashMail] Using stored session_id");
        return { session_id: localStorage.session_id };
    }

    // No stored session - need to login
    if (!syncStorage.username || !syncStorage.password) {
        throw new Error("Not logged in. Please log in first.");
    }

    // Check if this is an OPAQUE account (PAT stored)
    if (isPAT(syncStorage.password)) {
        // For OPAQUE accounts with PAT, we need to re-authenticate via OPAQUE
        // But we can't do that in popup without loading the OPAQUE library
        // Redirect user to options page to re-login
        throw new Error("Session expired. Please log in again via Options.");
    }

    // For non-OPAQUE accounts, use classic login
    var data = {
        "cmd": "login",
        "fe-login-user": syncStorage.username,
        "fe-login-pass": syncStorage.password
    };

    var response = await callAPI(data);

    // Store the new session_id
    await browser.storage.local.set({ "session_id": response.session_id });

    return response;
}

/**
 * Check if password is a Personal Access Token
 */
function isPAT(password) {
    return password && typeof password === 'string' && password.startsWith('tmpat_') && password.length > 6;
}

/**
 * Open Address Manager with current session
 *
 * NOTE: We intentionally don't pass session_id as GET parameter anymore.
 * The browser's session cookie will be used automatically.
 *
 * BUG FIX (2025-01-02): Previously, passing session_id in URL would override
 * the browser's existing session cookie, causing users to be logged out of
 * their active sessions when the extension opened a new tab.
 */
async function addressManager() {
    try {
        const baseUrl = await getApiBaseUrl();
        // Only pass language, let the browser use its session cookie
        const url = baseUrl + "/?cmd=manager&lang=" + browser.i18n.getUILanguage().substr(0, 2);
        await browser.tabs.create({"url": url});
        window.close();
    } catch (error) {
        let error_msg = document.getElementById("error_msg");
        error_msg.textContent = error.message || error;
        error_msg.style.display = "block";

        // If session expired for OPAQUE account, offer to re-login
        if (error.message && error.message.includes("log in")) {
            setTimeout(function() {
                browser.runtime.openOptionsPage();
                window.close();
            }, 2000);
        }
    }
}

document.getElementById("btn-address-manager").addEventListener("click", addressManager);

document.getElementById("btn-options").addEventListener("click", function () {
    browser.runtime.openOptionsPage().then(function () {
        window.close();
    });
});
