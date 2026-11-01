/**
 * #26f94a61: ts/ios.ts - die iPhone/iPad-Darstellung darf NUR auf iOS/iPadOS
 * angehen; Chrome, Firefox und Safari auf macOS bleiben unverändert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const mac = async () => ({ os: 'mac' });
const ios = async () => ({ os: 'ios' });

describe('istIos', () => {
    it.each([
        ['iPhone, Plattform ios', IPHONE, 5, ios, true],
        ['iPhone ohne getPlatformInfo (Rückfall User-Agent)', IPHONE, 5, undefined, true],
        ['iPad (alte Kennung) ohne getPlatformInfo', IPAD_ALT, 5, undefined, true],
        ['iPadOS (Macintosh mit Touch), Plattform ios', MAC_SAFARI, 5, ios, true],
        ['Mac mit Touch, Plattform mac', MAC_SAFARI, 5, mac, false],
        ['Mac mit Touch ohne getPlatformInfo', MAC_SAFARI, 5, undefined, false],
        ['iPhone-Kennung, aber Plattform mac', IPHONE, 5, mac, false],
        ['Safari auf macOS (kein Touch)', MAC_SAFARI, 0, ios, false],
        ['Firefox auf macOS', FIREFOX_MAC, 0, undefined, false],
        ['Chrome auf Windows mit Touchscreen', CHROME_WIN, 10, undefined, false],
    ] as const)('%s -> %s', async (_name, ua, touch, plattform, erwartet) => {
        expect(await istIos({ userAgent: ua, maxTouchPoints: touch }, plattform)).toBe(erwartet);
    });

    it('getPlatformInfo wirft: Rückfall auf den User-Agent, Macintosh nie', async () => {
        const wirft = async (): Promise<never> => { throw new Error('nicht unterstützt'); };
        expect(await istIos({ userAgent: IPHONE, maxTouchPoints: 5 }, wirft)).toBe(true);
        expect(await istIos({ userAgent: MAC_SAFARI, maxTouchPoints: 5 }, wirft)).toBe(false);
    });
});

describe('iosVorbereiten', () => {
    it('Desktop: ändert NICHTS am Dokument und fragt die Plattform gar nicht', async () => {
        const doc = neuesDokument();
        const vorher = doc.documentElement.outerHTML;
        const plattform = vi.fn(ios);
        expect(await iosVorbereiten(doc, { userAgent: MAC_SAFARI, maxTouchPoints: 0 }, plattform)).toBe(false);
        expect(doc.documentElement.outerHTML).toBe(vorher);
        expect(plattform).not.toHaveBeenCalled();
    });

    // #26f94a61 (Codex-Review): Ein Mac mit Touch-Bildschirm ist Desktop.
    it('WAECHTER: Mac mit maxTouchPoints 5 und os "mac" bekommt KEIN html.ios und keine Attribute', async () => {
        const doc = neuesDokument();
        const vorher = doc.documentElement.outerHTML;
        expect(await iosVorbereiten(doc, { userAgent: MAC_SAFARI, maxTouchPoints: 5 }, mac)).toBe(false);
        expect(doc.documentElement.classList.contains('ios')).toBe(false);
        expect(doc.documentElement.outerHTML).toBe(vorher);
    });

    it('iPadOS (Macintosh mit Touch, os "ios") bekommt html.ios', async () => {
        const doc = neuesDokument();
        expect(await iosVorbereiten(doc, { userAgent: MAC_SAFARI, maxTouchPoints: 5 }, ios)).toBe(true);
        expect(doc.documentElement.classList.contains('ios')).toBe(true);
    });

    it('bis zur Antwort ist die Seite unsichtbar (kein Umspringen), danach wieder sichtbar', async () => {
        const doc = neuesDokument();
        let antworten: (v: { os: string }) => void = () => undefined;
        const lauf = iosVorbereiten(doc, { userAgent: IPHONE, maxTouchPoints: 5 }, () => new Promise((r) => { antworten = r; }));
        expect(doc.documentElement.style.visibility).toBe('hidden');
        expect(doc.documentElement.classList.contains('ios')).toBe(false);
        antworten({ os: 'ios' });
        expect(await lauf).toBe(true);
        expect(doc.documentElement.classList.contains('ios')).toBe(true);
        expect(doc.documentElement.hasAttribute('style')).toBe(false);
    });

    it('iPhone: setzt html.ios, Schalter und Tastatur-Hinweise; vorhandene Werte bleiben', async () => {
        const doc = neuesDokument();
        expect(await iosVorbereiten(doc, { userAgent: IPHONE, maxTouchPoints: 5 }, ios)).toBe(true);
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
        await iosVorbereiten(doc, { userAgent: IPHONE, maxTouchPoints: 5 }, ios);
        const panel = doc.createElement('div');
        panel.innerHTML = '<input type="text" id="twofa-code"><input type="checkbox" id="twofa-trust">';
        doc.body.appendChild(panel);
        await new Promise((r) => setTimeout(r, 0));
        expect(doc.getElementById('twofa-code')!.getAttribute('autocapitalize')).toBe('off');
        expect(doc.getElementById('twofa-trust')!.hasAttribute('switch')).toBe(true);
    });
});
