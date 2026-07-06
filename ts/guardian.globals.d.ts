/**
 * Additional cross-file globals produced by guardian.ts, plus Firefox-only
 * webRequest APIs that @types/chrome does not model.
 *
 * The shared surface (publicKeys, guardianInitialized, tabSecurityStatus,
 * guardianEnabled, ed25519Supported, isProtectedHost, initGuardian) lives in
 * ts/global.d.ts. Everything guardian-specific that is NOT part of that surface
 * goes here so global.d.ts stays untouched.
 */

/**
 * guardian.ts exposes isFirefoxBrowser() on the service-worker global so
 * background.ts can access it (esbuild wraps every bundle in an IIFE, so the
 * top-level declaration is not global anymore - it is assigned to self).
 */
declare function isFirefoxBrowser(): boolean;

/** Certificate object as returned by Firefox's webRequest.getSecurityInfo. */
interface GuardianCertificate {
    subject?: string;
    issuer?: string;
    fingerprint?: {
        sha256?: string;
        sha1?: string;
    };
}

/** SecurityInfo object as returned by Firefox's webRequest.getSecurityInfo. */
interface GuardianSecurityInfo {
    certificates?: GuardianCertificate[];
    [key: string]: unknown;
}

/**
 * Firefox-only extension of chrome.webRequest. getSecurityInfo() is not part of
 * the Chrome API surface, so @types/chrome omits it; this merge adds it back.
 */
declare namespace chrome.webRequest {
    function getSecurityInfo(
        requestId: string,
        options?: { certificateChain?: boolean },
    ): Promise<GuardianSecurityInfo>;
}
