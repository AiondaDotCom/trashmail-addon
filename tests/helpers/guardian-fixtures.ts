/**
 * Fixtures für die Guardian-Tests: echtes Ed25519-Signing (Node WebCrypto),
 * ein fetch-Router mit echten Response-Objekten und kleine Warte-Helfer.
 *
 * Diese Datei ist KEIN *.test.ts und wird daher nicht als Suite ausgeführt.
 */
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';

const subtle: SubtleCrypto = (globalThis.crypto?.subtle ?? (webcrypto as unknown as Crypto).subtle);

export interface KeyFileEntry {
    algorithm?: string;
    public_key: string;
    valid_from: string;
    warn_after: string | null;
    valid_until: string;
}

export interface KeyFile {
    keys: Record<string, KeyFileEntry>;
    current_key_id?: string;
}

export interface GeneratedKey {
    keyId: string;
    keyPair: CryptoKeyPair;
    keyFile: KeyFile;
    /** Signiert `data` mit dem privaten Ed25519-Key und liefert Base64. */
    sign(data: string): Promise<string>;
}

function toBase64(buffer: ArrayBuffer): string {
    return Buffer.from(new Uint8Array(buffer)).toString('base64');
}

/**
 * Erzeugt ein echtes Ed25519-Schlüsselpaar und baut ein public_key.json im
 * Original-Format (SPKI-DER Base64), das guardian.ts importieren kann.
 */
export async function generateSigningKey(opts?: {
    keyId?: string;
    validFrom?: string;
    validUntil?: string;
    warnAfter?: string | null;
}): Promise<GeneratedKey> {
    const keyId = opts?.keyId ?? 'test-key';
    const keyPair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const spki = await subtle.exportKey('spki', keyPair.publicKey);

    const entry: KeyFileEntry = {
        algorithm: 'Ed25519',
        public_key: toBase64(spki),
        valid_from: opts?.validFrom ?? '2020-01-01T00:00:00Z',
        warn_after: opts?.warnAfter ?? null,
        valid_until: opts?.validUntil ?? '2999-01-01T00:00:00Z',
    };

    const keyFile: KeyFile = { keys: { [keyId]: entry }, current_key_id: keyId };

    return {
        keyId,
        keyPair,
        keyFile,
        async sign(data: string): Promise<string> {
            const sig = await subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, new TextEncoder().encode(data));
            return toBase64(sig);
        },
    };
}

export interface FetchRoute {
    test(url: string): boolean;
    response(url: string): Response | Promise<Response>;
}

export interface FetchStub {
    (input: unknown, init?: unknown): Promise<Response>;
    calls: string[];
    countMatching(predicate: (url: string) => boolean): number;
}

/**
 * Baut einen vi.fn()-fetch-Stub, der Requests anhand von Routen beantwortet
 * und alle aufgerufenen URLs mitschreibt. Nutzt echte Response-Objekte
 * (Node 22), damit .json()/.text()/.headers wie im Browser funktionieren.
 */
export function makeFetch(routes: FetchRoute[]): FetchStub {
    const calls: string[] = [];
    const fn = vi.fn(async (input: unknown): Promise<Response> => {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
        calls.push(url);
        for (const route of routes) {
            if (route.test(url)) {
                return route.response(url);
            }
        }
        throw new Error(`Unhandled fetch in test: ${url}`);
    });
    return Object.assign(fn as unknown as FetchStub, {
        calls,
        countMatching: (predicate: (url: string) => boolean): number => calls.filter(predicate).length,
    });
}

/** Response im public_key.json-Format. */
export function publicKeyResponse(keyFile: KeyFile): Response {
    return new Response(JSON.stringify(keyFile), { status: 200 });
}

/** Wartet, bis `cond()` wahr ist (Polling über Makrotasks). */
export async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
    for (let i = 0; i < tries; i++) {
        if (cond()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error('waitFor: Bedingung wurde nicht erfüllt (Timeout)');
}

/** Lässt anstehende Microtasks/Makrotasks durchlaufen. */
export async function tick(times = 3): Promise<void> {
    for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}
