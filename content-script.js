"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
