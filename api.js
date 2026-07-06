"use strict";
(() => {
  // trashmail-addon/ts/api.ts
  var browser = globalThis.browser ?? chrome;
  var DEFAULT_API_URL = "https://mail.aionda.com";
  var apiBaseUrl = DEFAULT_API_URL;
  var apiPublicKeys = /* @__PURE__ */ new Map();
  var apiKeysLoaded = false;
  function apiBase64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  async function loadApiPublicKeys() {
    if (apiKeysLoaded) {
      return true;
    }
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
            cryptoKey,
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
  async function verifyApiResponse(body, signature, timestamp, keyId) {
    const keyInfo = apiPublicKeys.get(keyId);
    if (!keyInfo) {
      return { valid: false, reason: `Unknown key ID: ${keyId}` };
    }
    if (/* @__PURE__ */ new Date() > keyInfo.validUntil) {
      return { valid: false, reason: `Key ${keyId} expired` };
    }
    const timestampDate = new Date(Number(timestamp) * 1e3);
    const ageSeconds = Math.abs((Date.now() - timestampDate.getTime()) / 1e3);
    if (ageSeconds > 300) {
      return { valid: false, reason: `Timestamp too old: ${ageSeconds}s` };
    }
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
        valid,
        reason: valid ? null : "Signature mismatch - possible MITM attack!"
      };
    } catch (err) {
      return { valid: false, reason: `Verification error: ${err.message}` };
    }
  }
  async function loadApiBaseUrl() {
    try {
      const result = await browser.storage.local.get("debugApiUrl");
      if (result.debugApiUrl) {
        apiBaseUrl = result.debugApiUrl;
        console.log("[TrashMail Debug] Using custom API URL:", apiBaseUrl);
      }
    } catch (e) {
    }
  }
  loadApiBaseUrl();
  var PREFIXES = ["abs", "aby", "ace", "act", "add", "ado", "ads", "aft", "age", "ago", "aid", "ail", "aim", "air", "ait", "ale", "all", "amp", "and", "ant", "any", "ape", "apt", "arc", "are", "ark", "arm", "art", "ash", "ask", "asp", "ate", "auk", "awe", "awl", "awn", "axe", "azo", "baa", "bad", "bag", "bah", "bam", "ban", "bar", "bat", "bay", "bed", "bee", "beg", "bet", "bey", "bib", "bid", "big", "bin", "bio", "bit", "boa", "bob", "bod", "bog", "boo", "bop", "bot", "bow", "box", "boy", "bra", "bro", "bub", "bud", "bug", "bum", "bun", "bus", "but", "buy", "bye", "cab", "cad", "cam", "can", "cap", "car", "cat", "caw", "cee", "cha", "chi", "cob", "cod", "cog", "con", "coo", "cop", "cot", "cow", "cox", "coy", "cry", "cub", "cud", "cue", "cup", "cur", "cut", "dab", "dad", "dag", "dam", "day", "dee", "den", "dew", "dib", "did", "die", "dig", "dim", "din", "dip", "doe", "dog", "don", "doo", "dop", "dot", "dry", "dub", "dud", "due", "dug", "duh", "dun", "duo", "dux", "dye", "ear", "eat", "ebb", "eel", "egg", "ego", "eke", "elf", "elk", "elm", "emo", "emu", "end", "eon", "era", "erg", "err", "eve", "ewe", "eye", "fab", "fad", "fag", "fan", "far", "far", "fat", "fax", "fay", "fed", "fee", "fen", "few", "fey", "fez", "fib", "fie", "fig", "fin", "fir", "fit", "fix", "fly", "fob", "foe", "fog", "fon", "fop", "for", "fox", "fry", "fun", "fur", "gab", "gag", "gak", "gal", "gap", "gas", "gaw", "gay", "gee", "gel", "gem", "get", "gig", "gil", "gin", "git", "gnu", "gob", "God", "goo", "got", "gum", "gun", "gut", "guy", "gym", "had", "hag", "hal", "ham", "has", "hat", "hay", "hem", "hen", "her", "hew", "hex", "hey", "hid", "him", "hip", "his", "hit", "hoe", "hog", "hop", "hot", "how", "hoy", "hub", "hue", "hug", "hug", "huh", "hum", "hut", "ice", "ick", "icy", "ilk", "ill", "imp", "ink", "inn", "ion", "ire", "irk", "ism", "its", "jab", "jag", "jah", "jak", "jam", "jap", "jar", "jaw", "jay", "jem", "jet", "Jew", "jib", "jig", "job", "joe", "jog", "jon", "jot", "joy", "jug", "jus", "jut", "keg", "key", "kid", "kin", "kit", "koa", "kob", "koi", "lab", "lad", "lag", "lap", "law", "lax", "lay", "lea", "led", "leg", "lei", "let", "lew", "lid", "lie", "lip", "lit", "lob", "log", "loo", "lop", "lot", "low", "lug", "lux", "lye", "mac", "mad", "mag", "man", "map", "mar", "mat", "maw", "max", "may", "men", "met", "mic", "mid", "mit", "mix", "mob", "mod", "mog", "mom", "mon", "moo", "mop", "mow", "mud", "mug", "mum", "nab", "nag", "nap", "nay", "nee", "neo", "net", "new", "nib", "nil", "nip", "nit", "nix", "nob", "nod", "nog", "nor", "not", "now", "nub", "nun", "nut", "oaf", "oak", "oar", "oat", "odd", "ode", "off", "oft", "ohm", "oil", "old", "ole", "one", "opt", "orb", "ore", "our", "out", "out", "ova", "owe", "owl", "own", "pac", "pad", "pal", "pan", "pap", "par", "pat", "paw", "pax", "pay", "pea", "pee", "peg", "pen", "pep", "per", "pet", "pew", "pic", "pie", "pig", "pin", "pip", "pit", "pix", "ply", "pod", "pog", "poi", "poo", "pop", "pot", "pow", "pox", "pro", "pry", "pub", "pud", "pug", "pun", "pup", "pus", "put", "pyx", "qat", "qua", "quo", "rad", "rag", "ram", "ran", "rap", "rat", "raw", "ray", "red", "rib", "rid", "rig", "rim", "rip", "rob", "roc", "rod", "roe", "rot", "row", "rub", "rue", "rug", "rum", "run", "rut", "rye", "sac", "sad", "sag", "sap", "sat", "saw", "sax", "say", "sea", "sec", "see", "set", "sew", "sex", "she", "shy", "sic", "sim", "sin", "sip", "sir", "sis", "sit", "six", "ski", "sky", "sly", "sob", "sod", "som", "son", "sop", "sot", "sow", "soy", "spa", "spy", "sty", "sub", "sue", "sum", "sun", "sun", "sup", "tab", "tad", "tag", "tam", "tan", "tap", "tar", "tat", "tax", "tea", "tee", "ten", "the", "tic", "tie", "til", "tin", "tip", "tit", "toe", "toe", "tom", "ton", "too", "top", "tot", "tow", "toy", "try", "tub", "tug", "tui", "tut", "two", "ugh", "uke", "ump", "urn", "use", "van", "vat", "vee", "vet", "vex", "via", "vie", "vig", "vim", "voe", "vow", "wad", "wag", "wan", "war", "was", "wax", "way", "web", "wed", "wee", "wen", "wet", "who", "why", "wig", "win", "wit", "wiz", "woe", "wog", "wok", "won", "woo", "wow", "wry", "wye", "yak", "yam", "yap", "yaw", "yay", "yea", "yen", "yep", "yes", "yet", "yew", "yip", "you", "yow", "yum", "yup", "zag", "zap", "zed", "zee", "zen", "zig", "zip", "zit", "zoa", "zoo"];
  async function callAPI(data, json = null) {
    await loadApiPublicKeys();
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    const params = new URLSearchParams(data);
    params.append("lang", browser.i18n.getUILanguage().substr(0, 2));
    const fetchOptions = { "method": "POST", "headers": headers, "body": JSON.stringify(json), "credentials": "omit" };
    const response = await fetch(`${apiBaseUrl}/?api=1&${params.toString()}`, fetchOptions);
    if (!response.ok) {
      let serverMessage = "";
      let serverErrorCode;
      try {
        const errorBody = JSON.parse(await response.text());
        serverMessage = errorBody.msg ?? "";
        serverErrorCode = errorBody.error_code;
      } catch {
      }
      const error2 = new Error(serverMessage || `${response.status} ${response.statusText} Error occurred.`);
      error2.errorCode = serverErrorCode;
      error2.httpStatus = response.status;
      throw error2;
    }
    const signature = response.headers.get("x-aionda-signature");
    const timestamp = response.headers.get("x-aionda-timestamp");
    const keyId = response.headers.get("x-aionda-key-id");
    const bodyText = await response.text();
    if (apiKeysLoaded && signature && timestamp && keyId) {
      const isDev = apiBaseUrl.includes("dev.mail.aionda.com");
      const expectedKeyPrefix = isDev ? "dev-" : "prod-";
      if (!keyId.startsWith(expectedKeyPrefix)) {
        console.error(`[API] SECURITY WARNING: Key ID mismatch! Expected ${expectedKeyPrefix}* but got ${keyId}`);
        const error2 = new Error("Security Error: Invalid key for this server");
        error2.securityError = true;
        throw error2;
      }
      const verification = await verifyApiResponse(bodyText, signature, timestamp, keyId);
      if (!verification.valid) {
        console.error("[API] SECURITY WARNING: Signature verification failed!", verification.reason);
        const error2 = new Error(`Security Error: ${verification.reason}`);
        error2.securityError = true;
        error2.reason = verification.reason;
        throw error2;
      }
      console.log(`[API] Response signature verified (Key: ${keyId})`);
    } else if (signature || timestamp || keyId) {
      console.warn("[API] Incomplete signature headers - skipping verification");
    }
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(bodyText);
    } catch (e) {
      throw new Error("Invalid JSON response from server");
    }
    let msg = jsonResponse["message"];
    if (msg === void 0) {
      msg = jsonResponse["msg"];
    }
    if (msg === void 0) {
      msg = jsonResponse["data"];
    }
    const dataField = jsonResponse["data"];
    if (dataField && dataField["requires_2fa"]) {
      const error2 = new Error(dataField["pat_hint"] || msg || "2FA required. Please create a Personal Access Token in the Aionda Mail Manager and use it as password.");
      error2.requires_2fa = true;
      error2.url = dataField["url"];
      error2.extension_html = dataField["extension_html"];
      throw error2;
    }
    if (jsonResponse["success"]) {
      return msg;
    }
    let errorText;
    if (typeof msg === "string" && msg.trim() !== "") {
      errorText = msg;
    } else {
      const errorCode = jsonResponse["error_code"];
      const AUTH_ERROR_CODES = [2, 3, 5, 10, 61];
      if (typeof errorCode === "number" && AUTH_ERROR_CODES.includes(errorCode)) {
        errorText = browser.i18n.getMessage("errorSessionExpired") || "Your session has expired. Please log in again via the extension options.";
      } else {
        errorText = browser.i18n.getMessage("errorGenericServer") || `The server returned an error${errorCode !== void 0 ? ` (code ${errorCode})` : ""}. Please log in again via the extension options.`;
      }
    }
    const error = new Error(errorText);
    if (jsonResponse["error_code"] !== void 0) {
      error.errorCode = jsonResponse["error_code"];
    }
    throw error;
  }
  function isPAT(password) {
    return Boolean(password) && typeof password === "string" && password.startsWith("tmpat_") && password.length > 6;
  }
  async function getApiBaseUrl() {
    try {
      const result = await browser.storage.local.get("debugApiUrl");
      if (result.debugApiUrl) {
        return result.debugApiUrl;
      }
    } catch (e) {
    }
    return DEFAULT_API_URL;
  }
  function createAccessToken(sessionId, tokenName) {
    const data = {
      "cmd": "create_access_token",
      "session_id": sessionId
    };
    const json = {
      "name": tokenName
    };
    return callAPI(data, json).then((result) => {
      if (result && result.token) {
        return result.token;
      }
      throw new Error("Failed to create access token");
    });
  }
  async function openAddressManagerAuthenticated() {
    const lang = browser.i18n.getUILanguage().substr(0, 2);
    const sync = await browser.storage.sync.get(["username", "password"]);
    const username = sync.username;
    const password = sync.password;
    if (!username || !password) {
      throw new Error(browser.i18n.getMessage("errorSessionExpired") || 'Your session has expired. Please use "Switch login" to log in again.');
    }
    const baseUrl = await getApiBaseUrl();
    if (isPAT(password)) {
      if (typeof addonOpaqueClient === "undefined") {
        throw new Error("OPAQUE client not loaded. Please reload.");
      }
      await addonOpaqueClient.patOpaqueLogin(username, password, { establishBrowserSession: true });
    } else {
      const response = await fetch(`${baseUrl}/?api=1&cmd=login&lang=${lang}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "fe-login-user": username, "fe-login-pass": password })
      });
      const result = JSON.parse(await response.text());
      if (result.error || result.success === false) {
        throw new Error(result.msg || result.error || "Login failed");
      }
    }
    await browser.tabs.create({ "url": `${baseUrl}/?cmd=manager&lang=${lang}` });
  }
  Object.assign(globalThis, { callAPI, isPAT, createAccessToken, getApiBaseUrl, loadApiBaseUrl, PREFIXES, DEFAULT_API_URL, openAddressManagerAuthenticated });
  Object.defineProperty(globalThis, "API_BASE_URL", {
    get: () => apiBaseUrl,
    set: (value) => {
      apiBaseUrl = value;
    }
  });
})();
