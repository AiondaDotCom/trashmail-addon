/**
 * Unit-Tests für ts/session-codes.ts - das eine Kriterium „Sitzung
 * abgelehnt" und die Wartezeiten der Hintergrund-Anmeldesperre.
 *
 * Die erwarteten Codes stehen hier absichtlich noch einmal als Liste und
 * werden je Code geprüft: Fällt einer aus SESSION_REJECTED_CODES heraus,
 * fällt genau sein Test (Abnahme von 3d946a9, Befund M7).
 */
import { describe, expect, it } from 'vitest';

import {
    BLOCK_AFTER_NETWORK_ERROR_MS,
    BLOCK_AFTER_SERVER_REJECTION_MS,
    backgroundLoginBlockFor,
    isBackgroundLoginBlocked,
    isSessionRejected,
} from '../../ts/session-codes';

describe('isSessionRejected', () => {
    // 2 = ERROR_CODE_NOT_LOGGED_IN, 61 = ERROR_CODE_AUTHENTICATION_ERROR (config.php)
    for (const code of [2, 61]) {
        it(`Code ${code} gilt als abgelehnte Sitzung`, () => {
            expect(isSessionRejected({ errorCode: code })).toBe(true);
        });
    }
    for (const code of [0, 3, 5, 10, 25, 70, 429]) {
        it(`Code ${code} gilt NICHT als abgelehnte Sitzung`, () => {
            expect(isSessionRejected({ errorCode: code })).toBe(false);
        });
    }
    it('Fehler ohne Code, null und Zeichenketten-Codes gelten nicht als abgelehnt', () => {
        expect(isSessionRejected(new Error('offline'))).toBe(false);
        expect(isSessionRejected(null)).toBe(false);
        expect(isSessionRejected({ errorCode: '2' })).toBe(false);
    });
});

describe('backgroundLoginBlockFor', () => {
    const jetzt = 1_000_000;

    it('Ablehnung durch den Server (Code 3): 6 Stunden', () => {
        expect(BLOCK_AFTER_SERVER_REJECTION_MS).toBe(6 * 60 * 60 * 1000);
        expect(backgroundLoginBlockFor({ errorCode: 3, httpStatus: 200 }, jetzt)).toEqual({ until: jetzt + BLOCK_AFTER_SERVER_REJECTION_MS, error_code: 3, http_status: 200 });
    });

    it('2FA-Pflicht: 6 Stunden', () => {
        expect(backgroundLoginBlockFor({ requires_2fa: true }, jetzt).until).toBe(jetzt + BLOCK_AFTER_SERVER_REJECTION_MS);
    });

    it('429 ohne Wartezeit: mindestens 6 Stunden', () => {
        expect(backgroundLoginBlockFor({ httpStatus: 429 }, jetzt).until).toBe(jetzt + BLOCK_AFTER_SERVER_REJECTION_MS);
    });

    it('429 mit kürzerer Server-Wartezeit: trotzdem 6 Stunden', () => {
        expect(backgroundLoginBlockFor({ httpStatus: 429, remainingSeconds: 60 }, jetzt).until).toBe(jetzt + BLOCK_AFTER_SERVER_REJECTION_MS);
    });

    it('429 mit längerer Server-Wartezeit: die Server-Wartezeit', () => {
        expect(backgroundLoginBlockFor({ httpStatus: 429, remainingSeconds: 86400 }, jetzt).until).toBe(jetzt + 86400 * 1000);
    });

    it('Anmeldung hat den Server nicht erreicht (Netzfehler): 15 Minuten', () => {
        expect(BLOCK_AFTER_NETWORK_ERROR_MS).toBe(15 * 60 * 1000);
        expect(backgroundLoginBlockFor(new TypeError('Failed to fetch'), jetzt)).toEqual({ until: jetzt + BLOCK_AFTER_NETWORK_ERROR_MS });
    });
});

describe('isBackgroundLoginBlocked', () => {
    it('gilt bis zum Zeitpunkt `until`, danach nicht mehr', () => {
        expect(isBackgroundLoginBlocked({ until: 2000 }, 1999)).toBe(true);
        expect(isBackgroundLoginBlocked({ until: 2000 }, 2000)).toBe(false);
    });
    it('ohne oder mit kaputtem Vermerk: keine Sperre', () => {
        expect(isBackgroundLoginBlocked(undefined, 0)).toBe(false);
        expect(isBackgroundLoginBlocked({ until: 'morgen' }, 0)).toBe(false);
    });
});
