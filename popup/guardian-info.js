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
    const tlsVerified = params.get('tlsVerified');
    const tlsFingerprint = params.get('tlsFingerprint') || '';

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

    // TLS Certificate Status (Firefox only)
    if (tlsVerified) {
        const tlsStatusBox = document.getElementById('tls-status-box');
        const tlsStatusValue = document.getElementById('tls-status-value');
        const tlsFingerprintEl = document.getElementById('tls-fingerprint');

        tlsStatusBox.style.display = 'block';

        if (tlsVerified === '1') {
            tlsStatusBox.className = 'status-box verified';
            tlsStatusValue.textContent = browser.i18n.getMessage('guardianTlsVerified') + ' ✓';
            if (tlsFingerprint) {
                tlsFingerprintEl.textContent = tlsFingerprint;
            }
        } else {
            tlsStatusBox.className = 'status-box inactive';
            tlsStatusValue.textContent = browser.i18n.getMessage('guardianTlsNotVerified');
        }
    }

    // Close button
    document.getElementById('btn-close').addEventListener('click', function() {
        window.close();
    });

    // Auto-resize window to fit content
    setTimeout(async function() {
        try {
            const container = document.querySelector('.container');
            const contentHeight = container.offsetHeight + 32; // 32px = body padding
            const contentWidth = container.offsetWidth + 32;

            const currentWindow = await browser.windows.getCurrent();

            // Calculate the difference between window size and viewport
            const chromeHeight = currentWindow.height - window.innerHeight;
            const chromeWidth = currentWindow.width - window.innerWidth;

            // New window size = content + browser chrome
            const newHeight = Math.min(contentHeight + chromeHeight, screen.availHeight - 100);
            const newWidth = Math.min(contentWidth + chromeWidth, 500);

            // Center on screen
            const left = Math.round((screen.width - newWidth) / 2);
            const top = Math.round((screen.height - newHeight) / 2);

            await browser.windows.update(currentWindow.id, {
                width: newWidth,
                height: newHeight,
                left: left,
                top: top
            });
        } catch (err) {
            console.log('[Guardian Info] Auto-resize failed:', err);
        }
    }, 50); // Small delay to ensure content is rendered
});
