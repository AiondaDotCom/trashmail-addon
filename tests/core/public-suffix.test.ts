/**
 * Unit tests for ts/public-suffix.ts - the switch between the native Firefox
 * publicSuffix API and the bundled Public Suffix List.
 *
 * The module binds `browser` and memoises its resolver at import time, so every
 * test installs its globals first and then does a fresh vi.resetModules() +
 * dynamic import.
 *
 * The expectations for the native path are pinned to what Firefox 153 actually
 * returns (probed against Firefox Developer Edition 153): a punycode eTLD+1,
 * null for bare suffixes / unknown TLDs / localhost / IP literals, and a throw
 * on an unparsable hostname.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';

let mock: BrowserMock;
let orgDomain: ReturnType<typeof vi.fn>;

/** Loads the module after the current globals are in place. */
async function loadModule(): Promise<typeof import('../../ts/public-suffix')> {
    vi.resetModules();
    return await import('../../ts/public-suffix');
}

/** Puts a native publicSuffix API on the mocked `browser` object. */
function installNativeApi(getDomain: (hostname: string) => string | null): void {
    (mock as unknown as Record<string, unknown>)['publicSuffix'] = {
        getDomain: vi.fn(getDomain),
        getKnownSuffix: vi.fn(() => null),
        isKnownSuffix: vi.fn(() => false),
    };
}

/** Stubs fetch so the fallback path resolves to [rules, exceptions]. */
function stubSuffixFetch(ok = true): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => ({ ok, json: async () => [{ rules: true }, { exceptions: true }] }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => {
    vi.unstubAllGlobals();
    mock = installBrowserMock();
    orgDomain = vi.fn((url: URL) => `fallback:${url.hostname}`);
    (globalThis as Record<string, unknown>)['org_domain'] = orgDomain;
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)['org_domain'];
});

describe('native path (Firefox 153+)', () => {
    it('uses browser.publicSuffix and never fetches the bundled list', async () => {
        installNativeApi(() => 'bbc.co.uk');
        const fetchMock = stubSuffixFetch();

        const { getOrgDomainResolver } = await loadModule();
        const resolve = await getOrgDomainResolver();

        expect(resolve(new URL('https://www.bbc.co.uk/news'))).toBe('bbc.co.uk');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(orgDomain).not.toHaveBeenCalled();
    });

    it('passes the hostname, not the URL - getDomain rejects full URL strings', async () => {
        const getDomain = vi.fn(() => 'example.com');
        installNativeApi(getDomain);
        stubSuffixFetch();

        const { getOrgDomainResolver } = await loadModule();
        const resolve = await getOrgDomainResolver();
        resolve(new URL('https://a.b.example.com/pfad?q=1'));

        expect(getDomain).toHaveBeenCalledWith('a.b.example.com');
    });

    it('falls back to the hostname when getDomain returns null (bare suffix, unknown TLD, localhost, IP)', async () => {
        installNativeApi(() => null);
        stubSuffixFetch();

        const { getOrgDomainResolver } = await loadModule();
        const resolve = await getOrgDomainResolver();

        expect(resolve(new URL('https://co.uk'))).toBe('co.uk');
        expect(resolve(new URL('http://localhost'))).toBe('localhost');
        expect(resolve(new URL('http://127.0.0.1'))).toBe('127.0.0.1');
        expect(resolve(new URL('https://test.invalid-tld-xyz'))).toBe('test.invalid-tld-xyz');
    });

    it('falls back to the hostname when getDomain throws', async () => {
        installNativeApi(() => { throw new Error('Invalid hostname'); });
        stubSuffixFetch();

        const { getOrgDomainResolver } = await loadModule();
        const resolve = await getOrgDomainResolver();

        expect(resolve(new URL('https://example.com'))).toBe('example.com');
    });

    it('keeps the punycode spelling both paths agree on', async () => {
        const getDomain = vi.fn((hostname: string) => hostname);
        installNativeApi(getDomain);
        stubSuffixFetch();

        const { getOrgDomainResolver } = await loadModule();
        const resolve = await getOrgDomainResolver();

        // URL.hostname IDNA-encodes, so the native API sees the same spelling
        // it hands back - no unicode/punycode mismatch between the two paths.
        expect(resolve(new URL('https://münchen.de'))).toBe('xn--mnchen-3ya.de');
        expect(getDomain).toHaveBeenCalledWith('xn--mnchen-3ya.de');
    });
});

describe('fallback path (Chrome, Firefox below 153)', () => {
    it('loads public_suffix.json and resolves through org_domain', async () => {
        const fetchMock = stubSuffixFetch();

        const { getOrgDomainResolver } = await loadModule();
        const resolve = await getOrgDomainResolver();

        expect(resolve(new URL('https://www.bbc.co.uk/news'))).toBe('fallback:www.bbc.co.uk');
        expect(fetchMock).toHaveBeenCalledWith('chrome-extension://test-extension-id/public_suffix.json');
        expect(orgDomain).toHaveBeenCalledWith(expect.any(URL), { rules: true }, { exceptions: true });
    });

    it('rejects when the list cannot be loaded', async () => {
        stubSuffixFetch(false);

        const { getOrgDomainResolver } = await loadModule();

        await expect(getOrgDomainResolver()).rejects.toThrow('Public Suffix List konnte nicht geladen werden');
    });

    it('does not memoise a failed load, so a later call can still succeed', async () => {
        stubSuffixFetch(false);
        const { getOrgDomainResolver } = await loadModule();
        await expect(getOrgDomainResolver()).rejects.toThrow();

        stubSuffixFetch(true);
        const resolve = await getOrgDomainResolver();

        expect(resolve(new URL('https://example.com'))).toBe('fallback:example.com');
    });

    it('fetches the list only once across repeated calls', async () => {
        const fetchMock = stubSuffixFetch();

        const { getOrgDomainResolver } = await loadModule();
        await Promise.all([getOrgDomainResolver(), getOrgDomainResolver()]);
        await getOrgDomainResolver();

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
