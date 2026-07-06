/**
 * Globals consumed by background.ts that are provided by vendor classic
 * scripts loaded alongside it (importScripts in the Chrome service worker,
 * manifest background.scripts in Firefox).
 *
 * publicsuffixlist.js stays vendor JS and exposes `org_domain` on the global
 * scope. Its name is snake_case, so it is reached through a typed globalThis
 * property instead of a bare ambient `declare` (which would clash with the
 * camelCase naming-convention lint rule).
 */

/** Public-suffix store as loaded from public_suffix.json (see publicsuffixlist.js). */
type PublicSuffixStore = Record<string, unknown>;

/** Vendor globals from publicsuffixlist.js. */
interface PublicSuffixGlobals {
    org_domain(url: URL, rules: PublicSuffixStore, exceptions: PublicSuffixStore): string;
}
