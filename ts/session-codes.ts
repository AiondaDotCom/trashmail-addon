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
