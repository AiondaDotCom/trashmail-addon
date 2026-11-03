/**
 * #26f94a61: Unit-Tests für ts/fenster.ts.
 *
 * Safari auf iOS/iPadOS hat keine Erweiterungsfenster: `browser.windows`
 * fehlt ganz, einzelne Methoden fehlen, oder sie werfen. Jeder Fall wird hier
 * dreifach geprüft: mit Fenster-API (Desktop, bisheriger Weg), ohne
 * (`undefined`) und wenn sie wirft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';
import { beimSchliessen, eigeneSeiteSchliessen, fensterAnpassen, seiteOeffnen } from '../../ts/fenster';

let mock: BrowserMock;
let tabRemove: ReturnType<typeof vi.fn>;
let closeSpy: ReturnType<typeof vi.spyOn>;

/** Wie Safari auf iOS: kein `browser.windows`. */
function ohneFenster(): void {
    delete (mock as unknown as Record<string, unknown>)['windows'];
}

/** Fenster-API vorhanden, jeder Aufruf wirft (wie ein „not supported"). */
function fensterWerfen(): void {
    const wirft = async (): Promise<never> => {
        throw new Error('windows.* is not supported');
    };
    Object.assign(mock.windows, { create: wirft, remove: wirft, update: wirft, getCurrent: wirft, getLastFocused: wirft });
}

beforeEach(() => {
    mock = installBrowserMock();
    tabRemove = vi.fn(async () => undefined);
    Object.assign(mock.tabs, {
        getCurrent: vi.fn(async () => ({ id: 77, windowId: 9 })),
        remove: tabRemove,
    });
    closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('seiteOeffnen', () => {
    it('Desktop: öffnet ein zentriertes Popup-Fenster wie bisher (kein Tab)', async () => {
        const seite = await seiteOeffnen('chrome-extension://x/options/welcome.html', { width: 600, height: 720, bezug: 'aktuell' });
        expect(mock.windows.created).toEqual([{
            url: 'chrome-extension://x/options/welcome.html', type: 'popup',
            width: 600, height: 720, left: 440, top: 90,
        }]);
        expect(mock.tabs.list).toHaveLength(0);
        expect(seite.alsTab).toBe(false);
        expect(seite.tabId).toBeTypeOf('number');
    });

    it('Desktop: zentriert über dem zuletzt fokussierten Fenster bzw. dem Bildschirm', async () => {
        await seiteOeffnen('u1', { width: 750, height: 720, bezug: 'zuletzt-fokussiert' });
        await seiteOeffnen('u2', { width: 450, height: 595, bezug: 'bildschirm' });
        expect(mock.windows.created[0]).toMatchObject({ left: 365, top: 90 });
        expect(mock.windows.created[1]).toMatchObject({
            left: Math.round((screen.width - 450) / 2), top: Math.round((screen.height - 595) / 2),
        });
    });

    it('iOS (windows undefined): öffnet einen Tab und liefert dessen Tab-ID', async () => {
        ohneFenster();
        const seite = await seiteOeffnen('chrome-extension://x/create-address/create-address.html', { width: 750, height: 720 });
        expect(mock.tabs.list).toHaveLength(1);
        expect(mock.tabs.list[0]!.url).toContain('create-address.html');
        expect(seite).toEqual({ alsTab: true, windowId: 1, tabId: mock.tabs.list[0]!.id });
    });

    it('windows.create wirft: fällt auf einen Tab zurück', async () => {
        fensterWerfen();
        const seite = await seiteOeffnen('u', { width: 600, height: 720, bezug: 'aktuell' });
        expect(seite.alsTab).toBe(true);
        expect(mock.tabs.list).toHaveLength(1);
    });
});

describe('beimSchliessen', () => {
    it('Fenster: meldet das Schließen genau dieses Fensters', async () => {
        const seite = await seiteOeffnen('u', { width: 600, height: 720 });
        const rueckruf = vi.fn();
        beimSchliessen(seite, rueckruf);
        mock.windows.onRemoved.trigger(seite.windowId! + 1);
        expect(rueckruf).not.toHaveBeenCalled();
        mock.windows.onRemoved.trigger(seite.windowId!);
        expect(rueckruf).toHaveBeenCalledTimes(1);
    });

    it('Tab (iOS): meldet das Schließen genau dieses Tabs', async () => {
        ohneFenster();
        const seite = await seiteOeffnen('u', { width: 600, height: 720 });
        const rueckruf = vi.fn();
        beimSchliessen(seite, rueckruf);
        mock.tabs.onRemoved.trigger(seite.tabId! + 1);
        expect(rueckruf).not.toHaveBeenCalled();
        mock.tabs.onRemoved.trigger(seite.tabId!);
        expect(rueckruf).toHaveBeenCalledTimes(1);
    });
});

describe('eigeneSeiteSchliessen', () => {
    it('Desktop: schließt das eigene Fenster per windows.remove, nicht den Tab', async () => {
        const remove = vi.spyOn(mock.windows, 'remove');
        await eigeneSeiteSchliessen();
        expect(remove).toHaveBeenCalledWith(1);
        expect(tabRemove).not.toHaveBeenCalled();
        expect(closeSpy).not.toHaveBeenCalled();
    });

    it('iOS (windows undefined): schließt den eigenen Tab', async () => {
        ohneFenster();
        await eigeneSeiteSchliessen();
        expect(tabRemove).toHaveBeenCalledWith(77);
        expect(closeSpy).not.toHaveBeenCalled();
    });

    it('iOS (getCurrent da, remove fehlt): schließt den eigenen Tab', async () => {
        delete (mock.windows as unknown as Record<string, unknown>)['remove'];
        await eigeneSeiteSchliessen();
        expect(tabRemove).toHaveBeenCalledWith(77);
    });

    it('windows.remove wirft: schließt den eigenen Tab', async () => {
        fensterWerfen();
        await eigeneSeiteSchliessen();
        expect(tabRemove).toHaveBeenCalledWith(77);
    });

    it('weder Fenster- noch Tab-Schließen möglich: window.close()', async () => {
        ohneFenster();
        delete (mock.tabs as unknown as Record<string, unknown>)['getCurrent'];
        await eigeneSeiteSchliessen();
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('tabs.remove wirft: window.close()', async () => {
        ohneFenster();
        tabRemove.mockRejectedValue(new Error('nope'));
        await eigeneSeiteSchliessen();
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });
});

describe('fensterAnpassen', () => {
    it('Desktop: setzt die berechneten Maße am eigenen Fenster', async () => {
        const geaendert = await fensterAnpassen((f) => ({ height: (f.height ?? 0) + 10 }));
        expect(geaendert).toBe(true);
        expect(mock.windows.updated).toEqual([{ windowId: 1, info: { height: 810 } }]);
    });

    it('berechne liefert undefined: nichts ändern', async () => {
        expect(await fensterAnpassen(() => undefined)).toBe(false);
        expect(mock.windows.updated).toHaveLength(0);
    });

    it('iOS (windows undefined): tut nichts, wirft nicht', async () => {
        ohneFenster();
        const berechne = vi.fn(() => ({ height: 1 }));
        expect(await fensterAnpassen(berechne)).toBe(false);
        expect(berechne).not.toHaveBeenCalled();
    });

    it('windows.update wirft: false statt Ausnahme', async () => {
        Object.assign(mock.windows, { update: async () => { throw new Error('not supported'); } });
        expect(await fensterAnpassen(() => ({ height: 1 }))).toBe(false);
    });

    it('getCurrent wirft: false statt Ausnahme', async () => {
        fensterWerfen();
        expect(await fensterAnpassen(() => ({ height: 1 }))).toBe(false);
    });
});

/**
 * #26f94a61 (Codex-Review): Nach einem Tab-Rückfall läuft die Seite in einem
 * Tab des Browserfensters des Kunden. Funktionieren windows.getCurrent/remove
 * dort weiter, darf trotzdem NIE das ganze Fenster zugehen oder seine Größe
 * ändern - nur der eigene Tab schließt sich.
 */
describe('Seite als Tab im Fenster des Kunden', () => {
    afterEach(() => {
        window.history.replaceState({}, '', '/');
    });

    it('der Tab-Rückfall kennzeichnet die Adresse', async () => {
        fensterWerfen();
        await seiteOeffnen('chrome-extension://x/options/welcome.html', { width: 600, height: 720 });
        await seiteOeffnen('chrome-extension://x/popup/guardian-info.html?status=ok', { width: 450, height: 595 });
        expect(mock.tabs.list.map((t) => t.url)).toEqual([
            'chrome-extension://x/options/welcome.html?aiondaTab=1',
            'chrome-extension://x/popup/guardian-info.html?status=ok&aiondaTab=1',
        ]);
    });

    it('WAECHTER: mit Kennzeichen schließt eigeneSeiteSchliessen nur den Tab, nie das Fenster', async () => {
        window.history.replaceState({}, '', '/options/welcome.html?aiondaTab=1');
        const remove = vi.spyOn(mock.windows, 'remove');
        await eigeneSeiteSchliessen();
        expect(remove).not.toHaveBeenCalled();
        expect(tabRemove).toHaveBeenCalledWith(77);
    });

    it('WAECHTER: mit Kennzeichen ändert fensterAnpassen das Fenster nicht', async () => {
        window.history.replaceState({}, '', '/options/welcome.html?aiondaTab=1');
        expect(await fensterAnpassen(() => ({ height: 900 }))).toBe(false);
        expect(mock.windows.updated).toHaveLength(0);
    });

    it('WAECHTER: Fenster mit mehreren Tabs gilt nicht als eigenes (Schließen und Größe)', async () => {
        Object.assign(mock.windows, {
            getCurrent: async () => ({ id: 1, width: 1280, height: 800, type: 'normal', tabs: [{ id: 5 }, { id: 77 }] }),
        });
        const remove = vi.spyOn(mock.windows, 'remove');
        expect(await fensterAnpassen(() => ({ height: 900 }))).toBe(false);
        await eigeneSeiteSchliessen();
        expect(mock.windows.updated).toHaveLength(0);
        expect(remove).not.toHaveBeenCalled();
        expect(tabRemove).toHaveBeenCalledWith(77);
    });

    it('eigenes Popup mit genau einem Tab wird wie bisher geschlossen und angepasst', async () => {
        Object.assign(mock.windows, {
            getCurrent: async () => ({ id: 4, width: 600, height: 720, type: 'popup', tabs: [{ id: 77 }] }),
        });
        const remove = vi.spyOn(mock.windows, 'remove');
        expect(await fensterAnpassen(() => ({ height: 900 }))).toBe(true);
        await eigeneSeiteSchliessen();
        expect(mock.windows.updated).toEqual([{ windowId: 4, info: { height: 900 } }]);
        expect(remove).toHaveBeenCalledWith(4);
        expect(tabRemove).not.toHaveBeenCalled();
    });
});
