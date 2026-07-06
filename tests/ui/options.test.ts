import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';
import { loadHtmlBody, stubCommonGlobals, stubWindowNavigation, fireDomReady, tick, resetDocumentListeners, type CommonGlobals } from './_helpers';

let mock: BrowserMock;
let nav: ReturnType<typeof stubWindowNavigation>;
let globals: CommonGlobals;

async function importOptions(): Promise<void> {
    await import('../../ts/options/options');
}

function $(id: string): HTMLElement {
    return document.getElementById(id)!;
}
function input(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
}
function select(id: string): HTMLSelectElement {
    return document.getElementById(id) as HTMLSelectElement;
}

describe('options.ts', () => {
    beforeEach(() => {
        vi.resetModules();
        resetDocumentListeners();
        mock = installBrowserMock();
        loadHtmlBody('options/options.html');
        globals = stubCommonGlobals();
        nav = stubWindowNavigation();
        sessionStorage.clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('restoreOptions', () => {
        it('fills selects + checkboxes and enables the form when logged in', async () => {
            mock.storage.sync.data.set('username', 'alice');
            mock.storage.sync.data.set('default_email', 'a@b.com');
            mock.storage.sync.data.set('default_domain', 'x.com');
            mock.storage.sync.data.set('default_forwards', '10');
            mock.storage.sync.data.set('default_expire', '30');
            mock.storage.sync.data.set('guardian_enabled', true);
            mock.storage.local.data.set('real_emails', ['a@b.com']);
            mock.storage.local.data.set('domains', ['x.com']);

            await importOptions();
            fireDomReady();
            await tick();

            expect($('username').textContent).toBe('alice');
            expect(select('default_email').value).toBe('a@b.com');
            expect(select('default_domain').value).toBe('x.com');
            expect(select('default_forwards').value).toBe('10');
            expect(select('default_expire').value).toBe('30');
            expect(input('guardian_enabled').checked).toBe(true);
            // logged in -> fields enabled
            expect(select('default_email').disabled).toBe(false);
        });

        it('keeps fields disabled and shows the localized logged-out state without a username', async () => {
            mock.storage.local.data.set('real_emails', ['a@b.com']);
            mock.i18n.messages.set('optionsNotLoggedIn', 'Nicht angemeldet');
            mock.i18n.messages.set('optionsLoginButton', 'Anmelden');
            await importOptions();
            fireDomReady();
            await tick();
            expect($('username').textContent).toBe('Nicht angemeldet');
            // Ohne Login heisst der Button "Anmelden", nicht "Benutzer wechseln"
            expect($('btn-switch-login').textContent).toBe('Anmelden');
            expect(select('default_email').disabled).toBe(true);
        });

        it('shows "Benutzer wechseln" on the switch button when logged in', async () => {
            mock.storage.sync.data.set('username', 'bob');
            mock.i18n.messages.set('optionsSwitchLoginButton', 'Benutzer wechseln');
            await importOptions();
            fireDomReady();
            await tick();
            expect($('username').textContent).toBe('bob');
            expect($('btn-switch-login').textContent).toBe('Benutzer wechseln');
        });

        it('REGRESSION: local.domains stored as an OBJECT (legacy) does not throw and yields options', async () => {
            mock.storage.sync.data.set('username', 'bob');
            mock.storage.local.data.set('domains', { 'legacy.com': 1, 'old.net': 1 });
            mock.storage.local.data.set('real_emails', { 'r@e.com': 1 });

            await importOptions();
            fireDomReady();
            await tick();

            const domainValues = Array.from(select('default_domain').options).map((o) => o.value);
            expect(domainValues).toContain('legacy.com');
            expect(domainValues).toContain('old.net');
            const emailValues = Array.from(select('default_email').options).map((o) => o.value);
            expect(emailValues).toContain('r@e.com');
        });
    });

    describe('saveOptions', () => {
        it('persists selected values and coerces missing checkboxes to false', async () => {
            mock.storage.local.data.set('real_emails', ['a@b.com']);
            mock.storage.local.data.set('domains', ['x.com']);
            await importOptions();
            fireDomReady();
            await tick();

            // Enable and set field states.
            document.querySelectorAll('#options-default input, #options-default select, #guardian_enabled')
                .forEach((el) => { (el as HTMLInputElement).disabled = false; });
            select('default_email').value = 'a@b.com';
            select('default_domain').value = 'x.com';
            input('default_masq').checked = false;
            input('default_notify').checked = false;
            input('default_send').checked = false;
            input('guardian_enabled').checked = false;

            document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();

            // default_challenge existiert nicht mehr (CAPTCHA-Option entfernt)
            expect(mock.storage.sync.data.has('default_challenge')).toBe(false);
            expect(mock.storage.sync.data.get('default_masq')).toBe(false);
            expect(mock.storage.sync.data.get('guardian_enabled')).toBe(false);
            expect(mock.storage.sync.data.get('default_email')).toBe('a@b.com');
            expect($('saved_msg').style.display).toBe('block');
            // Undo snapshot stored in sessionStorage.
            expect(sessionStorage.getItem('undo')).not.toBeNull();
        });
    });

    describe('saveOptions without sessionStorage', () => {
        it('still saves and removes the undo link when sessionStorage is unavailable', async () => {
            mock.storage.local.data.set('real_emails', ['a@b.com']);
            await importOptions();
            fireDomReady();
            await tick();
            // Simuliert einen Browser ohne sessionStorage (Undo nicht möglich).
            vi.stubGlobal('sessionStorage', null);

            document.querySelectorAll('#options-default input, #options-default select, #guardian_enabled')
                .forEach((el) => { (el as HTMLInputElement).disabled = false; });
            document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();

            expect($('saved_msg').style.display).toBe('block');
            expect(document.getElementById('undo')).toBeNull(); // Undo-Link entfernt
            vi.unstubAllGlobals();
        });
    });

    describe('undo / reset', () => {
        it('undo restores the previous sync snapshot and reloads', async () => {
            await importOptions();
            fireDomReady();
            await tick();
            sessionStorage.setItem('undo', JSON.stringify({ username: 'restored', default_email: 'r@e.com' }));

            $('undo').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect(mock.storage.sync.data.get('username')).toBe('restored');
            expect(mock.storage.sync.data.get('default_email')).toBe('r@e.com');
            expect(nav.reload).toHaveBeenCalled();
        });

        it('reset removes the default_* keys, flags a reset and reloads', async () => {
            mock.storage.sync.data.set('default_email', 'a@b.com');
            mock.storage.sync.data.set('default_forwards', '10');
            mock.storage.sync.data.set('username', 'keep');
            await importOptions();
            fireDomReady();
            await tick();

            $('btn-reset').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect(mock.storage.sync.data.has('default_email')).toBe(false);
            expect(mock.storage.sync.data.has('default_forwards')).toBe(false);
            expect(mock.storage.sync.data.get('username')).toBe('keep'); // not a reset key
            expect(sessionStorage.getItem('reset')).toBe('true');
            expect(nav.reload).toHaveBeenCalled();
        });

        it('restoreOptions shows the saved message after a reset flag', async () => {
            sessionStorage.setItem('reset', 'true');
            await importOptions();
            fireDomReady();
            await tick();
            expect($('saved_msg').style.display).toBe('block');
            expect(sessionStorage.getItem('reset')).toBeNull(); // consumed
        });
    });

    describe('switch login', () => {
        it('opens the welcome popup and reloads once it is closed', async () => {
            await importOptions();
            $('btn-switch-login').dispatchEvent(new MouseEvent('click'));
            await tick();
            expect(mock.windows.created).toHaveLength(1);
            expect((mock.windows.created[0] as { url: string }).url).toContain('options/welcome.html');

            // Closing the welcome window triggers a reload.
            await mock.windows.remove(500);
            expect(nav.reload).toHaveBeenCalled();
        });
    });

    describe('addressManager', () => {
        it('opens the manager via authenticated POST login (no session_id in the URL)', async () => {
            await importOptions();

            $('btn-address-manager').dispatchEvent(new MouseEvent('click'));
            await tick();

            // Der zentrale Helper macht den POST-Login (Cookie) und oeffnet den Tab
            expect(globals.openAddressManagerAuthenticated).toHaveBeenCalledTimes(1);
            expect($('progress').style.display).toBe('none');
            expect($('error_msg').style.display).not.toBe('block');
        });

        it('shows the error when the authenticated login fails', async () => {
            globals.openAddressManagerAuthenticated.mockRejectedValue(new Error('Your session has expired.'));
            await importOptions();

            $('btn-address-manager').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect($('error_msg').style.display).toBe('block');
            expect($('error_msg').textContent).toContain('expired');
            expect($('progress').style.display).toBe('none');
        });
    });

    describe('debug panel', () => {
        async function revealDebugPanel(): Promise<void> {
            await importOptions();
            fireDomReady();
            await tick();
            const title = document.querySelector('h1')!;
            for (let i = 0; i < 5; i++) {
                title.dispatchEvent(new MouseEvent('click'));
            }
            await tick();
        }

        it('reveals after 5 title clicks', async () => {
            await revealDebugPanel();
            expect($('debug-panel').style.display).toBe('block');
        });

        it('save writes debugApiUrl + updates live API_BASE_URL and status', async () => {
            await revealDebugPanel();
            select('debug_api_url').value = 'https://dev.mail.aionda.com';
            $('btn-save-debug').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect(mock.storage.local.data.get('debugApiUrl')).toBe('https://dev.mail.aionda.com');
            expect(globals.getApiBase()).toBe('https://dev.mail.aionda.com');
            expect(nav.alert).toHaveBeenCalled();
            expect($('debug-status').textContent).toContain('Debug mode active');
        });

        it('reset clears the debug override and restores the default URL', async () => {
            mock.storage.local.data.set('debugApiUrl', 'https://dev.mail.aionda.com');
            await revealDebugPanel();
            $('btn-reset-debug').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect(mock.storage.local.data.has('debugApiUrl')).toBe(false);
            expect(globals.getApiBase()).toBe('https://mail.aionda.com');
            expect(select('debug_api_url').value).toBe('https://mail.aionda.com');
            expect($('debug-status').textContent).toContain('production server');
        });
    });
});
