/**
 * Ambient types for public-suffix.ts.
 *
 * Two sources provide the organisational domain (eTLD+1):
 *   - browser.publicSuffix  -> native, Firefox 153+, always-current PSL
 *   - org_domain()          -> vendor fallback from publicsuffixlist.js,
 *                              fed by the bundled public_suffix.json
 *
 * These are ambient (script-scope) declarations; do NOT add import/export here.
 */

/** Public-suffix store as loaded from public_suffix.json (see publicsuffixlist.js). */
type PublicSuffixStore = Record<string, unknown>;

/**
 * Vendor globals from publicsuffixlist.js. The name is snake_case, so it is
 * reached through a typed globalThis property instead of a bare ambient
 * `declare` (which would clash with the camelCase naming-convention lint rule).
 */
interface PublicSuffixGlobals {
    org_domain(url: URL, rules: PublicSuffixStore, exceptions: PublicSuffixStore): string;
}

/**
 * Native publicSuffix API, Firefox 153+ (manifest permission "publicSuffix").
 * Not in @types/chrome, and `browser` is typed as `typeof chrome`, so it is
 * reached through a cast rather than by widening the `browser` declaration.
 */
interface FirefoxPublicSuffixApi {
    /**
     * Registrable domain (eTLD+1) of a hostname, punycode-encoded by default.
     * Returns null when there is none (bare suffix such as "co.uk", unknown
     * TLD, "localhost", IP literals) and throws on an unparsable hostname.
     * Takes a hostname, NOT a URL string.
     */
    getDomain(hostname: string): string | null;
    /** Public suffix of a hostname, or null if it has none. */
    getKnownSuffix(hostname: string): string | null;
    /** Whether the hostname is itself a public suffix. */
    isKnownSuffix(hostname: string): boolean;
}

/** Carrier for the optional `publicSuffix` property on the `browser` object. */
interface FirefoxPublicSuffixCarrier {
    publicSuffix?: FirefoxPublicSuffixApi;
}
