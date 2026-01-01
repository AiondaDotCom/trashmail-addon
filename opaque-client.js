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
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://trashmail.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        const response = await fetch(baseUrl + '/?api=1&cmd=opaque_check&lang=' + lang, {
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
     * @returns {Promise<object>} Login result with session info
     */
    async patOpaqueLogin(username, token) {
        // Ensure library is initialized
        await this.initialize();

        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://trashmail.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        // Step 1: Start PAT-OPAQUE login - create KE1
        console.log('[TrashMail OPAQUE] Starting PAT authentication...');
        const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password: token });

        const step1Response = await fetch(baseUrl + '/?api=1&cmd=pat_opaque_auth_init&lang=' + lang, {
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
}

// Create global instance
const addonOpaqueClient = new AddonOpaqueClient();
