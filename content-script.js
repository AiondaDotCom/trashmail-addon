"use strict";

browser.runtime.onMessage.addListener(function (message) {
    if (message == "get_domain") {
        return Promise.resolve(location.hostname);
    } else if (message == "check_editable") {
        let is_input = "selectionStart" in document.activeElement && !document.activeElement.readOnly;
        return Promise.resolve(is_input || document.activeElement.isContentEditable);
    } else {  // Paste email address
        let e = document.activeElement;
        if ("selectionStart" in e) {
            // input/textarea elements
            e.value = e.value.substr(0, e.selectionStart) + message + e.value.substr(e.selectionEnd);
        } else {
            // editableContent elements
            try {
                window.getSelection().deleteFromDocument();
                window.getSelection().getRangeAt(0).insertNode(document.createTextNode(message));
            } catch (e) {
                // Ignore errors. There seems to be errors occurring due to
                // receiving the same message 4 times from create-address.js.
            }
        }
    }
});
