import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';
import { loadHtmlBody, stubCommonGlobals, stubWindowNavigation, tick, resetDocumentListeners, fireDomReady, type CommonGlobals } from './_helpers';

let mock: BrowserMock;
let globals: CommonGlobals;
let nav: ReturnType<typeof stubWindowNavigation>;

async function importCreateAddress(): Promise<void> {
    await import('../../ts/create-address/create-address');
}

function $(id: string): HTMLElement {
    return document.getElementById(id)!;
}
function select(id: string): HTMLSelectElement {
    return document.getElementById(id) as HTMLSelectElement;
}
function optionValues(id: string): string[] {
    return Array.from(select(id).options).map((o) => o.value);
}

describe('create-address.ts', () => {
    beforeEach(async () => {
        vi.resetModules();
        resetDocumentListeners();
        mock = installBrowserMock();
        loadHtmlBody('create-address/create-address.html');
        globals = stubCommonGlobals();
        nav = stubWindowNavigation();
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, {}] })));
        vi.spyOn(Math, 'random').mockReturnValue(0); // deterministische Fake-Adresse
        // Echter Integrationspfad: mailfaker publiziert MailFaker auf globalThis.
        await import('../../ts/create-address/mailfaker');
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('initialisation', () => {
        it('fills the email dropdown with an "Internal Mailbox" option first, then the real emails', async () => {
            mock.storage.local.data.set('real_emails', ['r@e.com']);
            mock.storage.local.data.set('domains', ['d.com']);
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.sync.data.set('default_email', 'vault');
            mock.i18n.messages.set('optionsInternalMailbox', 'Internal Mailbox');

            await importCreateAddress();
            await tick();

            expect(select('email').options[0].value).toBe('vault');
            expect(optionValues('email')).toContain('r@e.com');
            expect(optionValues('domain')).toContain('d.com');
            expect((document.getElementById('disposable-name') as HTMLInputElement).value.length).toBeGreaterThan(0);
        });

        it('REGRESSION: legacy OBJECT-shaped real_emails/domains are read via Object.keys', async () => {
            mock.storage.local.data.set('real_emails', { 'a@x.com': 1, 'b@y.com': 1 });
            mock.storage.local.data.set('domains', { 'x.com': 1 });
            mock.storage.local.data.set('session_id', 'sess');

            await importCreateAddress();
            await tick();

            expect(optionValues('email')).toContain('a@x.com');
            expect(optionValues('email')).toContain('b@y.com');
            expect(optionValues('domain')).toContain('x.com');
        });

        it('applies stored default forwards/expire/domain/checkbox settings', async () => {
            mock.storage.local.data.set('real_emails', ['r@e.com']);
            mock.storage.local.data.set('domains', ['d.com']);
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.sync.data.set('default_domain', 'd.com');
            mock.storage.sync.data.set('default_forwards', '10');
            mock.storage.sync.data.set('default_expire', '30');
            mock.storage.sync.data.set('default_masq', false);

            await importCreateAddress();
            await tick();

            expect(select('forwards').value).toBe('10');
            expect(select('expire').value).toBe('30');
            expect((document.getElementById('masq') as HTMLInputElement).checked).toBe(false);
            expect(select('domain').value).toBe('d.com'); // default_domain vorselektiert
        });

        it('performs a classic login when no session_id is stored', async () => {
            mock.storage.local.data.set('real_emails', ['r@e.com']);
            mock.storage.local.data.set('domains', ['d.com']);
            mock.storage.sync.data.set('username', 'bob');
            mock.storage.sync.data.set('password', 'plainpw');
            globals.callAPI.mockResolvedValue({ session_id: 's2' });

            await importCreateAddress();
            await tick();

            expect(globals.callAPI).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'login' }));
            expect(mock.storage.local.data.get('session_id')).toBe('s2');
        });
    });

    describe('createAddress', () => {
        async function bootWithSession(): Promise<void> {
            mock.storage.local.data.set('real_emails', ['r@e.com']);
            mock.storage.local.data.set('domains', ['d.com']);
            mock.storage.local.data.set('session_id', 'sess');
            await importCreateAddress();
            await tick();
            // Background liefert [parent_url, parent_id, tab_id, frame_id].
            mock.runtime.onMessage.trigger(['https://www.shop.com/x', 7, 42, 0] as never);
            (document.getElementById('disposable-name') as HTMLInputElement).value = 'myaddr';
            select('domain').value = 'd.com';
            select('email').value = 'r@e.com';
        }

        it('creates the DEA and injects the address into the parent tab', async () => {
            globals.callAPI.mockResolvedValue({});
            await bootWithSession();

            document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(6);

            expect(globals.callAPI).toHaveBeenCalledWith(
                expect.objectContaining({ cmd: 'create_dea', session_id: 'sess' }),
                expect.objectContaining({ data: expect.objectContaining({ disposable_name: 'myaddr' }) }),
            );
            // Adresse an das Parent-Tab geschickt.
            expect(mock.tabs.sentMessages).toContainEqual({ tabId: 42, message: 'myaddr@d.com' });
            // Vorherige Adressen gespeichert (org_domain-Stub -> hostname).
            const prev = mock.storage.local.data.get('previous_addresses') as Record<string, unknown>;
            expect(prev['www.shop.com']).toBeDefined();
        });

        it('creates a vault DEA and appends to an existing website group', async () => {
            globals.callAPI.mockResolvedValue({});
            mock.storage.local.data.set('real_emails', ['r@e.com']);
            mock.storage.local.data.set('domains', ['d.com']);
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.local.data.set('previous_addresses', { 'www.shop.com': [['old@d.com', 'https://www.shop.com']] });
            await importCreateAddress();
            await tick();

            mock.runtime.onMessage.trigger(['https://www.shop.com/x', 7, 42, 0] as never);
            (document.getElementById('disposable-name') as HTMLInputElement).value = 'newaddr';
            select('domain').value = 'd.com';
            select('email').value = 'vault'; // isVault -> destination ""
            (document.getElementById('send') as HTMLInputElement).checked = false; // send aus -> website ""

            document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(6);

            const createCall = globals.callAPI.mock.calls.find((c) => (c[0] as { cmd?: string }).cmd === 'create_dea');
            expect((createCall![1] as { data: { vault: boolean; destination: string } }).data.vault).toBe(true);
            expect((createCall![1] as { data: { destination: string } }).data.destination).toBe('');
            const prev = mock.storage.local.data.get('previous_addresses') as Record<string, unknown[]>;
            expect(prev['www.shop.com']).toHaveLength(2); // an bestehende Gruppe angehängt
        });

        it('shows an error and re-enables the button when the API fails', async () => {
            globals.callAPI.mockRejectedValue(new Error('create failed'));
            await bootWithSession();

            document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(6);

            expect($('error_msg').style.display).toBe('block');
            expect($('progress').style.display).toBe('none');
            expect((document.getElementById('btn-create') as HTMLButtonElement).disabled).toBe(false);
            expect(mock.tabs.sentMessages).toHaveLength(0);
        });

        it('re-auths via PAT and retries when the session expired (error code 25)', async () => {
            // OPAQUE-Konto mit hinterlegtem PAT, aber serverseitig abgelaufener Session.
            mock.storage.sync.data.set('username', 'saf');
            mock.storage.sync.data.set('password', 'tmpat_stalesession');
            const patOpaqueLogin = vi.fn().mockResolvedValue({ session_id: 'fresh-sid' });
            (globalThis as Record<string, unknown>)['addonOpaqueClient'] = { patOpaqueLogin };

            // Erster create_dea-Call scheitert mit Code 25 (anonymer Fallback),
            // der zweite (nach Re-Auth) klappt.
            globals.callAPI
                .mockRejectedValueOnce(Object.assign(new Error('nicht registriert'), { errorCode: 25 }))
                .mockResolvedValueOnce({});
            await bootWithSession();

            document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(8);

            expect(patOpaqueLogin).toHaveBeenCalledWith('saf', 'tmpat_stalesession');
            expect(mock.storage.local.data.get('session_id')).toBe('fresh-sid');
            // Zweiter Versuch mit frischer Session
            const retry = globals.callAPI.mock.calls.filter((c) => (c[0] as { cmd?: string }).cmd === 'create_dea');
            expect(retry.at(-1)![0]).toMatchObject({ session_id: 'fresh-sid' });
            // Adresse landet trotz anfaenglichem Fehler im Parent-Tab.
            expect(mock.tabs.sentMessages).toContainEqual({ tabId: 42, message: 'myaddr@d.com' });

            delete (globalThis as Record<string, unknown>)['addonOpaqueClient'];
        });
    });

    describe('addressManager button', () => {
        it('opens the manager tab with the session and closes the window', async () => {
            mock.storage.local.data.set('session_id', 'sess-cm');
            mock.storage.local.data.set('real_emails', []);
            mock.storage.local.data.set('domains', []);
            await importCreateAddress();
            await tick();

            $('btn-address-manager').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect(mock.tabs.list).toHaveLength(1);
            expect(mock.tabs.list[0].url).toContain('cmd=manager');
            expect(mock.tabs.list[0].url).toContain('session_id=sess-cm');
            expect(nav.close).toHaveBeenCalled();
        });
    });

    describe('parent tab lifecycle', () => {
        it('closes its own window when the parent tab is removed', async () => {
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.local.data.set('real_emails', []);
            mock.storage.local.data.set('domains', []);
            await importCreateAddress();
            await tick();
            const removeSpy = vi.spyOn(mock.windows, 'remove');

            // Background registriert die Parent-IDs; tab_id = 55.
            mock.runtime.onMessage.trigger(['https://p.com', 1, 55, 0] as never);
            // Parent-Tab wird geschlossen.
            mock.tabs.onRemoved.trigger(55);
            await tick();

            expect(removeSpy).toHaveBeenCalled();
        });
    });

    describe('addressManager error path', () => {
        it('shows the error when the base URL cannot be resolved', async () => {
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.local.data.set('real_emails', []);
            mock.storage.local.data.set('domains', []);
            (globalThis as Record<string, unknown>)['getApiBaseUrl'] = vi.fn(async () => {
                throw new Error('offline');
            });
            await importCreateAddress();
            await tick();

            $('btn-address-manager').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect($('error_msg').style.display).toBe('block');
            expect(nav.close).not.toHaveBeenCalled();
        });
    });

    describe('auto-resize', () => {
        it('resizes and re-centres the popup window on DOMContentLoaded', async () => {
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.local.data.set('real_emails', []);
            mock.storage.local.data.set('domains', []);
            // fehlende API auf der Mock-Instanz ergänzen (Mock-Datei bleibt unangetastet).
            const updateSpy = vi.fn(async () => undefined);
            (mock.windows as unknown as { update: typeof updateSpy }).update = updateSpy;

            await importCreateAddress();
            await tick();
            fireDomReady();
            // Auto-Resize läuft in einem setTimeout(…, 100).
            await new Promise((resolve) => setTimeout(resolve, 150));

            expect(updateSpy).toHaveBeenCalled();
        });

        it('swallows resize failures (windows.update unavailable)', async () => {
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.local.data.set('real_emails', []);
            mock.storage.local.data.set('domains', []);
            // windows.update fehlt absichtlich -> Aufruf wirft -> catch greift.
            await importCreateAddress();
            await tick();
            fireDomReady();
            await new Promise((resolve) => setTimeout(resolve, 150));
            // Kein ungefangener Fehler; DOM steht weiterhin.
            expect(document.getElementById('btn-create')).not.toBeNull();
        });
    });

    describe('PAT account without a stored session', () => {
        it('reports an expired session via the address-manager button', async () => {
            mock.storage.sync.data.set('password', 'tmpat_expiredtoken');
            // kein session_id -> zweiter then wirft "Session expired".
            await importCreateAddress();
            // addressManager fängt die Rejection und zeigt den Fehler.
            $('btn-address-manager').dispatchEvent(new MouseEvent('click'));
            await tick();

            expect($('error_msg').style.display).toBe('block');
            expect(nav.close).not.toHaveBeenCalled();
        });
    });

    describe('close button', () => {
        it('closes the popup window', async () => {
            mock.storage.local.data.set('session_id', 'sess');
            mock.storage.local.data.set('real_emails', []);
            mock.storage.local.data.set('domains', []);
            await importCreateAddress();
            await tick();

            $('btn-close').dispatchEvent(new MouseEvent('click'));
            expect(nav.close).toHaveBeenCalled();
        });
    });
});
