import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';
import { loadHtmlBody, stubCommonGlobals, fireDomReady, tick, resetDocumentListeners, clearAuthClients, type CommonGlobals } from './_helpers';

let mock: BrowserMock;
let globals: CommonGlobals;

async function importWelcome(): Promise<void> {
    await import('../../ts/options/welcome');
}

function $(id: string): HTMLElement {
    return document.getElementById(id)!;
}
function input(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
}

/** Standard-callAPI-Router für die Login-/Register-Flows. */
function routeCallApi(loginResult: Record<string, unknown>): void {
    globals.callAPI.mockImplementation(async (data: { cmd: string }) => {
        if (data.cmd === 'login') return loginResult;
        if (data.cmd === 'read_dea') return [];
        return {};
    });
}

function setOpaqueClient(client: unknown): void {
    (globalThis as Record<string, unknown>)['addonOpaqueClient'] = client;
}

describe('welcome.ts', () => {
    beforeEach(() => {
        vi.resetModules();
        resetDocumentListeners();
        mock = installBrowserMock();
        loadHtmlBody('options/welcome.html');
        globals = stubCommonGlobals();
        clearAuthClients();
        // loadDEAAndClose lädt public_suffix.json.
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, {}] })));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('panel switching', () => {
        it('shows the login / lost-password panels on demand', async () => {
            await importWelcome();
            $('btn-show-login').dispatchEvent(new MouseEvent('click'));
            expect($('login-panel').style.display).toBe('block');
            expect($('welcome-panel').style.display).toBe('none');

            $('lost-password').dispatchEvent(new MouseEvent('click'));
            expect($('lost-password-panel').style.display).toBe('block');

            $('btn-lost-cancel').dispatchEvent(new MouseEvent('click'));
            expect($('login-panel').style.display).toBe('block');
        });
    });

    describe('register (register_account_v2, unsichtbarer Bot-Check)', () => {
        /** Routet fetch: unsichtbare Captcha-Validierung + public_suffix.json. */
        function routeFetch(captchaResponse: Record<string, unknown>): ReturnType<typeof vi.fn> {
            const fetchMock = vi.fn(async (url: string) => {
                if (String(url).includes('game_captcha_validate')) {
                    return { ok: true, json: async () => captchaResponse };
                }
                return { ok: true, json: async () => [{}, {}] };
            });
            vi.stubGlobal('fetch', fetchMock);
            return fetchMock;
        }

        function fillForm(username = 'newuser', password = 'secret123', email = 'real@example.com'): void {
            input('register-username').value = username;
            input('register-password').value = password;
            input('register-email').value = email;
        }

        it('toggles password visibility with the eye button (replaces the confirm field)', async () => {
            await importWelcome();
            $('btn-show-register').dispatchEvent(new MouseEvent('click'));

            expect(document.getElementById('register-confirm')).toBeNull();
            const pw = input('register-password');
            expect(pw.type).toBe('password');

            $('register-toggle-pw').dispatchEvent(new MouseEvent('click'));
            expect(pw.type).toBe('text');
            expect($('register-toggle-pw').getAttribute('aria-pressed')).toBe('true');

            $('register-toggle-pw').dispatchEvent(new MouseEvent('click'));
            expect(pw.type).toBe('password');
        });

        it('ticks off the password policy checklist interactively', async () => {
            await importWelcome();
            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            const pw = input('register-password');
            const met = () => Array.from(document.querySelectorAll('#register-pw-checklist li.met'))
                .map((li) => (li as HTMLElement).dataset['crit']);

            pw.value = 'abc';
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            expect(met()).toEqual([]);

            pw.value = 'abcdefg1';
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            expect(met()).toEqual(['len8', 'digit']);

            pw.value = 'Abcdefgh123!x';
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            expect(met()).toEqual(['len8', 'len12', 'case', 'digit', 'special']);
        });

        it('offers clickable username ideas when the field is empty (conversion booster)', async () => {
            mock.i18n.messages.set('registerUsernameIdeas', 'Vorschlaege:');
            const fetchMock = vi.fn(async (url: string) => {
                if (String(url).includes('check_username_available')) {
                    return { ok: true, json: async () => ({ available: true, error: null, suggestions: [] }) };
                }
                return { ok: true, json: async () => [{}, {}] };
            });
            vi.stubGlobal('fetch', fetchMock);
            await importWelcome();
            $('btn-show-register').dispatchEvent(new MouseEvent('click'));

            const ideas = $('register-username-ideas');
            expect(ideas.style.display).toBe('block');
            const pills = ideas.querySelectorAll('button.suggestion-btn');
            // 3 Vorschlaege + Neu-Wuerfeln-Button
            expect(pills.length).toBe(4);
            const firstIdea = pills[0]!.textContent!;
            // Vorschlaege sind immer regelkonform (adjektiv-tier + Zahl)
            expect(firstIdea).toMatch(/^[a-z]+-[a-z]+\d{2}$/);

            // Klick uebernimmt den Vorschlag und blendet die Ideen aus
            (pills[0] as HTMLButtonElement).dispatchEvent(new MouseEvent('click'));
            expect(input('register-username').value).toBe(firstIdea);
            expect(ideas.style.display).toBe('none');
        });

        it('checks username availability live and applies clickable suggestions', async () => {
            mock.i18n.messages.set('registerUsernameSuggestion', 'Wie waere es mit:');
            mock.i18n.messages.set('registerUsernameAvailable', 'Verfuegbar');
            const fetchMock = vi.fn(async (url: string, options?: { body?: string }) => {
                if (String(url).includes('check_username_available')) {
                    const requested = JSON.parse(options?.body ?? '{}').username as string;
                    if (requested === 'vergeben') {
                        return { ok: true, json: async () => ({ available: false, error: 'Schon weg.', suggestions: ['vergeben1', 'vergeben2'] }) };
                    }
                    return { ok: true, json: async () => ({ available: true, error: null, suggestions: [] }) };
                }
                return { ok: true, json: async () => [{}, {}] };
            });
            vi.stubGlobal('fetch', fetchMock);
            vi.useFakeTimers();
            await importWelcome();
            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            const usernameInput = input('register-username');
            const availability = $('register-username-availability');

            usernameInput.value = 'vergeben';
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
            await vi.advanceTimersByTimeAsync(400);
            vi.useRealTimers();
            await tick();

            // Vergeben: roter Hinweis + Server-Fehlertext + Vorschlags-Buttons, Submit blockiert
            expect(availability.style.display).toBe('block');
            expect(availability.classList.contains('invalid')).toBe(true);
            expect(availability.textContent).toContain('Schon weg.');
            expect(usernameInput.validationMessage).toBe('Schon weg.');
            const suggestionButtons = availability.querySelectorAll('button.suggestion-btn');
            expect(suggestionButtons.length).toBe(2);
            expect(suggestionButtons[0]!.textContent).toBe('vergeben1');

            // Klick auf Vorschlag uebernimmt den Namen und prueft erneut
            vi.useFakeTimers();
            (suggestionButtons[0] as HTMLButtonElement).dispatchEvent(new MouseEvent('click'));
            expect(usernameInput.value).toBe('vergeben1');
            await vi.advanceTimersByTimeAsync(400);
            vi.useRealTimers();
            await tick();

            expect(availability.classList.contains('ok')).toBe(true);
            expect(availability.textContent).toBe('Verfuegbar');
            expect(usernameInput.validationMessage).toBe('');
        });

        it('blocks passwords below "Ok" (score < 2) like the website does', async () => {
            mock.i18n.messages.set('registerPasswordTooWeak', 'ZU SCHWACH');
            routeFetch({ success: true, game_session_id: 'gs1' });
            const registerAccountV2 = vi.fn();
            setOpaqueClient({ registerAccountV2 });
            await importWelcome();
            $('btn-show-register').dispatchEvent(new MouseEvent('click'));

            fillForm('newuser', 'abcdefgh');  // nur Laenge >= 8 -> Score 1 = Schwach
            $('form-register').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();

            expect(input('register-password').validationMessage).toBe('ZU SCHWACH');
            expect(registerAccountV2).not.toHaveBeenCalled();
        });

        it('shows the password strength interactively while typing (website policy)', async () => {
            mock.i18n.messages.set('registerPwWeak', 'Schwach');
            mock.i18n.messages.set('registerPwOk', 'Ok');
            mock.i18n.messages.set('registerPwStrong', 'Stark');
            mock.i18n.messages.set('registerPasswordTooWeak', 'ZU SCHWACH');
            await importWelcome();
            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            const pw = input('register-password');
            const bar = $('register-pw-strength-bar');
            const label = $('register-pw-strength-label');

            pw.value = 'abcdefgh';  // Score 1 = Schwach
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            expect(bar.style.width).toBe('25%');
            expect(label.textContent).toBe('Schwach');
            expect(pw.validationMessage).toBe('ZU SCHWACH');

            pw.value = 'secret123';  // Score 2 = Ok -> gueltig
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            expect(bar.style.width).toBe('50%');
            expect(label.textContent).toBe('Ok');
            expect(pw.validationMessage).toBe('');

            pw.value = 'Abcdefgh123!x';  // alle Kriterien -> Score 4 = Stark
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            expect(bar.style.width).toBe('100%');
            expect(label.textContent).toBe('Stark');

            pw.value = '';
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            expect(bar.style.width).toBe('0%');
            expect(label.textContent).toBe('');
        });

        it('registers via OPAQUE with an invisible captcha, auto-creates a PAT, stores the real email and closes the window', async () => {
            mock.i18n.messages.set('confirmSentTo', 'Mail an $1 geschickt.');
            const fetchMock = routeFetch({ success: true, game_session_id: 'gs1' });
            const registerAccountV2 = vi.fn().mockResolvedValue({ success: true, account_id: 42, username: 'newuser' });
            const passwordOpaqueLogin = vi.fn().mockResolvedValue({
                success: true, session_id: 's9', domain_name_list: ['a.com'], real_email_list: {},
            });
            const createAccessTokenOpaque = vi.fn().mockResolvedValue('tmpat_fresh');
            setOpaqueClient({ registerAccountV2, passwordOpaqueLogin, createAccessTokenOpaque });
            globals.callAPI.mockImplementation(async (data: { cmd: string }) => (data.cmd === 'read_dea' ? [] : { success: true }));
            const windowsRemove = vi.spyOn(mock.windows, 'remove');
            await importWelcome();

            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            fillForm('NewUser');  // wird lowercased
            $('form-register').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();
            await tick();
            await tick();
            await tick();

            // Unsichtbarer Bot-Check beim Absenden: Metriken innerhalb der
            // Server-Plausibilitaetsfenster (>=3.2s, >=12 Interaktionen)
            const captchaCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('game_captcha_validate'))!;
            const body = JSON.parse((captchaCall[1] as { body: string }).body);
            expect(body.score).toBe(5);
            expect(body.duration).toBeGreaterThanOrEqual(3200);
            expect(body.movements).toBeGreaterThanOrEqual(12);
            expect(body.spam_caught).toBe(0);

            expect(registerAccountV2).toHaveBeenCalledWith('newuser', 'secret123', 'gs1');
            // v2-Konten sind OPAQUE-only -> Login via OPAQUE, nicht classic
            expect(passwordOpaqueLogin).toHaveBeenCalledWith('newuser', 'secret123', { establishBrowserSession: true });
            // OPAQUE-PAT automatisch angelegt (pat_opaque_create_*, NICHT
            // create_access_token - Classic-Tokens kann patOpaqueLogin nicht
            // verifizieren) und statt des Passworts hinterlegt
            expect(createAccessTokenOpaque).toHaveBeenCalledWith('s9', expect.any(String));
            expect(globals.createAccessToken).not.toHaveBeenCalled();
            expect(mock.storage.sync.data.get('username')).toBe('newuser');
            expect(mock.storage.sync.data.get('password')).toBe('tmpat_fresh');
            expect(mock.storage.local.data.get('session_id')).toBe('s9');
            expect(mock.storage.local.data.get('is_opaque_account')).toBe(true);
            // Echte E-Mail-Adresse wird serverseitig hinterlegt (Bestaetigungs-Mail)
            expect(globals.callAPI).toHaveBeenCalledWith(expect.objectContaining({
                cmd: 'add_real_email', session_id: 's9', email: 'real@example.com',
            }));
            expect(mock.storage.local.data.get('real_emails')).toEqual(['real@example.com']);
            expect(mock.storage.sync.data.get('default_email')).toBe('real@example.com');
            // Fenster schliesst NICHT sofort - erst der Bestaetigungs-Schritt
            expect(windowsRemove).not.toHaveBeenCalled();
            expect($('confirm-panel').style.display).toBe('block');
            expect($('confirm-sent-to').textContent).toContain('real@example.com');
        });

        it('waits live for the email confirmation, then stores confirmed list and closes', async () => {
            vi.useFakeTimers();
            routeFetch({ success: true, game_session_id: 'gs1' });
            setOpaqueClient({
                registerAccountV2: vi.fn().mockResolvedValue({ success: true }),
                passwordOpaqueLogin: vi.fn().mockResolvedValue({ success: true, session_id: 's9', domain_name_list: [], real_email_list: {} }),
                createAccessTokenOpaque: vi.fn().mockResolvedValue('tmpat_fresh'),
            });
            let confirmed = false;
            globals.callAPI.mockImplementation(async (data: { cmd: string }) => {
                if (data.cmd === 'list_real_emails') {
                    return {
                        success: true,
                        data: {
                            real_emails_detailed: [{ email: 'real@example.com', confirmed }],
                            real_email_list: confirmed ? ['real@example.com'] : [],
                        },
                    };
                }
                return data.cmd === 'read_dea' ? [] : { success: true };
            });
            const windowsRemove = vi.spyOn(mock.windows, 'remove');
            await importWelcome();

            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            fillForm();
            $('form-register').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            for (let flush = 0; flush < 8; flush++) { await vi.advanceTimersByTimeAsync(1); }

            // Panel wartet (erster Poll: unbestaetigt)
            expect($('confirm-panel').style.display).toBe('block');
            expect($('confirm-status').classList.contains('done')).toBe(false);
            expect(windowsRemove).not.toHaveBeenCalled();

            // User klickt den Link -> naechster Poll (3s) erkennt die Bestaetigung
            confirmed = true;
            await vi.advanceTimersByTimeAsync(3100);
            expect($('confirm-status').classList.contains('done')).toBe(true);
            // Nur die bestaetigte Liste landet im Storage
            expect(mock.storage.local.data.get('real_emails')).toEqual(['real@example.com']);

            // Nach kurzem Erfolgsmoment schliesst das Fenster
            await vi.advanceTimersByTimeAsync(1600);
            expect(windowsRemove).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('lets the user resend the confirmation email or skip waiting', async () => {
            routeFetch({ success: true, game_session_id: 'gs1' });
            setOpaqueClient({
                registerAccountV2: vi.fn().mockResolvedValue({ success: true }),
                passwordOpaqueLogin: vi.fn().mockResolvedValue({ success: true, session_id: 's9', domain_name_list: [], real_email_list: {} }),
                createAccessTokenOpaque: vi.fn().mockResolvedValue('tmpat_fresh'),
            });
            globals.callAPI.mockImplementation(async (data: { cmd: string }) => (data.cmd === 'read_dea' ? [] : { success: true }));
            const windowsRemove = vi.spyOn(mock.windows, 'remove');
            await importWelcome();

            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            fillForm();
            $('form-register').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(); await tick(); await tick(); await tick();
            expect($('confirm-panel').style.display).toBe('block');

            // Erneut senden
            $('btn-confirm-resend').dispatchEvent(new MouseEvent('click'));
            await tick();
            expect(globals.callAPI).toHaveBeenCalledWith(expect.objectContaining({
                cmd: 'resend_confirmation_email', session_id: 's9', email: 'real@example.com',
            }));

            // Spaeter bestaetigen -> Fenster schliesst trotzdem
            $('btn-confirm-skip').dispatchEvent(new MouseEvent('click'));
            await tick(); await tick();
            expect(windowsRemove).toHaveBeenCalled();
        });

        it('validates the username LIVE while typing (server rules, lowercased)', async () => {
            mock.i18n.messages.set('registerUsernameRules', 'REGELN');
            await importWelcome();
            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            const usernameInput = input('register-username');
            const hint = $('register-username-hint');

            // Grossbuchstaben werden beim Tippen normalisiert
            usernameInput.value = 'MaxMustermann';
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
            expect(usernameInput.value).toBe('maxmustermann');
            expect(hint.classList.contains('invalid')).toBe(false);
            expect(usernameInput.validationMessage).toBe('');

            // Ungueltige Zeichen -> Hinweis wird sofort rot, Formular blockiert
            usernameInput.value = 'max mustermann!';
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
            expect(hint.classList.contains('invalid')).toBe(true);
            expect(usernameInput.validationMessage).toBe('REGELN');

            // Punkt am Ende -> ungueltig; gueltiger Name -> wieder ok
            usernameInput.value = 'max.mustermann.';
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
            expect(hint.classList.contains('invalid')).toBe(true);

            usernameInput.value = 'max.muster-mann';
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
            expect(hint.classList.contains('invalid')).toBe(false);
            expect(usernameInput.validationMessage).toBe('');
        });

        it('shows the error when the invisible captcha validation is rejected', async () => {
            routeFetch({ success: false, msg: 'Captcha abgelehnt' });
            const registerAccountV2 = vi.fn();
            setOpaqueClient({ registerAccountV2 });
            await importWelcome();

            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            fillForm();
            $('form-register').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();
            await tick();

            expect($('register-error').style.display).toBe('block');
            expect($('register-error').textContent).toContain('Captcha');
            expect(registerAccountV2).not.toHaveBeenCalled();
            // Buttons wieder frei fuer einen neuen Versuch
            expect(input('btn-register').disabled).toBe(false);
        });

        it('shows the server error when the registration itself fails', async () => {
            routeFetch({ success: true, game_session_id: 'gs1' });
            const serverError = Object.assign(new Error('Benutzername bereits vergeben'), { errorCode: 71 });
            setOpaqueClient({ registerAccountV2: vi.fn().mockRejectedValue(serverError) });
            await importWelcome();

            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            fillForm();
            $('form-register').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();
            await tick();
            await tick();

            expect($('register-error').style.display).toBe('block');
            expect($('register-error').textContent).toContain('vergeben');
            expect(input('btn-register').disabled).toBe(false);
        });

        it('keeps the window open and shows the error when add_real_email fails', async () => {
            routeFetch({ success: true, game_session_id: 'gs1' });
            setOpaqueClient({
                registerAccountV2: vi.fn().mockResolvedValue({ success: true }),
                passwordOpaqueLogin: vi.fn().mockResolvedValue({ success: true, session_id: 's9', domain_name_list: [], real_email_list: {} }),
                createAccessTokenOpaque: vi.fn().mockResolvedValue('tmpat_fresh'),
            });
            globals.callAPI.mockImplementation(async (data: { cmd: string }) => {
                if (data.cmd === 'add_real_email') { throw new Error('Ungültige E-Mail-Adresse'); }
                return data.cmd === 'read_dea' ? [] : { success: true };
            });
            const windowsRemove = vi.spyOn(mock.windows, 'remove');
            await importWelcome();

            $('btn-show-register').dispatchEvent(new MouseEvent('click'));
            fillForm('newuser', 'secret123', 'kaputt@example.com');
            $('form-register').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();
            await tick();
            await tick();
            await tick();

            // Konto + PAT existieren, aber der Fehler wird gezeigt, Fenster bleibt offen
            expect(mock.storage.sync.data.get('password')).toBe('tmpat_fresh');
            expect($('register-error').style.display).toBe('block');
            expect($('register-error').textContent).toContain('E-Mail');
            expect(windowsRemove).not.toHaveBeenCalled();
        });
    });

    describe('login – classic password', () => {
        it('logs in, creates a PAT and stores session data', async () => {
            routeCallApi({ session_id: 's1', domain_name_list: ['a.com'], real_email_list: { 'x@y.com': 1 } });
            globals.createAccessToken.mockResolvedValue('tmpat_token');
            await importWelcome();

            input('login-username').value = 'bob';
            input('login-password').value = 'plainpw';
            $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(8);

            expect(globals.callAPI).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'login' }));
            expect(globals.createAccessToken).toHaveBeenCalled();
            expect(mock.storage.sync.data.get('password')).toBe('tmpat_token');
            expect(mock.storage.local.data.get('session_id')).toBe('s1');
            expect(mock.storage.local.data.get('domains')).toEqual(['a.com']);
        });

        it('falls back to the original password when PAT creation fails', async () => {
            routeCallApi({ session_id: 's1', domain_name_list: [], real_email_list: {} });
            globals.createAccessToken.mockRejectedValue(new Error('pat failed'));
            await importWelcome();

            input('login-username').value = 'bob';
            input('login-password').value = 'plainpw';
            $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(8);

            expect(mock.storage.sync.data.get('password')).toBe('plainpw');
        });

        it('REGRESSION: domain_name_list as an OBJECT is normalised via Object.keys', async () => {
            routeCallApi({ session_id: 's1', domain_name_list: { 'a.com': 1, 'b.com': 1 }, real_email_list: {} });
            globals.createAccessToken.mockResolvedValue('tmpat_token');
            await importWelcome();

            input('login-username').value = 'bob';
            input('login-password').value = 'plainpw';
            $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(8);

            expect(mock.storage.local.data.get('domains')).toEqual(['a.com', 'b.com']);
        });

        it('shows the PAT-required panel when the account uses 2FA', async () => {
            // Real callAPI REJECTS with a requires_2fa error (see api.js).
            globals.callAPI.mockImplementation(async (data: { cmd: string }) => {
                if (data.cmd === 'login') {
                    const err = new Error('2fa required') as Error & { requires_2fa?: boolean };
                    err.requires_2fa = true;
                    throw err;
                }
                return {};
            });
            await importWelcome();

            input('login-username').value = 'bob';
            input('login-password').value = 'plainpw';
            $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(6);

            expect(document.getElementById('pat-required-panel')).not.toBeNull();
            expect(document.getElementById('pat-required-panel')!.style.display).toBe('block');
        });
    });

    describe('login – OPAQUE / PAT', () => {
        it('uses PAT-OPAQUE authentication when the server has OPAQUE enabled', async () => {
            const patOpaqueLogin = vi.fn().mockResolvedValue({ session_id: 's-opaque', domain_name_list: [], real_email_list: {} });
            setOpaqueClient({
                checkOpaqueEnabled: vi.fn().mockResolvedValue({ opaque_enabled: true, srp_enabled: false }),
                patOpaqueLogin,
            });
            routeCallApi({});
            await importWelcome();

            input('login-username').value = 'bob';
            input('login-password').value = 'tmpat_secrettoken';
            $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(8);

            expect(patOpaqueLogin).toHaveBeenCalledWith('bob', 'tmpat_secrettoken');
            expect(mock.storage.local.data.get('session_id')).toBe('s-opaque');
        });

        it('falls back to classic PAT login when OPAQUE fails', async () => {
            setOpaqueClient({
                checkOpaqueEnabled: vi.fn().mockResolvedValue({ opaque_enabled: true, srp_enabled: false }),
                patOpaqueLogin: vi.fn().mockRejectedValue(new Error('OPAQUE handshake failed')),
            });
            routeCallApi({ session_id: 's-classic', domain_name_list: [], real_email_list: {} });
            await importWelcome();

            input('login-username').value = 'bob';
            input('login-password').value = 'tmpat_secrettoken';
            $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(8);

            expect(globals.callAPI).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'login' }));
            expect(mock.storage.local.data.get('session_id')).toBe('s-classic');
        });

        it('shows the OPAQUE-PAT-required panel for a classic password on an OPAQUE account', async () => {
            setOpaqueClient({
                checkOpaqueEnabled: vi.fn().mockResolvedValue({ opaque_enabled: true, srp_enabled: false }),
                patOpaqueLogin: vi.fn(),
            });
            await importWelcome();

            input('login-username').value = 'bob';
            input('login-password').value = 'plainpassword';
            $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick(6);

            expect(document.getElementById('opaque-pat-required-panel')).not.toBeNull();
        });
    });

    describe('lost password', () => {
        it('submits a reset request and shows success', async () => {
            mock.i18n.messages.set('lostPasswordSuccess', 'reset sent to $1');
            globals.callAPI.mockResolvedValue({});
            await importWelcome();
            input('lost-username').value = 'bob';
            input('lost-email').value = 'a@b.com';

            $('form-lost').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();

            expect(globals.callAPI).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'reset_password' }));
            expect($('lost-error').className).toBe('success');
            expect($('lost-error').innerHTML).toBe('reset sent to a@b.com');
        });

        it('shows the error on failure', async () => {
            globals.callAPI.mockRejectedValue(new Error('nope'));
            await importWelcome();
            input('lost-username').value = 'bob';
            input('lost-email').value = 'a@b.com';

            $('form-lost').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await tick();

            expect($('lost-error').style.display).toBe('block');
            expect(input('btn-reset-password').disabled).toBe(false);
        });
    });

    function setSrpClient(client: unknown): void {
        (globalThis as Record<string, unknown>)['addonSrpClient'] = client;
    }

    async function submitLogin(username: string, password: string, ticks = 8): Promise<void> {
        input('login-username').value = username;
        input('login-password').value = password;
        $('form-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        await tick(ticks);
    }

    describe('login – SRP', () => {
        it('uses SRP zero-knowledge login when the account has SRP enabled', async () => {
            const srpLogin = vi.fn().mockResolvedValue({ session_id: 's-srp', domain_name_list: [], real_email_list: {} });
            setSrpClient({
                checkSrpEnabled: vi.fn().mockResolvedValue({ success: true, srp_enabled: true }),
                login: srpLogin,
                migrateToSrp: vi.fn(),
            });
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => (d.cmd === 'read_dea' ? [] : {}));
            globals.createAccessToken.mockResolvedValue('tmpat_srp');
            await importWelcome();

            await submitLogin('bob', 'plainpw');

            expect(srpLogin).toHaveBeenCalledWith('bob', 'plainpw');
            expect(mock.storage.local.data.get('session_id')).toBe('s-srp');
        });

        it('shows the 2FA panel when SRP reports requires_2fa', async () => {
            setSrpClient({
                checkSrpEnabled: vi.fn().mockResolvedValue({ success: true, srp_enabled: true }),
                login: vi.fn().mockResolvedValue({ requires_2fa: true }),
                migrateToSrp: vi.fn(),
            });
            await importWelcome();

            await submitLogin('bob', 'plainpw', 6);

            expect(document.getElementById('pat-required-panel')).not.toBeNull();
        });

        it('classic login migrates to SRP when the server offers migrate_to_srp', async () => {
            const migrateToSrp = vi.fn().mockResolvedValue({});
            setSrpClient({
                checkSrpEnabled: vi.fn().mockResolvedValue({ success: true, srp_enabled: false }),
                login: vi.fn(),
                migrateToSrp,
            });
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') return { session_id: 's-mig', domain_name_list: [], real_email_list: {}, migrate_to_srp: true };
                if (d.cmd === 'read_dea') return [];
                return {};
            });
            globals.createAccessToken.mockResolvedValue('tmpat_mig');
            await importWelcome();

            await submitLogin('bob', 'plainpw');

            expect(migrateToSrp).toHaveBeenCalledWith('bob', 'plainpw');
            expect(mock.storage.local.data.get('session_id')).toBe('s-mig');
        });

        it('async classic path shows the 2FA panel on requires_2fa', async () => {
            setSrpClient({
                checkSrpEnabled: vi.fn().mockResolvedValue({ success: true, srp_enabled: false }),
                login: vi.fn(),
                migrateToSrp: vi.fn(),
            });
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') return { requires_2fa: true };
                return {};
            });
            await importWelcome();

            await submitLogin('bob', 'plainpw', 6);

            expect(document.getElementById('pat-required-panel')).not.toBeNull();
        });
    });

    describe('login – misc branches', () => {
        it('flow A: classic PAT login when the OPAQUE client is unavailable', async () => {
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') return { session_id: 's-pat', domain_name_list: [], real_email_list: {} };
                if (d.cmd === 'read_dea') return [];
                return {};
            });
            await importWelcome();

            await submitLogin('bob', 'tmpat_sometoken');

            expect(globals.callAPI).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'login' }));
            expect(globals.createAccessToken).not.toHaveBeenCalled(); // already a PAT
            expect(mock.storage.local.data.get('session_id')).toBe('s-pat');
        });

        it('names the PAT after the browser (Firefox)', async () => {
            Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Firefox/123' });
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') return { session_id: 's1', domain_name_list: [], real_email_list: {} };
                if (d.cmd === 'read_dea') return [];
                return {};
            });
            globals.createAccessToken.mockResolvedValue('tmpat_x');
            await importWelcome();

            await submitLogin('bob', 'plainpw');

            expect(globals.createAccessToken).toHaveBeenCalledWith('s1', 'Firefox Extension');
        });

        it('rebuilds the previous-addresses map from DEAs (loadDEAAndClose)', async () => {
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') return { session_id: 's1', domain_name_list: [], real_email_list: {} };
                if (d.cmd === 'read_dea') {
                    return [
                        { website: 'https://shop.example.com/a', disposable_name: 'd1', disposable_domain: 'trash.com' },
                        { website: 'https://shop.example.com/b', disposable_name: 'd2', disposable_domain: 'trash.com' },
                        { website: '', disposable_name: 'd3', disposable_domain: 'trash.com' }, // ohne website -> übersprungen
                        { website: 'not a url', disposable_name: 'd4', disposable_domain: 'trash.com' }, // URL wirft -> continue
                    ];
                }
                return {};
            });
            globals.createAccessToken.mockResolvedValue('tmpat_x');
            await importWelcome();

            await submitLogin('bob', 'plainpw');

            const prev = mock.storage.local.data.get('previous_addresses') as Record<string, unknown[]>;
            // org_domain-Stub -> hostname; beide gültigen Adressen unter demselben Host.
            expect(prev['shop.example.com']).toHaveLength(2);
        });

        it('falls back to classic login when the OPAQUE check itself fails', async () => {
            setOpaqueClient({
                checkOpaqueEnabled: vi.fn().mockRejectedValue(new Error('opaque_check network error')),
                patOpaqueLogin: vi.fn(),
            });
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') return { session_id: 's-fb', domain_name_list: [], real_email_list: {} };
                if (d.cmd === 'read_dea') return [];
                return {};
            });
            globals.createAccessToken.mockResolvedValue('tmpat_x');
            await importWelcome();

            await submitLogin('bob', 'plainpw');

            expect(mock.storage.local.data.get('session_id')).toBe('s-fb');
        });

        it('shows a login error when a PAT-OPAQUE failure is not OPAQUE-related', async () => {
            setOpaqueClient({
                checkOpaqueEnabled: vi.fn().mockResolvedValue({ opaque_enabled: true, srp_enabled: false }),
                patOpaqueLogin: vi.fn().mockRejectedValue(new Error('network down')), // enthält NICHT "OPAQUE"
            });
            await importWelcome();

            await submitLogin('bob', 'tmpat_token', 6);

            expect($('login-error').style.display).toBe('block');
        });

        it('classic login (no auth clients) surfaces API errors', async () => {
            globals.callAPI.mockRejectedValue(new Error('server down'));
            await importWelcome();

            await submitLogin('bob', 'plainpw', 6);

            expect($('login-error').style.display).toBe('block');
            expect(input('btn-login').disabled).toBe(false);
        });

        it('localises the 2FA panel to French', async () => {
            mock.i18n.getUILanguage = () => 'fr-FR';
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') {
                    const err = new Error('2fa') as Error & { requires_2fa?: boolean };
                    err.requires_2fa = true;
                    throw err;
                }
                return {};
            });
            await importWelcome();

            await submitLogin('bob', 'plainpw', 6);

            expect(document.getElementById('pat-required-panel')!.innerHTML).toContain('Authentification à deux facteurs');
        });

        it.each([
            ['Mozilla/5.0 Chrome/120', 'Chrome Extension'],
            ['Mozilla/5.0 Safari/605', 'Safari Extension'],
            ['Mozilla/5.0 Edge/120', 'Edge Extension'],
        ])('names the PAT after the browser for UA %s', async (userAgent, expectedName) => {
            Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: userAgent });
            globals.callAPI.mockImplementation(async (d: { cmd: string }) => {
                if (d.cmd === 'login') return { session_id: 's1' }; // domain_name_list/real_email_list fehlen -> || []/{}
                if (d.cmd === 'read_dea') return [];
                return {};
            });
            globals.createAccessToken.mockResolvedValue('tmpat_x');
            await importWelcome();

            await submitLogin('bob', 'plainpw');

            expect(globals.createAccessToken).toHaveBeenCalledWith('s1', expectedName);
        });

        it('surfaces a generic auth error via showLoginError', async () => {
            setOpaqueClient({
                checkOpaqueEnabled: vi.fn().mockRejectedValue(new Error('totally unexpected')),
                patOpaqueLogin: vi.fn(),
            });
            await importWelcome();

            await submitLogin('bob', 'plainpw', 6);

            expect($('login-error').style.display).toBe('block');
            expect(input('btn-login').disabled).toBe(false);
        });
    });

    describe('OPAQUE PAT-required panel – localisation', () => {
        it.each([
            ['fr-FR', 'Personal Access Token requis'],
            ['en-US', 'Personal Access Token Required'],
        ])('renders the %s panel text', async (uiLang, expectedTitle) => {
            mock.i18n.getUILanguage = () => uiLang;
            setOpaqueClient({
                checkOpaqueEnabled: vi.fn().mockResolvedValue({ opaque_enabled: true, srp_enabled: false }),
                patOpaqueLogin: vi.fn(),
            });
            await importWelcome();

            await submitLogin('bob', 'plainpassword', 6);

            const panel = document.getElementById('opaque-pat-required-panel')!;
            expect(panel.innerHTML).toContain(expectedTitle);
        });
    });
});
