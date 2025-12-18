"use strict";

/**
 * SRP (Secure Remote Password) Client for TrashMail Browser Extension
 *
 * Implements SRP-6a protocol with Argon2 hardening for Zero-Knowledge authentication.
 * The password NEVER leaves the browser - only cryptographic proofs are sent.
 *
 * Adapted from static/js/srp-client.js for browser extension context:
 * - Uses API_BASE_URL from api.js instead of relative URLs
 * - Works with addon's async storage and context
 *
 * Security features:
 * - Argon2id password stretching (memory-hard, post-quantum resistant)
 * - RFC 5054 2048-bit group parameters
 * - Constant-time comparisons where applicable
 *
 * Dependencies:
 * - argon2-browser (bundled as argon2-bundled.min.js)
 * - api.js (for API_BASE_URL)
 *
 * @author Stephan Ferraro, Aionda GmbH 2025
 */

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

// RFC 5054 2048-bit Group Parameters
const SRP_N_HEX = 'AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310DCD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF747359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB694B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73';
const SRP_G_HEX = '02';

// Argon2 parameters (must match server!)
const ARGON2_TIME = 3;
const ARGON2_MEMORY = 65536;  // 64 MB in KB
const ARGON2_PARALLELISM = 4;
const ARGON2_HASH_LENGTH = 32;

/**
 * TrashMail SRP Client for Browser Extension
 */
class AddonSrpClient {
    constructor() {
        this.N = BigInt('0x' + SRP_N_HEX);
        this.g = BigInt('0x' + SRP_G_HEX);
        this.k = null;  // Computed lazily
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /**
     * Check if an account uses SRP authentication
     *
     * @param {string} username - User's email/username
     * @returns {Promise<{srp_enabled: boolean, reset_by_support?: boolean}>}
     */
    async checkSrpEnabled(username) {
        const response = await this._apiRequest('srp_check', { username });
        return response;
    }

    /**
     * Generate SRP verifier for registration or migration
     *
     * @param {string} username - User's email/username
     * @param {string} password - User's password
     * @returns {Promise<{salt: string, verifier: string}>} Base64-encoded values
     */
    async generateVerifier(username, password) {
        // Generate random salt (32 bytes)
        const salt = crypto.getRandomValues(new Uint8Array(32));

        // Compute x = H(salt, H(username:stretched_password))
        const x = await this._computeX(username, password, salt);

        // Compute verifier = g^x mod N
        const verifier = this._modPow(this.g, x, this.N);

        return {
            salt: this._bytesToBase64(salt),
            verifier: this._bytesToBase64(this._bigIntToBytes(verifier))
        };
    }

    /**
     * Perform SRP login
     *
     * @param {string} username - User's email/username
     * @param {string} password - User's password
     * @returns {Promise<object>} Login result with session info
     */
    async login(username, password) {
        // Step 1: Initialize handshake
        const initResponse = await this._apiRequest('srp_init', { username });

        if (!initResponse.success) {
            const error = new Error(initResponse.msg || 'SRP init failed');
            error.errorCode = initResponse.error_code;
            throw error;
        }

        const { session_id, salt, server_public } = initResponse;

        // Decode server values
        const saltBytes = this._base64ToBytes(salt);
        const B = this._bytesToBigInt(this._base64ToBytes(server_public));

        // Security check: B mod N != 0
        if (B % this.N === 0n) {
            throw new Error('Invalid server value (B mod N == 0)');
        }

        // Step 2: Generate client ephemeral
        const a = this._bytesToBigInt(crypto.getRandomValues(new Uint8Array(32)));
        const A = this._modPow(this.g, a, this.N);

        // Security check: A mod N != 0
        if (A % this.N === 0n) {
            throw new Error('Invalid client value (A mod N == 0)');
        }

        // Step 3: Compute x
        const x = await this._computeX(username, password, saltBytes);

        // Step 4: Compute u = H(A || B)
        const u = await this._computeU(A, B);

        // Security check: u != 0
        if (u === 0n) {
            throw new Error('Invalid u value');
        }

        // Step 5: Compute S = (B - k*g^x)^(a + u*x) mod N
        const k = await this._computeK();
        const gx = this._modPow(this.g, x, this.N);
        const kgx = (k * gx) % this.N;
        let diff = B - kgx;
        if (diff < 0n) {
            diff = diff + this.N;
        }
        const exp = (a + u * x) % (this.N - 1n);
        const S = this._modPow(diff, exp, this.N);

        // Step 6: Compute K = H(S)
        const K = await this._hash(this._bigIntToBytes(S));

        // Step 7: Compute M1 (client proof)
        const M1 = await this._computeM1(username, saltBytes, A, B, K);

        // Step 8: Send proof to server
        const verifyResponse = await this._apiRequest('srp_verify', {
            session_id: session_id,
            client_public: this._bytesToBase64(this._bigIntToBytes(A)),
            client_proof: this._bytesToBase64(M1)
        });

        if (!verifyResponse.success) {
            const error = new Error(verifyResponse.msg || 'Authentication failed');
            error.errorCode = verifyResponse.error_code;
            throw error;
        }

        // Step 9: Verify server proof M2
        const serverM2 = this._base64ToBytes(verifyResponse.server_proof);
        const expectedM2 = await this._computeM2(A, M1, K);

        if (!this._constantTimeEqual(serverM2, expectedM2)) {
            throw new Error('Server proof invalid - possible MITM attack!');
        }

        // Success!
        return {
            success: true,
            session_id: verifyResponse.session_id,
            session_token: verifyResponse.session_token,
            user: verifyResponse.user,
            requires_2fa: verifyResponse.requires_2fa || false,
            domain_name_list: verifyResponse.domain_name_list || [],
            real_email_list: verifyResponse.real_email_list || {},
            migrate_to_srp: false  // Already using SRP
        };
    }

    /**
     * Migrate account to SRP after classic login
     *
     * @param {string} username - User's email/username
     * @param {string} password - User's password
     * @returns {Promise<object>} Migration result
     */
    async migrateToSrp(username, password) {
        try {
            // Generate SRP verifier
            const verifier = await this.generateVerifier(username, password);

            // Send to server
            const response = await this._apiRequest('srp_migrate', verifier);

            if (response.success) {
                console.log('[TrashMail SRP] Migration complete');
            } else {
                console.warn('[TrashMail SRP] Migration failed:', response.msg);
            }

            return response;

        } catch (error) {
            console.error('[TrashMail SRP] Migration error:', error);
            return { success: false, error: error.message };
        }
    }

    // =====================================================================
    // PRIVATE: Cryptographic Operations
    // =====================================================================

    /**
     * Compute x = H(salt, H(username:stretched_password))
     * This is where Argon2 hardening happens!
     */
    async _computeX(username, password, salt) {
        // Step 1: Stretch password with Argon2id
        const stretched = await this._argon2Stretch(password, salt);

        // Step 2: Standard SRP x computation
        const identity = username.toLowerCase() + ':' + this._bytesToHex(stretched);
        const identityHash = await this._hash(new TextEncoder().encode(identity));

        // Step 3: Final x = H(salt || identityHash)
        const combined = new Uint8Array(salt.length + identityHash.length);
        combined.set(salt, 0);
        combined.set(identityHash, salt.length);
        const xBytes = await this._hash(combined);

        return this._bytesToBigInt(xBytes);
    }

    /**
     * Argon2id password stretching
     */
    async _argon2Stretch(password, salt) {
        // Check if argon2 is available
        if (typeof argon2 === 'undefined') {
            throw new Error('Argon2 library not loaded. Include argon2-bundled.min.js.');
        }

        const result = await argon2.hash({
            pass: password,
            salt: salt,
            time: ARGON2_TIME,
            mem: ARGON2_MEMORY,
            hashLen: ARGON2_HASH_LENGTH,
            parallelism: ARGON2_PARALLELISM,
            type: argon2.ArgonType.Argon2id
        });

        return new Uint8Array(result.hash);
    }

    /**
     * Compute SRP-6a k = H(N || PAD(g))
     */
    async _computeK() {
        if (this.k !== null) {
            return this.k;
        }

        const Nbytes = this._bigIntToBytes(this.N);
        const gbytes = this._bigIntToBytes(this.g);

        // Pad g to same length as N
        const gPadded = new Uint8Array(Nbytes.length);
        gPadded.set(gbytes, Nbytes.length - gbytes.length);

        const combined = new Uint8Array(Nbytes.length + gPadded.length);
        combined.set(Nbytes, 0);
        combined.set(gPadded, Nbytes.length);

        const kBytes = await this._hash(combined);
        this.k = this._bytesToBigInt(kBytes);

        return this.k;
    }

    /**
     * Compute u = H(A || B)
     */
    async _computeU(A, B) {
        const Abytes = this._bigIntToBytes(A);
        const Bbytes = this._bigIntToBytes(B);

        const combined = new Uint8Array(Abytes.length + Bbytes.length);
        combined.set(Abytes, 0);
        combined.set(Bbytes, Abytes.length);

        const uBytes = await this._hash(combined);
        return this._bytesToBigInt(uBytes);
    }

    /**
     * Compute M1 = H(H(N) XOR H(g), H(username), salt, A, B, K)
     */
    async _computeM1(username, salt, A, B, K) {
        const HN = await this._hash(this._bigIntToBytes(this.N));
        const Hg = await this._hash(this._bigIntToBytes(this.g));

        // XOR HN and Hg
        const HNxorHg = new Uint8Array(HN.length);
        for (let i = 0; i < HN.length; i++) {
            HNxorHg[i] = HN[i] ^ Hg[i];
        }

        const Husername = await this._hash(new TextEncoder().encode(username.toLowerCase()));
        const Abytes = this._bigIntToBytes(A);
        const Bbytes = this._bigIntToBytes(B);

        // Concatenate all parts
        const totalLen = HNxorHg.length + Husername.length + salt.length +
                         Abytes.length + Bbytes.length + K.length;
        const combined = new Uint8Array(totalLen);

        let offset = 0;
        combined.set(HNxorHg, offset); offset += HNxorHg.length;
        combined.set(Husername, offset); offset += Husername.length;
        combined.set(salt, offset); offset += salt.length;
        combined.set(Abytes, offset); offset += Abytes.length;
        combined.set(Bbytes, offset); offset += Bbytes.length;
        combined.set(K, offset);

        return await this._hash(combined);
    }

    /**
     * Compute M2 = H(A, M1, K)
     */
    async _computeM2(A, M1, K) {
        const Abytes = this._bigIntToBytes(A);
        const combined = new Uint8Array(Abytes.length + M1.length + K.length);

        combined.set(Abytes, 0);
        combined.set(M1, Abytes.length);
        combined.set(K, Abytes.length + M1.length);

        return await this._hash(combined);
    }

    // =====================================================================
    // PRIVATE: Utilities
    // =====================================================================

    /**
     * SHA-256 hash
     */
    async _hash(data) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(hashBuffer);
    }

    /**
     * Modular exponentiation: base^exp mod mod
     */
    _modPow(base, exp, mod) {
        let result = 1n;
        base = base % mod;

        while (exp > 0n) {
            if (exp % 2n === 1n) {
                result = (result * base) % mod;
            }
            exp = exp / 2n;
            base = (base * base) % mod;
        }

        return result;
    }

    /**
     * Convert BigInt to Uint8Array
     */
    _bigIntToBytes(num) {
        let hex = num.toString(16);
        if (hex.length % 2 !== 0) {
            hex = '0' + hex;
        }
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    /**
     * Convert Uint8Array to BigInt
     */
    _bytesToBigInt(bytes) {
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
        }
        return BigInt('0x' + hex);
    }

    /**
     * Convert Uint8Array to hex string
     */
    _bytesToHex(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Convert Uint8Array to Base64
     */
    _bytesToBase64(bytes) {
        return btoa(String.fromCharCode.apply(null, bytes));
    }

    /**
     * Convert Base64 to Uint8Array
     */
    _base64ToBytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Constant-time comparison (mitigates timing attacks)
     */
    _constantTimeEqual(a, b) {
        if (a.length !== b.length) {
            return false;
        }

        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a[i] ^ b[i];
        }

        return result === 0;
    }

    /**
     * Make API request using the addon's API_BASE_URL
     */
    async _apiRequest(cmd, params) {
        // Use API_BASE_URL from api.js (global variable)
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://trashmail.com';
        const lang = browser.i18n.getUILanguage().substr(0, 2);

        const response = await fetch(baseUrl + '/?api=1&cmd=' + cmd + '&lang=' + lang, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        return await response.json();
    }
}

// Create global instance
const addonSrpClient = new AddonSrpClient();
