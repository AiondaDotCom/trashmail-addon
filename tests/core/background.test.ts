/**
 * Unit tests for ts/background.ts (ported from background.js).
 *
 * background.ts has import-time side effects (context menu, listener
 * registration, auto-login chain), so every test does a fresh
 * vi.resetModules() + re-import. It talks to the rest of the extension purely
 * through globals: `callAPI` (from api.js) and `org_domain` (from
 * publicsuffixlist.js) — both stubbed on globalThis before import. importScripts
 * is undefined under jsdom, so the Chrome service-worker require() is skipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';

const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); await new Promise((resolve) => setTimeout(resolve, 0)); };

let mock: BrowserMock;
let callAPI: ReturnType<typeof vi.fn>;
let orgDomain: ReturnType<typeof vi.fn>;

/** Stubs fetch so background's public_suffix.json load resolves to [rules, exceptions]. */
function stubSuffixFetch(): void {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, {}] })));
}

function setGuardianGlobals(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
        (globalThis as Record<string, unknown>)[key] = value;
    }
}

function clearGuardianGlobals(): void {
    for (const key of ['guardianEnabled', 'guardianInitialized', 'publicKeys', 'tabSecurityStatus', 'isProtectedHost', 'ed25519Supported', 'ServiceWorkerGlobalScope']) {
        delete (globalThis as Record<string, unknown>)[key];
    }
}

async function importBackground(): Promise<void> {
    await import('../../ts/background');
    await flush();
}

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    clearGuardianGlobals();
    mock = installBrowserMock();
    callAPI = vi.fn(async () => ({}));
    orgDomain = vi.fn((url: URL) => url.hostname);
    (globalThis as Record<string, unknown>)['callAPI'] = callAPI;
    (globalThis as Record<string, unknown>)['org_domain'] = orgDomain;
    stubSuffixFetch();
});

afterEach(() => {
    clearGuardianGlobals();
});

describe('install / onInstalled', () => {
    it('opens the options page on install when no username is stored (Firefox onInstalled path)', async () => {
        await importBackground();
        mock.runtime.onInstalled.trigger();
        await flush();
        expect(mock.runtime.openOptionsPageCalls).toBe(1);
    });

    it('does NOT open the options page when a username is already stored', async () => {
        await mock.storage.sync.set({ username: 'alice' });
        await importBackground();
        mock.runtime.onInstalled.trigger();
        await flush();
        expect(mock.runtime.openOptionsPageCalls).toBe(0);
    });

    it('uses the service-worker install event when ServiceWorkerGlobalScope exists', async () => {
        setGuardianGlobals({ ServiceWorkerGlobalScope: class {} });
        await importBackground();
        const event = new Event('install') as Event & { waitUntil: (promise: Promise<unknown>) => void };
        let waited: Promise<unknown> | undefined;
        event.waitUntil = (promise: Promise<unknown>): void => { waited = promise; };
        self.dispatchEvent(event);
        await waited;
        await flush();
        expect(mock.runtime.openOptionsPageCalls).toBe(1);
    });
});

describe('context menu bootstrap', () => {
    it('creates the paste-email root entry on load', async () => {
        await importBackground();
        expect(mock.contextMenus.entries.some((entry) => entry['id'] === 'paste-email')).toBe(true);
    });

    it('calls importScripts in a service-worker context', async () => {
        const importScriptsMock = vi.fn();
        (globalThis as Record<string, unknown>)['importScripts'] = importScriptsMock;
        try {
            await importBackground();
            expect(importScriptsMock).toHaveBeenCalledWith('api.js', 'publicsuffixlist.js', 'guardian.js');
        } finally {
            delete (globalThis as Record<string, unknown>)['importScripts'];
        }
    });
});

describe('contextMenus.onClicked', () => {
    it('opens the create-address popup window for the paste-email item', async () => {
        await importBackground();
        mock.contextMenus.onClicked.trigger(
            { menuItemId: 'paste-email', frameId: 0 },
            { id: 7, url: 'https://site.test/', windowId: 1 },
        );
        await flush();
        expect(mock.windows.created.length).toBe(1);
        expect(mock.windows.created[0]!['type']).toBe('popup');
    });

    it('pastes a previous address by sending the menu id to the tab', async () => {
        await importBackground();
        mock.contextMenus.onClicked.trigger(
            { menuItemId: 'foo@trashmail.com', frameId: 3 },
            { id: 9, url: 'https://site.test/', windowId: 1 },
        );
        await flush();
        expect(mock.tabs.sentMessages).toContainEqual({ tabId: 9, message: 'foo@trashmail.com' });
    });

    it('forwards the parent context to the popup once its tab finishes loading', async () => {
        await importBackground();
        mock.contextMenus.onClicked.trigger(
            { menuItemId: 'paste-email', frameId: 0 },
            { id: 7, url: 'https://parent.test/', windowId: 3 },
        );
        await flush();
        // The mock's windows.create returns a fresh popup tab (id 100 in a fresh mock).
        const popupTabId = 100;
        // status !== "complete" → handler must ignore it.
        mock.tabs.onUpdated.trigger(popupTabId, { status: 'loading' }, { id: popupTabId, url: 'about:blank', windowId: 500 });
        expect(mock.tabs.sentMessages.some((m) => Array.isArray(m.message))).toBe(false);
        // status === "complete" → parent context is delivered.
        mock.tabs.onUpdated.trigger(popupTabId, { status: 'complete' }, { id: popupTabId, url: 'about:blank', windowId: 500 });
        await flush();
        expect(mock.tabs.sentMessages).toContainEqual({ tabId: popupTabId, message: ['https://parent.test/', 3, 7, 0] });
    });
});

describe('updateContextMenu (via tabs.onUpdated)', () => {
    it('adds a previous-address entry using organizational-domain suffix matching', async () => {
        await mock.storage.local.set({ previous_addresses: { 'example.com': [['addr@dev', 'https://example.com/']] } });
        mock.i18n.messages.set('menuPastePrevious', '$1');
        await importBackground();

        mock.tabs.onUpdated.trigger(1, {}, { id: 1, url: 'https://sub.example.com/', windowId: 1 });
        await flush();

        const entry = mock.contextMenus.entries.find((item) => item['id'] === 'addr@dev');
        expect(entry).toBeDefined();
        expect(entry!['title']).toBe('addr@dev (example.com)');
    });

    it('returns early when the tab has no url', async () => {
        await importBackground();
        const removeAll = vi.spyOn(mock.contextMenus, 'removeAll');
        await Promise.all(mock.tabs.onUpdated.trigger(1, {}, { id: 1, url: '', windowId: 1 }));
        await flush();
        expect(removeAll).not.toHaveBeenCalled();
    });

    it('returns early on an invalid tab url without throwing', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await importBackground();
        await Promise.all(mock.tabs.onUpdated.trigger(1, {}, { id: 1, url: 'http://[::bad url', windowId: 1 }));
        await flush();
        expect(errorSpy).toHaveBeenCalledWith('Error while parsing the URL:', 'http://[::bad url', expect.anything());
        errorSpy.mockRestore();
    });

    it('skips a repeated identical domain but re-runs after a storage.onChanged invalidation', async () => {
        await importBackground();
        const removeAll = vi.spyOn(mock.contextMenus, 'removeAll');

        await Promise.all(mock.tabs.onUpdated.trigger(1, {}, { id: 1, url: 'https://a.test/', windowId: 1 }));
        await flush();
        expect(removeAll).toHaveBeenCalledTimes(1);

        // Same domain again → early return, no rebuild.
        await Promise.all(mock.tabs.onUpdated.trigger(1, {}, { id: 1, url: 'https://a.test/x', windowId: 1 }));
        await flush();
        expect(removeAll).toHaveBeenCalledTimes(1);

        // Invalidate cached domain, then the same domain rebuilds again.
        mock.storage.onChanged.trigger({ previous_addresses: { newValue: {} } }, 'local');
        await Promise.all(mock.tabs.onUpdated.trigger(1, {}, { id: 1, url: 'https://a.test/', windowId: 1 }));
        await flush();
        expect(removeAll).toHaveBeenCalledTimes(2);
    });

    it('updates the menu when the active tab changes (onActivated)', async () => {
        mock.tabs.list.push({ id: 5, url: 'https://activated.test/', windowId: 1, active: true });
        await importBackground();
        const removeAll = vi.spyOn(mock.contextMenus, 'removeAll');
        mock.tabs.onActivated.trigger({ tabId: 5 });
        await flush();
        expect(removeAll).toHaveBeenCalled();
    });
});

describe('auto-login chain', () => {
    it('skips silently when no credentials are stored', async () => {
        await importBackground();
        expect(callAPI).not.toHaveBeenCalled();
        expect(mock.storage.local.data.has('previous_addresses')).toBe(false);
    });

    it('classic login stores domains (array), real emails and previous addresses', async () => {
        await mock.storage.sync.set({ username: 'bob', password: 'plainpass' });
        callAPI.mockImplementation(async (data: { cmd: string }) => {
            if (data.cmd === 'login') {
                return { session_id: 's1', domain_name_list: ['a.com', 'b.com'], real_email_list: { 'me@x.com': 1 } };
            }
            return [{ website: 'https://shop.example.com', disposable_name: 'foo', disposable_domain: 'trashmail.com' }];
        });
        await importBackground();

        expect(mock.storage.local.data.get('domains')).toEqual(['a.com', 'b.com']);
        expect(mock.storage.local.data.get('real_emails')).toEqual(['me@x.com']);
        expect(mock.storage.local.data.get('previous_addresses')).toEqual({
            'shop.example.com': [['foo@trashmail.com', 'https://shop.example.com']],
        });
        expect(orgDomain).toHaveBeenCalled();
    });

    it('REGRESSION: domain_name_list as an OBJECT is reduced to its keys (Array.isArray guard)', async () => {
        await mock.storage.sync.set({ username: 'bob', password: 'plainpass' });
        callAPI.mockImplementation(async (data: { cmd: string }) => {
            if (data.cmd === 'login') {
                return { session_id: 's1', domain_name_list: { 'a.com': 1, 'b.com': 1 }, real_email_list: { 'me@x.com': 1 } };
            }
            return [];
        });
        await importBackground();
        expect(mock.storage.local.data.get('domains')).toEqual(['a.com', 'b.com']);
    });

    it('survives a failing public_suffix.json load (rejected → caught, no addresses stored)', async () => {
        await mock.storage.sync.set({ username: 'bob', password: 'plainpass' });
        callAPI.mockImplementation(async (data: { cmd: string }) => {
            if (data.cmd === 'login') {
                return { session_id: 's1', domain_name_list: ['a.com'], real_email_list: { 'me@x.com': 1 } };
            }
            return [{ website: 'https://shop.example.com', disposable_name: 'foo', disposable_domain: 'trashmail.com' }];
        });
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [{}, {}] })));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await importBackground();
        // The suffix load rejects with a clear Error → propagates through the chain →
        // the outer .catch logs it and aborts the update, so no previous_addresses are
        // written (no confusing "undefined is not iterable" detour anymore).
        expect(mock.storage.local.data.has('previous_addresses')).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            '[TrashMail] Auto-login failed:',
            'Public Suffix List konnte nicht geladen werden',
        );
        warnSpy.mockRestore();
    });

    it('PAT account uses the stored session_id and calls read_dea only', async () => {
        await mock.storage.sync.set({ username: 'bob', password: 'tmpat_secrettoken' });
        await mock.storage.local.set({ session_id: 'stored-sess' });
        callAPI.mockResolvedValue([]); // read_dea returns an (empty) address list
        await importBackground();

        expect(callAPI).toHaveBeenCalledTimes(1);
        expect(callAPI).toHaveBeenCalledWith({ cmd: 'read_dea', session_id: 'stored-sess' });
    });
});

describe('runtime message: get_guardian_status', () => {
    it('reports guardian state and the active tab', async () => {
        mock.tabs.list.push({ id: 42, url: 'https://protected.test/page', windowId: 1, active: true });
        setGuardianGlobals({
            guardianEnabled: true,
            guardianInitialized: true,
            publicKeys: new Map([['k1', {}], ['k2', {}]]),
            tabSecurityStatus: new Map([[42, { status: 'secure', verified: 1, unsigned: 0, failed: [] }]]),
            isProtectedHost: (hostname: string) => hostname === 'protected.test',
            ed25519Supported: true,
        });
        await importBackground();

        const response = await mock.runtime.sendMessage({ action: 'get_guardian_status' }) as Record<string, unknown>;
        expect(response['enabled']).toBe(true);
        expect(response['initialized']).toBe(true);
        expect(response['keysLoaded']).toBe(2);
        expect(response['isProtected']).toBe(true);
        expect(response['tabId']).toBe(42);
        expect(response['hostname']).toBe('protected.test');
        expect((response['status'] as { status: string }).status).toBe('secure');
    });

    it('reports safe defaults with an active tab when guardian.js has not loaded its globals', async () => {
        mock.tabs.list.push({ id: 8, url: 'https://plain.test/', windowId: 1, active: true });
        // No guardian globals set at all (cleared in beforeEach).
        await importBackground();
        const response = await mock.runtime.sendMessage({ action: 'get_guardian_status' }) as Record<string, unknown>;
        expect(response['enabled']).toBe(false);
        expect(response['initialized']).toBe(false);
        expect(response['keysLoaded']).toBe(0);
        expect(response['isProtected']).toBe(false);
        expect(response['status']).toBeNull();
        expect(response['tabId']).toBe(8);
        expect(response['hostname']).toBe('plain.test');
    });

    it('flags Firefox limited mode via webRequest.getSecurityInfo', async () => {
        mock.tabs.list.push({ id: 8, url: 'https://plain.test/', windowId: 1, active: true });
        mock.webRequest.getSecurityInfo = vi.fn(async () => ({}));
        await importBackground();
        const response = await mock.runtime.sendMessage({ action: 'get_guardian_status' }) as Record<string, unknown>;
        expect(response['isFirefox']).toBe(true);
        expect(response['limitedMode']).toBe(false);
    });

    it('returns a no-tab fallback object when no active tab exists', async () => {
        setGuardianGlobals({ guardianEnabled: false, guardianInitialized: true, publicKeys: new Map() });
        await importBackground();
        const response = await mock.runtime.sendMessage({ action: 'get_guardian_status' }) as Record<string, unknown>;
        expect(response['enabled']).toBe(false);
        expect(response['initialized']).toBe(true);
        expect(response['isProtected']).toBe(false);
        expect(response['status']).toBeNull();
    });
});

describe('runtime message: update_menu', () => {
    it('updates the menu for an explicit tabId and returns success', async () => {
        mock.tabs.list.push({ id: 11, url: 'https://explicit.test/', windowId: 1, active: false });
        await importBackground();
        const response = await mock.runtime.sendMessage({ action: 'update_menu', tabId: 11 });
        expect(response).toEqual({ status: 'success' });
    });

    it('updates the menu for the active tab when no tabId is given', async () => {
        mock.tabs.list.push({ id: 12, url: 'https://active.test/', windowId: 1, active: true });
        await importBackground();
        const response = await mock.runtime.sendMessage({ action: 'update_menu' });
        expect(response).toEqual({ status: 'success' });
    });

    it('returns an error when there is no active tab', async () => {
        await importBackground();
        const response = await mock.runtime.sendMessage({ action: 'update_menu' });
        expect(response).toEqual({ status: 'error', message: 'No active tab available.' });
    });

    it('ignores unknown message actions (listener returns false)', async () => {
        await importBackground();
        const response = await mock.runtime.sendMessage({ action: 'totally_unknown' });
        expect(response).toBeUndefined();
    });
});
