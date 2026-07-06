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
