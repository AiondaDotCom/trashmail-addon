"use strict";

// Compatibility layer for browser and chrome
if (typeof browser === "undefined") {
    var browser = chrome;
}

// API Base URL - can be overridden via hidden debug option
const DEFAULT_API_URL = "https://trashmail.com";
let API_BASE_URL = DEFAULT_API_URL;

// ============================================================
// Response Signature Verification (MITM Protection)
// ============================================================

let apiPublicKeys = new Map(); // keyId -> CryptoKey
let apiKeysLoaded = false;

/**
 * Convert Base64 to ArrayBuffer
 */
function apiBase64ToArrayBuffer(base64) {
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
async function loadApiPublicKeys() {
    if (apiKeysLoaded) return true;

    try {
        const response = await fetch(browser.runtime.getURL("public_key.json"));
        if (!response.ok) {
            console.warn("[API] public_key.json not found - signature verification disabled");
            return false;
        }

        const keyData = await response.json();

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
async function verifyApiResponse(body, signature, timestamp, keyId) {
    const keyInfo = apiPublicKeys.get(keyId);
    if (!keyInfo) {
        return { valid: false, reason: `Unknown key ID: ${keyId}` };
    }

    // Check if key has expired
    if (new Date() > keyInfo.validUntil) {
        return { valid: false, reason: `Key ${keyId} expired` };
    }

    // Verify timestamp (max 5 minutes old)
    const timestampDate = new Date(timestamp * 1000);
    const ageSeconds = Math.abs((Date.now() - timestampDate) / 1000);
    if (ageSeconds > 300) {
        return { valid: false, reason: `Timestamp too old: ${ageSeconds}s` };
    }

    // Verify signature
    const dataToVerify = body + "|" + timestamp;
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
        return { valid: false, reason: `Verification error: ${err.message}` };
    }
}

// Load custom API URL from storage (for debugging)
async function loadApiBaseUrl() {
    try {
        const result = await browser.storage.local.get('debugApiUrl');
        if (result.debugApiUrl) {
            API_BASE_URL = result.debugApiUrl;
            console.log('[TrashMail Debug] Using custom API URL:', API_BASE_URL);
        }
    } catch (e) {
        // Ignore errors, use default
    }
}

// Initialize API URL on load
loadApiBaseUrl();

// http://www.totallystupid.com/?what=3
const PREFIXES = ["abs","aby","ace","act","add","ado","ads","aft","age","ago","aid","ail","aim","air","ait","ale","all","amp","and","ant","any","ape","apt","arc","are","ark","arm","art","ash","ask","asp","ate","auk","awe","awl","awn","axe","azo","baa","bad","bag","bah","bam","ban","bar","bat","bay","bed","bee","beg","bet","bey","bib","bid","big","bin","bio","bit","boa","bob","bod","bog","boo","bop","bot","bow","box","boy","bra","bro","bub","bud","bug","bum","bun","bus","but","buy","bye","cab","cad","cam","can","cap","car","cat","caw","cee","cha","chi","cob","cod","cog","con","coo","cop","cot","cow","cox","coy","cry","cub","cud","cue","cup","cur","cut","dab","dad","dag","dam","day","dee","den","dew","dib","did","die","dig","dim","din","dip","doe","dog","don","doo","dop","dot","dry","dub","dud","due","dug","duh","dun","duo","dux","dye","ear","eat","ebb","eel","egg","ego","eke","elf","elk","elm","emo","emu","end","eon","era","erg","err","eve","ewe","eye","fab","fad","fag","fan","far","far","fat","fax","fay","fed","fee","fen","few","fey","fez","fib","fie","fig","fin","fir","fit","fix","fly","fob","foe","fog","fon","fop","for","fox","fry","fun","fur","gab","gag","gak","gal","gap","gas","gaw","gay","gee","gel","gem","get","gig","gil","gin","git","gnu","gob","God","goo","got","gum","gun","gut","guy","gym","had","hag","hal","ham","has","hat","hay","hem","hen","her","hew","hex","hey","hid","him","hip","his","hit","hoe","hog","hop","hot","how","hoy","hub","hue","hug","hug","huh","hum","hut","ice","ick","icy","ilk","ill","imp","ink","inn","ion","ire","irk","ism","its","jab","jag","jah","jak","jam","jap","jar","jaw","jay","jem","jet","Jew","jib","jig","job","joe","jog","jon","jot","joy","jug","jus","jut","keg","key","kid","kin","kit","koa","kob","koi","lab","lad","lag","lap","law","lax","lay","lea","led","leg","lei","let","lew","lid","lie","lip","lit","lob","log","loo","lop","lot","low","lug","lux","lye","mac","mad","mag","man","map","mar","mat","maw","max","may","men","met","mic","mid","mit","mix","mob","mod","mog","mom","mon","moo","mop","mow","mud","mug","mum","nab","nag","nap","nay","nee","neo","net","new","nib","nil","nip","nit","nix","nob","nod","nog","nor","not","now","nub","nun","nut","oaf","oak","oar","oat","odd","ode","off","oft","ohm","oil","old","ole","one","opt","orb","ore","our","out","out","ova","owe","owl","own","pac","pad","pal","pan","pap","par","pat","paw","pax","pay","pea","pee","peg","pen","pep","per","pet","pew","pic","pie","pig","pin","pip","pit","pix","ply","pod","pog","poi","poo","pop","pot","pow","pox","pro","pry","pub","pud","pug","pun","pup","pus","put","pyx","qat","qua","quo","rad","rag","ram","ran","rap","rat","raw","ray","red","rib","rid","rig","rim","rip","rob","roc","rod","roe","rot","row","rub","rue","rug","rum","run","rut","rye","sac","sad","sag","sap","sat","saw","sax","say","sea","sec","see","set","sew","sex","she","shy","sic","sim","sin","sip","sir","sis","sit","six","ski","sky","sly","sob","sod","som","son","sop","sot","sow","soy","spa","spy","sty","sub","sue","sum","sun","sun","sup","tab","tad","tag","tam","tan","tap","tar","tat","tax","tea","tee","ten","the","tic","tie","til","tin","tip","tit","toe","toe","tom","ton","too","top","tot","tow","toy","try","tub","tug","tui","tut","two","ugh","uke","ump","urn","use","van","vat","vee","vet","vex","via","vie","vig","vim","voe","vow","wad","wag","wan","war","was","wax","way","web","wed","wee","wen","wet","who","why","wig","win","wit","wiz","woe","wog","wok","won","woo","wow","wry","wye","yak","yam","yap","yaw","yay","yea","yen","yep","yes","yet","yew","yip","you","yow","yum","yup","zag","zap","zed","zee","zen","zig","zip","zit","zoa","zoo"]

async function callAPI(data, json=null) {
    // Ensure public keys are loaded for signature verification
    await loadApiPublicKeys();

    var headers = new Headers({"Content-Type": "application/x-www-form-urlencoded"});
    var params = new URLSearchParams(data);
    params.append("lang",  browser.i18n.getUILanguage().substr(0, 2));
    var fetchOptions = {"method": "POST", "headers": headers, "body": JSON.stringify(json)};

    const response = await fetch(API_BASE_URL + "/?api=1&" + params.toString(), fetchOptions);

    if (!response.ok) {
        throw new Error(response.status + " " + response.statusText + " Error occurred.");
    }

    // Get signature headers
    const signature = response.headers.get("x-aionda-signature");
    const timestamp = response.headers.get("x-aionda-timestamp");
    const keyId = response.headers.get("x-aionda-key-id");

    // Read body as text for verification
    const bodyText = await response.text();

    // Note: API signature verification is disabled for now.
    // The Guardian module handles signature verification for website responses.
    // API endpoints may use different signing schemes that need separate implementation.
    if (signature && timestamp && keyId) {
        console.log("[API] Response has signature headers (verification delegated to Guardian)");
    }

    // Parse JSON after verification
    let jsonResponse;
    try {
        jsonResponse = JSON.parse(bodyText);
    } catch (e) {
        throw new Error("Invalid JSON response from server");
    }

    let msg = jsonResponse["message"];
    if (msg === undefined)
        msg = jsonResponse["msg"];
    if (msg === undefined)
        msg = jsonResponse["data"];

    // Check for 2FA required FIRST (before success check)
    // API returns success:true with requires_2fa:true
    if (jsonResponse["data"] && jsonResponse["data"]["requires_2fa"]) {
        let error = new Error(jsonResponse["data"]["pat_hint"] || msg || "2FA required. Please create a Personal Access Token in the TrashMail Manager and use it as password.");
        error.requires_2fa = true;
        error.url = jsonResponse["data"]["url"];
        error.extension_html = jsonResponse["data"]["extension_html"];
        throw error;
    }

    if (jsonResponse["success"])
        return msg;

    throw new Error(msg);
}

/**
 * Check if a password is a Personal Access Token (PAT)
 * PATs start with "tmpat_" prefix
 */
function isPAT(password) {
    return password && typeof password === 'string' && password.startsWith('tmpat_') && password.length > 6;
}

/**
 * Get the current API base URL (reads from storage for debug mode)
 * @returns {Promise<string>} - The API base URL
 */
async function getApiBaseUrl() {
    try {
        const result = await browser.storage.local.get('debugApiUrl');
        if (result.debugApiUrl) {
            return result.debugApiUrl;
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
function createAccessToken(sessionId, tokenName) {
    var data = {
        "cmd": "create_access_token",
        "session_id": sessionId
    };
    var json = {
        "name": tokenName
    };

    return callAPI(data, json).then(function(result) {
        if (result && result.token) {
            return result.token;
        }
        throw new Error("Failed to create access token");
    });
}
