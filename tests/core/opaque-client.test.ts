/**
 * #8d29c6d5 #26f94a61: opaque-client.js - Zugriffstoken per OPAQUE anlegen.
 *
 * Gemessen am 28.10.2026 gegen mail.aionda.com (Safari 26.6 auf dev-macos3,
 * Testkonto aiondaprodtest2, Web-Inspektor der Erweiterung):
 *
 *   - pat_opaque_create_finish verlangt `mcp_capability_hash` (seit 77ddb2da8
 *     im src-Repo): ohne antwortet der Server mit Fehler 6 „session_id,
 *     user_record, name, token_prefix, and mcp_capability_hash are required".
 *     Die Erweiterung schickte das Feld nie - die Anmeldung mit Passwort
 *     scheiterte damit in JEDEM Browser beim Anlegen des Tokens.
 *   - Safari schickt das Sitzungscookie von Erweiterungsseiten nicht mit:
 *     finish nur mit Cookie -> Fehler 70 „Bitte melde dich an …". Mit der
 *     Konto-Sitzung als `session_id` in der ADRESSE und der OPAQUE-Sitzung im
 *     Rumpf kommt finish an der Anmeldung vorbei (Fehler 11 für eine erfundene
 *     OPAQUE-Sitzung, also hinter der Prüfung). Der alte Kommentar „der Rumpf
 *     überschreibt den URL-Parameter, daher nur Cookie" stimmte nicht.
 *   - Seit 6.1.3 geht die Konto-Sitzung in die Kopfzeile X-TrashMail-Session
 *     statt in die Adresse (keine Sitzung im Zugriffsprotokoll). Gegen Dev
 *     gemessen am 03.11.2026: init und finish antworten mit Kopfzeile genau
 *     wie mit Adresse (Fehler 11 statt 70 ohne Sitzung). In Safari selbst
 *     ist das NICHT gemessen.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock } from '../helpers/browser-mock';

interface Aufruf { url: string; init: RequestInit }

function ladeClient(): { createAccessTokenOpaque(sessionId: string, name: string): Promise<string> } {
    const quelle = readFileSync('trashmail-addon/opaque-client.js', 'utf8');
    // Klassisches Skript: die Klasse aus dem Skript holen, ohne Modulsystem.
    const Klasse = new Function(`${quelle}\nreturn AddonOpaqueClient;`)() as new () => { createAccessTokenOpaque(sessionId: string, name: string): Promise<string> };
    return new Klasse();
}

describe('createAccessTokenOpaque', () => {
    let aufrufe: Aufruf[];

    beforeEach(() => {
        installBrowserMock();
        aufrufe = [];
        (globalThis as Record<string, unknown>)['opaque'] = {
            ready: Promise.resolve(),
            client: {
                startRegistration: () => ({ clientRegistrationState: 'zustand', registrationRequest: 'anfrage' }),
                finishRegistration: () => ({ registrationRecord: 'datensatz' }),
            },
        };
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            aufrufe.push({ url, init });
            const antwort = url.includes('pat_opaque_create_init')
                ? { success: true, session_id: 'opaque-sitzung', registration_response: 'antwort' }
                : { success: true };
            return { json: async () => antwort };
        }));
    });

    it('WAECHTER: schickt mcp_capability_hash (64 Hex-Zeichen, SHA-256 eines eigenen tmmcp_-Geheimnisses)', async () => {
        const token = await ladeClient().createAccessTokenOpaque('konto-sitzung', 'Safari Add-On');
        const finish = aufrufe.find((a) => a.url.includes('pat_opaque_create_finish'))!;
        const rumpf = JSON.parse(String(finish.init.body)) as Record<string, unknown>;
        expect(rumpf['mcp_capability_hash']).toMatch(/^[0-9a-f]{64}$/);
        // Nicht der Hash des Zugriffstokens: Die MCP-Fähigkeit ist ein eigenes Geheimnis.
        expect(rumpf['mcp_capability_hash']).not.toBe(createHash('sha256').update(token).digest('hex'));
        expect(rumpf['session_id']).toBe('opaque-sitzung');
        expect(rumpf['user_record']).toBe('datensatz');
        expect(token).toMatch(/^tmpat_[A-Za-z0-9_-]{43}$/);
    });

    it('WAECHTER: trägt die Konto-Sitzung bei init UND finish in der Kopfzeile X-TrashMail-Session (Safari schickt kein Cookie), nie in der Adresse', async () => {
        await ladeClient().createAccessTokenOpaque('konto sitzung/1', 'Safari Add-On');
        for (const cmd of ['pat_opaque_create_init', 'pat_opaque_create_finish']) {
            const aufruf = aufrufe.find((a) => a.url.includes(cmd))!;
            expect((aufruf.init.headers as Record<string, string>)['X-TrashMail-Session']).toBe('konto sitzung/1');
            expect(new URL(aufruf.url).searchParams.has('session_id')).toBe(false);
            expect(decodeURIComponent(aufruf.url)).not.toContain('konto sitzung/1');
        }
        // Im finish-Rumpf bleibt die OPAQUE-Registrierungssession.
        const finish = aufrufe.find((a) => a.url.includes('pat_opaque_create_finish'))!;
        expect((JSON.parse(String(finish.init.body)) as Record<string, unknown>)['session_id']).toBe('opaque-sitzung');
    });

    it('erzeugt bei jedem Aufruf eine andere Fähigkeit', async () => {
        const client = ladeClient();
        await client.createAccessTokenOpaque('s', 'n');
        await client.createAccessTokenOpaque('s', 'n');
        const hashes = aufrufe.filter((a) => a.url.includes('finish')).map((a) => (JSON.parse(String(a.init.body)) as Record<string, string>)['mcp_capability_hash']);
        expect(hashes).toHaveLength(2);
        expect(hashes[0]).not.toBe(hashes[1]);
    });
});

/**
 * #48779b5c: Anmeldung ohne Cookie.
 *
 * Gemessen auf Prod am 04.11.2026 (Gateway-Log, Kunde AM-000075, Firefox 159
 * ohne Host-Berechtigung): `opaque_login_init` kam nur als OPTIONS an, ein
 * POST folgte nie. Der Server antwortet mit Access-Control-Allow-Origin: *
 * und Allow-Credentials: false; eine Anfrage mit credentials:"include"
 * verwirft der Browser deshalb schon an der Vorabanfrage. Safari schickt das
 * Cookie von Erweiterungsseiten ohnehin nicht und meldet sich seit 6.1.3
 * genau so an (Prod-Log 03.11.2026: opaque_login_init/finish +
 * pat_opaque_create_init aus Safari, jeweils 200).
 *
 * Bauart der Wächter: je Aufrufstelle, sie lesen `init.credentials` des
 * tatsächlichen fetch-Aufrufs. Fehltrefferzahl auf dem sauberen Baum: 0
 * (05.11.2026).
 */
type VollerClient = {
    passwordOpaqueLogin(u: string, p: string, o?: { establishBrowserSession?: boolean }): Promise<Record<string, unknown>>;
    createAccessTokenOpaque(sessionId: string, name: string): Promise<string>;
    verifyTotpLogin(code: string, trust?: boolean, sitzung?: string): Promise<{ success: boolean; session_id?: string }>;
    useRecoveryCode(code: string, sitzung?: string): Promise<{ success: boolean }>;
};

function ladeVollerClient(): VollerClient {
    const quelle = readFileSync('trashmail-addon/opaque-client.js', 'utf8');
    const Klasse = new Function(`${quelle}\nreturn AddonOpaqueClient;`)() as new () => VollerClient;
    return new Klasse();
}

describe('#48779b5c Anmeldung ohne Cookie', () => {
    let aufrufe: Aufruf[];
    let finishAntwort: Record<string, unknown>;

    beforeEach(() => {
        installBrowserMock();
        aufrufe = [];
        finishAntwort = { success: true, data: { session_id: 'konto-sitzung', domain_name_list: [], real_email_list: {} } };
        (globalThis as Record<string, unknown>)['opaque'] = {
            ready: Promise.resolve(),
            client: {
                startLogin: () => ({ clientLoginState: 'z', startLoginRequest: 'ke1' }),
                finishLogin: () => ({ finishLoginRequest: 'ke3' }),
                startRegistration: () => ({ clientRegistrationState: 'zustand', registrationRequest: 'anfrage' }),
                finishRegistration: () => ({ registrationRecord: 'datensatz' }),
            },
        };
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            aufrufe.push({ url, init });
            let antwort: Record<string, unknown> = { success: true };
            if (url.includes('opaque_login_init')) {antwort = { success: true, session_id: 'opaque-sitzung', loginResponse: 'ke2' };}
            if (url.includes('opaque_login_finish')) {antwort = finishAntwort;}
            if (url.includes('pat_opaque_create_init')) {antwort = { success: true, session_id: 'opaque-reg', registration_response: 'antwort' };}
            if (url.includes('cmd=totp_verify')) {antwort = { success: true, session_id: 'neue-sitzung' };}
            return { json: async () => antwort };
        }));
    });

    const aufruf = (cmd: string): Aufruf => {
        const treffer = aufrufe.find((a) => new URL(a.url).searchParams.get('cmd') === cmd);
        if (!treffer) {throw new Error(`kein Aufruf ${cmd}`);}
        return treffer;
    };

    it('WAECHTER: passwordOpaqueLogin ohne Optionen schickt init UND finish mit credentials "omit"', async () => {
        const ergebnis = await ladeVollerClient().passwordOpaqueLogin('bob', 'geheim');
        expect(aufruf('opaque_login_init').init.credentials).toBe('omit');
        expect(aufruf('opaque_login_finish').init.credentials).toBe('omit');
        expect(ergebnis['session_id']).toBe('konto-sitzung');
    });

    it('2FA: der Fehler traegt die Sitzung aus der finish-Antwort (pendingSessionId)', async () => {
        finishAntwort = { success: true, data: { requires_2fa: true, session_id: 'sitzung-2fa', url: '/?cmd=2fa_verify' } };
        await expect(ladeVollerClient().passwordOpaqueLogin('bob', 'geheim')).rejects.toMatchObject({ requires_2fa: true, pendingSessionId: 'sitzung-2fa' });
    });

    it('2FA bei altem Server (keine Sitzung in der Antwort): pendingSessionId leer', async () => {
        finishAntwort = { success: true, data: { requires_2fa: true, url: '/?cmd=2fa_verify' } };
        await expect(ladeVollerClient().passwordOpaqueLogin('bob', 'geheim')).rejects.toMatchObject({ requires_2fa: true, pendingSessionId: '' });
    });

    it('WAECHTER: createAccessTokenOpaque mit Konto-Sitzung schickt init UND finish ohne Cookie', async () => {
        await ladeVollerClient().createAccessTokenOpaque('konto-sitzung', 'Firefox Add-On');
        expect(aufruf('pat_opaque_create_init').init.credentials).toBe('omit');
        expect(aufruf('pat_opaque_create_finish').init.credentials).toBe('omit');
    });

    it('createAccessTokenOpaque ohne Sitzung (alter 2FA-Weg) bleibt beim Cookie', async () => {
        await ladeVollerClient().createAccessTokenOpaque('', 'Firefox Add-On');
        expect(aufruf('pat_opaque_create_init').init.credentials).toBe('include');
    });

    it('WAECHTER: 2FA-Abschluss mit Sitzung geht per Kopfzeile ohne Cookie (TOTP und Wiederherstellungscode)', async () => {
        const client = ladeVollerClient();
        const ergebnis = await client.verifyTotpLogin('123456', true, 'sitzung-2fa');
        expect(ergebnis.session_id).toBe('neue-sitzung');
        await client.useRecoveryCode('ABCD-EFGH-IJKL', 'sitzung-2fa');
        for (const cmd of ['totp_verify', 'totp_recovery_use']) {
            const a = aufruf(cmd);
            expect(a.init.credentials).toBe('omit');
            expect((a.init.headers as Record<string, string>)['X-TrashMail-Session']).toBe('sitzung-2fa');
            expect(a.url).not.toContain('sitzung-2fa');
        }
    });

    it('2FA-Abschluss ohne Sitzung (alter Server) bleibt beim Cookie und schickt keine Kopfzeile', async () => {
        await ladeVollerClient().verifyTotpLogin('123456', false);
        const a = aufruf('totp_verify');
        expect(a.init.credentials).toBe('include');
        expect((a.init.headers as Record<string, string>)['X-TrashMail-Session']).toBeUndefined();
    });
});
