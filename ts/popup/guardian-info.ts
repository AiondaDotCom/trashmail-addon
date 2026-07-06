// Compatibility layer
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

document.addEventListener("DOMContentLoaded", () => {
    // Get status from URL parameters
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') || 'unknown';
    const text = params.get('text') || '';
    const detail = params.get('detail') || '';
    const tlsVerified = params.get('tlsVerified');
    const tlsFingerprint = params.get('tlsFingerprint') || '';

    // Update status display
    const statusBox = document.getElementById('status-box') as HTMLElement;
    const statusValue = document.getElementById('status-value') as HTMLElement;
    const statusIcon = document.getElementById('status-icon') as HTMLElement;

    statusValue.textContent = `${text}${detail ? ` - ${detail}` : ''}`;

    // Set status class and icon
    switch(status) {
        case 'verified':
            statusBox.className = 'status-box verified';
            statusIcon.textContent = '✅';
            break;
        case 'protected':
            statusBox.className = 'status-box protected';
            statusIcon.textContent = '🛡️';
            break;
        case 'warning':
            statusBox.className = 'status-box warning';
            statusIcon.textContent = '⚠️';
            break;
        case 'danger':
        case 'unsigned':
            statusBox.className = 'status-box danger';
            statusIcon.textContent = '⚠️';
            break;
        default:
            statusBox.className = 'status-box';
            statusIcon.textContent = '🔒';
    }

    // TLS Certificate Status (Firefox only)
    if (tlsVerified) {
        const tlsStatusBox = document.getElementById('tls-status-box') as HTMLElement;
        const tlsStatusValue = document.getElementById('tls-status-value') as HTMLElement;
        const tlsFingerprintEl = document.getElementById('tls-fingerprint') as HTMLElement;

        tlsStatusBox.style.display = 'block';

        if (tlsVerified === '1') {
            tlsStatusBox.className = 'status-box verified';
            tlsStatusValue.textContent = `${browser.i18n.getMessage('guardianTlsVerified')} ✓`;
            if (tlsFingerprint) {
                tlsFingerprintEl.textContent = tlsFingerprint;
            }
        } else {
            tlsStatusBox.className = 'status-box inactive';
            tlsStatusValue.textContent = browser.i18n.getMessage('guardianTlsNotVerified');
        }
    }

    // Close button
    (document.getElementById('btn-close') as HTMLElement).addEventListener('click', () => {
        window.close();
    });

    // Auto-resize window to fit content
    setTimeout(async () => {
        try {
            const container = document.querySelector('.container') as HTMLElement;
            const contentHeight = container.offsetHeight + 32; // 32px = body padding
            const contentWidth = container.offsetWidth + 32;

            const currentWindow = await browser.windows.getCurrent();

            // Calculate the difference between window size and viewport
            const chromeHeight = (currentWindow.height as number) - window.innerHeight;
            const chromeWidth = (currentWindow.width as number) - window.innerWidth;

            // New window size = content + browser chrome
            const newHeight = Math.min(contentHeight + chromeHeight, screen.availHeight - 100);
            const newWidth = Math.min(contentWidth + chromeWidth, 500);

            // Center on screen
            const left = Math.round((screen.width - newWidth) / 2);
            const top = Math.round((screen.height - newHeight) / 2);

            await browser.windows.update(currentWindow.id as number, {
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

export {};
