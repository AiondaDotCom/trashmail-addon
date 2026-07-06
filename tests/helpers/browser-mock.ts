/**
 * In-Memory-Implementierung der WebExtension-APIs für Unit-Tests.
 *
 * Ziel: echtes Verhalten testen. storage verhält sich wie echtes
 * browser.storage (inkl. onChanged-Events), runtime.sendMessage wird an
 * registrierte onMessage-Listener geroutet (inkl. `return true` +
 * sendResponse-Pattern), Badge-/Notification-/Menu-Aufrufe werden
 * aufgezeichnet und sind per Handle assertierbar.
 *
 * Verwendung (Module haben Import-Seiteneffekte, daher immer frisch laden):
 *   const mock = installBrowserMock();
 *   vi.resetModules();
 *   await import('../../ts/background');
 *   mock.runtime.onMessage.trigger(...)
 */

export interface MockEvent<T extends (...args: never[]) => unknown> {
    addListener(listener: T): void;
    removeListener(listener: T): void;
    hasListener(listener: T): boolean;
    listeners: T[];
    /** Ruft alle Listener auf und liefert deren Rückgabewerte. */
    trigger(...args: Parameters<T>): unknown[];
}

export function createMockEvent<T extends (...args: never[]) => unknown>(): MockEvent<T> {
    const listeners: T[] = [];
    return {
        listeners,
        addListener(listener: T): void {
            listeners.push(listener);
        },
        removeListener(listener: T): void {
            const index = listeners.indexOf(listener);
            if (index >= 0) {
                listeners.splice(index, 1);
            }
        },
        hasListener(listener: T): boolean {
            return listeners.includes(listener);
        },
        trigger(...args: Parameters<T>): unknown[] {
            // Kopie, damit remove/add während des Triggerns nicht stört
            return [...listeners].map((listener) => listener(...args));
        },
    };
}

type StorageValue = unknown;
type StorageChanges = Record<string, { oldValue?: StorageValue; newValue?: StorageValue }>;

export interface MockStorageArea {
    data: Map<string, StorageValue>;
    get(keys?: null | string | string[] | Record<string, StorageValue>): Promise<Record<string, StorageValue>>;
    set(items: Record<string, StorageValue>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    clear(): Promise<void>;
}

export interface BrowserMock {
    storage: {
        sync: MockStorageArea;
        local: MockStorageArea;
        onChanged: MockEvent<(changes: StorageChanges, areaName: string) => void>;
    };
    runtime: {
        id: string;
        lastError: undefined;
        getURL(path: string): string;
        getManifest(): { version: string; short_name: string; name: string };
        openOptionsPage(): Promise<void>;
        onMessage: MockEvent<(message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => unknown>;
        onInstalled: MockEvent<() => void>;
        /** Routet wie der echte Browser an onMessage-Listener (inkl. `return true`-Pattern). */
        sendMessage(message: unknown): Promise<unknown>;
        openOptionsPageCalls: number;
    };
    i18n: {
        getMessage(key: string, substitutions?: string | string[]): string;
        getUILanguage(): string;
        /** Testseitig befüllbar; Fallback ist der Key selbst. */
        messages: Map<string, string>;
    };
    tabs: {
        list: Array<{ id: number; url: string; windowId: number; active: boolean }>;
        create(props: { url: string }): Promise<{ id: number; url: string }>;
        query(query: Record<string, unknown>): Promise<Array<{ id: number; url: string; windowId: number; active: boolean }>>;
        get(tabId: number): Promise<{ id: number; url: string; windowId: number; active: boolean }>;
        sendMessage(tabId: number, message: unknown, options?: unknown): Promise<unknown>;
        onUpdated: MockEvent<(tabId: number, changeInfo: Record<string, unknown>, tab: unknown) => void>;
        onActivated: MockEvent<(activeInfo: { tabId: number }) => void>;
        onRemoved: MockEvent<(tabId: number) => void>;
        sentMessages: Array<{ tabId: number; message: unknown }>;
    };
    action: {
        badges: Map<number, { text?: string; color?: string | number[] }>;
        setBadgeText(details: { tabId?: number; text: string }): Promise<void>;
        setBadgeBackgroundColor(details: { tabId?: number; color: string | number[] }): Promise<void>;
    };
    notifications: {
        created: Array<Record<string, unknown>>;
        create(options: Record<string, unknown>): Promise<string>;
        onClicked: MockEvent<(notificationId: string) => void>;
    };
    contextMenus: {
        entries: Array<Record<string, unknown>>;
        create(props: Record<string, unknown>): string;
        removeAll(): Promise<void>;
        onClicked: MockEvent<(info: Record<string, unknown>, tab: unknown) => void>;
    };
    windows: {
        created: Array<Record<string, unknown>>;
        updated: Array<{ windowId: number; info: Record<string, unknown> }>;
        create(options: Record<string, unknown>): Promise<{ id: number; tabs: Array<{ id: number }> }>;
        remove(windowId: number): Promise<void>;
        update(windowId: number, info: Record<string, unknown>): Promise<void>;
        getCurrent(): Promise<{ id: number; left: number; top: number; width: number; height: number }>;
        getLastFocused(): Promise<{ id: number; left: number; top: number; width: number; height: number }>;
        onRemoved: MockEvent<(windowId: number) => void>;
    };
    webRequest: {
        onResponseStarted: MockEvent<(details: Record<string, unknown>) => void> & { addListenerArgs: unknown[][] };
        onHeadersReceived: MockEvent<(details: Record<string, unknown>) => unknown> & { addListenerArgs: unknown[][] };
        getSecurityInfo?: (requestId: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    webNavigation: {
        onBeforeNavigate: MockEvent<(details: { tabId: number; url: string; frameId: number }) => void>;
    };
}

function createStorageArea(areaName: string, onChanged: MockEvent<(changes: StorageChanges, areaName: string) => void>): MockStorageArea {
    const data = new Map<string, StorageValue>();
    return {
        data,
        async get(keys?: null | string | string[] | Record<string, StorageValue>): Promise<Record<string, StorageValue>> {
            const result: Record<string, StorageValue> = {};
            if (keys === undefined || keys === null) {
                for (const [key, value] of data) {
                    result[key] = value;
                }
            } else if (typeof keys === 'string') {
                if (data.has(keys)) {
                    result[keys] = data.get(keys);
                }
            } else if (Array.isArray(keys)) {
                for (const key of keys) {
                    if (data.has(key)) {
                        result[key] = data.get(key);
                    }
                }
            } else {
                for (const [key, fallback] of Object.entries(keys)) {
                    result[key] = data.has(key) ? data.get(key) : fallback;
                }
            }
            return result;
        },
        async set(items: Record<string, StorageValue>): Promise<void> {
            const changes: StorageChanges = {};
            for (const [key, value] of Object.entries(items)) {
                changes[key] = { oldValue: data.get(key), newValue: value };
                data.set(key, value);
            }
            onChanged.trigger(changes, areaName);
        },
        async remove(keys: string | string[]): Promise<void> {
            const changes: StorageChanges = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                if (data.has(key)) {
                    changes[key] = { oldValue: data.get(key) };
                    data.delete(key);
                }
            }
            if (Object.keys(changes).length > 0) {
                onChanged.trigger(changes, areaName);
            }
        },
        async clear(): Promise<void> {
            data.clear();
        },
    };
}

function createEventWithArgCapture<T extends (...args: never[]) => unknown>(): MockEvent<T> & { addListenerArgs: unknown[][] } {
    const base = createMockEvent<T>();
    const addListenerArgs: unknown[][] = [];
    const originalAdd = base.addListener.bind(base);
    return Object.assign(base, {
        addListenerArgs,
        addListener(listener: T, ...rest: unknown[]): void {
            addListenerArgs.push(rest);
            originalAdd(listener);
        },
    });
}

export function createBrowserMock(): BrowserMock {
    const storageChanged = createMockEvent<(changes: StorageChanges, areaName: string) => void>();
    let nextTabId = 100;
    let nextWindowId = 500;

    const mock: BrowserMock = {
        storage: {
            sync: createStorageArea('sync', storageChanged),
            local: createStorageArea('local', storageChanged),
            onChanged: storageChanged,
        },
        runtime: {
            id: 'test-extension-id',
            lastError: undefined,
            getURL: (path: string) => `chrome-extension://test-extension-id/${path.replace(/^\//, '')}`,
            getManifest: () => ({ version: '5.1.0', short_name: 'Aionda Mail', name: 'Aionda Mail Test' }),
            openOptionsPageCalls: 0,
            async openOptionsPage(): Promise<void> {
                mock.runtime.openOptionsPageCalls++;
            },
            onMessage: createMockEvent(),
            onInstalled: createMockEvent(),
            sendMessage(message: unknown): Promise<unknown> {
                return new Promise((resolve) => {
                    let async = false;
                    for (const listener of mock.runtime.onMessage.listeners) {
                        const result = listener(message as never, { id: 'test-sender' } as never, resolve as never);
                        if (result === true) {
                            async = true;
                        }
                    }
                    if (!async) {
                        resolve(undefined);
                    }
                });
            },
        },
        i18n: {
            messages: new Map<string, string>(),
            getMessage(key: string, substitutions?: string | string[]): string {
                const template = mock.i18n.messages.get(key) ?? key;
                const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
                return subs.reduce((text, sub, index) => text.replace(`$${index + 1}`, sub), template);
            },
            getUILanguage: () => 'de-DE',
        },
        tabs: {
            list: [],
            sentMessages: [],
            async create(props: { url: string }) {
                const tab = { id: nextTabId++, url: props.url, windowId: 1, active: true };
                mock.tabs.list.push(tab);
                return tab;
            },
            async query(query: Record<string, unknown>) {
                let result = mock.tabs.list;
                if (query['active']) {
                    result = result.filter((tab) => tab.active);
                }
                return result;
            },
            async get(tabId: number) {
                const tab = mock.tabs.list.find((entry) => entry.id === tabId);
                if (!tab) {
                    throw new Error(`No tab with id ${tabId}`);
                }
                return tab;
            },
            async sendMessage(tabId: number, message: unknown) {
                mock.tabs.sentMessages.push({ tabId, message });
                return undefined;
            },
            onUpdated: createMockEvent(),
            onActivated: createMockEvent(),
            onRemoved: createMockEvent(),
        },
        action: {
            badges: new Map(),
            async setBadgeText(details: { tabId?: number; text: string }): Promise<void> {
                const tabId = details.tabId ?? -1;
                mock.action.badges.set(tabId, { ...mock.action.badges.get(tabId), text: details.text });
            },
            async setBadgeBackgroundColor(details: { tabId?: number; color: string | number[] }): Promise<void> {
                const tabId = details.tabId ?? -1;
                mock.action.badges.set(tabId, { ...mock.action.badges.get(tabId), color: details.color });
            },
        },
        notifications: {
            created: [],
            async create(options: Record<string, unknown>): Promise<string> {
                mock.notifications.created.push(options);
                return `notification-${mock.notifications.created.length}`;
            },
            onClicked: createMockEvent(),
        },
        contextMenus: {
            entries: [],
            create(props: Record<string, unknown>): string {
                mock.contextMenus.entries.push(props);
                return String(props['id'] ?? mock.contextMenus.entries.length);
            },
            async removeAll(): Promise<void> {
                mock.contextMenus.entries.length = 0;
            },
            onClicked: createMockEvent(),
        },
        windows: {
            created: [],
            updated: [],
            async create(options: Record<string, unknown>) {
                mock.windows.created.push(options);
                return { id: nextWindowId++, tabs: [{ id: nextTabId++ }] };
            },
            async remove(windowId: number): Promise<void> {
                mock.windows.onRemoved.trigger(windowId);
            },
            async update(windowId: number, info: Record<string, unknown>): Promise<void> {
                mock.windows.updated.push({ windowId, info });
            },
            async getCurrent() {
                return { id: 1, left: 100, top: 50, width: 1280, height: 800 };
            },
            async getLastFocused() {
                return { id: 1, left: 100, top: 50, width: 1280, height: 800 };
            },
            onRemoved: createMockEvent(),
        },
        webRequest: {
            onResponseStarted: createEventWithArgCapture(),
            onHeadersReceived: createEventWithArgCapture(),
        },
        webNavigation: {
            onBeforeNavigate: createMockEvent(),
        },
    };
    return mock;
}

/**
 * Installiert einen frischen Mock als globalThis.browser + globalThis.chrome.
 * Vor jedem Modul-Import aufrufen (Module cachen `browser` beim Laden).
 */
export function installBrowserMock(): BrowserMock {
    const mock = createBrowserMock();
    (globalThis as Record<string, unknown>)['browser'] = mock;
    (globalThis as Record<string, unknown>)['chrome'] = mock;
    return mock;
}
