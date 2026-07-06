import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';
import { loadHtmlBody, stubCommonGlobals, stubWindowNavigation, fireDomReady, tick, resetDocumentListeners } from './_helpers';

let mock: BrowserMock;
let nav: ReturnType<typeof stubWindowNavigation>;

async function importPopup(): Promise<void> {
    await import('../../ts/popup/popup');
}

/** Registriert einen Background-Simulator, der auf get_guardian_status antwortet. */
function respondGuardian(response: unknown): void {
    mock.runtime.onMessage.addListener((_msg, _sender, sendResponse) => {
        sendResponse(response);
    });
}

function statusEl(): HTMLElement {
    return document.getElementById('security-status')!;
}
function text(sel: string): string {
    return statusEl().querySelector(sel)!.textContent ?? '';
}

describe('popup.ts', () => {
    beforeEach(() => {
        vi.resetModules();
        resetDocumentListeners();
        mock = installBrowserMock();
        loadHtmlBody('popup/popup.html');
        stubCommonGlobals();
        nav = stubWindowNavigation();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('updateSecurityStatus', () => {
        it('no response -> inactive / not initialized', async () => {
            await importPopup();
            fireDomReady(); // kein onMessage-Listener registriert -> sendMessage resolved undefined
            await tick();
            expect(statusEl().className).toBe('inactive');
            expect(text('.status-text')).toBe('guardianNotInitialized');
            expect(text('.status-detail')).toBe('guardianFailedToLoad');
        });

        it('enabled=false (opt-in disabled) -> inactive / guardianDisabled', async () => {
            await importPopup();
            respondGuardian({ enabled: false });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('inactive');
            expect(text('.status-text')).toBe('guardianDisabled');
            expect(text('.status-detail')).toBe('guardianEnableInOptions');
        });

        it('enabled but not initialized -> inactive / not initialized', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: false });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('inactive');
            expect(text('.status-text')).toBe('guardianNotInitialized');
        });

        it('ed25519 not supported -> warning', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, ed25519Supported: false });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('warning');
            expect(text('.status-text')).toBe('guardianEd25519NotSupported');
            expect(text('.status-detail')).toBe('Chrome 113+ required');
        });

        it('not on a protected host -> inactive / mitm protection hint', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, ed25519Supported: true, isProtected: false });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('inactive');
            expect(text('.status-text')).toBe('guardianMitmProtection');
            expect(text('.status-detail')).toBe('guardianVisitToActivate');
        });

        it('protected host, no status yet -> protected / hostname detail', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, ed25519Supported: true, isProtected: true, status: null, hostname: 'mail.aionda.com' });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('protected');
            expect(text('.status-text')).toBe('guardianProtected');
            expect(text('.status-detail')).toBe('mail.aionda.com');
        });

        it('status PROTECTED -> protected branch', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, hostname: 'x', status: { status: 'PROTECTED' } });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('protected');
        });

        it('VERIFIED singular vs plural', async () => {
            mock.i18n.messages.set('guardianResponseVerified', 'one verified');
            mock.i18n.messages.set('guardianResponsesVerified', 'many $1 verified');

            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: 'VERIFIED', verified: 1 } });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('verified');
            expect(text('.status-detail')).toBe('one verified');

            // Re-run mit verified: 3
            vi.resetModules();
            resetDocumentListeners();
            mock = installBrowserMock();
            mock.i18n.messages.set('guardianResponsesVerified', 'many $1 verified');
            loadHtmlBody('popup/popup.html');
            stubCommonGlobals();
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: 'VERIFIED', verified: 3 } });
            fireDomReady();
            await tick();
            expect(text('.status-detail')).toBe('many 3 verified');
        });

        it('VERIFIED_DEPRECATED / KEY_EXPIRED / COMPROMISED', async () => {
            for (const [state, cls, txt] of [
                ['VERIFIED_DEPRECATED', 'warning', 'guardianKeyExpiringSoon'],
                ['KEY_EXPIRED', 'danger', 'guardianKeyExpired'],
                ['COMPROMISED', 'danger', 'guardianMitmDetected'],
            ]) {
                vi.resetModules();
                resetDocumentListeners();
                mock = installBrowserMock();
                loadHtmlBody('popup/popup.html');
                stubCommonGlobals();
                await importPopup();
                respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: state, verified: 0 } });
                fireDomReady();
                await tick();
                expect(statusEl().className).toBe(cls);
                expect(text('.status-text')).toBe(txt);
            }
        });

        it('UNSIGNED singular vs plural', async () => {
            mock.i18n.messages.set('guardianMissingSignature', 'one missing');
            mock.i18n.messages.set('guardianMissingSignatures', '$1 missing');
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: 'UNSIGNED', verified: 0, unsigned: 1 } });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('danger');
            expect(text('.status-text')).toBe('guardianUnsigned');
            expect(text('.status-detail')).toBe('one missing');

            vi.resetModules();
            resetDocumentListeners();
            mock = installBrowserMock();
            mock.i18n.messages.set('guardianMissingSignatures', '$1 missing');
            loadHtmlBody('popup/popup.html');
            stubCommonGlobals();
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: 'UNSIGNED', verified: 0, unsigned: 2 } });
            fireDomReady();
            await tick();
            expect(text('.status-detail')).toBe('2 missing');
        });

        it('UNSIGNED with an undefined count falls back to 0 (plural branch)', async () => {
            mock.i18n.messages.set('guardianMissingSignatures', 'missing $1');
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: 'UNSIGNED', verified: 0 } });
            fireDomReady();
            await tick();
            expect(text('.status-detail')).toBe('missing 0');
        });

        it('unknown status -> inactive / guardianUnknown + raw status detail', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: 'WEIRD_STATE', verified: 0 } });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('inactive');
            expect(text('.status-text')).toBe('guardianUnknown');
            expect(text('.status-detail')).toBe('WEIRD_STATE');
        });

        it('sendMessage throwing -> error branch (❌ + message)', async () => {
            await importPopup();
            mock.runtime.onMessage.addListener(() => {
                throw new Error('boom');
            });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe('inactive');
            expect(text('.status-icon')).toBe('❌');
            expect(text('.status-text')).toBe('guardianError');
            expect(text('.status-detail')).toBe('boom');
        });
    });

    describe('openGuardianInfoWindow', () => {
        it('opens a centred popup window with status params (non-Firefox: no TLS params)', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: 'VERIFIED', verified: 1 }, isFirefox: false });
            fireDomReady();
            await tick();

            statusEl().dispatchEvent(new MouseEvent('click'));
            await tick();

            expect(mock.windows.created).toHaveLength(1);
            const created = mock.windows.created[0] as { url: string; type: string };
            expect(created.type).toBe('popup');
            expect(created.url).toContain('popup/guardian-info.html?');
            expect(created.url).toContain('status=verified');
            expect(created.url).not.toContain('tlsVerified');
        });

        it.each([
            ['danger', 'COMPROMISED'],
            ['warning', 'VERIFIED_DEPRECATED'],
            ['inactive', 'WEIRD'],
        ])('maps className "%s" onto the status query param', async (expectedClass, state) => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, status: { status: state, verified: 0 } });
            fireDomReady();
            await tick();
            expect(statusEl().className).toBe(expectedClass);

            statusEl().dispatchEvent(new MouseEvent('click'));
            await tick();
            const created = mock.windows.created[0] as { url: string };
            expect(created.url).toContain(`status=${expectedClass}`);
        });

        it('falls back to a literal label when the ed25519 i18n message is empty', async () => {
            mock.i18n.messages.set('guardianEd25519NotSupported', '');
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, ed25519Supported: false });
            fireDomReady();
            await tick();
            expect(text('.status-text')).toBe('Ed25519 not supported');
        });

        it('includes TLS params for Firefox', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, isFirefox: true, status: { status: 'VERIFIED', verified: 1, tlsVerified: true, tlsFingerprint: 'AA:BB' } });
            fireDomReady();
            await tick();

            statusEl().dispatchEvent(new MouseEvent('click'));
            await tick();

            const created = mock.windows.created[0] as { url: string };
            expect(created.url).toContain('tlsVerified=1');
            expect(created.url).toContain('tlsFingerprint=AA');
        });

        it('emits tlsVerified=0 for Firefox with unverified TLS', async () => {
            await importPopup();
            respondGuardian({ enabled: true, initialized: true, isProtected: true, isFirefox: true, status: { status: 'VERIFIED', verified: 1, tlsVerified: false, tlsFingerprint: '' } });
            fireDomReady();
            await tick();
            statusEl().dispatchEvent(new MouseEvent('click'));
            await tick();
            const created = mock.windows.created[0] as { url: string };
            expect(created.url).toContain('tlsVerified=0');
        });

        it('still opens the info window when the TLS status request fails', async () => {
            await importPopup();
            let calls = 0;
            mock.runtime.onMessage.addListener((_msg, _sender, sendResponse) => {
                calls++;
                if (calls === 1) {
                    sendResponse({ enabled: true, initialized: true, isProtected: true, status: { status: 'VERIFIED', verified: 1 } });
                    return;
                }
                throw new Error('tls request failed');
            });
            fireDomReady();
            await tick();
            statusEl().dispatchEvent(new MouseEvent('click'));
            await tick();
            expect(mock.windows.created).toHaveLength(1);
        });
    });

    describe('buttons', () => {
        it('address-manager button logs in via POST helper and closes the popup', async () => {
            await importPopup();
            document.getElementById('btn-address-manager')!.dispatchEvent(new MouseEvent('click'));
            await tick();
            // Zentraler Helper: POST-Login setzt Cookie + oeffnet den Manager-Tab
            expect((globalThis as Record<string, unknown>)['openAddressManagerAuthenticated']).toHaveBeenCalledTimes(1);
            expect(nav.close).toHaveBeenCalled();
        });

        it('address-manager error path shows the message and offers re-login', async () => {
            vi.useFakeTimers();
            ((globalThis as Record<string, unknown>)['openAddressManagerAuthenticated'] as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('please log in again'));
            await importPopup();
            document.getElementById('btn-address-manager')!.dispatchEvent(new MouseEvent('click'));
            await Promise.resolve();
            await Promise.resolve();
            const errorMsg = document.getElementById('error_msg')!;
            expect(errorMsg.style.display).toBe('block');
            expect(errorMsg.textContent).toContain('log in');
            // Re-login timer opens the options page after 2s.
            vi.advanceTimersByTime(2000);
            expect(mock.runtime.openOptionsPageCalls).toBe(1);
            vi.useRealTimers();
        });

        it('options button opens the options page', async () => {
            await importPopup();
            document.getElementById('btn-options')!.dispatchEvent(new MouseEvent('click'));
            await tick();
            expect(mock.runtime.openOptionsPageCalls).toBe(1);
            expect(nav.close).toHaveBeenCalled();
        });
    });
});
