"use strict";

/**
 * #26f94a61: Fensterzugriff an einer Stelle.
 *
 * Safari auf iOS/iPadOS kennt keine eigenen Erweiterungsfenster: Je nach
 * Version fehlt `browser.windows.create/remove/update` ganz oder der Aufruf
 * wirft. Beim Anmelden auf dem iPhone kam deshalb „browser.windows.remove is
 * not a function" (gemeldet 31.10.2026). Jede Seite geht darum über diese
 * Funktionen, die erst das Fenster versuchen und sonst auf Tabs bzw.
 * `window.close()` zurückfallen.
 *
 * Die Erweiterungs-API wird bei JEDEM Aufruf frisch geholt (nicht beim Laden
 * des Moduls), damit Tests und Rückfälle immer den aktuellen Stand sehen.
 */

type Erweiterung = typeof chrome;

function api(): Erweiterung {
    return (globalThis as { browser?: Erweiterung }).browser ?? chrome;
}

/** Stellt eine Funktion wirklich bereit? (`undefined`, Objekt ohne Methode, …) */
function hat(objekt: unknown, name: string): boolean {
    return typeof objekt === "object" && objekt !== null
        && typeof (objekt as Record<string, unknown>)[name] === "function";
}

/** Bezug, über dem ein neues Fenster zentriert wird. */
export type Bezug = "zuletzt-fokussiert" | "aktuell" | "bildschirm";

export interface FensterWunsch {
    width: number;
    height: number;
    bezug?: Bezug;
}

/** Was tatsächlich geöffnet wurde: eigenes Fenster oder (Rückfall) ein Tab. */
export interface GeoeffneteSeite {
    alsTab: boolean;
    windowId?: number;
    tabId?: number;
}

async function position(wunsch: FensterWunsch): Promise<{ left: number; top: number } | undefined> {
    const { width, height } = wunsch;
    const bezug = wunsch.bezug ?? "zuletzt-fokussiert";
    if (bezug === "bildschirm") {
        if (typeof screen === "undefined") {
            return undefined;
        }
        return { left: Math.round((screen.width - width) / 2), top: Math.round((screen.height - height) / 2) };
    }
    const fenster = api().windows;
    const name = bezug === "aktuell" ? "getCurrent" : "getLastFocused";
    if (!hat(fenster, name)) {
        return undefined;
    }
    try {
        const f = bezug === "aktuell" ? await fenster.getCurrent() : await fenster.getLastFocused();
        return {
            left: Math.max(0, Math.round((f.left ?? 0) + ((f.width ?? width) - width) / 2)),
            top: Math.max(0, Math.round((f.top ?? 0) + ((f.height ?? height) - height) / 2)),
        };
    } catch {
        return undefined;
    }
}

/**
 * Seite als zentriertes Popup-Fenster öffnen; fehlt `windows.create` oder
 * wirft es, als Tab.
 */
export async function seiteOeffnen(url: string, wunsch: FensterWunsch): Promise<GeoeffneteSeite> {
    const b = api();
    if (hat(b.windows, "create")) {
        try {
            const pos = await position(wunsch);
            const fenster = await b.windows.create({
                "url": url, "type": "popup", "width": wunsch.width, "height": wunsch.height, ...pos,
            });
            return { alsTab: false, windowId: fenster?.id, tabId: fenster?.tabs?.[0]?.id };
        } catch (err) {
            console.warn("[Aionda Mail] Kein eigenes Fenster möglich, öffne Tab:", err);
        }
    }
    const tab = await b.tabs.create({ "url": url });
    return { alsTab: true, windowId: tab?.windowId, tabId: tab?.id };
}

/** Meldet, wenn die mit `seiteOeffnen` geöffnete Seite geschlossen wurde. */
export function beimSchliessen(seite: GeoeffneteSeite, rueckruf: () => void): void {
    const b = api();
    if (!seite.alsTab && seite.windowId !== undefined && hat(b.windows?.onRemoved, "addListener")) {
        b.windows.onRemoved.addListener((id) => {
            if (id === seite.windowId) {
                rueckruf();
            }
        });
        return;
    }
    if (seite.tabId !== undefined && hat(b.tabs?.onRemoved, "addListener")) {
        b.tabs.onRemoved.addListener((id) => {
            if (id === seite.tabId) {
                rueckruf();
            }
        });
    }
}

/**
 * Aktuelles Fenster der Seite, wenn die Fenster-API es liefert. Auf dem
 * Desktop ist das wie bisher das Popup-Fenster der Seite.
 */
async function eigenesFenster(): Promise<chrome.windows.Window | undefined> {
    const fenster = api().windows;
    if (!hat(fenster, "getCurrent")) {
        return undefined;
    }
    try {
        const aktuell = await fenster.getCurrent();
        return aktuell?.id === undefined ? undefined : aktuell;
    } catch {
        return undefined;
    }
}

/**
 * Gibt es eigene Fenster (Desktop)? Auf iOS/iPadOS fehlen `create`/`remove`.
 * Seiten, die bisher `window.close()` riefen, behalten das auf dem Desktop.
 */
export function fensterVerfuegbar(): boolean {
    const fenster = api().windows;
    return hat(fenster, "create") && hat(fenster, "remove");
}

/**
 * Eigene Seite schließen: eigenes Popup-Fenster per `windows.remove`, sonst
 * den eigenen Tab per `tabs.getCurrent` + `tabs.remove`, sonst `window.close()`.
 */
export async function eigeneSeiteSchliessen(): Promise<void> {
    const b = api();
    const fenster = await eigenesFenster();
    if (fenster !== undefined && hat(b.windows, "remove")) {
        try {
            await b.windows.remove(fenster.id!);
            return;
        } catch (err) {
            console.warn("[Aionda Mail] Fenster ließ sich nicht schließen:", err);
        }
    }
    if (hat(b.tabs, "getCurrent") && hat(b.tabs, "remove")) {
        try {
            const tab = await b.tabs.getCurrent();
            if (tab?.id !== undefined) {
                await b.tabs.remove(tab.id);
                return;
            }
        } catch (err) {
            console.warn("[Aionda Mail] Tab ließ sich nicht schließen:", err);
        }
    }
    window.close();
}

/**
 * Größe/Lage des eigenen Fensters ändern. `berechne` bekommt das
 * aktuelle Fenster und liefert die neuen Maße (oder `undefined` = nichts
 * tun). Ohne eigenes Fenster (iOS, Tab) passiert nichts.
 *
 * @returns true, wenn das Fenster geändert wurde.
 */
export async function fensterAnpassen(
    berechne: (fenster: chrome.windows.Window) => chrome.windows.UpdateInfo | undefined,
): Promise<boolean> {
    const b = api();
    if (!hat(b.windows, "update")) {
        return false;
    }
    const fenster = await eigenesFenster();
    if (fenster === undefined) {
        return false;
    }
    const neu = berechne(fenster);
    if (neu === undefined) {
        return false;
    }
    try {
        await b.windows.update(fenster.id!, neu);
        return true;
    } catch (err) {
        console.log("[Aionda Mail] Fenstergröße ließ sich nicht ändern:", err);
        return false;
    }
}
