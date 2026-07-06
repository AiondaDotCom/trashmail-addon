/**
 * Gemeinsamer Boot-Helfer: aktiviert Guardian (opt-in), stubbt fetch für
 * public_key.json (+ optionale Zusatzrouten), importiert das Modul frisch und
 * wartet bis die WebRequest-Listener registriert sind.
 *
 * Für den Firefox-Pfad muss der Aufrufer VOR bootGuardian()
 * `mock.webRequest.getSecurityInfo = ...` setzen, damit onHeadersReceived
 * registriert wird.
 */
import { vi } from 'vitest';

import type { BrowserMock } from './browser-mock';
import type { FetchRoute, FetchStub, KeyFile } from './guardian-fixtures';
import { makeFetch, publicKeyResponse, waitFor } from './guardian-fixtures';

export interface BootResult {
    fetchStub: FetchStub;
    /** Der registrierte onResponseStarted-Handler (processResponse). */
    processResponse(details: Record<string, unknown>): Promise<void>;
    /** Der registrierte onHeadersReceived-Handler (checkCertificate), falls Firefox. */
    checkCertificate(details: Record<string, unknown>): Promise<void>;
}

export async function bootGuardian(
    mock: BrowserMock,
    keyFile: KeyFile,
    extraRoutes: FetchRoute[] = [],
): Promise<BootResult> {
    const fetchStub = makeFetch([
        { test: (u) => u.includes('public_key.json'), response: () => publicKeyResponse(keyFile) },
        ...extraRoutes,
    ]);
    vi.stubGlobal('fetch', fetchStub);
    mock.storage.sync.data.set('guardian_enabled', '1');

    await import('../../ts/guardian');
    await waitFor(() => mock.webRequest.onResponseStarted.listeners.length > 0);

    const onResp = mock.webRequest.onResponseStarted.listeners[0] as unknown as (d: Record<string, unknown>) => Promise<void>;
    const onHeaders = mock.webRequest.onHeadersReceived.listeners[0] as unknown as (d: Record<string, unknown>) => Promise<void>;

    return {
        fetchStub,
        processResponse: (details) => onResp(details),
        checkCertificate: (details) => (onHeaders ? onHeaders(details) : Promise.resolve()),
    };
}

/** Baut ein OnResponseStarted-Details-Objekt mit Header-Liste. */
export function makeResponseDetails(
    tabId: number,
    url: string,
    headers: Record<string, string> = {},
): Record<string, unknown> {
    return {
        tabId,
        url,
        responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
    };
}
