/**
 * Ergänzende Tests für Fehler-/Fallback-Pfade in guardian.ts, damit alle vier
 * Coverage-Metriken >= 80% liegen. Deckt: verifySignature-Zweige (Timestamp,
 * abgelaufen, deprecated), fetchServerFingerprint-Fehler (nicht signiert,
 * Server-Fehler, HTTP-Fehler), den Import-Fehler eines defekten Keys, den
 * COMPROMISED-Kurzschluss in processResponse und den direkten
 * Warnungs-Injection-Fallback in showSecurityWarning.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserMock } from '../helpers/browser-mock';
import { installBrowserMock } from '../helpers/browser-mock';
import { bootGuardian, makeResponseDetails } from '../helpers/guardian-boot';
import { generateSigningKey, tick, type FetchRoute, type GeneratedKey, type KeyFile } from '../helpers/guardian-fixtures';

interface CertStatus { status: string; }

function statusFor(tabId: number): CertStatus | undefined {
    return (globalThis as unknown as { tabSecurityStatus: Map<number, CertStatus> }).tabSecurityStatus.get(tabId);
}

const UNKNOWN_ISSUER_CERT = {
    certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Unknown Corporate Root', fingerprint: { sha256: 'AB:CD:EF' } }],
};

function certFingerprintCount(fetchStub: { countMatching(p: (u: string) => boolean): number }): number {
    return fetchStub.countMatching((u) => u.includes('cmd=cert_fingerprint'));
}

let mock: BrowserMock;
let securityInfo: Record<string, unknown>;

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mock = installBrowserMock();
    securityInfo = UNKNOWN_ISSUER_CERT;
    mock.webRequest.getSecurityInfo = async () => securityInfo;
});

describe('fetchServerFingerprint — Fehler- und Sonderpfade', () => {
    async function bootWithFingerprint(key: GeneratedKey, route: FetchRoute) {
        return bootGuardian(mock, key.keyFile, [route]);
    }

    it('cached auch eine unsignierte (aber erfolgreiche) Fingerprint-Antwort', async () => {
        const key = await generateSigningKey();
        const route: FetchRoute = {
            test: (u) => u.includes('cmd=cert_fingerprint'),
            response: () => new Response(JSON.stringify({ success: true, fingerprint: 'sha256:x', timestamp: Math.floor(Date.now() / 1000) })),
        };
        const b = await bootWithFingerprint(key, route);

        await b.checkCertificate({ tabId: 60, url: 'https://mail.aionda.com/', requestId: 'a1' });
        await b.checkCertificate({ tabId: 60, url: 'https://mail.aionda.com/', requestId: 'a2' });

        expect(certFingerprintCount(b.fetchStub)).toBe(1); // gecached
    });

    it('cached NICHT wenn der Server einen Fehler meldet (success=false)', async () => {
        const key = await generateSigningKey();
        const route: FetchRoute = {
            test: (u) => u.includes('cmd=cert_fingerprint'),
            response: () => new Response(JSON.stringify({ success: false, error: 'boom' })),
        };
        const b = await bootWithFingerprint(key, route);

        await b.checkCertificate({ tabId: 61, url: 'https://mail.aionda.com/', requestId: 'b1' });
        await b.checkCertificate({ tabId: 61, url: 'https://mail.aionda.com/', requestId: 'b2' });

        expect(certFingerprintCount(b.fetchStub)).toBe(2); // nicht gecached -> erneuter Fetch
    });

    it('cached NICHT bei HTTP-Fehler (Status 500)', async () => {
        const key = await generateSigningKey();
        const route: FetchRoute = {
            test: (u) => u.includes('cmd=cert_fingerprint'),
            response: () => new Response('err', { status: 500 }),
        };
        const b = await bootWithFingerprint(key, route);

        await b.checkCertificate({ tabId: 62, url: 'https://mail.aionda.com/', requestId: 'c1' });
        await b.checkCertificate({ tabId: 62, url: 'https://mail.aionda.com/', requestId: 'c2' });

        expect(certFingerprintCount(b.fetchStub)).toBe(2);
    });

    it('lehnt einen zu alten Timestamp ab', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const key = await generateSigningKey();
        const route: FetchRoute = {
            test: (u) => u.includes('cmd=cert_fingerprint'),
            response: async () => {
                const oldTs = Math.floor(Date.now() / 1000) - 10000;
                const body = JSON.stringify({ success: true, fingerprint: 'sha256:x', timestamp: oldTs });
                const sig = await key.sign(`${body}|${oldTs}`);
                return new Response(body, {
                    headers: { 'x-aionda-signature': sig, 'x-aionda-timestamp': String(oldTs), 'x-aionda-key-id': key.keyId },
                });
            },
        };
        const b = await bootWithFingerprint(key, route);

        await b.checkCertificate({ tabId: 63, url: 'https://mail.aionda.com/', requestId: 'd1' });

        expect(errorSpy.mock.calls.some((c) => String(c[1]).includes('Timestamp too old'))).toBe(true);
        errorSpy.mockRestore();
    });

    it('akzeptiert einen gültigen, aber als deprecated markierten Key (warn_after überschritten)', async () => {
        const key = await generateSigningKey({ warnAfter: '2020-01-01T00:00:00Z', validUntil: '2999-01-01T00:00:00Z' });
        const route: FetchRoute = {
            test: (u) => u.includes('cmd=cert_fingerprint'),
            response: async () => {
                const ts = Math.floor(Date.now() / 1000);
                const body = JSON.stringify({ success: true, fingerprint: 'sha256:x', timestamp: ts });
                const sig = await key.sign(`${body}|${ts}`);
                return new Response(body, {
                    headers: { 'x-aionda-signature': sig, 'x-aionda-timestamp': String(ts), 'x-aionda-key-id': key.keyId },
                });
            },
        };
        const b = await bootWithFingerprint(key, route);

        await b.checkCertificate({ tabId: 64, url: 'https://mail.aionda.com/', requestId: 'e1' });
        await b.checkCertificate({ tabId: 64, url: 'https://mail.aionda.com/', requestId: 'e2' });

        expect(certFingerprintCount(b.fetchStub)).toBe(1); // gültig -> gecached (deprecated-Zweig ausgeführt)
    });
});

describe('loadPublicKeys — defekter Key', () => {
    it('überspringt einen nicht importierbaren Key und lädt die gültigen', async () => {
        const good = await generateSigningKey({ keyId: 'good-key' });
        const keyFile: KeyFile = {
            keys: {
                'good-key': good.keyFile.keys['good-key']!,
                'broken-key': {
                    algorithm: 'Ed25519',
                    public_key: '!!!not-valid-base64!!!',
                    valid_from: '2020-01-01T00:00:00Z',
                    warn_after: null,
                    valid_until: '2999-01-01T00:00:00Z',
                },
            },
        };

        await bootGuardian(mock, keyFile);

        const keys = (globalThis as unknown as { publicKeys: Map<string, unknown> }).publicKeys;
        expect(keys.size).toBe(1);
        expect(keys.has('good-key')).toBe(true);
        expect(mock.webRequest.onResponseStarted.listeners.length).toBe(1);
    });
});

describe('processResponse — COMPROMISED-Kurzschluss', () => {
    it('überschreibt einen COMPROMISED-Status nicht mit UNSIGNED', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Zscaler Root', fingerprint: { sha256: 'AA:BB' } }] };
        const b = await bootGuardian(mock, key.keyFile);

        // Erst MITM -> COMPROMISED (erzeugt 1 Notification)
        await b.checkCertificate({ tabId: 70, url: 'https://mail.aionda.com/', requestId: 'f1' });
        expect(statusFor(70)?.status).toBe('COMPROMISED');
        const notificationsAfterMitm = mock.notifications.created.length;

        // Danach unsigniertes HTML auf demselben Tab -> darf COMPROMISED nicht verdrängen
        await b.processResponse(makeResponseDetails(70, 'https://mail.aionda.com/x', { 'content-type': 'text/html' }));

        expect(statusFor(70)?.status).toBe('COMPROMISED');
        expect(mock.notifications.created.length).toBe(notificationsAfterMitm); // keine neue UNSIGNED-Notification
    });
});

describe('checkCertificate — Guard-Klauseln & Branch-Abdeckung', () => {
    it('bricht bei deaktiviertem Guardian, Nicht-Firefox, ungültiger tabId und defekter URL ab', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'O=Google Trust Services', fingerprint: { sha256: 'AA:BB' } }] };
        const b = await bootGuardian(mock, key.keyFile);

        // ungültige tabId -> früher Abbruch
        await b.checkCertificate({ tabId: -1, url: 'https://mail.aionda.com/', requestId: 'h1' });
        expect(statusFor(-1)).toBeUndefined();

        // defekte URL -> URL-Parse-catch
        await b.checkCertificate({ tabId: 80, url: ':::not-a-url', requestId: 'h2' });
        expect(statusFor(80)).toBeUndefined();

        // getSecurityInfo entfernen -> isFirefox() false -> Abbruch
        delete (mock.webRequest as { getSecurityInfo?: unknown }).getSecurityInfo;
        await b.checkCertificate({ tabId: 81, url: 'https://mail.aionda.com/', requestId: 'h3' });
        expect(statusFor(81)).toBeUndefined();

        // Guardian zur Laufzeit deaktivieren -> Abbruch
        await mock.storage.sync.set({ guardian_enabled: false });
        await b.checkCertificate({ tabId: 82, url: 'https://mail.aionda.com/', requestId: 'h4' });
        expect(statusFor(82)).toBeUndefined();
    });

    it('behandelt ein Zertifikat ohne Issuer/Subject als MITM (leere Fallbacks)', async () => {
        const key = await generateSigningKey();
        // Kein issuer, kein subject, nur Fingerprint -> "" Fallbacks, kein Trust/MITM-Match
        securityInfo = { certificates: [{ fingerprint: { sha256: 'CA:FE' } }] };
        const b = await bootGuardian(mock, key.keyFile); // keine cert_fingerprint-Route -> fetch schlägt fehl -> null

        await b.checkCertificate({ tabId: 83, url: 'https://mail.aionda.com/', requestId: 'i1' });

        expect(statusFor(83)?.status).toBe('COMPROMISED');
    });

    it('nutzt einen bestehenden Tab-Status beim MITM (kein Default-Objekt)', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Zscaler Root', fingerprint: { sha256: 'AA:BB' } }] };
        const b = await bootGuardian(mock, key.keyFile);

        // Erst regulären Status erzeugen ...
        await b.processResponse(makeResponseDetails(84, 'https://mail.aionda.com/', {
            'x-aionda-signature': 'c2ln', 'x-aionda-timestamp': '1700000000', 'x-aionda-key-id': key.keyId,
        }));
        expect(statusFor(84)?.status).toBe('VERIFIED');

        // ... dann MITM auf demselben Tab -> handleMitmDetected nutzt vorhandenen Status
        await b.checkCertificate({ tabId: 84, url: 'https://mail.aionda.com/', requestId: 'j1' });
        expect(statusFor(84)?.status).toBe('COMPROMISED');
    });

    it('erkennt API-Antworten am /api/-Pfad als UNSIGNED', async () => {
        const key = await generateSigningKey();
        const b = await bootGuardian(mock, key.keyFile);

        await b.processResponse(makeResponseDetails(85, 'https://mail.aionda.com/api/inbox', {
            'content-type': 'application/json',
        }));

        expect(statusFor(85)?.status).toBe('UNSIGNED');
    });
});

describe('showSecurityWarning — direkter Injection-Fallback', () => {
    it('injiziert die Warnung per scripting.executeScript wenn kein Content-Script antwortet', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Zscaler Root', fingerprint: { sha256: 'AA:BB' } }] };
        // Content-Script nicht bereit -> sendMessage rejectet -> Fallback-Pfad
        mock.tabs.sendMessage = async () => { throw new Error('no receiver'); };
        // scripting-API bereitstellen und die injizierte Funktion real ausführen
        (mock as unknown as { scripting: { executeScript(opts: { func: (...a: string[]) => void; args: string[] }): Promise<unknown[]> } }).scripting = {
            executeScript: async (opts) => { opts.func(...opts.args); return []; },
        };

        const b = await bootGuardian(mock, key.keyFile);

        await b.checkCertificate({ tabId: 71, url: 'https://mail.aionda.com/', requestId: 'g1' });
        await tick();

        const overlay = document.getElementById('trashmail-mitm-warning');
        expect(overlay).not.toBeNull();

        // Zweiter Aufruf: Overlay existiert bereits -> injizierte Funktion kehrt früh zurück
        await b.checkCertificate({ tabId: 71, url: 'https://mail.aionda.com/', requestId: 'g2' });
        await tick();
        expect(document.querySelectorAll('#trashmail-mitm-warning').length).toBe(1);

        // Dismiss-Button entfernt das Overlay
        document.getElementById('trashmail-mitm-dismiss')?.dispatchEvent(new Event('click'));
        expect(document.getElementById('trashmail-mitm-warning')).toBeNull();
    });
});
