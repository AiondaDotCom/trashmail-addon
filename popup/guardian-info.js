"use strict";

// Compatibility layer
if (typeof browser === "undefined") {
    var browser = chrome;
}

document.addEventListener("DOMContentLoaded", function() {
    // Get status from URL parameters
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') || 'unknown';
    const text = params.get('text') || '';
    const detail = params.get('detail') || '';

    // Update status display
    const statusBox = document.getElementById('status-box');
    const statusValue = document.getElementById('status-value');
    const statusIcon = document.getElementById('status-icon');

    statusValue.textContent = text + (detail ? ' - ' + detail : '');

    // Set status class and icon
    switch(status) {
        case 'verified':
            statusBox.className = 'status-box verified';
            statusIcon.textContent = '\u2705';
            break;
        case 'protected':
            statusBox.className = 'status-box protected';
            statusIcon.textContent = '\uD83D\uDEE1\uFE0F';
            break;
        case 'warning':
            statusBox.className = 'status-box warning';
            statusIcon.textContent = '\u26A0\uFE0F';
            break;
        case 'danger':
        case 'unsigned':
            statusBox.className = 'status-box danger';
            statusIcon.textContent = '\u26A0\uFE0F';
            break;
        default:
            statusBox.className = 'status-box';
            statusIcon.textContent = '\uD83D\uDD12';
    }

    // Close button
    document.getElementById('btn-close').addEventListener('click', function() {
        window.close();
    });
});
