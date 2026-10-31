/**
 * #26f94a61: ts/ios.ts - die iPhone/iPad-Darstellung darf NUR auf iOS/iPadOS
 * angehen; Chrome, Firefox und Safari auf macOS bleiben unverändert.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { iosVorbereiten, istIos } from '../../ts/ios';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const IPAD_ALT = 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:144.0) Gecko/20100101 Firefox/144.0';

function neuesDokument(): Document {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = `
        <input type="checkbox" id="c1">
        <input type="text" id="t1">
        <input type="text" id="t2" autocapitalize="words">
        <input type="password" id="p1">
        <input type="submit" id="s1">`;
    return doc;
}

afterEach(() => {
    document.documentElement.classList.remove('ios');
});

describe('istIos', () => {
    it.each([
        ['iPhone', IPHONE, 5, true],
        ['iPad (alte Kennung)', IPAD_ALT, 5, true],
        ['iPadOS (meldet sich als Macintosh, mit Touch)', MAC_SAFARI, 5, true],
        ['Safari auf macOS (kein Touch)', MAC_SAFARI, 0, false],
        ['Firefox auf macOS', FIREFOX_MAC, 0, false],
        ['Chrome auf Windows mit Touchscreen', CHROME_WIN, 10, false],
    ])('%s -> %s', (_name, ua, touch, erwartet) => {
        expect(istIos({ userAgent: ua, maxTouchPoints: touch })).toBe(erwartet);
    });
});

describe('iosVorbereiten', () => {
    it('Desktop: ändert NICHTS am Dokument (keine Klasse, keine Attribute)', () => {
        const doc = neuesDokument();
        const vorher = doc.documentElement.outerHTML;
        expect(iosVorbereiten(doc, { userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(false);
        expect(doc.documentElement.outerHTML).toBe(vorher);
    });

    it('iPhone: setzt html.ios, Schalter und Tastatur-Hinweise; vorhandene Werte bleiben', () => {
        const doc = neuesDokument();
        expect(iosVorbereiten(doc, { userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
        expect(doc.documentElement.classList.contains('ios')).toBe(true);
        expect(doc.getElementById('c1')!.hasAttribute('switch')).toBe(true);
        expect(doc.getElementById('t1')!.getAttribute('autocapitalize')).toBe('off');
        expect(doc.getElementById('t1')!.getAttribute('autocorrect')).toBe('off');
        expect(doc.getElementById('t1')!.getAttribute('spellcheck')).toBe('false');
        expect(doc.getElementById('t2')!.getAttribute('autocapitalize')).toBe('words');
        expect(doc.getElementById('p1')!.getAttribute('autocapitalize')).toBe('off');
        expect(doc.getElementById('s1')!.hasAttribute('autocapitalize')).toBe(false);
    });

    it('iPhone: stattet auch später eingefügte Felder aus (2FA-Feld)', async () => {
        const doc = document;
        doc.body.innerHTML = '';
        iosVorbereiten(doc, { userAgent: IPHONE, maxTouchPoints: 5 });
        const panel = doc.createElement('div');
        panel.innerHTML = '<input type="text" id="twofa-code"><input type="checkbox" id="twofa-trust">';
        doc.body.appendChild(panel);
        await new Promise((r) => setTimeout(r, 0));
        expect(doc.getElementById('twofa-code')!.getAttribute('autocapitalize')).toBe('off');
        expect(doc.getElementById('twofa-trust')!.hasAttribute('switch')).toBe(true);
    });
});
