"use strict";

/**
 * OPAQUE Client for TrashMail Browser Extension
 *
 * Provides Zero-Knowledge authentication for Personal Access Tokens (PAT).
 * Uses @serenity-kit/opaque library bundled in libopaque.js.
 *
 * When an account is migrated to OPAQUE:
 * - Classic login no longer works (password is not stored on server)
 * - Extension must use PAT-OPAQUE for authentication
 * - User creates PAT in web interface, uses it as "password" in extension
 *
 * @author Stephan Ferraro, Aionda GmbH 2025
 */

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

/**
 * TrashMail OPAQUE Client for Extension
 */
class AddonOpaqueClient {
    constructor() {
        this.initialized = false;
        this.initPromise = null;
    }

    /**
     * Initialize the OPAQUE library (load WASM)
     * Must be called before any OPAQUE operations
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            // Wait for opaque library to be ready
            if (typeof opaque !== 'undefined' && opaque.ready) {
                await opaque.ready;
                this.initialized = true;
                console.log('[TrashMail OPAQUE] Library initialized');
            } else {
                throw new Error('OPAQUE library not loaded. Include libopaque.js.');
            }
        })();

        return this.initPromise;
    }

    /**
     * Check if an account uses OPAQUE authentication
     *
     * @param {string} username - User's username/email
     * @returns {Promise<{opaque_enabled: boolean, srp_enabled: boolean, migration_available: boolean}>}
     */
    async checkOpaqueEnabled(username) {
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://mail.aionda.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        const response = await fetch(baseUrl + '/?api=1&cmd=opaque_check&lang=' + lang, {
            // Keine Webapp-Cookies mitschicken - das Addon arbeitet nur mit session_id.
            credentials: "omit",
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        const result = await response.json();

        return {
            opaque_enabled: result.opaque_enabled || false,
            srp_enabled: result.srp_enabled || false,
            migration_available: result.migration_available || false
        };
    }

    /**
     * Perform PAT-OPAQUE authentication
     *
     * @param {string} username - User's username/email
     * @param {string} token - Personal Access Token (starts with 'tmpat_')
     * @param {object} [options] - { establishBrowserSession: true } schickt die
     *   Login-Requests MIT Browser-Cookies, sodass der Server die Website-Session
     *   (Session-Cookie) im Browser setzt - fuer "Address-Manager oeffnen" ohne
     *   session_id in der URL. Default: cookie-los (Addon-interne session_id).
     * @returns {Promise<object>} Login result with session info
     */
    async patOpaqueLogin(username, token, options = {}) {
        const credentialsMode = options.establishBrowserSession ? "include" : "omit";
        // Ensure library is initialized
        await this.initialize();

        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://mail.aionda.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        // Step 1: Start PAT-OPAQUE login - create KE1
        console.log('[TrashMail OPAQUE] Starting PAT authentication...');
        const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password: token });

        const step1Response = await fetch(baseUrl + '/?api=1&cmd=pat_opaque_auth_init&lang=' + lang, {
            credentials: credentialsMode,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                token_prefix: token.substring(0, 12) + '...',
                startLoginRequest
            })
        });

        const step1Result = await step1Response.json();

        if (!step1Result.success || !step1Result.session_id) {
            const error = new Error(step1Result.msg || 'PAT authentication failed');
            error.errorCode = step1Result.error_code || 3;
            throw error;
        }

        // Step 2: Finish PAT-OPAQUE login - process KE2, create KE3
        const loginResponse = step1Result.loginResponse || step1Result.login_response || '';

        const loginResult = opaque.client.finishLogin({
            clientLoginState,
            loginResponse,
            password: token
        });

        // finishLogin returns null if token is incorrect
        if (!loginResult || !loginResult.finishLoginRequest) {
            const error = new Error('Invalid Personal Access Token');
            error.errorCode = 3;
            throw error;
        }

        // Step 3: Send KE3 proof to server
        console.log('[TrashMail OPAQUE] Verifying token...');
        const step2Response = await fetch(baseUrl + '/?api=1&cmd=pat_opaque_auth_finish&lang=' + lang, {
            credentials: credentialsMode,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: step1Result.session_id,
                finishLoginRequest: loginResult.finishLoginRequest
            })
        });

        const step2Result = await step2Response.json();

        if (!step2Result.success) {
            const error = new Error(step2Result.msg || 'PAT verification failed');
            error.errorCode = step2Result.error_code;
            throw error;
        }

        console.log('[TrashMail OPAQUE] PAT authentication successful');

        // Extract data from response (server returns login data in 'data' field)
        var data = step2Result.data || {};

        // Return in same format as classic login for compatibility
        return {
            success: true,
            session_id: data.session_id || step2Result.session_id,
            domain_name_list: data.domain_name_list || step2Result.domain_name_list || [],
            real_email_list: data.real_email_list || step2Result.real_email_list || {}
        };
    }

    /**
     * Create a Personal Access Token via the OPAQUE pair
     * pat_opaque_create_init/finish (Zero-Knowledge: the token itself never
     * leaves the browser, the server only stores the OPAQUE record).
     *
     * WICHTIG: cmd=create_access_token erzeugt CLASSIC-Tokens
     * (mail_access_tokens) - die sind per patOpaqueLogin NICHT verifizierbar.
     * Fuer OPAQUE-Konten immer diese Methode nutzen.
     *
     * VORAUSSETZUNG: Eine Browser-Session (Cookie) muss existieren - vorher
     * patOpaqueLogin/passwordOpaqueLogin mit { establishBrowserSession: true }
     * aufrufen. Grund: der finish-Body traegt selbst ein session_id-Feld
     * (die OPAQUE-Session) und ueberschreibt serverseitig den URL-Parameter,
     * daher geht die Account-Auth nur ueber das Cookie.
     *
     * @param {string} sessionId - Authentifizierte Account-Session (Fallback fuer init)
     * @param {string} name - Anzeigename des Tokens (z.B. "Chrome Extension")
     * @returns {Promise<string>} Der neue Token (tmpat_...), nur einmal sichtbar
     */
    async createAccessTokenOpaque(sessionId, name) {
        await this.initialize();

        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://mail.aionda.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        // Token client-seitig erzeugen (identisch zur Webapp: 32 Bytes base64url)
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const base64 = btoa(String.fromCharCode(...bytes))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        const token = 'tmpat_' + base64;
        const tokenPrefix = token.substring(0, 12) + '...';

        const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password: token });

        const initResponse = await fetch(baseUrl + '/?api=1&cmd=pat_opaque_create_init&lang=' + lang + '&session_id=' + encodeURIComponent(sessionId), {
            credentials: "include",
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registration_request: registrationRequest })
        });
        const initResult = await initResponse.json();

        if (!initResult.success || !initResult.session_id) {
            const error = new Error(initResult.msg || 'Token creation initialization failed');
            error.errorCode = initResult.error_code;
            throw error;
        }

        const { registrationRecord } = opaque.client.finishRegistration({
            clientRegistrationState,
            registrationResponse: initResult.registration_response,
            password: token
        });

        const finishResponse = await fetch(baseUrl + '/?api=1&cmd=pat_opaque_create_finish&lang=' + lang, {
            credentials: "include",
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: initResult.session_id,
                user_record: registrationRecord,
                name: name,
                token_prefix: tokenPrefix,
                expires_at: null
            })
        });
        const finishResult = await finishResponse.json();

        if (!finishResult.success) {
            const error = new Error(finishResult.msg || 'Token creation failed');
            error.errorCode = finishResult.error_code;
            throw error;
        }

        return token;
    }

    /**
     * Register a new account via register_account_v2 (OPAQUE, no email).
     *
     * Flow: opaque.client.startRegistration -> opaque_register_init ->
     * opaque.client.finishRegistration -> register_account_v2.
     * The password never leaves the browser (Zero-Knowledge).
     *
     * @param {string} username - Desired username (lowercase)
     * @param {string} password - Account password (stays client-side)
     * @param {string} gameSessionId - Passed game captcha session (game_captcha_validate)
     * @returns {Promise<object>} {success, account_id, username}
     */
    async registerAccountV2(username, password, gameSessionId) {
        await this.initialize();

        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://mail.aionda.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        // Step 1: OPAQUE registration request (base64url strings, no encoding needed)
        const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password });

        const initResponse = await fetch(baseUrl + '/?api=1&cmd=opaque_register_init&lang=' + lang, {
            // Keine Webapp-Cookies mitschicken - das Addon arbeitet nur mit session_id.
            credentials: "omit",
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, registrationRequest })
        });
        const initResult = await initResponse.json();

        if (!initResult.success || !initResult.session_id) {
            const error = new Error(initResult.msg || 'OPAQUE registration init failed');
            error.errorCode = initResult.error_code;
            throw error;
        }

        // Step 2: Finish registration client-side
        const registrationResponse = initResult.registrationResponse || initResult.registration_response || '';
        const { registrationRecord } = opaque.client.finishRegistration({
            clientRegistrationState,
            registrationResponse,
            password
        });

        // Step 3: Create the account
        const regResponse = await fetch(baseUrl + '/?api=1&cmd=register_account_v2&lang=' + lang, {
            // Keine Webapp-Cookies mitschicken - das Addon arbeitet nur mit session_id.
            credentials: "omit",
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: username,
                session_id: initResult.session_id,
                registrationRecord,
                game_session_id: gameSessionId
            })
        });
        const regResult = await regResponse.json();

        if (!regResult.success) {
            const error = new Error(regResult.msg || 'Registration failed');
            error.errorCode = regResult.error_code;
            throw error;
        }

        return regResult;
    }

    /**
     * Full OPAQUE password login (opaque_login_init/opaque_login_finish).
     * Needed right after registration: v2 accounts are OPAQUE-only, a classic
     * cmd=login with the password can never work for them.
     *
     * @param {string} username - Username
     * @param {string} password - Account password (stays client-side)
     * @param {object} [options] - { establishBrowserSession: true } setzt das
     *   Website-Session-Cookie im Browser (siehe patOpaqueLogin).
     * @returns {Promise<object>} Same shape as classic login (session_id, lists)
     */
    async passwordOpaqueLogin(username, password, options = {}) {
        const credentialsMode = options.establishBrowserSession ? "include" : "omit";
        await this.initialize();

        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://mail.aionda.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        // Step 1: KE1
        const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password });

        const step1Response = await fetch(baseUrl + '/?api=1&cmd=opaque_login_init&lang=' + lang, {
            credentials: credentialsMode,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, startLoginRequest })
        });
        const step1Result = await step1Response.json();

        if (!step1Result.success || !step1Result.session_id) {
            const error = new Error(step1Result.msg || 'OPAQUE login failed');
            error.errorCode = step1Result.error_code || 3;
            throw error;
        }

        // Step 2: KE2 -> KE3
        const loginResponse = step1Result.loginResponse || step1Result.login_response || '';
        const loginResult = opaque.client.finishLogin({
            clientLoginState,
            loginResponse,
            password
        });

        if (!loginResult || !loginResult.finishLoginRequest) {
            const error = new Error('Invalid credentials');
            error.errorCode = 3;
            throw error;
        }

        // Step 3: KE3 proof
        const step2Response = await fetch(baseUrl + '/?api=1&cmd=opaque_login_finish&lang=' + lang, {
            credentials: credentialsMode,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: step1Result.session_id,
                finishLoginRequest: loginResult.finishLoginRequest
            })
        });
        const step2Result = await step2Response.json();

        if (!step2Result.success) {
            const error = new Error(step2Result.msg || 'Login verification failed');
            error.errorCode = step2Result.error_code;
            throw error;
        }

        const data = step2Result.data || {};

        if (data.requires_2fa) {
            const error = new Error('2FA required');
            error.requires_2fa = true;
            throw error;
        }

        return {
            success: true,
            session_id: data.session_id || step2Result.session_id,
            domain_name_list: data.domain_name_list || [],
            real_email_list: data.real_email_list || {}
        };
    }
}

// Create global instance
const addonOpaqueClient = new AddonOpaqueClient();
