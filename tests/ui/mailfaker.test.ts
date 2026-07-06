import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface MailFakerInstance {
    locale: string;
    firstName(gender?: string): string;
    lastName(): string;
    fullName(gender?: string): string;
    localPart(gender?: string): string;
    domainPart(): string;
    fullAddress(gender?: string): string;
}
interface MailFakerCtor {
    new (locale?: string): MailFakerInstance;
    version: string;
}

async function loadMailFaker(): Promise<MailFakerCtor> {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>)['MailFaker'];
    await import('../../ts/create-address/mailfaker');
    return (globalThis as Record<string, unknown>)['MailFaker'] as MailFakerCtor;
}

describe('mailfaker.ts – MailFaker', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('publishes MailFaker on globalThis with a static version', async () => {
        const MailFaker = await loadMailFaker();
        expect(typeof MailFaker).toBe('function');
        expect(MailFaker.version).toBe('1.1.0');
    });

    it('uses the requested locale and falls back to "en" for unknown locales', async () => {
        const MailFaker = await loadMailFaker();
        expect(new MailFaker('de').locale).toBe('de');
        expect(new MailFaker('fr').locale).toBe('fr');
        expect(new MailFaker('xx').locale).toBe('en');
        expect(new MailFaker().locale).toBe('en');
        // Non-string locale hits the same fallback branch.
        expect(new MailFaker(42 as unknown as string).locale).toBe('en');
    });

    it('firstName respects the gender argument', async () => {
        const MailFaker = await loadMailFaker();
        const faker = new MailFaker('en');
        vi.spyOn(Math, 'random').mockReturnValue(0); // first element of each list

        expect(faker.firstName('female')).toBe('Lisa');
        expect(faker.firstName('male')).toBe('John');
        // No gender: picks one of the two lists, then an entry. With random=0 -> female[0].
        expect(faker.firstName()).toBe('Lisa');
    });

    it('lastName / fullName produce values from the locale data', async () => {
        const MailFaker = await loadMailFaker();
        const faker = new MailFaker('en');
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(faker.lastName()).toBe('Miller');
        expect(faker.fullName('male')).toBe('John Miller');
    });

    it('localPart is deterministic given Math.random (separator, number, order)', async () => {
        const MailFaker = await loadMailFaker();
        const faker = new MailFaker('en');
        // random=0.5 -> firstName/lastName mid entries, sep index floor(1.5)=1 -> '-',
        // num = floor(0.5*9000+1000)=5500, reverse = (0.5 < 0.5) = false -> name + sep + num
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const local = faker.localPart();
        expect(local).toMatch(/^[a-z]+-[a-z]+-5500$/);
    });

    it('localPart reverses order when random < 0.5', async () => {
        const MailFaker = await loadMailFaker();
        const faker = new MailFaker('en');
        // random=0 -> sep '.', num=1000, reverse (0 < 0.5) true -> num + sep + name
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(faker.localPart()).toMatch(/^1000\.[a-z]+\.[a-z]+$/);
    });

    it('domainPart combines a domain and a global TLD', async () => {
        const MailFaker = await loadMailFaker();
        const faker = new MailFaker('en');
        vi.spyOn(Math, 'random').mockReturnValue(0);
        // domains[0]='mailflare', globalTlds[0]='com'
        expect(faker.domainPart()).toBe('mailflare.com');
    });

    it('fullAddress is localPart@domainPart', async () => {
        const MailFaker = await loadMailFaker();
        const faker = new MailFaker('de');
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const addr = faker.fullAddress();
        expect(addr).toContain('@');
        const [local, domain] = addr.split('@');
        expect(local.length).toBeGreaterThan(0);
        expect(domain).toMatch(/\.[a-z]+$/);
    });
});
