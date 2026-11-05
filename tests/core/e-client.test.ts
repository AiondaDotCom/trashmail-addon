/**
 * #329f963f Schlanker /e-Client der Erweiterung.
 *
 * Gegenserver aus denselben Bausteinen: Er entschlüsselt die Anfrage mit dem
 * privaten Server-Schlüssel (wie ApiEncryptionService), prüft Kopfzeilen und
 * Cookie-Modus und antwortet gepolstert (0xDEAD) + gzip + verschlüsselt.
 * Byte-genau gegen den echten Server ist der Weg zusätzlich live gemessen
 * (Dev, 05.11.2026: ai_assistant_public -> read_help(addresses)).
 */
import { gzipSync, gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
    EClient, TransportFehler, aesEntschluesseln, aesVerschluesseln, ausBase64, auspacken,
    entkapseln, hybridSchluesselpaar, kapseln, zuBase64,
} from "../../ts/e-client";

interface Aufruf { url: string; init: RequestInit }

function gepolstert(daten: Uint8Array): Uint8Array {
    const bucket = [256, 512, 1024, 2048, 4096].find((b) => b >= daten.length + 6)!;
    const out = new Uint8Array(bucket);
    out.set([0xde, 0xad, (daten.length >>> 24) & 255, (daten.length >>> 16) & 255, (daten.length >>> 8) & 255, daten.length & 255], 0);
    out.set(daten, 6);
    return out;
}

function gegenserver(opts: { unverschluesselt?: boolean } = {}) {
    const server = hybridSchluesselpaar();
    const aufrufe: Aufruf[] = [];
    let empfangen: Record<string, unknown> | null = null;
    const holen = (async (url: string, init: RequestInit) => {
        aufrufe.push({ url, init });
        if (url.includes("cmd=get_encryption_keys")) {
            return { json: async () => ({ success: true, session_id: "sitzung-abc", keys: [{ uuid: "k1", x25519_pub: zuBase64(server.x25519Pub), mlkem_pub: zuBase64(server.mlKemPub) }] }) };
        }
        const n = JSON.parse(String(init.body)) as Record<string, string>;
        const geheim = entkapseln(ausBase64(n.x25519_ciphertext!), ausBase64(n.mlkem_ciphertext!), server.x25519Priv, server.mlKemPriv);
        empfangen = JSON.parse(gunzipSync(await aesEntschluesseln(geheim, ausBase64(n.encrypted_payload!))).toString()) as Record<string, unknown>;
        if (opts.unverschluesselt) {return { json: async () => ({ success: true, msg: "Klartext" }) };}
        const antwort = gepolstert(gzipSync(JSON.stringify({ success: true, data: { content: "Hallo" } })));
        const k = kapseln(ausBase64(n.response_x25519_pub!), ausBase64(n.response_mlkem_pub!));
        return { json: async () => ({ encrypted_response: zuBase64(await aesVerschluesseln(k.geheim, antwort)), response_x25519_ciphertext: zuBase64(k.x25519Ct), response_mlkem_ciphertext: zuBase64(k.mlKemCt) }) };
    }) as unknown as typeof fetch;
    return { holen, aufrufe, empfangen: () => empfangen };
}

describe("EClient (/e der Erweiterung)", () => {
    it("Rundlauf: Anfrage kommt beim Server entschlüsselt an, Antwort wird entschlüsselt", async () => {
        const s = gegenserver();
        const antwort = await new EClient("https://mail.example", "de", s.holen).senden("ai_assistant_public", { kanal: "addon-firefox" });
        expect(antwort).toEqual({ success: true, data: { content: "Hallo" } });
        expect(s.empfangen()).toEqual({ cmd: "ai_assistant_public", lang: "de", kanal: "addon-firefox" });
    });

    it("WAECHTER: nie mit Cookie, die Sitzung aus get_encryption_keys geht bei /e als X-TrashMail-Session mit", async () => {
        const s = gegenserver();
        await new EClient("https://mail.example", "de", s.holen).senden("x", {});
        expect(s.aufrufe.map((a) => a.init.credentials)).toEqual(["omit", "omit"]);
        const e = s.aufrufe.find((a) => a.url.endsWith("/e"))!;
        expect((e.init.headers as Record<string, string>)["X-TrashMail-Session"]).toBe("sitzung-abc");
        expect(s.aufrufe[0]!.url).toBe("https://mail.example/?api=1&cmd=get_encryption_keys&lang=de");
    });

    it("WAECHTER: eine unverschlüsselte Antwort wird abgelehnt, nicht gelesen", async () => {
        const s = gegenserver({ unverschluesselt: true });
        await expect(new EClient("https://mail.example", "de", s.holen).senden("x", {})).rejects.toBeInstanceOf(TransportFehler);
    });

    it("Polster ohne gültige Bucketgröße wird nicht entfernt", async () => {
        const roh = new Uint8Array([0xde, 0xad, 0, 0, 0, 1, 42]);
        expect(await auspacken(roh)).toEqual(roh);
    });
});
