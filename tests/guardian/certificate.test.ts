import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserMock } from '../helpers/browser-mock';
import { installBrowserMock } from '../helpers/browser-mock';
import { bootGuardian } from '../helpers/guardian-boot';
import { generateSigningKey, type FetchRoute, type GeneratedKey } from '../helpers/guardian-fixtures';

interface CertStatus { status: string; tlsVerified?: boolean; tlsFingerprint?: string; mitmDetected?: boolean; }

function statusFor(tabId: number): CertStatus | undefined {
    return (globalThis as unknown as { tabSecurityStatus: Map<number, CertStatus> }).tabSecurityStatus.get(tabId);
}

let mock: BrowserMock;
let securityInfo: Record<string, unknown>;

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mock = installBrowserMock();
    securityInfo = { certificates: [] };
    // getSecurityInfo VOR dem Boot setzen -> Firefox-Pfad, onHeadersReceived wird registriert
    mock.webRequest.getSecurityInfo = async () => securityInfo;
});

function certFingerprintRoute(key: GeneratedKey, opts: { tamper?: boolean; fingerprint?: string; issuer?: string } = {}): FetchRoute {
    return {
        test: (u) => u.includes('cmd=cert_fingerprint'),
        response: async () => {
            const tsSec = Math.floor(Date.now() / 1000);
            const payload: Record<string, unknown> = {
                success: true,
                fingerprint: opts.fingerprint ?? 'sha256:serverfp',
                timestamp: tsSec,
            };
            if (opts.issuer) {
                payload.issuer = opts.issuer;
            }
            const body = JSON.stringify(payload);
            const signedData = opts.tamper ? `${body}|${tsSec}TAMPERED` : `${body}|${tsSec}`;
            const sig = await key.sign(signedData);
            return new Response(body, {
                headers: {
                    'x-aionda-signature': sig,
                    'x-aionda-timestamp': String(tsSec),
                    'x-aionda-key-id': key.keyId,
                },
            });
        },
    };
}

describe('checkCertificate (Firefox TLS-Pfad)', () => {
    it('registriert den onHeadersReceived-Listener als blocking im Firefox', async () => {
        const key = await generateSigningKey();
        await bootGuardian(mock, key.keyFile);
        expect(mock.webRequest.onHeadersReceived.listeners.length).toBe(1);
        expect(mock.webRequest.onHeadersReceived.addListenerArgs[0]?.[1]).toEqual(['blocking']);
    });

    it('erkennt einen bekannten MITM-Proxy-Issuer (Zscaler) -> COMPROMISED', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Zscaler Root CA, O=Zscaler Inc.', fingerprint: { sha256: 'AA:BB:CC:DD' } }] };
        const b = await bootGuardian(mock, key.keyFile);

        await b.checkCertificate({ tabId: 40, url: 'https://mail.aionda.com/', requestId: 'r1' });

        expect(statusFor(40)?.status).toBe('COMPROMISED');
        expect(statusFor(40)?.mitmDetected).toBe(true);
        expect(mock.action.badges.get(40)).toEqual({ text: '✗', color: '#ef4444' });
        expect(mock.notifications.created.length).toBe(1);
        // Warnung wurde an den Content-Script geschickt
        expect(mock.tabs.sentMessages.some((m) => (m.message as { action?: string }).action === 'guardian_warning')).toBe(true);
    });

    it('akzeptiert einen vertrauenswürdigen Issuer (Google Trust Services) -> tlsVerified', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'C=US, O=Google Trust Services, CN=WE1', fingerprint: { sha256: 'AA:BB:CC' } }] };
        const b = await bootGuardian(mock, key.keyFile);

        await b.checkCertificate({ tabId: 41, url: 'https://mail.aionda.com/', requestId: 'r2' });

        expect(statusFor(41)?.tlsVerified).toBe(true);
        expect(statusFor(41)?.tlsFingerprint).toBe('sha256:aabbcc');
        expect(statusFor(41)?.status).not.toBe('COMPROMISED');
    });

    it('sucht das Leaf-Zertifikat wenn certificates[0] nicht die Domain trägt', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [
            { subject: 'CN=edge-node-42', issuer: 'CN=irrelevant', fingerprint: { sha256: 'FF:EE' } },
            { subject: 'CN=mail.aionda.com', issuer: 'O=Google Trust Services', fingerprint: { sha256: 'BB:CC' } },
        ] };
        const b = await bootGuardian(mock, key.keyFile);

        await b.checkCertificate({ tabId: 43, url: 'https://mail.aionda.com/', requestId: 'r3' });

        expect(statusFor(43)?.tlsVerified).toBe(true);
        expect(statusFor(43)?.tlsFingerprint).toBe('sha256:bbcc');
    });

    it('gibt ohne Zertifikatsinfo früh auf (kein Status)', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [] };
        const b = await bootGuardian(mock, key.keyFile);

        await b.checkCertificate({ tabId: 44, url: 'https://mail.aionda.com/', requestId: 'r4' });

        expect(statusFor(44)).toBeUndefined();
    });

    it('gibt auf wenn kein SHA-256-Fingerprint extrahierbar ist', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'O=Google Trust Services', fingerprint: {} }] };
        const b = await bootGuardian(mock, key.keyFile);

        await b.checkCertificate({ tabId: 45, url: 'https://mail.aionda.com/', requestId: 'r5' });

        expect(statusFor(45)).toBeUndefined();
    });

    it('ignoriert nicht-geschützte Hosts', async () => {
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=x', issuer: 'CN=Zscaler', fingerprint: { sha256: 'AA' } }] };
        const b = await bootGuardian(mock, key.keyFile);

        await b.checkCertificate({ tabId: 46, url: 'https://example.com/', requestId: 'r6' });

        expect(statusFor(46)).toBeUndefined();
    });
});

describe('verifySignature (echte Ed25519-Verifikation über den Fingerprint-Pfad)', () => {
    it('bleibt COMPROMISED bei echtem Fingerprint-Mismatch (unbekannter Issuer) und cached die Antwort', async () => {
        const key = await generateSigningKey();
        // Browser sieht Fingerprint 'AB:CD:EF' -> 'sha256:abcdef'; Server signiert 'sha256:serverfp' -> MISMATCH
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Unknown Corporate Root', fingerprint: { sha256: 'AB:CD:EF' } }] };
        const b = await bootGuardian(mock, key.keyFile, [certFingerprintRoute(key)]);

        await b.checkCertificate({ tabId: 50, url: 'https://mail.aionda.com/', requestId: 'v1' });
        // Echter Fingerprint-Mismatch bei unbekannter CA MUSS COMPROMISED bleiben
        expect(statusFor(50)?.status).toBe('COMPROMISED');

        await b.checkCertificate({ tabId: 50, url: 'https://mail.aionda.com/', requestId: 'v2' });
        // Gültige Signatur -> gecached -> nur EIN cert_fingerprint-Fetch
        expect(b.fetchStub.countMatching((u) => u.includes('cmd=cert_fingerprint'))).toBe(1);
    });

    it('lehnt eine manipulierte Signatur ab (kein Caching -> erneuter Fetch)', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const key = await generateSigningKey();
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Unknown Corporate Root', fingerprint: { sha256: 'AB:CD:EF' } }] };
        const b = await bootGuardian(mock, key.keyFile, [certFingerprintRoute(key, { tamper: true })]);

        await b.checkCertificate({ tabId: 51, url: 'https://mail.aionda.com/', requestId: 'v3' });
        await b.checkCertificate({ tabId: 51, url: 'https://mail.aionda.com/', requestId: 'v4' });

        // Ungültige Signatur -> NICHT gecached -> zweiter Fetch
        expect(b.fetchStub.countMatching((u) => u.includes('cmd=cert_fingerprint'))).toBe(2);
        expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('signature INVALID'))).toBe(true);
        errorSpy.mockRestore();
    });

    it('lehnt eine Signatur eines abgelaufenen Keys ab (hard limit)', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const key = await generateSigningKey({ validUntil: '2020-06-01T00:00:00Z' });
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Unknown Corporate Root', fingerprint: { sha256: 'AB:CD:EF' } }] };
        const b = await bootGuardian(mock, key.keyFile, [certFingerprintRoute(key)]);

        await b.checkCertificate({ tabId: 52, url: 'https://mail.aionda.com/', requestId: 'v5' });

        expect(b.fetchStub.countMatching((u) => u.includes('cmd=cert_fingerprint'))).toBe(1);
        expect(errorSpy.mock.calls.some((c) => String(c[1]).includes('expired'))).toBe(true);
        errorSpy.mockRestore();
    });
});

describe('checkCertificate — kein False-Positive bei unbekannter, aber legitimer CA (Bug-Fix)', () => {
    it('akzeptiert ein Zertifikat mit unbekanntem Issuer wenn der signierte Server-Fingerprint übereinstimmt', async () => {
        const key = await generateSigningKey();
        // Browser-Cert 'AB:CD:EF' -> getCertFingerprint -> 'sha256:abcdef'
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=Unknown Corporate Root', fingerprint: { sha256: 'AB:CD:EF' } }] };
        // Server signiert GENAU denselben Fingerprint -> stärkster Beweis, kein MITM
        const b = await bootGuardian(mock, key.keyFile, [certFingerprintRoute(key, { fingerprint: 'sha256:abcdef' })]);

        await b.checkCertificate({ tabId: 55, url: 'https://mail.aionda.com/', requestId: 'm1' });

        expect(statusFor(55)?.tlsVerified).toBe(true);
        expect(statusFor(55)?.tlsFingerprint).toBe('sha256:abcdef');
        expect(statusFor(55)?.status).not.toBe('COMPROMISED');
        expect(mock.notifications.created.length).toBe(0);
    });

    it('akzeptiert via Issuer-Org-Fallback wenn der Fingerprint abweicht aber die CA übereinstimmt', async () => {
        const key = await generateSigningKey();
        // Nicht-vertrauenswürdiger Issuer (weder trusted noch MITM), Org = "Acme Internal CA"
        securityInfo = { certificates: [{ subject: 'CN=mail.aionda.com', issuer: 'CN=edge5, O=Acme Internal CA, C=US', fingerprint: { sha256: 'AB:CD:EF' } }] };
        // Server: anderer Fingerprint (anderes Edge-Cert), aber gleiche Issuer-Org
        const b = await bootGuardian(mock, key.keyFile, [certFingerprintRoute(key, { fingerprint: 'sha256:serverfp', issuer: 'CN=edge9, O=Acme Internal CA, C=US' })]);

        await b.checkCertificate({ tabId: 56, url: 'https://mail.aionda.com/', requestId: 'm2' });

        expect(statusFor(56)?.tlsVerified).toBe(true);
        expect(statusFor(56)?.status).not.toBe('COMPROMISED');
    });
});
