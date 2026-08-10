/**
 * Organisational domain (eTLD+1) resolution, with a switch between the native
 * Firefox API and the bundled Public Suffix List.
 *
 * Firefox 153+ ships browser.publicSuffix, backed by the browser's own
 * always-current PSL copy. Everywhere else (Chrome, and Firefox below 153,
 * which our manifest still supports via strict_min_version) we keep loading
 * public_suffix.json and running the vendor org_domain() over it.
 *
 * Consumers ask for a resolver instead of a raw store so the two paths look
 * identical at the call site, and so the JSON is only fetched when it is
 * actually needed. Callers that already parallelise work (background.ts,
 * options/welcome.ts) can keep doing so: this returns a promise they can put
 * straight into their existing Promise.all.
 */

/** Maps a URL to the organisational domain its addresses should be grouped under. */
export type OrgDomainResolver = (url: URL) => string;

/**
 * Own compatibility binding rather than the ambient `browser`.
 *
 * Every entrypoint declares its own local `const browser`, and esbuild merges
 * all modules into one IIFE scope - a bare `browser` in here would silently
 * bind to whichever entry happens to pull the module in. Resolving it locally
 * keeps this module correct on its own terms, on Chrome as well as Firefox.
 */
const browserApi: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

/** Resolved once per bundle; the native path costs nothing, the fallback a fetch. */
let resolverPromise: Promise<OrgDomainResolver> | null = null;

/** The native API, or undefined on Chrome and Firefox below 153. */
function nativePublicSuffix(): FirefoxPublicSuffixApi | undefined {
    // `browser` is typed as `typeof chrome`, which does not know this API.
    return (browserApi as unknown as FirefoxPublicSuffixCarrier | undefined)?.publicSuffix;
}

/**
 * Wrap the native API so it behaves like org_domain() at the edges.
 *
 * getDomain() returns null where there is no registrable domain (a bare suffix
 * like "co.uk", an unknown TLD, "localhost", an IP literal) and throws on an
 * unparsable hostname. org_domain() never fails, it just hands back whatever it
 * has left, so we fall back to the hostname and keep callers free of null
 * handling. In those cases org_domain() produced nonsense anyway ("co.uk" came
 * back as "uk", "127.0.0.1" as "0.1"), so the hostname is both the compatible
 * and the more sensible answer.
 */
function nativeResolver(api: FirefoxPublicSuffixApi): OrgDomainResolver {
    return (url: URL): string => {
        // URL.hostname is already lowercased and punycode-encoded, which is the
        // form getDomain() returns, so both paths agree on the spelling.
        const hostname = url.hostname;
        try {
            return api.getDomain(hostname) ?? hostname;
        } catch {
            return hostname;
        }
    };
}

/** Load the bundled list and close over it, for browsers without the native API. */
async function fallbackResolver(): Promise<OrgDomainResolver> {
    const response = await fetch(browserApi.runtime.getURL("public_suffix.json"));
    if (!response.ok) {
        throw new Error("Public Suffix List konnte nicht geladen werden");
    }

    const [rules, exceptions] = await response.json() as [PublicSuffixStore, PublicSuffixStore];
    const orgDomain = (globalThis as unknown as PublicSuffixGlobals).org_domain;

    return (url: URL): string => orgDomain(url, rules, exceptions);
}

/**
 * Resolver for the current browser, memoised across calls.
 *
 * A failed fallback load is deliberately not memoised - caching the rejection
 * would keep every later call broken for the lifetime of the page or worker,
 * even though a retry might well succeed.
 */
export function getOrgDomainResolver(): Promise<OrgDomainResolver> {
    if (!resolverPromise) {
        const api = nativePublicSuffix();
        resolverPromise = api
            ? Promise.resolve(nativeResolver(api))
            : fallbackResolver().catch((error: unknown) => {
                resolverPromise = null;
                throw error;
            });
    }
    return resolverPromise;
}
