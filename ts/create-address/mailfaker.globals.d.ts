/**
 * Globals produced by create-address/mailfaker.ts and consumed by
 * create-address/create-address.ts.
 *
 * mailfaker.ts defines a `class MailFaker` and publishes it via
 * `Object.assign(globalThis, { MailFaker })`. Ambient (script-scope) file; do
 * NOT add import/export here.
 *
 * (org_domain is declared in options/welcome.globals.d.ts and is visible here
 * too, since ambient declarations are program-wide.)
 */

/** Instance surface of MailFaker (fake German/English/French identity data). */
interface MailFakerInstance {
    readonly locale: string;
    firstName(gender?: string): string;
    lastName(): string;
    fullName(gender?: string): string;
    localPart(gender?: string): string;
    domainPart(): string;
    fullAddress(gender?: string): string;
}

/** Constructor surface of MailFaker. */
interface MailFakerConstructor {
    new (locale?: string): MailFakerInstance;
    readonly version: string;
}

declare const MailFaker: MailFakerConstructor;
