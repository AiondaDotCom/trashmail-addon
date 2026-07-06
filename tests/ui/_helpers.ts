/**
 * Gemeinsame Test-Helfer für die UI-Modul-Tests (popup/options/welcome/create-address).
 *
 * UI-Module haben Import-Seiteneffekte (greifen beim Laden auf DOM + Globals zu),
 * daher: HTML laden + Globals stubben VOR dem dynamischen Import, pro Test frisch
 * (vi.resetModules()).
 */
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

/**
 * jsdom hat EIN Dokument pro Testdatei. Module registrieren beim Import
 * `document.addEventListener("DOMContentLoaded", …)`; ohne Aufräumen sammeln sich
 * diese Listener über Tests hinweg an und feuern alle auf dem aktuellen DOM.
 * Deshalb tracken wir document-Listener und entfernen sie vor jedem Import.
 */
const trackedDocListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const originalDocAdd = document.addEventListener.bind(document);
document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void => {
    trackedDocListeners.push([type, listener]);
    originalDocAdd(type, listener, options);
}) as typeof document.addEventListener;

/** Entfernt alle von importierten Modulen registrierten document-Listener. */
export function resetDocumentListeners(): void {
    for (const [type, listener] of trackedDocListeners) {
        document.removeEventListener(type, listener);
    }
    trackedDocListeners.length = 0;
}

/** Lädt den <body>-Inhalt einer echten Addon-HTML-Seite ins jsdom-Dokument. */
export function loadHtmlBody(addonRelativePath: string): void {
    const html = readFileSync(`trashmail-addon/${addonRelativePath}`, 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.innerHTML = parsed.body.innerHTML;
}

/** Wartet auf Microtask/Macrotask-Ketten (mehrere `.then()`-Stufen). */
export async function tick(times = 4): Promise<void> {
    for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

export interface CommonGlobals {
    callAPI: ReturnType<typeof vi.fn>;
    createAccessToken: ReturnType<typeof vi.fn>;
    getApiBaseUrl: ReturnType<typeof vi.fn>;
    openAddressManagerAuthenticated: ReturnType<typeof vi.fn>;
    orgDomain: ReturnType<typeof vi.fn>;
    /** Aktueller API_BASE_URL-Wert (per get/set-Property wie in api.ts). */
    getApiBase(): string;
}

/**
 * Stubt die von den Modulen konsumierten api.ts/Vendor-Globals auf globalThis.
 * API_BASE_URL wird — wie api.ts — als get/set-Property definiert, damit
 * Lese- UND Schreibzugriff (Debug-Panel) funktioniert und assertierbar ist.
 */
export function stubCommonGlobals(overrides: { apiBase?: string } = {}): CommonGlobals {
    let apiBase = overrides.apiBase ?? 'https://mail.aionda.com';

    const g = globalThis as Record<string, unknown>;

    const callAPI = vi.fn();
    const createAccessToken = vi.fn();
    const getApiBaseUrl = vi.fn(async () => apiBase);
    const openAddressManagerAuthenticated = vi.fn(async () => undefined);
    // Vendor: org_domain aus publicsuffixlist.js — hier deterministisch = Hostname.
    const orgDomain = vi.fn((url: URL) => url.hostname);

    // Reales isPAT-Verhalten (identisch zu api.ts).
    const isPAT = (password: unknown): boolean =>
        typeof password === 'string' && password.startsWith('tmpat_') && password.length > 6;

    Object.assign(g, {
        callAPI,
        createAccessToken,
        getApiBaseUrl,
        openAddressManagerAuthenticated,
        isPAT,
        org_domain: orgDomain,
        DEFAULT_API_URL: 'https://mail.aionda.com',
    });

    try {
        delete g['API_BASE_URL'];
    } catch {
        /* noop */
    }
    Object.defineProperty(g, 'API_BASE_URL', {
        configurable: true,
        get: () => apiBase,
        set: (value: string) => {
            apiBase = value;
        },
    });

    return {
        callAPI,
        createAccessToken,
        getApiBaseUrl,
        openAddressManagerAuthenticated,
        orgDomain,
        getApiBase: () => apiBase,
    };
}

/** Entfernt die Addon-Auth-Vendor-Clients (Pfad „Client nicht verfügbar"). */
export function clearAuthClients(): void {
    (globalThis as Record<string, unknown>)['addonOpaqueClient'] = undefined;
    (globalThis as Record<string, unknown>)['addonSrpClient'] = undefined;
}

/** Stubt window.close / window.alert / window.location.reload (in jsdom nicht implementiert). */
export function stubWindowNavigation(): { reload: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; alert: ReturnType<typeof vi.fn> } {
    const reload = vi.fn();
    const close = vi.fn();
    const alert = vi.fn();
    vi.spyOn(window, 'close').mockImplementation(close);
    vi.spyOn(window, 'alert').mockImplementation(alert);
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, reload, assign: vi.fn(), href: 'about:blank' },
    });
    return { reload, close, alert };
}

/** Feuert das DOMContentLoaded-Event (jsdom triggert es nach innerHTML nicht selbst). */
export function fireDomReady(): void {
    document.dispatchEvent(new Event('DOMContentLoaded'));
}
