/**
 * Consumed globals for options/welcome.ts.
 *
 * Producers (vendor classic scripts, left untouched):
 *   - opaque-client.js  -> addonOpaqueClient
 *   - srp-client.js     -> addonSrpClient
 *   - publicsuffixlist.js -> org_domain
 *
 * These are ambient (script-scope) declarations; do NOT add import/export here.
 */

/** Result of AddonOpaqueClient.checkOpaqueEnabled(). */
interface AddonAuthMethods {
    opaque_enabled: boolean;
    srp_enabled: boolean;
    migration_available?: boolean;
}

/** Result of AddonSrpClient.checkSrpEnabled(). */
interface AddonSrpCheckResult {
    success?: boolean;
    srp_enabled?: boolean;
    reset_by_support?: boolean;
    [key: string]: unknown;
}

/** OPAQUE client instance exported by opaque-client.js (`const addonOpaqueClient`). */
interface AddonOpaqueClient {
    checkOpaqueEnabled(username: string): Promise<AddonAuthMethods>;
    patOpaqueLogin(username: string, token: string, options?: { establishBrowserSession?: boolean }): Promise<TmApiResponse>;
    /** OPAQUE-PAT anlegen (pat_opaque_create_init/finish) - Token entsteht client-seitig. */
    createAccessTokenOpaque(sessionId: string, name: string): Promise<string>;
    /** register_account_v2: OPAQUE-Registrierung ohne E-Mail (braucht bestandenes Captcha-Spiel). */
    registerAccountV2(username: string, password: string, gameSessionId: string): Promise<TmApiResponse>;
    /** Voller OPAQUE-Passwort-Login (v2-Konten sind OPAQUE-only, classic login geht nicht). */
    passwordOpaqueLogin(username: string, password: string, options?: { establishBrowserSession?: boolean }): Promise<TmApiResponse>;
    /** Schliesst eine schwebende 2FA-Anmeldung per TOTP-Code ab (Cookie-Session). */
    verifyTotpLogin(code: string, trustDevice?: boolean): Promise<{ success: boolean }>;
    /** Wie verifyTotpLogin, nutzt aber einen Wiederherstellungscode als Fallback. */
    useRecoveryCode(code: string): Promise<{ success: boolean }>;
}

/** SRP client instance exported by srp-client.js (`const addonSrpClient`). */
interface AddonSrpClient {
    checkSrpEnabled(username: string): Promise<AddonSrpCheckResult>;
    login(username: string, password: string): Promise<TmApiResponse>;
    migrateToSrp(username: string, password: string): Promise<unknown>;
}

/**
 * Vendor crypto clients may be absent (script not loaded); the code guards them
 * with `typeof addonXxxClient !== 'undefined'`, so they are typed as optional.
 */
declare const addonOpaqueClient: AddonOpaqueClient | undefined;
declare const addonSrpClient: AddonSrpClient | undefined;

/**
 * Get the organizational domain from a URL. Defined in publicsuffixlist.js.
 * `rules`/`exceptions` come straight from public_suffix.json (opaque store shape).
 * Also consumed by create-address/create-address.ts (ambient, program-wide).
 */
// eslint-disable-next-line @typescript-eslint/naming-convention -- external vendor global name
declare function org_domain(
    url: URL,
    rules: Record<string, unknown>,
    exceptions: Record<string, unknown>,
): string;
