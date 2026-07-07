"use strict";

// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

/** Error objects thrown across the login flow carry extra flags. */
interface AppError {
    message?: string;
    handled?: boolean;
    requires_2fa?: boolean;
    [key: string]: unknown;
}

/** A DEA record as returned by `read_dea`. */
interface DeaRecord {
    website?: string;
    disposable_name?: string;
    disposable_domain?: string;
    [key: string]: unknown;
}

/** Look up an element by id, throwing (like the original blind access) if absent. */
function elById<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (el === null) {
        throw new Error(`Element #${id} not found`);
    }
    return el as T;
}

function changePanel(panel: string) {
    for (const p of document.querySelectorAll<HTMLElement>(".panel"))
        {p.style.display = p.id === panel ? "block" : "none";}
    fitWindowToContent();
}

/** Fenster an die Panel-Hoehe anpassen (nur wachsen, gedeckelt am Bildschirm). */
function fitWindowToContent() {
    setTimeout(() => {
        const wanted = Math.min(document.documentElement.scrollHeight + 90, screen.availHeight || 900);
        browser.windows.getCurrent().then((currentWindow) => {
            if (currentWindow.id !== undefined && (currentWindow.height === undefined || wanted > currentWindow.height)) {
                return browser.windows.update(currentWindow.id, { height: wanted });
            }
            return undefined;
        }).catch(() => undefined);
    }, 60);
}

// ============================================================
// Registrierung (register_account_v2: OPAQUE + Captcha-Spiel)
// ============================================================

// Unsichtbarer Bot-Check: Der Server verlangt fuer register_account_v2 eine
// bestandene game_captcha_validate-Session (Bot-Abuse-Schutz). Statt des
// sichtbaren "Fang die Briefe"-Spiels sammelt das Addon echte
// Interaktionsdaten (Zeit im Formular, Eingabe-Events) und validiert die
// Session beim Absenden im Hintergrund - der User merkt davon nichts.
let regPanelOpenedAt = 0;
let regInteractions = 0;
let regTrackingAttached = false;

function startRegistrationTracking() {
    regPanelOpenedAt = Date.now();
    if (regTrackingAttached) {return;}
    regTrackingAttached = true;
    const panel = elById("register-panel");
    const bump = () => { regInteractions++; };
    panel.addEventListener("input", bump);
    panel.addEventListener("pointermove", bump);
    panel.addEventListener("click", bump);
}

async function obtainCaptchaSession(): Promise<string> {
    // Echte Metriken, aber auf die Server-Plausibilitaetsfenster begrenzt
    // (3-60s Dauer, >=10 Interaktionen) - Autofill fuellt schneller als 3s,
    // und wer lange ueberlegt, soll nicht an der 60s-Grenze scheitern.
    const elapsed = Date.now() - regPanelOpenedAt;
    const response = await fetch(`${API_BASE_URL}/?api=1&cmd=game_captcha_validate`, {
        // Keine Webapp-Cookies mitschicken - das Addon arbeitet nur mit session_id.
        credentials: "omit",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            score: 5,
            duration: Math.min(Math.max(elapsed, 3200), 59000),
            movements: Math.max(regInteractions, 12),
            spam_caught: 0,
        }),
    });
    const data = await response.json() as { success?: boolean; game_session_id?: string; msg?: string };
    if (!data.success || !data.game_session_id) {
        throw new Error(data.msg || "Captcha validation failed");
    }
    return data.game_session_id;
}

/**
 * Live-Validierung der Benutzerkennung WAEHREND der Eingabe (nicht erst beim
 * Absenden). Spiegelt die Server-Regeln aus RegisterAccountV2Service:
 * 3-30 Zeichen, nur a-z 0-9 . -, nicht am Anfang/Ende, nicht doppelt.
 */
function isUsernameValid(name: string): boolean {
    return name.length >= 3 && name.length <= 30
        && /^[a-z0-9.-]+$/.test(name)
        && !/^[.-]|[.-]$/.test(name)
        && !/[.-]{2}/.test(name);
}

/**
 * Passwort-Staerke: exakt dieselbe Richtlinie wie die Webseite
 * (templates/signup_wizard.html). 0=leer, 1=schwach, 2=ok, 3=gut, 4=stark.
 * Zum Registrieren ist mindestens "Ok" (Score 2) noetig - wie im Wizard.
 */
function evaluatePasswordStrength(pw: string): number {
    let score = 0;
    if (pw.length >= 8) {score++;}
    if (pw.length >= 12) {score++;}
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) {score++;}
    if (/[0-9]/.test(pw)) {score++;}
    if (/[^A-Za-z0-9]/.test(pw)) {score++;}
    return Math.min(score, 4);
}

const PW_STRENGTH_COLORS = ["#ef4444", "#f59e0b", "#eab308", "#22c55e"];
const PW_STRENGTH_WIDTHS = ["25%", "50%", "75%", "100%"];
const PW_STRENGTH_LABEL_KEYS = ["registerPwWeak", "registerPwOk", "registerPwGood", "registerPwStrong"];

function updatePasswordStrengthLive() {
    const passwordInput = elById<HTMLInputElement>("register-password");
    const bar = elById("register-pw-strength-bar");
    const label = elById("register-pw-strength-label");
    const pw = passwordInput.value;
    const score = evaluatePasswordStrength(pw);

    // Interaktive Richtlinien-Checkliste: erfuellte Kriterien live abhaken
    const criteria: Record<string, boolean> = {
        len8: pw.length >= 8,
        len12: pw.length >= 12,
        case: /[A-Z]/.test(pw) && /[a-z]/.test(pw),
        digit: /[0-9]/.test(pw),
        special: /[^A-Za-z0-9]/.test(pw),
    };
    for (const item of document.querySelectorAll<HTMLElement>("#register-pw-checklist li")) {
        item.classList.toggle("met", Boolean(criteria[item.dataset["crit"] ?? ""]));
    }

    if (pw.length === 0) {
        bar.style.width = "0%";
        label.textContent = "";
        passwordInput.setCustomValidity("");
        return;
    }

    const idx = Math.max(0, score - 1);
    bar.style.width = PW_STRENGTH_WIDTHS[idx]!;
    bar.style.background = PW_STRENGTH_COLORS[idx]!;
    label.textContent = browser.i18n.getMessage(PW_STRENGTH_LABEL_KEYS[idx]!);
    label.style.color = PW_STRENGTH_COLORS[idx]!;

    passwordInput.setCustomValidity(
        score >= 2 ? "" : browser.i18n.getMessage("registerPasswordTooWeak"));
}

/** Auge-Button: Passwort anzeigen/verbergen (ersetzt das Bestaetigen-Feld). */
function togglePasswordVisibility() {
    const passwordInput = elById<HTMLInputElement>("register-password");
    const toggle = elById<HTMLButtonElement>("register-toggle-pw");
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
}

// Freundliche Namensvorschlaege, damit sich niemand selbst etwas ausdenken
// muss. Sprachneutral, immer konform zu den Server-Regeln.
const IDEA_ADJECTIVES = ["sunny", "swift", "lucky", "clever", "quiet", "magic", "cosmic", "golden"];
const IDEA_ANIMALS = ["fox", "owl", "lion", "wolf", "panda", "otter", "koala", "falcon"];

function generateUsernameIdea(): string {
    const adjective = IDEA_ADJECTIVES[Math.floor(Math.random() * IDEA_ADJECTIVES.length)]!;
    const animal = IDEA_ANIMALS[Math.floor(Math.random() * IDEA_ANIMALS.length)]!;
    const number = Math.floor(Math.random() * 90) + 10;
    return `${adjective}-${animal}${number}`;
}

/** Zeigt 3 klickbare Namensvorschlaege + Neu-Wuerfeln unter dem leeren Feld. */
function renderUsernameIdeas() {
    const ideas = elById("register-username-ideas");
    ideas.textContent = "";

    const prefix = document.createElement("span");
    prefix.className = "suggestion-prefix";
    prefix.textContent = `${browser.i18n.getMessage("registerUsernameIdeas")} `;
    ideas.appendChild(prefix);

    const seen = new Set<string>();
    let guard = 0;
    while (seen.size < 3 && guard++ < 40) {
        const candidate = generateUsernameIdea();
        if (isUsernameValid(candidate)) {seen.add(candidate);}
    }
    for (const idea of seen) {
        const ideaButton = document.createElement("button");
        ideaButton.type = "button";
        ideaButton.className = "suggestion-btn";
        ideaButton.textContent = idea;
        ideaButton.addEventListener("click", () => {
            const usernameInput = elById<HTMLInputElement>("register-username");
            usernameInput.value = idea;
            usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
            usernameInput.focus();
        });
        ideas.appendChild(ideaButton);
    }

    // Neu wuerfeln
    const reroll = document.createElement("button");
    reroll.type = "button";
    reroll.className = "suggestion-btn";
    reroll.textContent = "↻";
    reroll.title = browser.i18n.getMessage("registerUsernameIdeasMore");
    reroll.addEventListener("click", renderUsernameIdeas);
    ideas.appendChild(reroll);

    ideas.style.display = "block";
}

let usernameCheckTimer: ReturnType<typeof setTimeout> | undefined;
let usernameCheckSeq = 0;

function validateUsernameLive() {
    const usernameInput = elById<HTMLInputElement>("register-username");
    const hint = elById("register-username-hint");
    const availability = elById("register-username-availability");

    // Grossbuchstaben direkt normalisieren (Konten sind immer lowercase)
    const lowered = usernameInput.value.toLowerCase();
    if (usernameInput.value !== lowered) {
        usernameInput.value = lowered;
    }

    // Bei jeder Eingabe: alten Verfuegbarkeits-Status zuruecknehmen
    clearTimeout(usernameCheckTimer);
    usernameCheckSeq++;
    availability.style.display = "none";

    // Vorschlaege nur zeigen, solange das Feld leer ist
    elById("register-username-ideas").style.display = lowered === "" ? "block" : "none";

    if (lowered === "" || isUsernameValid(lowered)) {
        hint.classList.remove("invalid");
        usernameInput.setCustomValidity("");
    } else {
        hint.classList.add("invalid");
        usernameInput.setCustomValidity(browser.i18n.getMessage("registerUsernameRules"));
        return;
    }

    // Verfuegbarkeit live pruefen (debounced wie im Webapp-Wizard)
    if (lowered.length >= 3) {
        usernameCheckTimer = setTimeout(() => { checkUsernameAvailability(lowered); }, 350);
    }
}

/** Fragt check_username_available ab und zeigt ggf. klickbare Alternativen. */
async function checkUsernameAvailability(username: string) {
    const seq = ++usernameCheckSeq;
    const usernameInput = elById<HTMLInputElement>("register-username");
    const availability = elById("register-username-availability");

    try {
        const lang = browser.i18n.getUILanguage().substr(0, 2);
        const response = await fetch(`${API_BASE_URL}/?api=1&cmd=check_username_available&lang=${lang}`, {
            // Keine Webapp-Cookies mitschicken - das Addon arbeitet nur mit session_id.
            credentials: "omit",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username }),
        });
        const data = await response.json() as { available?: boolean; error?: string | null; suggestions?: string[] };

        // Veraltete Antwort (User hat weitergetippt) ignorieren
        if (seq !== usernameCheckSeq || usernameInput.value !== username) {return;}

        availability.textContent = "";
        availability.classList.remove("invalid", "ok");
        availability.style.display = "block";

        if (data.available) {
            availability.classList.add("ok");
            availability.textContent = browser.i18n.getMessage("registerUsernameAvailable");
            usernameInput.setCustomValidity("");
            fitWindowToContent();
            return;
        }

        // Vergeben: Fehlertext + klickbare Vorschlaege (DOM-API, kein innerHTML!)
        availability.classList.add("invalid");
        const message = document.createElement("span");
        message.textContent = data.error || browser.i18n.getMessage("registerUsernameTaken");
        availability.appendChild(message);
        usernameInput.setCustomValidity(message.textContent ?? "taken");

        const suggestions = data.suggestions ?? [];
        if (suggestions.length > 0) {
            availability.appendChild(document.createElement("br"));
            const prefix = document.createElement("span");
            prefix.className = "suggestion-prefix";
            prefix.textContent = `${browser.i18n.getMessage("registerUsernameSuggestion")} `;
            availability.appendChild(prefix);
            for (const suggestion of suggestions) {
                const suggestionButton = document.createElement("button");
                suggestionButton.type = "button";
                suggestionButton.className = "suggestion-btn";
                suggestionButton.textContent = suggestion;
                suggestionButton.addEventListener("click", () => {
                    usernameInput.value = suggestion;
                    usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
                    usernameInput.focus();
                });
                availability.appendChild(suggestionButton);
            }
        }
        fitWindowToContent();
    } catch (e) {
        // Netzfehler blockieren nicht - der Server validiert beim Registrieren erneut
        console.warn("[TrashMail] Username availability check failed:", e);
    }
}

/**
 * Konto anlegen und den User direkt einloggen:
 * registerAccountV2 (OPAQUE) -> passwordOpaqueLogin -> handleLoginSuccess mit
 * needsPAT=true (legt automatisch einen PAT an und hinterlegt ihn als
 * "Passwort" im Addon-Storage) -> DEAs laden + Fenster schliessen.
 */
function register(e: Event) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);

    // Gleiche Richtlinie wie die Webseite: mindestens "Ok" (Score 2)
    if (evaluatePasswordStrength(String(form.get("password"))) < 2) {
        const passwordInput = elById<HTMLInputElement>("register-password");
        passwordInput.setCustomValidity(browser.i18n.getMessage("registerPasswordTooWeak"));
        passwordInput.reportValidity();
        return;
    }

    const registerError = elById("register-error");
    if (typeof addonOpaqueClient === "undefined") {
        registerError.textContent = "OPAQUE client not loaded. Please reload.";
        registerError.style.display = "block";
        return;
    }
    const opaqueClient = addonOpaqueClient;

    const registerButton = elById<HTMLInputElement>("btn-register");
    const cancelButton = elById<HTMLButtonElement>("btn-register-cancel");
    const progress = elById("progress-register");

    registerButton.disabled = true;
    cancelButton.disabled = true;
    progress.style.display = "inline-block";
    registerError.style.display = "none";

    const username = String(form.get("username")).toLowerCase().trim();
    const password = String(form.get("password"));
    const realEmail = String(form.get("email")).trim();

    obtainCaptchaSession().then((gameSessionId) => {
        return opaqueClient.registerAccountV2(username, password, gameSessionId);
    }).then(() => {
        // Frisches Konto: alte Addon-Daten zuruecksetzen
        return browser.storage.local.set({ "previous_addresses": {} });
    }).then(() => {
        // v2-Konten sind OPAQUE-only - klassischer Login geht nicht.
        // establishBrowserSession setzt zugleich das Website-Cookie: noetig
        // fuer die OPAQUE-PAT-Erstellung gleich danach, und der User ist im
        // Browser direkt eingeloggt.
        return opaqueClient.passwordOpaqueLogin(username, password, { establishBrowserSession: true });
    }).then((loginDetails) => {
        // Speichert Zugangsdaten + Session (needsPAT=false: der PAT kommt
        // gleich als OPAQUE-Token, nicht als Classic-Token)
        return handleLoginSuccess(username, password, loginDetails, false);
    }).then((loginDetails) => {
        // OPAQUE-PAT anlegen und statt des Passworts hinterlegen - nur diese
        // Token-Sorte kann patOpaqueLogin spaeter verifizieren
        return opaqueClient.createAccessTokenOpaque(String(loginDetails["session_id"]), getBrowserName())
            .then((token) => browser.storage.sync.set({ "password": token }))
            .then(() => loginDetails);
    }).then((loginDetails) => {
        // handleLoginSuccess leitet is_opaque_account von isPAT(password) ab -
        // hier ist das Passwort kein PAT, das v2-Konto aber OPAQUE-only.
        return browser.storage.local.set({ "is_opaque_account": true }).then(() => loginDetails);
    }).then((loginDetails) => {
        // Echte E-Mail-Adresse hinterlegen: ohne Vault-Onboarding (nur im
        // Webapp-Wizard) koennen DEAs nur an eine echte Adresse weiterleiten.
        // Der Server schickt eine Bestaetigungs-Mail an die Adresse.
        return callAPI({
            "cmd": "add_real_email",
            "session_id": loginDetails["session_id"],
            "email": realEmail,
        }).then(() => {
            return Promise.all([
                browser.storage.local.set({ "real_emails": [realEmail] }),
                browser.storage.sync.set({ "default_email": realEmail }),
            ]);
        }).then(() => loginDetails);
    }).then((loginDetails) => {
        // Nicht sofort schliessen: live auf die E-Mail-Bestaetigung warten
        // (Weiterleitungen funktionieren erst mit bestaetigter Adresse)
        progress.style.display = "none";
        showConfirmationPanel(realEmail, String(loginDetails["session_id"]));
    }).catch((error: AppError) => {
        registerError.textContent = error.message || String(error);
        registerError.style.display = "block";
        progress.style.display = "none";
        cancelButton.disabled = false;
        registerButton.disabled = false;
    });
}

// ============================================================
// E-Mail-Bestaetigung: live warten, bis der User den Link klickt
// ============================================================

let confirmPollTimer: ReturnType<typeof setInterval> | undefined;
let confirmEmail = "";

interface RealEmailEntry { email?: string; confirmed?: boolean }

/** Aktuelle Session-ID frisch aus dem Storage lesen (nicht cachen - sie kann rotieren). */
async function currentSessionId(): Promise<string> {
    const local = await browser.storage.local.get(["session_id"]) as { session_id?: string };
    return local.session_id ?? "";
}

/**
 * Meldet sich mit dem gespeicherten PAT neu an und liefert eine frische
 * Session-ID. Noetig, weil der Klick auf den Bestaetigungslink serverseitig
 * die Session rotiert (confirm_email -> Session::regenerate) und die im
 * Addon gespeicherte session_id damit ungueltig wird.
 */
async function reAuthWithPat(): Promise<string> {
    const sync = await browser.storage.sync.get(["username", "password"]) as { username?: string; password?: string };
    if (typeof addonOpaqueClient === "undefined" || !sync.username || !sync.password) {
        throw new Error("re-auth unavailable");
    }
    const login = await addonOpaqueClient.patOpaqueLogin(sync.username, sync.password);
    const sessionId = String(login["session_id"] ?? "");
    await browser.storage.local.set({ "session_id": sessionId });
    return sessionId;
}

const AUTH_ERROR_CODES = [2, 61];

/**
 * Fuehrt einen callAPI-Aufruf aus und meldet sich bei Auth-Fehler (Session
 * abgelaufen/rotiert) einmalig per PAT neu an und wiederholt den Aufruf.
 */
async function callWithReauth(cmd: string, extraParams: Record<string, unknown> = {}): Promise<TmApiResponse> {
    const sessionId = await currentSessionId();
    try {
        return await callAPI({ "cmd": cmd, "session_id": sessionId, ...extraParams });
    } catch (error) {
        const code = (error as { errorCode?: number }).errorCode;
        if (code !== undefined && AUTH_ERROR_CODES.includes(code)) {
            const fresh = await reAuthWithPat();
            return await callAPI({ "cmd": cmd, "session_id": fresh, ...extraParams });
        }
        throw error;
    }
}

/**
 * Zeigt nach der Registrierung den Bestaetigungs-Schritt und pollt
 * list_real_emails, bis die echte E-Mail-Adresse bestaetigt wurde.
 * Erst dann (oder bei "Spaeter bestaetigen") schliesst das Fenster.
 */
function showConfirmationPanel(email: string, _sessionId: string) {
    confirmEmail = email;
    changePanel("confirm-panel");
    elById("confirm-sent-to").textContent = browser.i18n.getMessage("confirmSentTo", email);

    const poll = async () => {
        try {
            const result = await callWithReauth("list_real_emails");
            // Response ist unter `data` genestet (list_real_emails-Vertrag)
            const data = (result["data"] as Record<string, unknown> | undefined) ?? result;
            const entries = (data["real_emails_detailed"] as RealEmailEntry[] | undefined) ?? [];
            const entry = entries.find((item) => String(item.email).toLowerCase() === email.toLowerCase());
            if (entry?.confirmed) {
                if (confirmPollTimer) {clearInterval(confirmPollTimer);}
                // Nur bestaetigte Adressen lokal anbieten
                const confirmedList = (data["real_email_list"] as string[] | undefined) ?? [email];
                await browser.storage.local.set({ "real_emails": confirmedList });
                elById("confirm-status").classList.add("done");
                elById("confirm-status-text").textContent = browser.i18n.getMessage("confirmDone");
                setTimeout(() => { currentSessionId().then((sid) => loadDEAAndClose(sid)); }, 1500);
            }
        } catch (e) {
            // Netzfehler: einfach beim naechsten Intervall erneut versuchen
            console.warn("[TrashMail] Confirmation poll failed:", e);
        }
    };

    poll();
    confirmPollTimer = setInterval(poll, 3000);
}

elById("btn-confirm-resend").addEventListener("click", () => {
    const confirmError = elById("confirm-error");
    confirmError.style.display = "none";
    callWithReauth("resend_confirmation_email", { "email": confirmEmail }).then(() => {
        elById("confirm-status-text").textContent = browser.i18n.getMessage("confirmResent");
    }).catch((error: AppError) => {
        // z.B. Rate-Limit (max. 1 Mail pro 5 Minuten) - Server-Meldung zeigen
        confirmError.textContent = error.message || String(error);
        confirmError.style.display = "block";
    });
});

elById("btn-confirm-skip").addEventListener("click", () => {
    if (confirmPollTimer) {clearInterval(confirmPollTimer);}
    currentSessionId().then((sessionId) => { loadDEAAndClose(sessionId); });
});

/**
 * Get browser name for PAT token naming
 */
function getBrowserName(): string {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
        if (navigator.userAgent.includes("Firefox")) {return "Firefox Extension";}
        if (navigator.userAgent.includes("Chrome")) {return "Chrome Extension";}
        if (navigator.userAgent.includes("Safari")) {return "Safari Extension";}
        if (navigator.userAgent.includes("Edge")) {return "Edge Extension";}
    }
    return "Browser Extension";
}

/**
 * Perform classic login (password sent to server)
 * Used for PAT tokens or accounts without SRP
 */
function classicLogin(username: string, password: string): Promise<TmApiResponse> {
    return callAPI({
        "cmd": "login",
        "fe-login-user": username,
        "fe-login-pass": password,
    });
}

/**
 * Handle successful login - store data and create PAT if needed
 */
function handleLoginSuccess(username: string, password: string, loginDetails: TmApiResponse, needsPAT: boolean): Promise<TmApiResponse> {
    const sessionId = loginDetails["session_id"];
    const isOpaqueAccount = isPAT(password);  // If using PAT, it's likely an OPAQUE account

    // Store session_id and auth type for popup.js to use
    const domainList = loginDetails["domain_name_list"] || [];
    const p1 = browser.storage.local.set({
        "domains": Array.isArray(domainList) ? domainList : Object.keys(domainList),
        "real_emails": Object.keys(loginDetails["real_email_list"] || {}),
        "session_id": sessionId,
        "is_opaque_account": isOpaqueAccount,
    });

    // If password is not a PAT, create one for future logins (classic token
    // for classic/SRP accounts - OPAQUE-Konten laufen ueber den Register-Flow,
    // der explizit createAccessTokenOpaque nutzt).
    if (needsPAT && sessionId) {
        return createAccessToken(sessionId as string, getBrowserName()).then((token) => {
            console.log("[TrashMail] PAT created successfully");
            return browser.storage.sync.set({
                "username": username,
                "password": token,  // Store PAT instead of original password
            });
        }).then(() => {
            return p1;
        }).then(() => {
            return loginDetails;
        }).catch((patError) => {
            // PAT creation failed, but login succeeded - store original password
            console.warn("[TrashMail] PAT creation failed:", patError);
            return browser.storage.sync.set({
                "username": username,
                "password": password,
            }).then(() => {
                return p1;
            }).then(() => {
                return loginDetails;
            });
        });
    } else {
        // Password is already a PAT, just store it
        const p2 = browser.storage.sync.set({
            "username": username,
            "password": password,
        });

        return Promise.all([loginDetails, p1, p2]).then((values) => {
            return values[0];
        });
    }
}

/**
 * Load DEA addresses and close window on success
 */
function loadDEAAndClose(sessionId?: string): Promise<void> {
    const data = {
        "cmd": "read_dea",
        "session_id": sessionId,
    };

    const suffixes = fetch(browser.runtime.getURL("public_suffix.json")).then((response) => {
        if (response.ok) {return response.json();}
    });

    return Promise.all([callAPI(data), suffixes]).then((values) => {
        const addresses = values[0] as unknown as DeaRecord[];
        const [rules, exceptions] = values[1] as [Record<string, unknown>, Record<string, unknown>];
        const currentPrevAddresses: Record<string, string[][]> = {};

        for (const address of addresses) {
            if (address["website"]) {
                let domainUrl: URL;
                try {
                    domainUrl = new URL(address["website"]);
                } catch (e) {
                    if (e instanceof TypeError) {continue;}
                    throw e;
                }
                const domain = org_domain(domainUrl, rules, exceptions);
                const email = [`${String(address["disposable_name"])}@${String(address["disposable_domain"])}`,
                    address["website"]];

                if (domain in currentPrevAddresses)
                    {currentPrevAddresses[domain]!.push(email);}
                else
                    {currentPrevAddresses[domain] = [email];}
            }
        }

        return browser.storage.local.set({ "previous_addresses": currentPrevAddresses }).then(() => {
            browser.windows.getCurrent().then((w) => {
                browser.windows.remove(w.id!);
            });
        });
    });
}

/**
 * Main login function with OPAQUE and SRP support
 *
 * Flow:
 * 1. Check if password is a PAT (starts with 'tmpat_')
 * 2. If PAT → check if server uses OPAQUE:
 *    - OPAQUE enabled → use PAT-OPAQUE (Zero-Knowledge)
 *    - OPAQUE not enabled → use classic PAT login
 * 3. If not PAT (regular password):
 *    - Check if account uses OPAQUE → show "PAT required" message
 *    - Check if account uses SRP → use SRP login
 *    - Otherwise → use classic login
 * 4. Handle 2FA if required
 * 5. Create PAT for future logins (only for non-OPAQUE accounts)
 */
function login(e: Event) {
    e.preventDefault();
    const loginButton = elById<HTMLButtonElement>("btn-login");
    const cancelButton = elById<HTMLButtonElement>("btn-login-cancel");
    const progress = elById("progress-login");
    const loginError = elById("login-error");

    loginButton.disabled = true;
    cancelButton.disabled = true;
    progress.style.display = "inline-block";
    loginError.style.display = "none";

    const form = new FormData(e.target as HTMLFormElement);
    const username = form.get("username") as string;
    const password = form.get("password") as string;
    const isPatToken = isPAT(password);

    // Flow A: If password is a PAT, check if we need OPAQUE or classic
    if (isPatToken) {
        console.log("[TrashMail] PAT detected, checking auth method...");

        // Check if OPAQUE client and server support are available
        if (typeof addonOpaqueClient !== "undefined") {
            addonOpaqueClient.checkOpaqueEnabled(username).then((authMethods) => {
                if (authMethods.opaque_enabled) {
                    // Use PAT-OPAQUE (Zero-Knowledge)
                    console.log("[TrashMail] Using PAT-OPAQUE authentication");
                    return addonOpaqueClient!.patOpaqueLogin(username, password);
                } else {
                    // Use classic PAT login (server hasn't migrated yet)
                    console.log("[TrashMail] Using classic PAT login (server not OPAQUE yet)");
                    return classicLogin(username, password);
                }
            }).then((loginDetails) => {
                return handleLoginSuccess(username, password, loginDetails, false);
            }).then((loginDetails) => {
                return loadDEAAndClose(loginDetails["session_id"]);
            }).catch((error: AppError) => {
                // Fallback to classic PAT login on OPAQUE errors
                if (error.message && error.message.includes("OPAQUE")) {
                    console.warn("[TrashMail] OPAQUE failed, trying classic PAT login:", error.message);
                    classicLogin(username, password)
                        .then((loginDetails) => {
                            return handleLoginSuccess(username, password, loginDetails, false);
                        })
                        .then((loginDetails) => {
                            return loadDEAAndClose(loginDetails["session_id"]);
                        })
                        .catch((fallbackError) => {
                            showLoginError(fallbackError, loginError, progress, cancelButton, loginButton);
                        });
                    return;
                }
                showLoginError(error, loginError, progress, cancelButton, loginButton);
            });
        } else {
            // No OPAQUE client, use classic PAT login
            console.log("[TrashMail] OPAQUE client not available, using classic PAT login");
            classicLogin(username, password)
                .then((loginDetails) => {
                    return handleLoginSuccess(username, password, loginDetails, false);
                })
                .then((loginDetails) => {
                    return loadDEAAndClose(loginDetails["session_id"]);
                })
                .catch((error) => {
                    showLoginError(error, loginError, progress, cancelButton, loginButton);
                });
        }
        return;
    }

    // Flow B: Regular password - check auth method
    console.log("[TrashMail] Checking authentication method...");

    // First check if OPAQUE is enabled for this account
    checkAuthMethodAndLogin(username, password, loginButton, cancelButton, progress, loginError);
}

/**
 * Helper to display login errors
 */
function showLoginError(error: unknown, loginError: HTMLElement, progress: HTMLElement, cancelButton: HTMLButtonElement, loginButton: HTMLButtonElement) {
    loginError.textContent = (error as AppError).message || String(error);
    loginError.style.display = "block";
    progress.style.display = "none";
    cancelButton.disabled = false;
    loginButton.disabled = false;
}

/**
 * Check auth method (OPAQUE/SRP/Classic) and perform appropriate login
 */
function checkAuthMethodAndLogin(username: string, password: string, loginButton: HTMLButtonElement, cancelButton: HTMLButtonElement, progress: HTMLElement, loginError: HTMLElement) {
    // Check OPAQUE first (if client available)
    let opaqueCheckPromise: Promise<AddonAuthMethods>;
    if (typeof addonOpaqueClient !== "undefined") {
        opaqueCheckPromise = addonOpaqueClient.checkOpaqueEnabled(username);
    } else {
        opaqueCheckPromise = Promise.resolve({ opaque_enabled: false, srp_enabled: false });
    }

    opaqueCheckPromise.then((authMethods) => {
        // If OPAQUE is enabled, user MUST use PAT
        if (authMethods.opaque_enabled) {
            console.log("[TrashMail] Account uses OPAQUE - PAT required");
            showOpaquePatRequired(username);
            return;
        }

        // If OPAQUE not enabled, try SRP
        if (typeof addonSrpClient === "undefined") {
            console.log("[TrashMail] SRP client not available, using classic login");
            performClassicLoginWithMigration(username, password, loginButton, cancelButton, progress, loginError);
            return;
        }

        // Check SRP
        return addonSrpClient.checkSrpEnabled(username).then((result) => {
            if (result && result.success !== false && result.srp_enabled) {
                // SRP Login (Zero-Knowledge)
                console.log("[TrashMail] Using SRP (Zero-Knowledge) authentication");
                return addonSrpClient!.login(username, password).then((loginDetails) => {
                    if (loginDetails.requires_2fa) {
                        show2FAInput(username, password);
                        throw { handled: true }; // eslint-disable-line no-throw-literal
                    }
                    return handleLoginSuccess(username, password, loginDetails, true);
                }).then((loginDetails) => {
                    return loadDEAAndClose(loginDetails["session_id"]);
                });
            } else {
                // Classic login
                console.log("[TrashMail] Using classic login");
                return performClassicLoginWithMigrationAsync(username, password);
            }
        });
    }).catch((error: AppError) => {
        if (error.handled) {return;}

        if (error.requires_2fa) {
            show2FAInput(username, password);
            return;
        }

        // If check failed, try classic login as fallback
        if (error.message && (error.message.includes("opaque_check") || error.message.includes("srp_check") || error.message.includes("fetch"))) {
            console.warn("[TrashMail] Auth check failed, falling back to classic login:", error.message);
            performClassicLoginWithMigrationAsync(username, password).catch((fallbackError) => {
                showLoginError(fallbackError, loginError, progress, cancelButton, loginButton);
            });
            return;
        }

        showLoginError(error, loginError, progress, cancelButton, loginButton);
    });
}

/**
 * Show message that OPAQUE account requires PAT
 */
function showOpaquePatRequired(username: string) {
    const loginPanel = elById("login-panel");
    const progress = document.getElementById("progress-login");
    const loginButton = document.getElementById("btn-login");
    const cancelButton = document.getElementById("btn-login-cancel");

    if (progress) {progress.style.display = "none";}
    if (loginButton) {(loginButton as HTMLButtonElement).disabled = false;}
    if (cancelButton) {(cancelButton as HTMLButtonElement).disabled = false;}

    let panelOpaque: HTMLElement | null = document.getElementById("opaque-pat-required-panel");
    if (!panelOpaque) {
        panelOpaque = document.createElement("div");
        panelOpaque.id = "opaque-pat-required-panel";
        panelOpaque.className = "panel";

        const lang = browser.i18n.getUILanguage().substr(0, 2);
        let title, info, step1, step2, step3, step4, step5, btnOpen, btnCancel;

        if (lang === "de") {
            title = "Personal Access Token erforderlich";
            info = "Ihr Konto verwendet die neue OPAQUE-Authentifizierung. Diese bietet maximale Sicherheit, erfordert aber einen Personal Access Token (PAT) für die Browser-Erweiterung:";
            step1 = "Öffnen Sie mail.aionda.com und melden Sie sich an";
            step2 = "Klicken Sie im Adress-Manager rechts oben auf Ihren Benutzernamen";
            step3 = "Wählen Sie <strong>Konto → Personal Access Tokens</strong>";
            step4 = "Erstellen Sie ein neues Token und kopieren Sie es";
            step5 = "Kommen Sie hierher zurück: <strong>Benutzername bleibt gleich</strong>, aber im Feld <strong>\"Passwort\"</strong> geben Sie das kopierte Token ein";
            btnOpen = "TrashMail öffnen";
            btnCancel = "Abbrechen";
        } else if (lang === "fr") {
            title = "Personal Access Token requis";
            info = "Votre compte utilise la nouvelle authentification OPAQUE. Cela offre une sécurité maximale mais nécessite un Personal Access Token (PAT) pour l'extension du navigateur :";
            step1 = "Ouvrez mail.aionda.com et connectez-vous";
            step2 = "Cliquez sur votre nom d'utilisateur en haut à droite du gestionnaire d'adresses";
            step3 = "Sélectionnez <strong>Compte → Personal Access Tokens</strong>";
            step4 = "Créez un nouveau token et copiez-le";
            step5 = "Revenez ici : <strong>le nom d'utilisateur reste le même</strong>, mais dans le champ <strong>« Mot de passe »</strong> entrez le token copié";
            btnOpen = "Ouvrir TrashMail";
            btnCancel = "Annuler";
        } else {
            title = "Personal Access Token Required";
            info = "Your account uses the new OPAQUE authentication. This provides maximum security but requires a Personal Access Token (PAT) for the browser extension:";
            step1 = "Open mail.aionda.com and log in";
            step2 = "Click on your username in the top right of the Address Manager";
            step3 = "Select <strong>Account → Personal Access Tokens</strong>";
            step4 = "Create a new token and copy it";
            step5 = "Come back here: <strong>Username stays the same</strong>, but in the <strong>\"Password\"</strong> field enter the copied token";
            btnOpen = "Open TrashMail";
            btnCancel = "Cancel";
        }

        panelOpaque.innerHTML = `
            <h2>${title}</h2>
            <p>${info}</p>
            <ol style="text-align: left; margin: 15px auto; max-width: 400px;">
                <li>${step1}</li>
                <li>${step2}</li>
                <li>${step3}</li>
                <li>${step4}</li>
                <li>${step5}</li>
            </ol>
            <div style="margin-top: 20px;">
                <input type="button" id="btn-open-trashmail-opaque" class="button"
                       style="height: 32px; min-width: 140px; background-color: #0066cc; color: white;"
                       value="${btnOpen}">
                <input type="button" id="btn-opaque-cancel" class="button"
                       style="height: 32px; min-width: 100px;"
                       value="${btnCancel}">
            </div>
        `;
        loginPanel.parentNode!.insertBefore(panelOpaque, loginPanel.nextSibling);

        elById("btn-open-trashmail-opaque").onclick = function () {
            browser.tabs.create({ url: `${API_BASE_URL}/?cmd=manager` });
        };
        elById("btn-opaque-cancel").onclick = function () {
            changePanel("login-panel");
        };
    }

    changePanel("opaque-pat-required-panel");
}

/**
 * Perform classic login with optional SRP migration (async version)
 * Migration only happens if server explicitly requests it via migrate_to_srp flag
 */
function performClassicLoginWithMigrationAsync(username: string, password: string): Promise<void> {
    return classicLogin(username, password).then((loginDetails) => {
        // Handle 2FA if required
        if (loginDetails.requires_2fa) {
            show2FAInput(username, password);
            throw { handled: true }; // eslint-disable-line no-throw-literal
        }

        // Check if server suggests migration to SRP (only if server supports it)
        if (loginDetails.migrate_to_srp && typeof addonSrpClient !== "undefined") {
            console.log("[TrashMail] Server supports SRP, migrating account...");
            // Fire and forget - don't block login on migration
            addonSrpClient.migrateToSrp(username, password).then(() => {
                console.log("[TrashMail] SRP migration successful");
            }).catch((err) => {
                console.warn("[TrashMail] SRP migration failed (non-fatal):", (err as AppError).message || err);
            });
        }

        return handleLoginSuccess(username, password, loginDetails, true);
    }).then((loginDetails) => {
        return loadDEAAndClose(loginDetails["session_id"]);
    });
}

/**
 * Perform classic login (fallback when SRP client not available)
 */
function performClassicLoginWithMigration(username: string, password: string, loginButton: HTMLButtonElement, cancelButton: HTMLButtonElement, progress: HTMLElement, loginError: HTMLElement) {
    classicLogin(username, password)
        .then((loginDetails) => {
            return handleLoginSuccess(username, password, loginDetails, true);
        })
        .then((loginDetails) => {
            return loadDEAAndClose(loginDetails["session_id"]);
        })
        .catch((error: AppError) => {
            if (error.requires_2fa) {
                show2FAInput(username, password);
                return;
            }

            loginError.textContent = error.message || String(error);
            loginError.style.display = "block";
            progress.style.display = "none";
            cancelButton.disabled = false;
            loginButton.disabled = false;
        });
}

/**
 * Show 2FA/SRP PAT required message
 * Instead of OTP input, we now show instructions to create a PAT
 */
function show2FAInput(username: string, password: string) {
    const loginPanel = elById("login-panel");
    const progress = document.getElementById("progress-login");
    const loginButton = document.getElementById("btn-login");
    const cancelButton = document.getElementById("btn-login-cancel");

    // Hide progress
    if (progress) {progress.style.display = "none";}
    if (loginButton) {(loginButton as HTMLButtonElement).disabled = false;}
    if (cancelButton) {(cancelButton as HTMLButtonElement).disabled = false;}

    // Create PAT info panel if it doesn't exist
    let panelPat: HTMLElement | null = document.getElementById("pat-required-panel");
    if (!panelPat) {
        panelPat = document.createElement("div");
        panelPat.id = "pat-required-panel";
        panelPat.className = "panel";

        const lang = browser.i18n.getUILanguage().substr(0, 2);
        let title, info, step1, step2, step3, step4, step5, btnOpen, btnCancel;

        if (lang === "de") {
            title = "Zwei-Faktor-Authentifizierung aktiv";
            info = "Ihr Konto hat 2FA aktiviert. Browser-Erweiterungen unterstützen keine direkte 2FA-Eingabe. Bitte erstellen Sie ein Personal Access Token:";
            step1 = "Öffnen Sie mail.aionda.com und melden Sie sich an";
            step2 = "Klicken Sie im Adress-Manager rechts oben auf Ihren Benutzernamen";
            step3 = "Wählen Sie <strong>Konto → Personal Access Tokens</strong>";
            step4 = "Erstellen Sie ein neues Token und kopieren Sie es";
            step5 = "Kommen Sie hierher zurück: <strong>Benutzername bleibt gleich</strong>, aber im Feld <strong>\"Passwort\"</strong> geben Sie das kopierte Token ein";
            btnOpen = "TrashMail öffnen";
            btnCancel = "Abbrechen";
        } else if (lang === "fr") {
            title = "Authentification à deux facteurs active";
            info = "Votre compte a 2FA activé. Les extensions de navigateur ne prennent pas en charge la saisie directe du 2FA. Veuillez créer un Personal Access Token :";
            step1 = "Ouvrez mail.aionda.com et connectez-vous";
            step2 = "Cliquez sur votre nom d'utilisateur en haut à droite du gestionnaire d'adresses";
            step3 = "Sélectionnez <strong>Compte → Personal Access Tokens</strong>";
            step4 = "Créez un nouveau token et copiez-le";
            step5 = "Revenez ici : <strong>le nom d'utilisateur reste le même</strong>, mais dans le champ <strong>« Mot de passe »</strong> entrez le token copié";
            btnOpen = "Ouvrir TrashMail";
            btnCancel = "Annuler";
        } else {
            title = "Two-Factor Authentication Active";
            info = "Your account has 2FA enabled. Browser extensions do not support direct 2FA input. Please create a Personal Access Token:";
            step1 = "Open mail.aionda.com and log in";
            step2 = "Click on your username in the top right of the Address Manager";
            step3 = "Select <strong>Account → Personal Access Tokens</strong>";
            step4 = "Create a new token and copy it";
            step5 = "Come back here: <strong>Username stays the same</strong>, but in the <strong>\"Password\"</strong> field enter the copied token";
            btnOpen = "Open TrashMail";
            btnCancel = "Cancel";
        }

        panelPat.innerHTML = `
            <h2>${title}</h2>
            <p>${info}</p>
            <ol style="text-align: left; margin: 15px auto; max-width: 400px;">
                <li>${step1}</li>
                <li>${step2}</li>
                <li>${step3}</li>
                <li>${step4}</li>
                <li>${step5}</li>
            </ol>
            <div style="margin-top: 20px;">
                <input type="button" id="btn-open-trashmail" class="button"
                       style="height: 32px; min-width: 140px; background-color: #0066cc; color: white;"
                       value="${btnOpen}">
                <input type="button" id="btn-pat-cancel" class="button"
                       style="height: 32px; min-width: 100px;"
                       value="${btnCancel}">
            </div>
        `;
        loginPanel.parentNode!.insertBefore(panelPat, loginPanel.nextSibling);

        // Add event listeners
        elById("btn-open-trashmail").onclick = function () {
            browser.tabs.create({ url: `${API_BASE_URL}/?cmd=manager` });
        };
        elById("btn-pat-cancel").onclick = function () {
            changePanel("login-panel");
        };
    }

    // Show PAT info panel
    changePanel("pat-required-panel");
}

function resetPassword(e: Event) {
    e.preventDefault();
    const resetButton = elById<HTMLButtonElement>("btn-reset-password");
    const cancelButton = elById<HTMLButtonElement>("btn-lost-cancel");
    const progress = elById("progress-lost");
    const lostError = elById("lost-error");

    resetButton.disabled = true;
    cancelButton.disabled = true;
    progress.style.display = "inline-block";
    lostError.style.display = "none";

    const form = new FormData(e.target as HTMLFormElement);
    const data = {
        "cmd": "reset_password",
        "username": form.get("username"),
        "email": form.get("email"),
    };

    callAPI(data).then(() => {
        lostError.className = "success";
        lostError.innerHTML = browser.i18n.getMessage(
            "lostPasswordSuccess", form.get("email") as string);
        lostError.style.display = "block";

        progress.remove();
        cancelButton.remove();
        resetButton.remove();
    }).catch((error) => {
        lostError.textContent = String(error);
        lostError.style.display = "block";
        progress.style.display = "none";
        cancelButton.disabled = false;
        resetButton.disabled = false;
    });
}

elById("btn-show-register").onclick = function () {
    changePanel("register-panel");
    startRegistrationTracking();
    // Conversion-Booster: direkt Namensvorschlaege anbieten,
    // damit sich niemand selbst etwas ausdenken muss
    if (elById<HTMLInputElement>("register-username").value === "") {
        renderUsernameIdeas();
    }
};
elById("btn-show-login").onclick = function () {
    changePanel("login-panel");
};
elById("btn-register-cancel").onclick = function () {
    changePanel("welcome-panel");
};
elById("btn-login-cancel").onclick = function () {
    changePanel("welcome-panel");
};
elById("lost-password").onclick = function () {
    changePanel("lost-password-panel");
};
elById("btn-lost-cancel").onclick = function () {
    changePanel("login-panel");
};

elById("form-login").addEventListener("submit", login);

elById("form-register").addEventListener("submit", register);

elById("register-username").addEventListener("input", validateUsernameLive);

elById("register-password").addEventListener("input", updatePasswordStrengthLive);

elById("register-toggle-pw").addEventListener("click", togglePasswordVisibility);

elById("form-lost").addEventListener("submit", resetPassword);

export {};
