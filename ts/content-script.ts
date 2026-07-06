// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

/** Guardian MITM warning message pushed from the background script. */
interface GuardianWarningMessage {
    action?: string;
    message: string;
    title?: string;
    dismissText?: string;
}

/**
 * Show MITM warning overlay
 * Called when Guardian detects a certificate mismatch
 * @param {string} message - The warning message
 * @param {string} title - The dialog title (localized)
 * @param {string} dismissText - The dismiss button text (localized)
 */
function showMitmWarning(message: string, title?: string, dismissText?: string) {
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
    document.getElementById("trashmail-mitm-close")!.addEventListener("click", () => {
        overlay.remove();
    });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

browser.runtime.onMessage.addListener((message: GuardianWarningMessage | string, sender, sendResponse) => {
    // Guardian MITM warning
    if (message && (message as GuardianWarningMessage).action === "guardian_warning") {
        const warning = message as GuardianWarningMessage;
        showMitmWarning(warning.message, warning.title, warning.dismissText);
        sendResponse({ received: true });
        return true;
    }

    if (message === "check_editable") {
        const activeElement = document.activeElement;
        const isInput = activeElement && "selectionStart" in activeElement && !(activeElement as HTMLInputElement).readOnly;
        sendResponse(isInput || (activeElement && (activeElement as HTMLElement).isContentEditable));
        return true; // Asynchrone Antwort erlauben
    } else {  // Paste email address
        const pasteText = message as string;
        const e = document.activeElement;
        if (e) {
            if ("selectionStart" in e) {
                // input/textarea elements
                const input = e as HTMLInputElement;
                const start = input.selectionStart!;
                const end = input.selectionEnd!;
                input.value = `${input.value.substring(0, start)}${pasteText}${input.value.substring(end)}`;
                input.setSelectionRange(start + pasteText.length, start + pasteText.length); // Cursor setzen
            } else if ((e as HTMLElement).isContentEditable) {
                // contentEditable elements
                const selection = window.getSelection()!;
                if (selection.rangeCount > 0) {
                    selection.deleteFromDocument();
                    selection.getRangeAt(0).insertNode(document.createTextNode(pasteText));
                }
            }
        }
    }
});

export {};
