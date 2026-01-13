"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

/**
 * Show MITM warning overlay
 * Called when Guardian detects a certificate mismatch
 * @param {string} message - The warning message
 * @param {string} title - The dialog title (localized)
 * @param {string} dismissText - The dismiss button text (localized)
 */
function showMitmWarning(message, title, dismissText) {
    // Don't show multiple warnings
    if (document.getElementById("trashmail-mitm-warning")) {
        return;
    }

    // Use localized strings or fallback to English
    const dialogTitle = title || "Security Warning";
    const continueText = dismissText || "Dismiss";

    // Create warning overlay
    const overlay = document.createElement("div");
    overlay.id = "trashmail-mitm-warning";
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const dialog = document.createElement("div");
    dialog.style.cssText = `
        background: #1a1a2e;
        border: 3px solid #ef4444;
        border-radius: 12px;
        padding: 32px;
        max-width: 500px;
        color: white;
        box-shadow: 0 0 50px rgba(239, 68, 68, 0.5);
    `;

    dialog.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <div style="font-size: 64px; margin-bottom: 16px;">⚠️</div>
            <h1 style="color: #ef4444; font-size: 24px; margin: 0 0 8px 0;">
                ${escapeHtml(dialogTitle)}
            </h1>
        </div>
        <div style="background: #0f0f1a; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</div>
        <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="trashmail-mitm-close" style="
                background: #ef4444;
                color: white;
                border: none;
                padding: 12px 32px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: bold;
            ">${escapeHtml(continueText)}</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Event handlers
    document.getElementById("trashmail-mitm-close").addEventListener("click", () => {
        overlay.remove();
    });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Guardian MITM warning
    if (message && message.action === "guardian_warning") {
        showMitmWarning(message.message, message.title, message.dismissText);
        sendResponse({ received: true });
        return true;
    }

    if (message === "check_editable") {
        let activeElement = document.activeElement;
        let is_input = activeElement && "selectionStart" in activeElement && !activeElement.readOnly;
        sendResponse(is_input || (activeElement && activeElement.isContentEditable));
        return true; // Asynchrone Antwort erlauben
    } else {  // Paste email address
        let e = document.activeElement;
        if (e) {
            if ("selectionStart" in e) {
                // input/textarea elements
                let start = e.selectionStart;
                let end = e.selectionEnd;
                e.value = e.value.substring(0, start) + message + e.value.substring(end);
                e.setSelectionRange(start + message.length, start + message.length); // Cursor setzen
            } else if (e.isContentEditable) {
                // contentEditable elements
                let selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    selection.deleteFromDocument();
                    selection.getRangeAt(0).insertNode(document.createTextNode(message));
                }
            }
        }
    }
});
