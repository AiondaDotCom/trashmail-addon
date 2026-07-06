import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserMock } from '../helpers/browser-mock';
import { installBrowserMock } from '../helpers/browser-mock';
import { bootGuardian, makeResponseDetails, type BootResult } from '../helpers/guardian-boot';
import { generateSigningKey } from '../helpers/guardian-fixtures';

interface Status { status: string; verified: number; unsigned: number; }

function statusFor(tabId: number): Status | undefined {
    return (globalThis as unknown as { tabSecurityStatus: Map<number, Status> }).tabSecurityStatus.get(tabId);
}

const SIGNED_HEADERS = {
    'x-aionda-signature': 'c2ln',
    'x-aionda-timestamp': '1700000000',
    'x-aionda-key-id': 'test-key',
};

let mock: BrowserMock;
let boot: BootResult;

beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mock = installBrowserMock();
    const keyFile = (await generateSigningKey()).keyFile;
    boot = await bootGuardian(mock, keyFile);
});

describe('processResponse — Signatur-Header-Präsenz', () => {
    it('setzt VERIFIED + grünes Badge wenn Signatur-Header vorhanden sind', async () => {
        await boot.processResponse(makeResponseDetails(1, 'https://mail.aionda.com/', SIGNED_HEADERS));

        expect(statusFor(1)?.status).toBe('VERIFIED');
        expect(statusFor(1)?.verified).toBe(1);
        expect(mock.action.badges.get(1)).toEqual({ text: '✓', color: '#10b981' });
    });

    it('setzt UNSIGNED + rotes Badge + Notification bei fehlender Signatur auf HTML', async () => {
        await boot.processResponse(makeResponseDetails(2, 'https://mail.aionda.com/inbox', {
            'content-type': 'text/html; charset=utf-8',
        }));

        expect(statusFor(2)?.status).toBe('UNSIGNED');
        expect(statusFor(2)?.unsigned).toBe(1);
        expect(mock.action.badges.get(2)).toEqual({ text: '!', color: '#ef4444' });
        expect(mock.notifications.created.length).toBe(1);
    });

    it('behandelt API-Antworten (api=1) ohne Signatur als UNSIGNED', async () => {
        await boot.processResponse(makeResponseDetails(3, 'https://mail.aionda.com/?api=1&cmd=whoami', {
            'content-type': 'application/json',
        }));

        expect(statusFor(3)?.status).toBe('UNSIGNED');
        expect(mock.notifications.created.length).toBe(1);
    });

    it('lässt normale Ressourcen ohne Signatur auf PROTECTED (nur unsigned++)', async () => {
        await boot.processResponse(makeResponseDetails(4, 'https://mail.aionda.com/style.css', {
            'content-type': 'text/css',
        }));

        expect(statusFor(4)?.status).toBe('PROTECTED');
        expect(statusFor(4)?.unsigned).toBe(1);
        expect(mock.notifications.created.length).toBe(0);
    });

    it('stuft von UNSIGNED auf VERIFIED hoch wenn mehr signiert als unsigniert', async () => {
        // 1x unsigniertes HTML -> UNSIGNED
        await boot.processResponse(makeResponseDetails(5, 'https://mail.aionda.com/a', {
            'content-type': 'text/html',
        }));
        expect(statusFor(5)?.status).toBe('UNSIGNED');
        // 2x signiert -> verified(2) > unsigned(1) -> VERIFIED
        await boot.processResponse(makeResponseDetails(5, 'https://mail.aionda.com/b', SIGNED_HEADERS));
        await boot.processResponse(makeResponseDetails(5, 'https://mail.aionda.com/c', SIGNED_HEADERS));
        expect(statusFor(5)?.status).toBe('VERIFIED');
    });
});

describe('processResponse — Skip-Bedingungen', () => {
    it('ignoriert nicht-geschützte Hosts', async () => {
        await boot.processResponse(makeResponseDetails(10, 'https://example.com/', {}));
        expect(statusFor(10)).toBeUndefined();
        expect(mock.action.badges.has(10)).toBe(false);
    });

    it('ignoriert CloudFlare-CDN-Ressourcen (/cdn-cgi/)', async () => {
        await boot.processResponse(makeResponseDetails(11, 'https://mail.aionda.com/cdn-cgi/challenge', {}));
        expect(statusFor(11)).toBeUndefined();
    });

    it('ignoriert den Service Worker (/sw.js)', async () => {
        await boot.processResponse(makeResponseDetails(12, 'https://mail.aionda.com/sw.js', {}));
        expect(statusFor(12)).toBeUndefined();
    });

    it('ignoriert Requests ohne gültige tabId', async () => {
        await boot.processResponse(makeResponseDetails(-1, 'https://mail.aionda.com/', SIGNED_HEADERS));
        expect((globalThis as unknown as { tabSecurityStatus: Map<number, unknown> }).tabSecurityStatus.has(-1)).toBe(false);
    });

    it('tut nichts wenn Guardian zur Laufzeit deaktiviert wurde', async () => {
        await mock.storage.sync.set({ guardian_enabled: false });
        await boot.processResponse(makeResponseDetails(13, 'https://mail.aionda.com/', SIGNED_HEADERS));
        expect(statusFor(13)).toBeUndefined();
    });
});
