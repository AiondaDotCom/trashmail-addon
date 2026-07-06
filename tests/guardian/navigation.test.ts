import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserMock } from '../helpers/browser-mock';
import { installBrowserMock } from '../helpers/browser-mock';
import { bootGuardian, makeResponseDetails, type BootResult } from '../helpers/guardian-boot';
import { generateSigningKey, tick, waitFor, type FetchRoute } from '../helpers/guardian-fixtures';

interface Status { status: string; verified: number; unsigned: number; }

function statusFor(tabId: number): Status | undefined {
    return (globalThis as unknown as { tabSecurityStatus: Map<number, Status> }).tabSecurityStatus.get(tabId);
}

const SIGNED_HEADERS = {
    'x-aionda-signature': 'c2ln',
    'x-aionda-timestamp': '1700000000',
    'x-aionda-key-id': 'test-key',
};

const signedPingRoute: FetchRoute = {
    test: (u) => u.includes('cmd=ping'),
    response: () => new Response('{}', {
        headers: {
            'x-aionda-signature': 'c2ln',
            'x-aionda-timestamp': '1700000000',
            'x-aionda-key-id': 'test-key',
        },
    }),
};

const unsignedPingRoute: FetchRoute = {
    test: (u) => u.includes('cmd=ping'),
    response: () => new Response('{}', {}),
};

let mock: BrowserMock;

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mock = installBrowserMock();
});

async function boot(routes: FetchRoute[] = []): Promise<BootResult> {
    const keyFile = (await generateSigningKey()).keyFile;
    return bootGuardian(mock, keyFile, routes);
}

describe('updateBadgeForTab & pingForVerification', () => {
    it('setzt PROTECTED und verifiziert via Ping (signiert) auf gecachter Seite', async () => {
        await boot([signedPingRoute]);
        mock.tabs.list.push({ id: 20, url: 'https://mail.aionda.com/', windowId: 1, active: true });

        await Promise.all(mock.tabs.onActivated.trigger({ tabId: 20 }));
        await waitFor(() => statusFor(20)?.status === 'VERIFIED');

        expect(mock.action.badges.get(20)).toEqual({ text: '✓', color: '#10b981' });
    });

    it('setzt UNSIGNED wenn der Ping keine Signatur liefert', async () => {
        await boot([unsignedPingRoute]);
        mock.tabs.list.push({ id: 21, url: 'https://trashmail.com/', windowId: 1, active: true });

        await Promise.all(mock.tabs.onActivated.trigger({ tabId: 21 }));
        await waitFor(() => statusFor(21)?.status === 'UNSIGNED');

        expect(mock.action.badges.get(21)?.text).toBe('!');
    });

    it('entfernt das Badge auf nicht-geschützten Hosts', async () => {
        await boot();
        mock.tabs.list.push({ id: 22, url: 'https://example.com/', windowId: 1, active: true });

        await Promise.all(mock.tabs.onActivated.trigger({ tabId: 22 }));
        await tick();

        expect(mock.action.badges.get(22)?.text).toBe('');
        expect(statusFor(22)).toBeUndefined();
    });

    it('fängt Fehler ab wenn der aktivierte Tab nicht mehr existiert', async () => {
        await boot();
        // tabId nicht in der Liste -> tabs.get wirft -> Handler-catch
        await expect(Promise.all(mock.tabs.onActivated.trigger({ tabId: 999 }))).resolves.toBeDefined();
    });

    it('aktualisiert das Badge bei onUpdated=complete', async () => {
        const b = await boot();
        // Vorab VERIFIED setzen (verified>0 -> kein Ping bei onUpdated)
        await b.processResponse(makeResponseDetails(23, 'https://mail.aionda.com/', SIGNED_HEADERS));
        mock.action.badges.delete(23);

        mock.tabs.onUpdated.trigger(23, { status: 'complete' }, { id: 23, url: 'https://mail.aionda.com/', windowId: 1, active: true });
        await tick();

        expect(mock.action.badges.get(23)).toEqual({ text: '✓', color: '#10b981' });
    });
});

describe('Navigation & Tab-Lifecycle', () => {
    it('resetTabStatus setzt auf PROTECTED bei onBeforeNavigate (Main-Frame)', async () => {
        const b = await boot();
        await b.processResponse(makeResponseDetails(30, 'https://mail.aionda.com/', SIGNED_HEADERS));
        expect(statusFor(30)?.status).toBe('VERIFIED');

        mock.webNavigation.onBeforeNavigate.trigger({ tabId: 30, url: 'https://mail.aionda.com/next', frameId: 0 });

        expect(statusFor(30)?.status).toBe('PROTECTED');
        expect(mock.action.badges.get(30)).toEqual({ text: '🛡', color: '#3b82f6' });
    });

    it('ignoriert onBeforeNavigate in Sub-Frames (frameId !== 0)', async () => {
        const b = await boot();
        await b.processResponse(makeResponseDetails(31, 'https://mail.aionda.com/', SIGNED_HEADERS));

        mock.webNavigation.onBeforeNavigate.trigger({ tabId: 31, url: 'https://mail.aionda.com/iframe', frameId: 1 });

        // Status bleibt VERIFIED, kein Reset
        expect(statusFor(31)?.status).toBe('VERIFIED');
    });

    it('löscht den Status wenn ein Tab geschlossen wird', async () => {
        const b = await boot();
        await b.processResponse(makeResponseDetails(32, 'https://mail.aionda.com/', SIGNED_HEADERS));
        expect(statusFor(32)).toBeDefined();

        mock.tabs.onRemoved.trigger(32);

        expect(statusFor(32)).toBeUndefined();
    });
});
