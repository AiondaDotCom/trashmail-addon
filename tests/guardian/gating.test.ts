import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserMock } from '../helpers/browser-mock';
import { installBrowserMock } from '../helpers/browser-mock';
import { generateSigningKey, makeFetch, publicKeyResponse, tick, waitFor } from '../helpers/guardian-fixtures';

function selfState(): Record<string, unknown> {
    return globalThis as unknown as Record<string, unknown>;
}

let mock: BrowserMock;

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mock = installBrowserMock();
});

describe('guardian opt-in gating', () => {
    it('bleibt deaktiviert wenn guardian_enabled nicht gesetzt ist', async () => {
        await import('../../ts/guardian');
        await tick();

        expect(selfState()['guardianEnabled']).toBe(false);
        expect(mock.webRequest.onResponseStarted.listeners.length).toBe(0);
        expect(mock.webRequest.onHeadersReceived.listeners.length).toBe(0);
    });

    it('initialisiert und registriert Listener wenn guardian_enabled vor Import gesetzt ist', async () => {
        const key = await generateSigningKey();
        vi.stubGlobal('fetch', makeFetch([
            { test: (u) => u.includes('public_key.json'), response: () => publicKeyResponse(key.keyFile) },
        ]));
        mock.storage.sync.data.set('guardian_enabled', '1');

        await import('../../ts/guardian');
        await waitFor(() => mock.webRequest.onResponseStarted.listeners.length > 0);

        expect(selfState()['guardianEnabled']).toBe(true);
        expect(selfState()['guardianInitialized']).toBe(true);
        const keys = selfState()['publicKeys'] as Map<string, unknown>;
        expect(keys.size).toBe(1);
        // onResponseStarted-Listener bekam urls-Filter + ["responseHeaders"]
        expect(mock.webRequest.onResponseStarted.addListenerArgs[0]?.[1]).toEqual(['responseHeaders']);
    });

    it('markiert initialisiert aber registriert keinen Listener wenn public_key.json fehlt', async () => {
        vi.stubGlobal('fetch', makeFetch([
            { test: (u) => u.includes('public_key.json'), response: () => new Response('nope', { status: 404 }) },
        ]));
        mock.storage.sync.data.set('guardian_enabled', '1');

        await import('../../ts/guardian');
        await waitFor(() => selfState()['guardianInitialized'] === true);

        expect(selfState()['guardianEnabled']).toBe(true);
        expect(mock.webRequest.onResponseStarted.listeners.length).toBe(0);
    });

    it('Laufzeit-Toggle: einschalten via storage.onChanged startet Guardian', async () => {
        const key = await generateSigningKey();
        vi.stubGlobal('fetch', makeFetch([
            { test: (u) => u.includes('public_key.json'), response: () => publicKeyResponse(key.keyFile) },
        ]));

        await import('../../ts/guardian');
        await tick();
        expect(selfState()['guardianEnabled']).toBe(false);

        await mock.storage.sync.set({ guardian_enabled: true });
        await waitFor(() => mock.webRequest.onResponseStarted.listeners.length > 0);

        expect(selfState()['guardianEnabled']).toBe(true);
    });

    it('Laufzeit-Toggle: ausschalten löscht alle Guardian-Badges', async () => {
        const key = await generateSigningKey();
        vi.stubGlobal('fetch', makeFetch([
            { test: (u) => u.includes('public_key.json'), response: () => publicKeyResponse(key.keyFile) },
        ]));
        mock.storage.sync.data.set('guardian_enabled', '1');
        mock.tabs.list.push({ id: 1, url: 'https://mail.aionda.com/', windowId: 1, active: true });
        mock.tabs.list.push({ id: 2, url: 'https://trashmail.com/', windowId: 1, active: false });

        await import('../../ts/guardian');
        await waitFor(() => mock.webRequest.onResponseStarted.listeners.length > 0);

        // Ein Badge setzen, damit das Clearing sichtbar ist
        mock.action.badges.set(1, { text: '✓', color: '#10b981' });

        await mock.storage.sync.set({ guardian_enabled: false });
        await tick();

        expect(selfState()['guardianEnabled']).toBe(false);
        expect(mock.action.badges.get(1)?.text).toBe('');
        expect(mock.action.badges.get(2)?.text).toBe('');
    });
});
