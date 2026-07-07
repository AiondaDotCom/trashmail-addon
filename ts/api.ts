// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

// API Base URL - can be overridden via hidden debug option
const DEFAULT_API_URL = "https://mail.aionda.com";
let apiBaseUrl = DEFAULT_API_URL;

// ============================================================
// Response Signature Verification (MITM Protection)
// ============================================================

interface ApiKeyEntry {
    cryptoKey: CryptoKey;
    validUntil: Date;
}

interface PublicKeyFile {
    keys: Record<string, { public_key: string; valid_until: string }>;
}

interface VerificationResult {
    valid: boolean;
    reason?: string | null;
}

/** Error enriched with the extra fields consumers rely on at runtime. */
interface ApiError extends Error {
    securityError?: boolean;
    reason?: string | null;
    requires_2fa?: boolean;
    url?: string;
    extension_html?: string;
    errorCode?: number;
}

const apiPublicKeys = new Map<string, ApiKeyEntry>(); // keyId -> CryptoKey
let apiKeysLoaded = false;

/**
 * Convert Base64 to ArrayBuffer
 */
function apiBase64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Load public keys for signature verification
 */
async function loadApiPublicKeys(): Promise<boolean> {
    if (apiKeysLoaded) {
        return true;
    }

    try {
        const response = await fetch(browser.runtime.getURL("public_key.json"));
        if (!response.ok) {
            console.warn("[API] public_key.json not found - signature verification disabled");
            return false;
        }

        const keyData = await response.json() as PublicKeyFile;

        for (const [keyId, keyInfo] of Object.entries(keyData.keys)) {
            try {
                const keyBuffer = apiBase64ToArrayBuffer(keyInfo.public_key);
                const cryptoKey = await crypto.subtle.importKey(
                    "spki",
                    keyBuffer,
                    { name: "Ed25519" },
                    false,
                    ["verify"]
                );
                apiPublicKeys.set(keyId, {
                    cryptoKey: cryptoKey,
                    validUntil: new Date(keyInfo.valid_until)
                });
            } catch (err) {
                console.error(`[API] Failed to import key ${keyId}:`, err);
            }
        }

        apiKeysLoaded = apiPublicKeys.size > 0;
        return apiKeysLoaded;
    } catch (err) {
        console.error("[API] Failed to load public keys:", err);
        return false;
    }
}

/**
 * Verify response signature
 * @returns {Object} - { valid: boolean, reason?: string }
 */
async function verifyApiResponse(body: string, signature: string, timestamp: string, keyId: string): Promise<VerificationResult> {
    const keyInfo = apiPublicKeys.get(keyId);
    if (!keyInfo) {
        return { valid: false, reason: `Unknown key ID: ${keyId}` };
    }

    // Check if key has expired
    if (new Date() > keyInfo.validUntil) {
        return { valid: false, reason: `Key ${keyId} expired` };
    }

    // Verify timestamp (max 5 minutes old)
    const timestampDate = new Date(Number(timestamp) * 1000);
    const ageSeconds = Math.abs((Date.now() - timestampDate.getTime()) / 1000);
    if (ageSeconds > 300) {
        return { valid: false, reason: `Timestamp too old: ${ageSeconds}s` };
    }

    // Verify signature
    const dataToVerify = `${body}|${timestamp}`;
    const dataBuffer = new TextEncoder().encode(dataToVerify);
    const signatureBuffer = apiBase64ToArrayBuffer(signature);

    try {
        const valid = await crypto.subtle.verify(
            { name: "Ed25519" },
            keyInfo.cryptoKey,
            signatureBuffer,
            dataBuffer
        );

        return {
            valid: valid,
            reason: valid ? null : "Signature mismatch - possible MITM attack!"
        };
    } catch (err) {
        return { valid: false, reason: `Verification error: ${(err as Error).message}` };
    }
}

// Load custom API URL from storage (for debugging)
async function loadApiBaseUrl(): Promise<void> {
    try {
        const result = await browser.storage.local.get("debugApiUrl");
        if (result.debugApiUrl) {
            apiBaseUrl = result.debugApiUrl as string;
            console.log("[TrashMail Debug] Using custom API URL:", apiBaseUrl);
        }
    } catch (e) {
        // Ignore errors, use default
    }
}

// Initialize API URL on load
loadApiBaseUrl();

// http://www.totallystupid.com/?what=3
const PREFIXES: string[] = ["abs","aby","ace","act","add","ado","ads","aft","age","ago","aid","ail","aim","air","ait","ale","all","amp","and","ant","any","ape","apt","arc","are","ark","arm","art","ash","ask","asp","ate","auk","awe","awl","awn","axe","azo","baa","bad","bag","bah","bam","ban","bar","bat","bay","bed","bee","beg","bet","bey","bib","bid","big","bin","bio","bit","boa","bob","bod","bog","boo","bop","bot","bow","box","boy","bra","bro","bub","bud","bug","bum","bun","bus","but","buy","bye","cab","cad","cam","can","cap","car","cat","caw","cee","cha","chi","cob","cod","cog","con","coo","cop","cot","cow","cox","coy","cry","cub","cud","cue","cup","cur","cut","dab","dad","dag","dam","day","dee","den","dew","dib","did","die","dig","dim","din","dip","doe","dog","don","doo","dop","dot","dry","dub","dud","due","dug","duh","dun","duo","dux","dye","ear","eat","ebb","eel","egg","ego","eke","elf","elk","elm","emo","emu","end","eon","era","erg","err","eve","ewe","eye","fab","fad","fag","fan","far","far","fat","fax","fay","fed","fee","fen","few","fey","fez","fib","fie","fig","fin","fir","fit","fix","fly","fob","foe","fog","fon","fop","for","fox","fry","fun","fur","gab","gag","gak","gal","gap","gas","gaw","gay","gee","gel","gem","get","gig","gil","gin","git","gnu","gob","God","goo","got","gum","gun","gut","guy","gym","had","hag","hal","ham","has","hat","hay","hem","hen","her","hew","hex","hey","hid","him","hip","his","hit","hoe","hog","hop","hot","how","hoy","hub","hue","hug","hug","huh","hum","hut","ice","ick","icy","ilk","ill","imp","ink","inn","ion","ire","irk","ism","its","jab","jag","jah","jak","jam","jap","jar","jaw","jay","jem","jet","Jew","jib","jig","job","joe","jog","jon","jot","joy","jug","jus","jut","keg","key","kid","kin","kit","koa","kob","koi","lab","lad","lag","lap","law","lax","lay","lea","led","leg","lei","let","lew","lid","lie","lip","lit","lob","log","loo","lop","lot","low","lug","lux","lye","mac","mad","mag","man","map","mar","mat","maw","max","may","men","met","mic","mid","mit","mix","mob","mod","mog","mom","mon","moo","mop","mow","mud","mug","mum","nab","nag","nap","nay","nee","neo","net","new","nib","nil","nip","nit","nix","nob","nod","nog","nor","not","now","nub","nun","nut","oaf","oak","oar","oat","odd","ode","off","oft","ohm","oil","old","ole","one","opt","orb","ore","our","out","out","ova","owe","owl","own","pac","pad","pal","pan","pap","par","pat","paw","pax","pay","pea","pee","peg","pen","pep","per","pet","pew","pic","pie","pig","pin","pip","pit","pix","ply","pod","pog","poi","poo","pop","pot","pow","pox","pro","pry","pub","pud","pug","pun","pup","pus","put","pyx","qat","qua","quo","rad","rag","ram","ran","rap","rat","raw","ray","red","rib","rid","rig","rim","rip","rob","roc","rod","roe","rot","row","rub","rue","rug","rum","run","rut","rye","sac","sad","sag","sap","sat","saw","sax","say","sea","sec","see","set","sew","sex","she","shy","sic","sim","sin","sip","sir","sis","sit","six","ski","sky","sly","sob","sod","som","son","sop","sot","sow","soy","spa","spy","sty","sub","sue","sum","sun","sun","sup","tab","tad","tag","tam","tan","tap","tar","tat","tax","tea","tee","ten","the","tic","tie","til","tin","tip","tit","toe","toe","tom","ton","too","top","tot","tow","toy","try","tub","tug","tui","tut","two","ugh","uke","ump","urn","use","van","vat","vee","vet","vex","via","vie","vig","vim","voe","vow","wad","wag","wan","war","was","wax","way","web","wed","wee","wen","wet","who","why","wig","win","wit","wiz","woe","wog","wok","won","woo","wow","wry","wye","yak","yam","yap","yaw","yay","yea","yen","yep","yes","yet","yew","yip","you","yow","yum","yup","zag","zap","zed","zee","zen","zig","zip","zit","zoa","zoo"];

async function callAPI(data: Record<string, unknown>, json: Record<string, unknown> | null = null): Promise<TmApiResponse> {
    // Ensure public keys are loaded for signature verification
    await loadApiPublicKeys();

    const headers = new Headers({"Content-Type": "application/x-www-form-urlencoded"});
    const params = new URLSearchParams(data as Record<string, string>);
    params.append("lang", browser.i18n.getUILanguage().substr(0, 2));
    // credentials: "omit" - niemals Webapp-Cookies mitschicken! Sonst greift
    // z.B. bei opaque_register_init oder add_real_email die fremde
    // Browser-Session (mail.aionda.com) statt der Addon-session_id.
    const fetchOptions: RequestInit = {"method": "POST", "headers": headers, "body": JSON.stringify(json), "credentials": "omit"};

    const response = await fetch(`${apiBaseUrl}/?api=1&${params.toString()}`, fetchOptions);

    if (!response.ok) {
        // Auch Fehler-Responses (z.B. 429 Rate-Limit) tragen eine lokalisierte
        // msg im JSON-Body - die dem User zeigen statt der rohen Statuszeile.
        let serverMessage = "";
        let serverErrorCode: number | undefined;
        let serverRemaining: number | undefined;
        try {
            const errorBody = JSON.parse(await response.text()) as { msg?: string; error_code?: number; remaining_seconds?: number };
            serverMessage = errorBody.msg ?? "";
            serverErrorCode = errorBody.error_code;
            serverRemaining = errorBody.remaining_seconds;
        } catch {
            // Kein JSON (z.B. Proxy-Fehlerseite) - generische Meldung nutzen
        }
        const error = new Error(serverMessage || `${response.status} ${response.statusText} Error occurred.`) as Error & { errorCode?: number; httpStatus?: number; remainingSeconds?: number };
        error.errorCode = serverErrorCode;
        error.httpStatus = response.status;
        error.remainingSeconds = serverRemaining;
        throw error;
    }

    // Get signature headers
    const signature = response.headers.get("x-aionda-signature");
    const timestamp = response.headers.get("x-aionda-timestamp");
    const keyId = response.headers.get("x-aionda-key-id");

    // Read body as text for verification
    const bodyText = await response.text();

    // Verify signature if headers are present and keys are loaded
    if (apiKeysLoaded && signature && timestamp && keyId) {
        // Validate that key-id matches the server we're talking to
        const isDev = apiBaseUrl.includes("dev.mail.aionda.com");
        const expectedKeyPrefix = isDev ? "dev-" : "prod-";

        if (!keyId.startsWith(expectedKeyPrefix)) {
            console.error(`[API] SECURITY WARNING: Key ID mismatch! Expected ${expectedKeyPrefix}* but got ${keyId}`);
            const error = new Error("Security Error: Invalid key for this server") as ApiError;
            error.securityError = true;
            throw error;
        }

        const verification = await verifyApiResponse(bodyText, signature, timestamp, keyId);
        if (!verification.valid) {
            console.error("[API] SECURITY WARNING: Signature verification failed!", verification.reason);
            const error = new Error(`Security Error: ${verification.reason}`) as ApiError;
            error.securityError = true;
            error.reason = verification.reason;
            throw error;
        }
        console.log(`[API] Response signature verified (Key: ${keyId})`);
    } else if (signature || timestamp || keyId) {
        // Some but not all headers present - suspicious
        console.warn("[API] Incomplete signature headers - skipping verification");
    }

    // Parse JSON after verification
    let jsonResponse: TmApiResponse;
    try {
        jsonResponse = JSON.parse(bodyText);
    } catch (e) {
        throw new Error("Invalid JSON response from server");
    }

    let msg = jsonResponse["message"];
    if (msg === undefined) {
        msg = jsonResponse["msg"];
    }
    if (msg === undefined) {
        msg = jsonResponse["data"];
    }

    // Check for 2FA required FIRST (before success check)
    // API returns success:true with requires_2fa:true
    const dataField = jsonResponse["data"] as Record<string, unknown> | undefined;
    if (dataField && dataField["requires_2fa"]) {
        const error = new Error((dataField["pat_hint"] as string | undefined) || (msg as string | undefined) || "2FA required. Please create a Personal Access Token in the Aionda Mail Manager and use it as password.") as ApiError;
        error.requires_2fa = true;
        error.url = dataField["url"] as string | undefined;
        error.extension_html = dataField["extension_html"] as string | undefined;
        throw error;
    }

    if (jsonResponse["success"]) {
        return msg as TmApiResponse;
    }

    // Build a human-readable error message. Never throw an empty or
    // non-string Error: an empty rejection surfaces in Firefox/Chrome as the
    // cryptic "Error message from listener couldn't be parsed or was empty."
    // instead of telling the user what to do.
    let errorText;
    if (typeof msg === "string" && msg.trim() !== "") {
        errorText = msg;
    } else {
        const errorCode = jsonResponse["error_code"];
        // Auth/session errors -> tell the user to re-login via the options page.
        // 2 = not logged in / no session, 3 = wrong user/pass,
        // 5 = invalid password, 10 = invalid security token, 61 = auth error.
        const AUTH_ERROR_CODES = [2, 3, 5, 10, 61];
        if (typeof errorCode === "number" && AUTH_ERROR_CODES.includes(errorCode)) {
            errorText = browser.i18n.getMessage("errorSessionExpired") ||
                "Your session has expired. Please log in again via the extension options.";
        } else {
            errorText = browser.i18n.getMessage("errorGenericServer") ||
                (`The server returned an error${errorCode !== undefined ? ` (code ${errorCode})` : ""}. Please log in again via the extension options.`);
        }
    }
    const error = new Error(errorText) as ApiError;
    if (jsonResponse["error_code"] !== undefined) {
        error.errorCode = jsonResponse["error_code"] as number;
    }
    throw error;
}

/**
 * Check if a password is a Personal Access Token (PAT)
 * PATs start with "tmpat_" prefix
 */
function isPAT(password: string): boolean {
    return Boolean(password) && typeof password === "string" && password.startsWith("tmpat_") && password.length > 6;
}

/**
 * Get the current API base URL (reads from storage for debug mode)
 * @returns {Promise<string>} - The API base URL
 */
async function getApiBaseUrl(): Promise<string> {
    try {
        const result = await browser.storage.local.get("debugApiUrl");
        if (result.debugApiUrl) {
            return result.debugApiUrl as string;
        }
    } catch (e) {
        // Ignore errors, use default
    }
    return DEFAULT_API_URL;
}

/**
 * Create a Personal Access Token via API
 * @param {string} sessionId - The session ID from login
 * @param {string} tokenName - Name for the token (e.g., "Firefox Extension")
 * @returns {Promise<string>} - The created token
 */
function createAccessToken(sessionId: string, tokenName: string): Promise<string> {
    const data = {
        "cmd": "create_access_token",
        "session_id": sessionId
    };
    const json = {
        "name": tokenName
    };

    return callAPI(data, json).then((result) => {
        if (result && result.token) {
            return result.token as string;
        }
        throw new Error("Failed to create access token");
    });
}

/**
 * Oeffnet den Web-Adressmanager als eingeloggten Tab.
 *
 * Etabliert die Website-Session per POST-Login MIT Browser-Cookies
 * (PAT-Konten via OPAQUE-Handshake, klassische Konten via cmd=login mit
 * Zugangsdaten im Request-BODY). Es landet also weder session_id noch
 * Passwort in der URL - der Manager-Tab oeffnet nackt mit ?cmd=manager
 * und ist ueber das frisch gesetzte Session-Cookie authentifiziert.
 */
async function openAddressManagerAuthenticated(): Promise<void> {
    const lang = browser.i18n.getUILanguage().substr(0, 2);
    const sync = await browser.storage.sync.get(["username", "password"]) as { username?: string; password?: string };
    const username = sync.username;
    const password = sync.password;
    if (!username || !password) {
        throw new Error(browser.i18n.getMessage("errorSessionExpired") ||
            "Your session has expired. Please use \"Switch login\" to log in again.");
    }

    const baseUrl = await getApiBaseUrl();

    if (isPAT(password)) {
        // PAT lebt in mail_opaque_access_tokens und ist nur per OPAQUE
        // verifizierbar - der Handshake setzt mit establishBrowserSession
        // das Session-Cookie im Browser.
        if (typeof addonOpaqueClient === "undefined") {
            throw new Error("OPAQUE client not loaded. Please reload.");
        }
        await addonOpaqueClient.patOpaqueLogin(username, password, { establishBrowserSession: true });
    } else {
        // Klassisches Konto: POST-Login mit Cookies, Zugangsdaten im Body
        const response = await fetch(`${baseUrl}/?api=1&cmd=login&lang=${lang}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "fe-login-user": username, "fe-login-pass": password }),
        });
        const result = JSON.parse(await response.text()) as { error?: string; msg?: string; success?: boolean };
        if (result.error || result.success === false) {
            throw new Error(result.msg || result.error || "Login failed");
        }
    }

    await browser.tabs.create({ "url": `${baseUrl}/?cmd=manager&lang=${lang}` });
}

// esbuild wraps this bundle in an IIFE, so the declarations above are NOT
// global anymore. Publish the cross-file surface explicitly (see global.d.ts).
Object.assign(globalThis, { callAPI, isPAT, createAccessToken, getApiBaseUrl, loadApiBaseUrl, PREFIXES, DEFAULT_API_URL, openAddressManagerAuthenticated });
// API_BASE_URL is mutable (reassigned by loadApiBaseUrl) and read as a live
// global by other files - expose it via a getter over the internal let.
// The setter is needed by the hidden debug panel in options.ts, which
// overrides the API URL at runtime.
Object.defineProperty(globalThis, "API_BASE_URL", {
    get: () => apiBaseUrl,
    set: (value: string) => { apiBaseUrl = value; },
});

export {};
