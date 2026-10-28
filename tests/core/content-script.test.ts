/**
 * Unit tests for ts/content-script.ts (ported from content-script.js).
 *
 * Runs in jsdom: the content script registers a runtime.onMessage listener and
 * manipulates the live DOM (MITM overlay, address pasting). Fresh module import
 * per test so the listener is re-registered against the fresh mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';

let mock: BrowserMock;

beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    mock = installBrowserMock();
    await import('../../ts/content-script');
});

describe('guardian MITM warning overlay', () => {
    it('renders an overlay and escapes malicious message HTML (XSS-safe)', async () => {
        const response = await mock.runtime.sendMessage({
            action: 'guardian_warning',
            message: '<img src=x onerror=alert(1)>',
            title: 'Achtung',
            dismissText: 'Schließen',
        });
        expect(response).toEqual({ received: true });

        const overlay = document.getElementById('trashmail-mitm-warning');
        expect(overlay).not.toBeNull();
        // Title/dismiss are used verbatim; the message HTML must be escaped (no live img element).
        expect(overlay!.querySelector('img')).toBeNull();
        expect(overlay!.innerHTML).toContain('&lt;img');
        expect(overlay!.textContent).toContain('Achtung');
        expect(overlay!.textContent).toContain('Schließen');
    });

    it('does not stack a second overlay while one is already shown', async () => {
        await mock.runtime.sendMessage({ action: 'guardian_warning', message: 'first', title: 'T', dismissText: 'D' });
        await mock.runtime.sendMessage({ action: 'guardian_warning', message: 'second', title: 'T', dismissText: 'D' });
        expect(document.querySelectorAll('#trashmail-mitm-warning').length).toBe(1);
    });

    it('falls back to English defaults when title/dismiss are missing', async () => {
        await mock.runtime.sendMessage({ action: 'guardian_warning', message: 'plain' });
        const overlay = document.getElementById('trashmail-mitm-warning')!;
        expect(overlay.textContent).toContain('Security Warning');
        expect(overlay.textContent).toContain('Dismiss');
    });

    it('removes the overlay when the dismiss button is clicked', async () => {
        await mock.runtime.sendMessage({ action: 'guardian_warning', message: 'x', title: 'T', dismissText: 'D' });
        const closeButton = document.getElementById('trashmail-mitm-close') as HTMLButtonElement;
        closeButton.click();
        expect(document.getElementById('trashmail-mitm-warning')).toBeNull();
    });
});

describe('check_editable', () => {
    it('reports true when a writable input is focused', async () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        const response = await mock.runtime.sendMessage('check_editable');
        expect(response).toBe(true);
    });

    it('reports a falsy value when nothing editable is focused', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const response = await mock.runtime.sendMessage('check_editable');
        expect(response).toBeFalsy();
    });

    it('treats a read-only input as not editable (but contentEditable still counts)', async () => {
        const input = document.createElement('input');
        input.readOnly = true;
        document.body.appendChild(input);
        input.focus();
        const response = await mock.runtime.sendMessage('check_editable');
        expect(response).toBeFalsy();
    });
});

describe('paste address into focused field', () => {
    it('inserts the message at the caret of an input element', async () => {
        const input = document.createElement('input');
        input.value = 'ab';
        document.body.appendChild(input);
        input.focus();
        input.setSelectionRange(1, 1);

        await mock.runtime.sendMessage('foo@trashmail.com');
        expect(input.value).toBe('afoo@trashmail.comb');
        expect(input.selectionStart).toBe(1 + 'foo@trashmail.com'.length);
    });

    it('replaces a selection range with the pasted address', async () => {
        const input = document.createElement('input');
        input.value = 'START-END';
        document.body.appendChild(input);
        input.focus();
        input.setSelectionRange(0, 6); // select "START-"

        await mock.runtime.sendMessage('X@Y.z');
        expect(input.value).toBe('X@Y.zEND');
    });

    it('inserts a text node into a focused contentEditable element', async () => {
        const editable = document.createElement('div');
        Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true });
        editable.textContent = '';
        document.body.appendChild(editable);
        const range = document.createRange();
        range.setStart(editable, 0);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        const activeGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');
        Object.defineProperty(document, 'activeElement', { get: () => editable, configurable: true });
        try {
            await mock.runtime.sendMessage('paste@me.com');
            expect(editable.textContent).toContain('paste@me.com');
        } finally {
            if (activeGetter) { Object.defineProperty(document, 'activeElement', activeGetter); }
        }
    });

    it('WAECHTER: ein Feld ohne Einfuegemarke (type="email") laesst den Listener NICHT werfen', async () => {
        // Vorbedingung, damit der Waechter nicht ins Leere prueft: genau hier wirft
        // der Browser. jsdom verhaelt sich wie Chrome (gemessen 13.08./16.08.2026:
        // selectionStart === null, setSelectionRange -> DOMException InvalidStateError).
        const input = document.createElement('input');
        input.type = 'email';
        document.body.appendChild(input);
        input.focus();
        expect(input.selectionStart).toBeNull();
        expect(() => input.setSelectionRange(0, 0)).toThrow(DOMException);

        // Ein Wurf aus dem Listener kommt beim Absender als
        // "Error message from listener couldn't be parsed or was empty." an.
        const response = await mock.runtime.sendMessage('wegwerf-7037@kurzepost.de');

        expect(response).toEqual({ pasted: true });
        expect(input.value).toBe('wegwerf-7037@kurzepost.de');
    });

    it('meldet ehrlich pasted:false, wenn der Browser den Wert verwirft (type="number")', async () => {
        const input = document.createElement('input');
        input.type = 'number';
        document.body.appendChild(input);
        input.focus();

        const response = await mock.runtime.sendMessage('wegwerf-7037@kurzepost.de');

        // Der Browser verwirft eine nicht-numerische Zuweisung still - dann darf
        // die Rueckmeldung nicht "eingefuegt" behaupten.
        expect(input.value).toBe('');
        expect(response).toEqual({ pasted: false });
    });

    it('is a no-op when the focused element is neither an input nor contentEditable', async () => {
        const plain = document.createElement('div');
        plain.textContent = 'unchanged';
        document.body.appendChild(plain);
        const activeGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');
        Object.defineProperty(document, 'activeElement', { get: () => plain, configurable: true });
        try {
            await mock.runtime.sendMessage('ignored@me.com');
            expect(plain.textContent).toBe('unchanged');
        } finally {
            if (activeGetter) { Object.defineProperty(document, 'activeElement', activeGetter); }
        }
    });
});

/**
 * #8d29c6d5 #26f94a61: Frameworks wie React verfolgen den Feldwert ueber einen
 * eigenen Setter auf der INSTANZ. `input.value = x` laeuft durch diesen Setter,
 * der Verfolger haelt den neuen Wert fuer bekannt, und das folgende
 * `input`-Ereignis loest kein onChange aus - das Formular sieht die Adresse
 * nicht. Ohne jedes Ereignis merkt es ohnehin nichts. Nachgebaut ist genau
 * Reacts `inputValueTracking`: Setter auf der Instanz, Vergleich beim Ereignis.
 */
describe('Einfuegen in Framework-Formulare (React/Vue)', () => {
    function reactArtigesFeld(type = 'text'): { input: HTMLInputElement; aenderungen: string[]; ereignisse: string[] } {
        const input = document.createElement('input');
        input.type = type;
        document.body.appendChild(input);
        const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
        let verfolgt = input.value;
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() { return proto.get!.call(this); },
            set(v: string) { verfolgt = String(v); proto.set!.call(this, v); },
        });
        const aenderungen: string[] = [];
        const ereignisse: string[] = [];
        // Am Dokument lauschen: React haengt seine Ereignisse an die Wurzel,
        // ein Ereignis ohne bubbles kaeme dort nie an.
        for (const art of ['input', 'change']) {
            document.addEventListener(art, (ev) => {
                if (ev.target !== input) { return; }
                ereignisse.push(art);
                const jetzt = proto.get!.call(input) as string;
                if (art === 'input' && jetzt !== verfolgt) {
                    verfolgt = jetzt;
                    aenderungen.push(jetzt);
                }
            });
        }
        return { input, aenderungen, ereignisse };
    }

    it('WAECHTER: loest input und change aus, und ein React-artiger Verfolger erkennt die Aenderung', async () => {
        const { input, aenderungen, ereignisse } = reactArtigesFeld('text');
        input.focus();
        const response = await mock.runtime.sendMessage('react@trashmail.com');
        expect(response).toEqual({ pasted: true });
        expect(input.value).toBe('react@trashmail.com');
        expect(ereignisse).toEqual(['input', 'change']);
        expect(aenderungen).toEqual(['react@trashmail.com']);
    });

    it('WAECHTER: gilt auch fuer Felder ohne Einfuegemarke (type="email")', async () => {
        const { input, aenderungen, ereignisse } = reactArtigesFeld('email');
        input.focus();
        const response = await mock.runtime.sendMessage('email@trashmail.com');
        expect(response).toEqual({ pasted: true });
        expect(ereignisse).toEqual(['input', 'change']);
        expect(aenderungen).toEqual(['email@trashmail.com']);
    });

    it('nutzt bei einer textarea den Setter von HTMLTextAreaElement', async () => {
        const area = document.createElement('textarea');
        document.body.appendChild(area);
        area.focus();
        let gesehen = '';
        area.addEventListener('input', () => { gesehen = area.value; });
        const response = await mock.runtime.sendMessage('area@trashmail.com');
        expect(response).toEqual({ pasted: true });
        expect(gesehen).toBe('area@trashmail.com');
    });
});

/**
 * #26f94a61: Auf iOS gibt es keine Kontextmenues der Erweiterung; die Adresse
 * entsteht im Popup. Das Antippen der Symbolleiste nimmt dem Feld den Fokus
 * (die Tastatur verschwindet), `document.activeElement` ist dann `body`. Das
 * zuletzt fokussierte Eingabefeld der Seite bleibt das Ziel.
 */
describe('Ziel nach Fokusverlust (Popup-Weg)', () => {
    it('fuegt in das zuletzt fokussierte Feld ein, wenn der Fokus inzwischen weg ist', async () => {
        const input = document.createElement('input');
        input.type = 'email';
        document.body.appendChild(input);
        input.focus();
        input.blur();
        expect(document.activeElement).toBe(document.body);
        const response = await mock.runtime.sendMessage('spaeter@trashmail.com');
        expect(response).toEqual({ pasted: true });
        expect(input.value).toBe('spaeter@trashmail.com');
    });

    it('meldet check_editable auch nach Fokusverlust fuer das zuletzt fokussierte Feld', async () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        input.blur();
        expect(await mock.runtime.sendMessage('check_editable')).toBeFalsy();
    });

    it('nimmt kein Feld, das inzwischen aus der Seite entfernt wurde', async () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        input.blur();
        input.remove();
        const response = await mock.runtime.sendMessage('weg@trashmail.com');
        expect(response).toEqual({ pasted: false });
    });

    it('nimmt kein schreibgeschuetztes Feld als Ersatzziel', async () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        input.readOnly = true;
        input.blur();
        const response = await mock.runtime.sendMessage('ro@trashmail.com');
        expect(response).toEqual({ pasted: false });
        expect(input.value).toBe('');
    });
});

