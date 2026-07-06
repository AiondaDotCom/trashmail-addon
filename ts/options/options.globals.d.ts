/**
 * Consumed global for options/options.ts.
 *
 * DEFAULT_API_URL is defined in api.ts. NOTE: api.ts currently keeps it as a
 * module-local const and does NOT publish it to globalThis, and it exposes
 * API_BASE_URL through a getter-only property (no setter). The options debug
 * panel writes API_BASE_URL and reads DEFAULT_API_URL, so at runtime api.ts must
 * additionally `Object.assign(globalThis, { DEFAULT_API_URL })` and add a setter
 * to the API_BASE_URL defineProperty. Declared here so the 1:1 port type-checks.
 */
declare const DEFAULT_API_URL: string;
