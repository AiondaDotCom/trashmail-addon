"use strict";

// This file is adapted from: https://github.com/gorhill/publicsuffixlist.js
// and is dual-licensed under GPLv3 and AGPLv3.

/** Get the organizational domain from a given URL object. */
function org_domain(url, rules, exceptions) {
    let hostname = url.hostname.toLowerCase();
    let suffix = get_public_suffix(hostname, rules, exceptions);
    let pos = hostname.lastIndexOf('.', hostname.length - suffix.length - 2);

    return hostname.slice(pos + 1);
}

function get_public_suffix(hostname, rules, exceptions) {
    for (let pos=hostname.indexOf('.'); pos >= 0;
         hostname=hostname.slice(pos + 1), pos=hostname.indexOf('.')) {
        if (suffix_search(exceptions, hostname))
            return hostname.slice(pos + 1);

        if (suffix_search(rules, hostname))
            return hostname;

        if (suffix_search(rules, '*' + hostname.slice(pos)))
            return hostname;
    }
    return hostname;
}

function suffix_search(store, hostname) {
    let pos = hostname.lastIndexOf('.');
    let tld = hostname.slice(pos + 1);
    let remainder = hostname.slice(0, pos) || hostname;

    let substore = store[tld];
    if (!substore)
        return false;

    // If substore is a string, use indexOf().
    if (typeof substore === 'string')
        return substore.indexOf(' ' + remainder + ' ') >= 0;

    // If it is an array, use binary search.
    let l = remainder.length;
    let haystack = substore[l];
    if (!haystack)
        return false;

    let left = 0;
    let right = Math.floor(haystack.length / l + 0.5);
    let i, needle;
    while (left < right) {
        i = left + right >> 1;
        needle = haystack.substr(l * i, l);
        if (remainder < needle)
            right = i;
        else if (remainder > needle)
            left = i + 1;
        else
            return true;
    }
    return false;
}
