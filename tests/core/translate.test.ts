/**
 * Unit tests for ts/translate.ts (ported from translate.js).
 *
 * translate.ts runs on DOMContentLoaded and localizes every [data-i18n]
 * element. We build a DOM fragment, seed i18n messages on the mock, dispatch
 * DOMContentLoaded and assert the applied text / attribute / substitutions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';

let mock: BrowserMock;

async function runTranslate(html: string): Promise<void> {
    document.body.innerHTML = html;
    await import('../../ts/translate');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    // getMessage is synchronous in the mock, so the DOM is updated immediately.
    await Promise.resolve();
}

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    mock = installBrowserMock();
});

describe('translate DOMContentLoaded', () => {
    it('inserts the localized text as content (no attribute)', async () => {
        mock.i18n.messages.set('greeting', 'Hallo Welt');
        await runTranslate('<span id="s" data-i18n="greeting"></span>');
        expect(document.getElementById('s')!.textContent).toContain('Hallo Welt');
    });

    it('assigns to the named attribute when data-i18n uses "key|attr"', async () => {
        mock.i18n.messages.set('myTitle', 'Titeltext');
        await runTranslate('<button id="b" data-i18n="myTitle|title"></button>');
        expect(document.getElementById('b')!.getAttribute('title')).toBe('Titeltext');
    });

    it('sets the value property for inputs via "key|value"', async () => {
        mock.i18n.messages.set('placeholderMsg', 'Bitte eingeben');
        await runTranslate('<input id="i" data-i18n="placeholderMsg|value">');
        expect((document.getElementById('i') as HTMLInputElement).value).toBe('Bitte eingeben');
    });

    it('passes "?"-separated substitutions to getMessage', async () => {
        mock.i18n.messages.set('welcome', 'Hi $1, du hast $2 Mails');
        await runTranslate('<span id="s" data-i18n="welcome?Max?5"></span>');
        expect(document.getElementById('s')!.textContent).toContain('Hi Max, du hast 5 Mails');
    });

    it('handles the literal "#" number branch (empty key → format_num used and re-formatted)', async () => {
        await runTranslate('<span id="s" data-i18n="#42"></span>');
        // key is empty → text becomes the format_num "42", then digits are re-run
        // through Intl.NumberFormat().format (identity for a short number).
        expect(document.getElementById('s')!.textContent).toContain('42');
    });

    it('re-formats digits inside a translated message (key#num branch)', async () => {
        mock.i18n.messages.set('count', 'Du hast 7 neue Nachrichten');
        await runTranslate('<span id="s" data-i18n="count#7"></span>');
        expect(document.getElementById('s')!.textContent).toContain('Du hast 7 neue Nachrichten');
    });

    it('localizes multiple elements in one pass', async () => {
        mock.i18n.messages.set('a', 'AAA');
        mock.i18n.messages.set('b', 'BBB');
        await runTranslate('<span id="x" data-i18n="a"></span><span id="y" data-i18n="b"></span>');
        expect(document.getElementById('x')!.textContent).toContain('AAA');
        expect(document.getElementById('y')!.textContent).toContain('BBB');
    });
});
