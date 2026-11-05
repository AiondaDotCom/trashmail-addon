/**
 * #329f963f Schlanker /e-Client der Erweiterung (verschlüsselter Weg).
 *
 * Bis 6.1.6 hatte die Erweiterung keinen /e-Client. Neue Endpunkte gibt es
 * aber nur noch über /e (Post-Quantum-Verschlüsselung in beide Richtungen,
 * CloudFlare sieht nur `POST /e`). Der Client des Managers
 * (`src/typescript/manager/encrypted-api-client.ts`) zieht Fehlerbehandlung,
 * Sentry und Postfach-Zustand mit sich, deshalb hier ein eigener, kleiner
 * Nachbau DESSELBEN Protokolls:
 *
 *   Anfrage:  gzip(JSON) → AES-256-GCM mit HKDF-SHA256(X25519 ‖ ML-KEM-1024,
 *             info "trashmail-hybrid-kem-v1") gegen einen Server-Schlüssel
 *             aus get_encryption_keys; Format nonce(12) ‖ tag(16) ‖ ciphertext.
 *   Antwort:  derselbe Aufbau gegen ein Schlüsselpaar, das NUR für diese
 *             Anfrage erzeugt wird; danach Bucket-Polster (0xDEAD) und gzip.
 *
 * Zwei Abweichungen vom Manager-Client, beide gewollt:
 *   - feste Adresse statt relativer Pfade (die Erweiterungsseite liegt unter
 *     moz-extension:// bzw. chrome-extension://);
 *   - `credentials: "omit"`: Mit Cookie verwirft Firefox ohne Host-Berechtigung
 *     die Anfrage an der CORS-Vorabanfrage (#48779b5c).
 *
 * Kein Rückfall auf einen unverschlüsselten Weg: Eine Antwort ohne
 * verschlüsselten Inhalt ist ein Fehler.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha256.js";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";

const HKDF_INFO = new TextEncoder().encode("trashmail-hybrid-kem-v1");
const PADDING_BUCKETS = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216];

export interface ServerSchluessel {
    uuid: string;
    x25519_pub: string;
    mlkem_pub: string;
}

/** Fehler des Transports (nicht des Kommandos): kein Server, kaputte Antwort. */
export class TransportFehler extends Error {
    constructor(meldung: string, readonly ursache?: unknown) {
        super(meldung);
        this.name = "TransportFehler";
    }
}

export function zuBase64(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) {s += String.fromCharCode(b);}
    return btoa(s);
}

export function ausBase64(text: string): Uint8Array {
    let t = text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4 !== 0) {t += "=";}
    const bin = atob(t);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {out[i] = bin.charCodeAt(i);}
    return out;
}

function kopie(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const neu = new Uint8Array(new ArrayBuffer(bytes.length));
    neu.set(bytes);
    return neu;
}

function gemeinsam(x25519Geteilt: Uint8Array, mlKemGeteilt: Uint8Array): Uint8Array {
    const zusammen = new Uint8Array(x25519Geteilt.length + mlKemGeteilt.length);
    zusammen.set(x25519Geteilt, 0);
    zusammen.set(mlKemGeteilt, x25519Geteilt.length);
    return hkdf(sha256, zusammen, undefined, HKDF_INFO, 32);
}

/** Kapselt gegen einen öffentlichen Hybrid-Schlüssel. */
export function kapseln(x25519Pub: Uint8Array, mlKemPub: Uint8Array): { x25519Ct: Uint8Array; mlKemCt: Uint8Array; geheim: Uint8Array } {
    const ephemer = x25519.utils.randomSecretKey();
    const x25519Geteilt = x25519.getSharedSecret(ephemer, x25519Pub);
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(mlKemPub);
    return { x25519Ct: x25519.getPublicKey(ephemer), mlKemCt: cipherText, geheim: gemeinsam(x25519Geteilt, sharedSecret) };
}

/** Entkapselt mit dem eigenen privaten Hybrid-Schlüssel. */
export function entkapseln(x25519Ct: Uint8Array, mlKemCt: Uint8Array, x25519Priv: Uint8Array, mlKemPriv: Uint8Array): Uint8Array {
    return gemeinsam(x25519.getSharedSecret(x25519Priv, x25519Ct), ml_kem1024.decapsulate(mlKemCt, mlKemPriv));
}

export function hybridSchluesselpaar(): { x25519Priv: Uint8Array; x25519Pub: Uint8Array; mlKemPriv: Uint8Array; mlKemPub: Uint8Array } {
    const x25519Priv = x25519.utils.randomSecretKey();
    const saat = crypto.getRandomValues(new Uint8Array(64));
    const ml = ml_kem1024.keygen(saat);
    return { x25519Priv, x25519Pub: x25519.getPublicKey(x25519Priv), mlKemPriv: ml.secretKey, mlKemPub: ml.publicKey };
}

/** AES-256-GCM im Serverformat nonce(12) ‖ tag(16) ‖ ciphertext. */
export async function aesVerschluesseln(geheim: Uint8Array, klartext: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const schluessel = await crypto.subtle.importKey("raw", kopie(geheim), "AES-GCM", false, ["encrypt"]);
    const roh = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, schluessel, kopie(klartext)));
    const tag = roh.slice(roh.length - 16);
    const daten = roh.slice(0, roh.length - 16);
    const out = new Uint8Array(28 + daten.length);
    out.set(iv, 0);
    out.set(tag, 12);
    out.set(daten, 28);
    return out;
}

export async function aesEntschluesseln(geheim: Uint8Array, paket: Uint8Array): Promise<Uint8Array> {
    if (paket.length < 28) {throw new TransportFehler("Antwort zu kurz");}
    const iv = paket.slice(0, 12);
    const tag = paket.slice(12, 28);
    const daten = paket.slice(28);
    const zusammen = new Uint8Array(daten.length + 16);
    zusammen.set(daten, 0);
    zusammen.set(tag, daten.length);
    const schluessel = await crypto.subtle.importKey("raw", kopie(geheim), "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, schluessel, zusammen));
}

async function strom(daten: Uint8Array, art: "gzip-ein" | "gzip-aus"): Promise<Uint8Array> {
    const s = art === "gzip-ein" ? new CompressionStream("gzip") : new DecompressionStream("gzip");
    const schreiber = s.writable.getWriter();
    void schreiber.write(kopie(daten));
    void schreiber.close();
    return new Uint8Array(await new Response(s.readable).arrayBuffer());
}

/** Bucket-Polster (0xDEAD, Länge big-endian) entfernen, dann gzip auspacken. */
export async function auspacken(daten: Uint8Array): Promise<Uint8Array> {
    let d = daten;
    if (d.length >= 6 && d[0] === 0xde && d[1] === 0xad && PADDING_BUCKETS.includes(d.length)) {
        const laenge = (((d[2] ?? 0) << 24) | ((d[3] ?? 0) << 16) | ((d[4] ?? 0) << 8) | (d[5] ?? 0)) >>> 0;
        if (laenge <= d.length - 6) {d = d.slice(6, 6 + laenge);}
    }
    if (d.length >= 2 && d[0] === 0x1f && d[1] === 0x8b) {
        d = await strom(d, "gzip-aus");
    }
    return d;
}

export class EClient {
    private schluessel: ServerSchluessel[] = [];
    /**
     * Die Server-Schlüssel sind an die PHP-Sitzung gebunden, die sie ausgegeben
     * hat ("Key belongs to different session"). Ohne Cookie erfahren wir die
     * Kennung aus der Antwort von get_encryption_keys und schicken sie danach
     * als X-TrashMail-Session mit (gemessen gegen Dev am 05.11.2026).
     */
    private sitzung = "";

    constructor(private readonly basis: string, private readonly sprache: string, private readonly holen: typeof fetch = fetch.bind(globalThis)) {}

    async initialisieren(anzahl = 5): Promise<void> {
        let antwort: Response;
        try {
            antwort = await this.holen(`${this.basis}/?api=1&cmd=get_encryption_keys&lang=${encodeURIComponent(this.sprache)}`, {
                method: "POST", credentials: "omit", headers: this.kopfzeilen(), body: JSON.stringify({ count: anzahl }),
            });
        } catch (fehler) {
            throw new TransportFehler("Server nicht erreichbar", fehler);
        }
        const json = await antwort.json() as { success?: boolean; keys?: ServerSchluessel[]; session_id?: string };
        if (typeof json.session_id === "string" && json.session_id !== "") {
            this.sitzung = json.session_id;
        }
        if (!json.success || !Array.isArray(json.keys) || json.keys.length === 0) {
            throw new TransportFehler("Keine Schlüssel für den verschlüsselten Weg");
        }
        this.schluessel.push(...json.keys);
    }

    private kopfzeilen(): Record<string, string> {
        const k: Record<string, string> = { "Content-Type": "application/json" };
        if (this.sitzung) {k["X-TrashMail-Session"] = this.sitzung;}
        return k;
    }

    /** Schickt ein Kommando über /e und liefert die entschlüsselte Antwort. */
    async senden(cmd: string, parameter: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (this.schluessel.length === 0) {await this.initialisieren();}
        const schluessel = this.schluessel.shift()!;
        const eigen = hybridSchluesselpaar();
        const klartext = await strom(new TextEncoder().encode(JSON.stringify({ cmd, lang: this.sprache, ...parameter })), "gzip-ein");
        const kapsel = kapseln(ausBase64(schluessel.x25519_pub), ausBase64(schluessel.mlkem_pub));
        const nutzlast = {
            encrypted_payload: zuBase64(await aesVerschluesseln(kapsel.geheim, klartext)),
            key_uuid: schluessel.uuid,
            x25519_ciphertext: zuBase64(kapsel.x25519Ct),
            mlkem_ciphertext: zuBase64(kapsel.mlKemCt),
            response_x25519_pub: zuBase64(eigen.x25519Pub),
            response_mlkem_pub: zuBase64(eigen.mlKemPub),
        };
        let antwort: Response;
        try {
            antwort = await this.holen(`${this.basis}/e`, { method: "POST", credentials: "omit", headers: this.kopfzeilen(), body: JSON.stringify(nutzlast) });
        } catch (fehler) {
            throw new TransportFehler("Server nicht erreichbar", fehler);
        }
        const json = await antwort.json() as Record<string, unknown>;
        if (typeof json.encrypted_response !== "string" || typeof json.response_x25519_ciphertext !== "string" || typeof json.response_mlkem_ciphertext !== "string") {
            // Kein stiller Rückfall: unverschlüsselte Antworten werden nie gelesen.
            throw new TransportFehler("Antwort war nicht verschlüsselt");
        }
        const geheim = entkapseln(ausBase64(json.response_x25519_ciphertext), ausBase64(json.response_mlkem_ciphertext), eigen.x25519Priv, eigen.mlKemPriv);
        const klar = await auspacken(await aesEntschluesseln(geheim, ausBase64(json.encrypted_response)));
        return JSON.parse(new TextDecoder().decode(klar)) as Record<string, unknown>;
    }
}
