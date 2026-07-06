import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserMock } from '../helpers/browser-mock';
import { installBrowserMock } from '../helpers/browser-mock';
import { bootGuardian, makeResponseDetails } from '../helpers/guardian-boot';
import { generateSigningKey, type KeyFile } from '../helpers/guardian-fixtures';

function selfState(): Record<string, unknown> {
    return globalThis as unknown as Record<string, unknown>;
}

let mock: BrowserMock;
let keyFile: KeyFile;

beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mock = installBrowserMock();
    keyFile = (await generateSigningKey()).keyFile;
});

describe('isProtectedHost (exposed on self)', () => {
    function isProtectedHost(hostname: string): boolean {
        return (selfState()['isProtectedHost'] as (h: string) => boolean)(hostname);
    }

    beforeEach(async () => {
        await bootGuardian(mock, keyFile);
    });

    it('erkennt exakte geschützte Hosts', () => {
        expect(isProtectedHost('mail.aionda.com')).toBe(true);
        expect(isProtectedHost('trashmail.com')).toBe(true);
        expect(isProtectedHost('byom.de')).toBe(true);
        expect(isProtectedHost('s.aionda.com')).toBe(true);
    });

    it('erkennt Subdomains geschützter Hosts', () => {
        expect(isProtectedHost('sub.mail.aionda.com')).toBe(true);
        expect(isProtectedHost('deep.nested.trashmail.com')).toBe(true);
    });

    it('ist case-insensitive', () => {
        expect(isProtectedHost('MAIL.AIONDA.COM')).toBe(true);
    });

    it('lehnt fremde Hosts ab', () => {
        expect(isProtectedHost('example.com')).toBe(false);
        expect(isProtectedHost('evil.com')).toBe(false);
        expect(isProtectedHost('notaionda.com')).toBe(false);
        // Suffix-Trick darf NICHT matchen (nur echte Subdomains via ".host")
        expect(isProtectedHost('faketrashmail.com')).toBe(false);
        expect(isProtectedHost('mail.aionda.com.evil.com')).toBe(false);
    });

    it('liefert false für leeren Hostnamen', () => {
        expect(isProtectedHost('')).toBe(false);
    });
});

describe('isHashedAsset (über processResponse-Skip beobachtbar)', () => {
    it('überspringt gehashte Assets (kein Badge, kein Status)', async () => {
        const boot = await bootGuardian(mock, keyFile);
        // Gehashtes Asset ohne Signatur -> muss übersprungen werden (kein UNSIGNED)
        await boot.processResponse(makeResponseDetails(7, 'https://mail.aionda.com/app.a1b2c3d4.js', {
            'content-type': 'application/javascript',
        }));
        expect((selfState()['tabSecurityStatus'] as Map<number, unknown>).get(7)).toBeUndefined();
        expect(mock.action.badges.has(7)).toBe(false);
    });

    it('überspringt volle SHA-256-gehashte CSS-Assets', async () => {
        const boot = await bootGuardian(mock, keyFile);
        const hash = '61bd607be317d6f746f436cc259f3a933396753b73ab14c891a768916bd97e04';
        await boot.processResponse(makeResponseDetails(8, `https://mail.aionda.com/app.${hash}.min.css`, {}));
        expect((selfState()['tabSecurityStatus'] as Map<number, unknown>).get(8)).toBeUndefined();
    });

    it('behandelt NICHT-gehashte JS-Ressourcen als reguläre Ressource', async () => {
        const boot = await bootGuardian(mock, keyFile);
        // normale .js ohne Signatur -> unsigned++ (aber kein UNSIGNED-Status, da kein HTML/API)
        await boot.processResponse(makeResponseDetails(9, 'https://mail.aionda.com/plain.js', {
            'content-type': 'application/javascript',
        }));
        const status = (selfState()['tabSecurityStatus'] as Map<number, { status: string; unsigned: number }>).get(9);
        expect(status?.status).toBe('PROTECTED');
        expect(status?.unsigned).toBe(1);
    });
});
