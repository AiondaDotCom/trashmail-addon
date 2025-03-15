"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

document.addEventListener("DOMContentLoaded", function () {
    var num_format = new Intl.NumberFormat();
    for (const elem of document.querySelectorAll("[data-i18n]")) {
        let [stub, attr] = elem.dataset.i18n.split("|", 2);
        stub = stub.split("?");
        let [key, format_num] = stub[0].split("#");

        let text;
        if (key)
            text = browser.i18n.getMessage(key, stub.slice(1));
        else
            text = format_num;

        if (format_num !== undefined)
            text = text.replace(/\d+/g, num_format.format);

        if (attr)
            elem[attr] = text;
        else
            elem.insertAdjacentHTML("beforeend", text);
    }
});
