/**
 * Woran das Addon erkennt, dass der Server eine gespeicherte session_id
 * ABLEHNT (abgelaufen, abgemeldet, nie gültig gewesen).
 *
 * Eine Stelle für alle Aufrufer (Hintergrundskript, create-address, welcome):
 * Bis 6.1.2 stand das Kriterium dreimal im Code, jeweils anders, und das
 * Hintergrundskript prüfte gar nicht erst - es meldete sich bei JEDEM
 * Aufwachen neu an (gemessen auf Prod am 03.11.2026: ~48.000 Anmeldungen am
 * Tag von ~766 Konten).
 *
 * Gemessen gegen Dev am 03.11.2026 (read_dea mit erfundener, mit
 * abgemeldeter und mit nur im Rumpf übergebener Sitzung): jedes Mal
 * `error_code` 2, „Nicht eingeloggt oder Session abgelaufen." Die Werte
 * stammen aus src/includes/config.php.
 */

/** ERROR_CODE_NOT_LOGGED_IN / ERROR_CODE_NO_SESSION (config.php). */
export const ERROR_CODE_NOT_LOGGED_IN = 2;
/** ERROR_CODE_AUTHENTICATION_ERROR (config.php). */
export const ERROR_CODE_AUTHENTICATION_ERROR = 61;

/** Fehlercodes, bei denen eine gespeicherte Sitzung als abgelehnt gilt. */
export const SESSION_REJECTED_CODES: readonly number[] = [ERROR_CODE_NOT_LOGGED_IN, ERROR_CODE_AUTHENTICATION_ERROR];

/** true, wenn der Fehler eines callAPI-Aufrufs „Sitzung abgelehnt" bedeutet. */
export function isSessionRejected(error: unknown): boolean {
    const code = (error as { errorCode?: unknown } | null | undefined)?.errorCode;
    return typeof code === "number" && SESSION_REJECTED_CODES.includes(code);
}

/**
 * Sperre für die Anmeldung des HINTERGRUNDSKRIPTS nach einem Fehlschlag.
 *
 * Ohne sie meldete sich das Hintergrundskript bei falschem oder geändertem
 * Passwort, bei 2FA-Pflicht oder bei Ratenbegrenzung (429) bei jedem
 * Aufwachen erneut an - jeder Fehlversuch zählt serverseitig in
 * mail_login_attempts und kann den Nutzer aussperren (Abnahme von 3d946a9,
 * Probe des Prüfers: 3 Aufwachen → 3 Anmeldungen).
 *
 * Der Merker liegt in storage.local, damit er das Entladen des
 * Hintergrundskripts überlebt. Aufgehoben wird er
 *   - wenn die gespeicherten Zugangsdaten sich ändern (storage.onChanged
 *     auf username/password im Hintergrundskript),
 *   - bei jeder erfolgreichen manuellen Anmeldung (welcome.ts),
 *   - nach Ablauf der Wartezeit.
 * Manuelle Anmeldungen (Optionen/Popup/create-address) prüfen ihn nie.
 */
export const BACKGROUND_LOGIN_BLOCK_KEY = "background_login_block";

/** Wartezeit nach einer Ablehnung durch den Server (falsches Passwort, 2FA, 429 …). */
export const BLOCK_AFTER_SERVER_REJECTION_MS = 6 * 60 * 60 * 1000;
/**
 * Wartezeit, wenn die Anmeldung den Server gar nicht erreicht hat (offline,
 * DNS, abgebrochene Verbindung). Ein solcher Versuch zählt serverseitig
 * nicht, deshalb kürzer.
 */
export const BLOCK_AFTER_NETWORK_ERROR_MS = 15 * 60 * 1000;

export interface BackgroundLoginBlock {
    until: number;
    error_code?: number;
    http_status?: number;
}

/** Sperrvermerk für einen fehlgeschlagenen Hintergrund-Login zum Zeitpunkt `now` (ms). */
export function backgroundLoginBlockFor(error: unknown, now: number): BackgroundLoginBlock {
    const err = (error ?? {}) as { errorCode?: unknown; httpStatus?: unknown; remainingSeconds?: unknown; requires_2fa?: unknown };
    const errorCode = typeof err.errorCode === "number" ? err.errorCode : undefined;
    const httpStatus = typeof err.httpStatus === "number" ? err.httpStatus : undefined;
    const reachedServer = errorCode !== undefined || httpStatus !== undefined || err.requires_2fa === true;

    let waitMs = reachedServer ? BLOCK_AFTER_SERVER_REJECTION_MS : BLOCK_AFTER_NETWORK_ERROR_MS;
    if (httpStatus === 429 && typeof err.remainingSeconds === "number" && err.remainingSeconds * 1000 > waitMs) {
        waitMs = err.remainingSeconds * 1000;
    }
    const block: BackgroundLoginBlock = { until: now + waitMs };
    if (errorCode !== undefined) { block.error_code = errorCode; }
    if (httpStatus !== undefined) { block.http_status = httpStatus; }
    return block;
}

/** true, solange ein gespeicherter Sperrvermerk zum Zeitpunkt `now` gilt. */
export function isBackgroundLoginBlocked(stored: unknown, now: number): boolean {
    const until = (stored as { until?: unknown } | null | undefined)?.until;
    return typeof until === "number" && now < until;
}
