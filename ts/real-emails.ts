import { isSessionRejected } from "./session-codes";

interface RefreshedEmails {
    emails: string[];
    defaultEmail: string;
    sessionId: string;
}

/** #0e21f82b: Den Server beim Öffnen fragen, nicht den Login-Cache für aktuell halten. */
export async function refreshRealEmails(sessionId?: string): Promise<RefreshedEmails | undefined> {
    const browser = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
    const sync = await browser.storage.sync.get(["username", "password"]);
    if (!sync.username) { return undefined; }
    const local = await browser.storage.local.get("session_id");
    let session = sessionId ?? local.session_id as string | undefined;
    const login = async (): Promise<string> => {
        if (typeof sync.username !== "string" || typeof sync.password !== "string" || !sync.password) {
            throw new Error("Please sign in again in the extension settings.");
        }
        const response = isPAT(sync.password)
            ? await loginWithStoredPat(sync.username, sync.password)
            : await callAPI({ cmd: "login", "fe-login-user": sync.username, "fe-login-pass": sync.password });
        if (typeof response.session_id !== "string" || !response.session_id) {
            throw new Error("The server did not return a session.");
        }
        return response.session_id;
    };
    if (!session) { session = await login(); }
    let response: TmApiResponse;
    try {
        response = await callAPI({ cmd: "list_real_emails", session_id: session });
    } catch (error) {
        if (!isSessionRejected(error)) { throw error; }
        session = await login();
        response = await callAPI({ cmd: "list_real_emails", session_id: session });
    }
    const raw: unknown = response.data?.real_email_list ?? response.real_email_list;
    if (!Array.isArray(raw) || !raw.every((email): email is string => typeof email === "string")) {
        throw new Error("The server returned an invalid email address list.");
    }
    // Abmelden/Kontowechsel während der Anfrage darf keine alten Daten zurückschreiben.
    const current = await browser.storage.sync.get(["username", "password", "default_email"]);
    if (current.username !== sync.username || current.password !== sync.password) { return undefined; }
    const preferred = typeof current.default_email === "string" ? current.default_email : "vault";
    const defaultEmail = preferred === "vault" || raw.includes(preferred) ? preferred : "vault";
    await browser.storage.local.set({ real_emails: raw, session_id: session });
    if (defaultEmail !== preferred) { await browser.storage.sync.set({ default_email: defaultEmail }); }
    return { emails: raw, defaultEmail, sessionId: session };
}

/** Erhält eine inzwischen vom Nutzer getroffene, weiterhin gültige Auswahl. */
export function updateEmailSelect(select: HTMLSelectElement, refreshed: RefreshedEmails): void {
    const selected = select.value;
    const desired = selected === "vault" || refreshed.emails.includes(selected) ? selected : refreshed.defaultEmail;
    const browser = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
    select.replaceChildren(new Option(browser.i18n.getMessage("optionsInternalMailbox") || "Internal Mailbox", "vault"));
    for (const email of refreshed.emails) { select.add(new Option(email, email)); }
    select.value = desired;
}
