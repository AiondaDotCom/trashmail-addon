/**
 * Unit tests for ts/api.ts (ported from api.js).
 *
 * api.ts publishes an accessor property `API_BASE_URL` on globalThis via a
 * NON-configurable Object.defineProperty. Re-importing the module (after
 * vi.resetModules) therefore throws "Cannot redefine property". The clean
 * solution is to import the module exactly ONCE per test file and reset the
 * mutable surface between tests:
 *   - storage/i18n maps of the (single, stable) browser mock are cleared
 *   - apiBaseUrl is reset through the published setter
 * Signature-verification (which flips the module-private apiKeysLoaded latch
 * once and for all) lives in the isolated sibling file api-signature.test.ts,
 * so here public_key.json always 404s and the crypto branch stays untouched.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';

interface FakeResponseInit {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
}

function fakeResponse(body: string | object, init: FakeResponseInit = {}) {
    const { ok = true, status = 200, statusText = 'OK', headers = {} } = init;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return {
        ok,
        status,
        statusText,
        headers: { get: (name: string): string | null => lower.get(name.toLowerCase()) ?? null },
        text: async (): Promise<string> => text,
    };
}

/** fetch stub: public_key.json → 404 (keys disabled), API url → provided response. */
function stubFetch(apiResponse: ReturnType<typeof fakeResponse>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('public_key.json')) {
            return fakeResponse('', { ok: false, status: 404, statusText: 'Not Found' });
        }
        return apiResponse;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

let mock: BrowserMock;

const api = () => globalThis as unknown as {
    callAPI: (data: Record<string, unknown>, json?: Record<string, unknown> | null) => Promise<Record<string, unknown>>;
    isPAT: (password: unknown) => boolean;
    createAccessToken: (sessionId: string, tokenName: string) => Promise<string>;
    getApiBaseUrl: () => Promise<string>;
    loadApiBaseUrl: () => Promise<void>;
    PREFIXES: string[];
    DEFAULT_API_URL: string;
    API_BASE_URL: string;
};

beforeAll(async () => {
    mock = installBrowserMock();
    await import('../../ts/api');
});

beforeEach(() => {
    mock.storage.local.data.clear();
    mock.storage.sync.data.clear();
    mock.i18n.messages.clear();
    vi.unstubAllGlobals();
    // Reset the mutable base url through the published setter.
    api().API_BASE_URL = api().DEFAULT_API_URL;
});

describe('isPAT', () => {
    it('accepts a proper tmpat_ token longer than 6 chars', () => {
        expect(api().isPAT('tmpat_abcdef')).toBe(true);
    });

    it('rejects the bare prefix (length 6, not > 6)', () => {
        expect(api().isPAT('tmpat_')).toBe(false);
    });

    it('rejects a token without the prefix', () => {
        expect(api().isPAT('hunter2password')).toBe(false);
    });

    it('rejects the empty string', () => {
        expect(api().isPAT('')).toBe(false);
    });

    it('rejects non-string values', () => {
        expect(api().isPAT(12345 as unknown as string)).toBe(false);
        expect(api().isPAT(null as unknown as string)).toBe(false);
        expect(api().isPAT(undefined as unknown as string)).toBe(false);
    });
});

describe('getApiBaseUrl', () => {
    it('returns the default when no debug override is stored', async () => {
        expect(await api().getApiBaseUrl()).toBe('https://mail.aionda.com');
    });

    it('returns the debug override from storage.local', async () => {
        await mock.storage.local.set({ debugApiUrl: 'https://dev.mail.aionda.com' });
        expect(await api().getApiBaseUrl()).toBe('https://dev.mail.aionda.com');
    });

    it('falls back to default when storage.get throws', async () => {
        const original = mock.storage.local.get;
        mock.storage.local.get = vi.fn(async () => { throw new Error('boom'); });
        expect(await api().getApiBaseUrl()).toBe('https://mail.aionda.com');
        mock.storage.local.get = original;
    });
});

describe('loadApiBaseUrl + API_BASE_URL liveness', () => {
    it('loadApiBaseUrl adopts the stored debug url into the live getter', async () => {
        await mock.storage.local.set({ debugApiUrl: 'https://staging.aionda.com' });
        await api().loadApiBaseUrl();
        expect(api().API_BASE_URL).toBe('https://staging.aionda.com');
    });

    it('the setter is live: writing API_BASE_URL changes the URL of the next callAPI', async () => {
        api().API_BASE_URL = 'https://dev.mail.aionda.com';
        const fetchMock = stubFetch(fakeResponse({ success: true, message: 'ok' }));
        await api().callAPI({ cmd: 'ping' });
        const apiCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('?api=1'));
        expect(String(apiCall?.[0])).toContain('https://dev.mail.aionda.com/?api=1&');
    });
});

describe('callAPI', () => {
    it('sends the UI language and returns the message on success', async () => {
        const fetchMock = stubFetch(fakeResponse({ success: true, message: 'hello' }));
        const result = await api().callAPI({ cmd: 'login' });
        expect(result).toBe('hello');
        const apiCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('?api=1'));
        expect(String(apiCall?.[0])).toContain('lang=de');
        expect(String(apiCall?.[0])).toContain('cmd=login');
    });

    it('falls back message → msg → data', async () => {
        stubFetch(fakeResponse({ success: true, msg: 'from-msg' }));
        expect(await api().callAPI({ cmd: 'x' })).toBe('from-msg');
    });

    it('returns the data field when message and msg are absent', async () => {
        stubFetch(fakeResponse({ success: true, data: { foo: 'bar' } }));
        expect(await api().callAPI({ cmd: 'x' })).toEqual({ foo: 'bar' });
    });

    it('throws on a non-ok HTTP response (generic message without JSON body)', async () => {
        stubFetch(fakeResponse('', { ok: false, status: 500, statusText: 'Server Error' }));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toThrow('500 Server Error Error occurred.');
    });

    it('surfaces the localized server msg from non-ok JSON responses (e.g. 429)', async () => {
        stubFetch(fakeResponse(
            { success: false, error_code: 429, msg: 'Bitte warte, bevor du diese E-Mail-Adresse erneut hinzufügst.' },
            { ok: false, status: 429, statusText: 'Too Many Requests' },
        ));
        const failure = api().callAPI({ cmd: 'add_real_email' });
        await expect(failure).rejects.toThrow('Bitte warte, bevor du diese E-Mail-Adresse erneut hinzufügst.');
        await expect(api().callAPI({ cmd: 'add_real_email' })).rejects.toMatchObject({ httpStatus: 429 });
    });

    it('throws "Invalid JSON response" when the body is not JSON', async () => {
        stubFetch(fakeResponse('<html>not json</html>'));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toThrow('Invalid JSON response from server');
    });

    it('rejects with a 2FA error carrying pat_hint/url when requires_2fa is set', async () => {
        stubFetch(fakeResponse({
            success: true,
            data: { requires_2fa: true, pat_hint: 'Use a PAT', url: 'https://mail.aionda.com/pat', extension_html: '<b>x</b>' },
        }));
        await expect(api().callAPI({ cmd: 'login' })).rejects.toMatchObject({
            message: 'Use a PAT',
            requires_2fa: true,
            url: 'https://mail.aionda.com/pat',
            extension_html: '<b>x</b>',
        });
    });

    it('throws the server message verbatim when success is false and msg is a non-empty string', async () => {
        stubFetch(fakeResponse({ success: false, message: 'Custom failure' }));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toThrow('Custom failure');
    });

    it('maps auth error codes to the localized session-expired message', async () => {
        mock.i18n.messages.set('errorSessionExpired', 'Bitte neu anmelden.');
        stubFetch(fakeResponse({ success: false, error_code: 61 }));
        const error = await api().callAPI({ cmd: 'x' }).catch((err: Error & { errorCode?: number }) => err);
        expect((error as Error).message).toBe('Bitte neu anmelden.');
        expect((error as { errorCode?: number }).errorCode).toBe(61);
    });

    it('uses the generic server error for non-auth error codes', async () => {
        mock.i18n.messages.set('errorGenericServer', 'Serverfehler.');
        stubFetch(fakeResponse({ success: false, error_code: 42 }));
        await expect(api().callAPI({ cmd: 'x' })).rejects.toThrow('Serverfehler.');
    });

    it('warns and skips verification when only some signature headers are present', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        stubFetch(fakeResponse({ success: true, message: 'ok' }, { headers: { 'x-aionda-signature': 'abc' } }));
        expect(await api().callAPI({ cmd: 'x' })).toBe('ok');
        expect(warn).toHaveBeenCalledWith('[API] Incomplete signature headers - skipping verification');
        warn.mockRestore();
    });
});

describe('createAccessToken', () => {
    it('returns the token on success', async () => {
        stubFetch(fakeResponse({ success: true, message: { token: 'tok-123' } }));
        expect(await api().createAccessToken('sess-1', 'Firefox Extension')).toBe('tok-123');
    });

    it('throws when the response carries no token', async () => {
        stubFetch(fakeResponse({ success: true, message: {} }));
        await expect(api().createAccessToken('sess-1', 'Firefox Extension')).rejects.toThrow('Failed to create access token');
    });
});

describe('PREFIXES', () => {
    it('is a non-empty word list published as a global', () => {
        expect(Array.isArray(api().PREFIXES)).toBe(true);
        expect(api().PREFIXES.length).toBeGreaterThan(100);
        expect(api().PREFIXES).toContain('cat');
    });
});
