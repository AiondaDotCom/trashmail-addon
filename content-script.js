"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

browser.runtime.onMessage.addListener(function (message) {
    if (message == "check_editable") {
        let is_input = "selectionStart" in document.activeElement && !document.activeElement.readOnly;
        return Promise.resolve(is_input || document.activeElement.isContentEditable);
    } else {  // Paste email address
        let e = document.activeElement;
        if ("selectionStart" in e) {
            // input/textarea elements
            e.value = e.value.substr(0, e.selectionStart) + message + e.value.substr(e.selectionEnd);
        } else {
            // contentEditable elements
            window.getSelection().deleteFromDocument();
            window.getSelection().getRangeAt(0).insertNode(document.createTextNode(message));
        }
    }
});
