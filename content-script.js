"use strict";
(() => {
  // trashmail-addon/ts/content-script.ts
  var browser = globalThis.browser ?? chrome;
  function showMitmWarning(message, title, dismissText) {
    if (document.getElementById("trashmail-mitm-warning")) {
      return;
    }
    const dialogTitle = title || "Security Warning";
    const continueText = dismissText || "Dismiss";
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
            <div style="font-size: 64px; margin-bottom: 16px;">\u26A0\uFE0F</div>
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
    document.getElementById("trashmail-mitm-close").addEventListener("click", () => {
      overlay.remove();
    });
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "guardian_warning") {
      const warning = message;
      showMitmWarning(warning.message, warning.title, warning.dismissText);
      sendResponse({ received: true });
      return true;
    }
    if (message === "check_editable") {
      const activeElement = document.activeElement;
      const isInput = activeElement && "selectionStart" in activeElement && !activeElement.readOnly;
      sendResponse(isInput || activeElement && activeElement.isContentEditable);
      return true;
    } else {
      const pasteText = message;
      const e = document.activeElement;
      if (e) {
        if ("selectionStart" in e) {
          const input = e;
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = `${input.value.substring(0, start)}${pasteText}${input.value.substring(end)}`;
          input.setSelectionRange(start + pasteText.length, start + pasteText.length);
        } else if (e.isContentEditable) {
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            selection.deleteFromDocument();
            selection.getRangeAt(0).insertNode(document.createTextNode(pasteText));
          }
        }
      }
    }
  });
})();
