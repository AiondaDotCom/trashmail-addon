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

    it('WAECHTER: trägt die Konto-Sitzung in der Adresse von finish (Safari schickt kein Cookie)', async () => {
        await ladeClient().createAccessTokenOpaque('konto sitzung/1', 'Safari Add-On');
        const finish = aufrufe.find((a) => a.url.includes('pat_opaque_create_finish'))!;
        expect(new URL(finish.url).searchParams.get('session_id')).toBe('konto sitzung/1');
        const init = aufrufe.find((a) => a.url.includes('pat_opaque_create_init'))!;
        expect(new URL(init.url).searchParams.get('session_id')).toBe('konto sitzung/1');
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
