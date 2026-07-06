/**
 * Real Ed25519 response-signature verification for ts/api.ts.
 *
 * Isolated file (vitest isolate=true → fresh module registry & globalThis), so
 * the module-private apiKeysLoaded latch starts fresh and public_key.json is
 * served with a genuine, freshly generated key pair. We sign the exact response
 * body the way the server does (`${body}|${timestamp}`) and assert the module
 * accepts good signatures and rejects tampered / mismatched / expired ones.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';

let mock: BrowserMock;
let keyPair: CryptoKeyPair;
let publicSpkiB64: string;

const KEY_ID = 'prod-2026-01';

function toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}

async function signBody(body: string, timestampSeconds: number): Promise<string> {
    const data = new TextEncoder().encode(`${body}|${timestampSeconds}`);
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, data);
    return toBase64(sig);
}

interface FakeResponseInit {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
}

function fakeResponse(body: string, init: FakeResponseInit = {}) {
    const { ok = true, status = 200, statusText = 'OK', headers = {} } = init;
    const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return {
        ok,
        status,
        statusText,
        headers: { get: (name: string): string | null => lower.get(name.toLowerCase()) ?? null },
        text: async (): Promise<string> => body,
        json: async (): Promise<unknown> => JSON.parse(body),
    };
}

/** public_key.json served with the generated key; API url → provided response. */
function stubFetch(apiResponse: ReturnType<typeof fakeResponse>, validUntil = '2999-01-01T00:00:00Z'): void {
    const keyFile = {
        keys: { [KEY_ID]: { algorithm: 'Ed25519', public_key: publicSpkiB64, valid_until: validUntil } },
        current_key_id: KEY_ID,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes('public_key.json')) {
            return fakeResponse(JSON.stringify(keyFile));
        }
        return apiResponse;
    }));
}

const api = () => globalThis as unknown as {
    callAPI: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
    API_BASE_URL: string;
    DEFAULT_API_URL: string;
};

beforeAll(async () => {
    mock = installBrowserMock();
    keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    publicSpkiB64 = toBase64(await crypto.subtle.exportKey('spki', keyPair.publicKey));
    await import('../../ts/api');
});

beforeEach(() => {
    mock.storage.local.data.clear();
    mock.i18n.messages.clear();
    vi.unstubAllGlobals();
    api().API_BASE_URL = api().DEFAULT_API_URL;
});

describe('response signature verification', () => {
    it('accepts a correctly signed response', async () => {
        const body = JSON.stringify({ success: true, message: 'secure' });
        const ts = Math.floor(Date.now() / 1000);
        stubFetch(fakeResponse(body, {
            headers: {
                'x-aionda-signature': await signBody(body, ts),
                'x-aionda-timestamp': String(ts),
                'x-aionda-key-id': KEY_ID,
            },
        }));
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        expect(await api().callAPI({ cmd: 'x' })).toBe('secure');
        expect(log).toHaveBeenCalledWith(`[API] Response signature verified (Key: ${KEY_ID})`);
        log.mockRestore();
    });

    it('rejects a tampered body (signature no longer matches)', async () => {
        const signedBody = JSON.stringify({ success: true, message: 'secure' });
        const ts = Math.floor(Date.now() / 1000);
        const signature = await signBody(signedBody, ts);
        // Serve a DIFFERENT body than what was signed.
        const tamperedBody = JSON.stringify({ success: true, message: 'HACKED' });
        stubFetch(fakeResponse(tamperedBody, {
            headers: { 'x-aionda-signature': signature, 'x-aionda-timestamp': String(ts), 'x-aionda-key-id': KEY_ID },
        }));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toMatchObject({
            message: expect.stringContaining('Signature mismatch'),
            securityError: true,
        });
    });

    it('rejects a key-id whose prefix does not match the server (dev key on prod)', async () => {
        const body = JSON.stringify({ success: true, message: 'x' });
        const ts = Math.floor(Date.now() / 1000);
        stubFetch(fakeResponse(body, {
            headers: { 'x-aionda-signature': await signBody(body, ts), 'x-aionda-timestamp': String(ts), 'x-aionda-key-id': 'dev-2026-01' },
        }));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toMatchObject({
            message: 'Security Error: Invalid key for this server',
            securityError: true,
        });
    });

    it('rejects an unknown key id', async () => {
        const body = JSON.stringify({ success: true, message: 'x' });
        const ts = Math.floor(Date.now() / 1000);
        // key file only knows KEY_ID, but the response references prod-unknown
        stubFetch(fakeResponse(body, {
            headers: { 'x-aionda-signature': await signBody(body, ts), 'x-aionda-timestamp': String(ts), 'x-aionda-key-id': 'prod-unknown' },
        }));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toMatchObject({
            message: expect.stringContaining('Unknown key ID: prod-unknown'),
        });
    });

    it('rejects a stale timestamp (older than 5 minutes)', async () => {
        const body = JSON.stringify({ success: true, message: 'x' });
        const staleTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
        stubFetch(fakeResponse(body, {
            headers: { 'x-aionda-signature': await signBody(body, staleTs), 'x-aionda-timestamp': String(staleTs), 'x-aionda-key-id': KEY_ID },
        }));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toMatchObject({
            message: expect.stringContaining('Timestamp too old'),
        });
    });
});
