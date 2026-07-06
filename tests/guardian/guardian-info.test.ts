import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserMock } from '../helpers/browser-mock';
import { installBrowserMock } from '../helpers/browser-mock';

const html = fs.readFileSync('trashmail-addon/popup/guardian-info.html', 'utf8');
const bodyInner = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';

function setSearch(qs: string): void {
    window.history.replaceState(null, '', `/popup/guardian-info.html${qs}`);
}

function byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Element #${id} nicht gefunden`);
    }
    return el;
}

let mock: BrowserMock;

async function render(qs: string): Promise<void> {
    setSearch(qs);
    // addEventListener spionieren, um GENAU den Handler dieses Imports zu greifen
    // und ihn direkt aufzurufen (verhindert Listener-Akkumulation über re-imports).
    const addSpy = vi.spyOn(document, 'addEventListener');
    await import('../../ts/popup/guardian-info');
    const call = addSpy.mock.calls.find((c) => c[0] === 'DOMContentLoaded');
    addSpy.mockRestore();
    const handler = call?.[1] as EventListener;
    handler(new Event('DOMContentLoaded'));
}

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    mock = installBrowserMock();
    document.body.innerHTML = bodyInner;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('guardian-info Statusdarstellung', () => {
    it('rendert VERIFIED mit Text + Detail', async () => {
        await render('?status=verified&text=Alles+sicher&detail=2+signiert');

        expect(byId('status-value').textContent).toBe('Alles sicher - 2 signiert');
        expect(byId('status-box').className).toBe('status-box verified');
        expect(byId('status-icon').textContent).toBe('✅');
    });

    it('rendert PROTECTED ohne Detail', async () => {
        await render('?status=protected&text=Geschützt');

        expect(byId('status-value').textContent).toBe('Geschützt');
        expect(byId('status-box').className).toBe('status-box protected');
        expect(byId('status-icon').textContent).toBe('🛡️');
    });

    it('rendert WARNING', async () => {
        await render('?status=warning&text=Achtung');
        expect(byId('status-box').className).toBe('status-box warning');
        expect(byId('status-icon').textContent).toBe('⚠️');
    });

    it('rendert DANGER', async () => {
        await render('?status=danger&text=Gefahr');
        expect(byId('status-box').className).toBe('status-box danger');
        expect(byId('status-icon').textContent).toBe('⚠️');
    });

    it('rendert UNSIGNED wie DANGER', async () => {
        await render('?status=unsigned&text=Unsigniert');
        expect(byId('status-box').className).toBe('status-box danger');
        expect(byId('status-icon').textContent).toBe('⚠️');
    });

    it('fällt bei unbekanntem Status auf den Default zurück', async () => {
        await render('?status=whatever&text=Unbekannt');
        expect(byId('status-box').className).toBe('status-box');
        expect(byId('status-icon').textContent).toBe('🔒');
    });

    it('rendert leere Defaults wenn keine Parameter gesetzt sind', async () => {
        await render('');
        expect(byId('status-value').textContent).toBe('');
        expect(byId('status-box').className).toBe('status-box');
        expect(byId('status-icon').textContent).toBe('🔒');
    });
});

describe('guardian-info TLS-Block (Firefox)', () => {
    it('zeigt TLS verifiziert inkl. Fingerprint bei tlsVerified=1', async () => {
        mock.i18n.messages.set('guardianTlsVerified', 'TLS verifiziert');
        await render('?status=verified&text=X&tlsVerified=1&tlsFingerprint=sha256:abcd1234');

        const box = byId('tls-status-box');
        expect(box.style.display).toBe('block');
        expect(box.className).toBe('status-box verified');
        expect(byId('tls-status-value').textContent).toBe('TLS verifiziert ✓');
        expect(byId('tls-fingerprint').textContent).toBe('sha256:abcd1234');
    });

    it('zeigt TLS-nicht-verifiziert bei tlsVerified=0', async () => {
        mock.i18n.messages.set('guardianTlsNotVerified', 'TLS nicht verifiziert');
        await render('?status=verified&text=X&tlsVerified=0');

        const box = byId('tls-status-box');
        expect(box.className).toBe('status-box inactive');
        expect(byId('tls-status-value').textContent).toBe('TLS nicht verifiziert');
    });

    it('blendet den TLS-Block aus wenn tlsVerified fehlt', async () => {
        await render('?status=verified&text=X');
        expect(byId('tls-status-box').style.display).toBe('none');
    });
});

describe('guardian-info Interaktion', () => {
    it('schließt das Fenster beim Klick auf Schließen', async () => {
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
        await render('?status=verified&text=X');

        byId('btn-close').dispatchEvent(new Event('click'));

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('passt die Fenstergröße nach dem Rendern an (Auto-Resize)', async () => {
        const updateSpy = vi.fn(async () => undefined);
        (mock.windows as unknown as { getCurrent: () => Promise<unknown> }).getCurrent = async () => ({ id: 1, width: 900, height: 700 });
        (mock.windows as unknown as { update: unknown }).update = updateSpy;

        await render('?status=verified&text=X');
        await vi.advanceTimersByTimeAsync(60);

        expect(updateSpy).toHaveBeenCalledTimes(1);
    });
});
