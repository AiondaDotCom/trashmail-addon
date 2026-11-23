import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserMock, type BrowserMock } from '../helpers/browser-mock';
import { stubCommonGlobals } from '../ui/_helpers';
import { refreshRealEmails, updateEmailSelect } from '../../ts/real-emails';

// #0e21f82b: Verhalten statt Textmarker; Erfolgs- und Fehlerantworten.
let mock: BrowserMock;
let api: ReturnType<typeof stubCommonGlobals>;
beforeEach(() => {
    mock = installBrowserMock();
    api = stubCommonGlobals();
    mock.storage.sync.data.set('username', 'tester');
    mock.storage.sync.data.set('password', 'tmpat_test');
    mock.storage.sync.data.set('default_email', 'old@test.invalid');
    mock.storage.local.data.set('session_id', 'existing');
    mock.storage.local.data.set('real_emails', ['old@test.invalid']);
});
describe('Adressliste aktualisieren', () => {
    it('ersetzt entfernte Adressen und den ungültigen Standard ohne Login', async () => {
        api.callAPI.mockResolvedValue({ data: { real_email_list: ['new@test.invalid'] } });
        const result = await refreshRealEmails();
        expect(result?.emails).toEqual(['new@test.invalid']);
        expect(mock.storage.local.data.get('real_emails')).toEqual(['new@test.invalid']);
        expect(mock.storage.sync.data.get('default_email')).toBe('vault');
        expect(api.loginWithStoredPat).not.toHaveBeenCalled();
        expect(api.callAPI).toHaveBeenCalledExactlyOnceWith({ cmd: 'list_real_emails', session_id: 'existing' });
    });
    it.each(['vault', 'new@test.invalid'])('erhält gültigen Standard %s', async (value) => {
        mock.storage.sync.data.set('default_email', value);
        api.callAPI.mockResolvedValue({ data: { real_email_list: ['new@test.invalid'] } });
        expect((await refreshRealEmails())?.defaultEmail).toBe(value);
    });
    it('akzeptiert eine leere bestätigte Liste', async () => {
        api.callAPI.mockResolvedValue({ data: { real_email_list: [] } });
        expect((await refreshRealEmails())?.emails).toEqual([]);
        expect(mock.storage.local.data.get('real_emails')).toEqual([]);
    });
    it.each([undefined, {}, [42]])('verwirft eine ungültige Antwort %j ohne Cacheverlust', async (raw) => {
        api.callAPI.mockResolvedValue({ data: { real_email_list: raw } });
        await expect(refreshRealEmails()).rejects.toThrow('invalid');
        expect(mock.storage.local.data.get('real_emails')).toEqual(['old@test.invalid']);
        expect(mock.storage.sync.data.get('default_email')).toBe('old@test.invalid');
    });
    it('meldet nur bei abgelehnter Sitzung einmal neu an', async () => {
        api.callAPI.mockRejectedValueOnce({ errorCode: 2 }).mockResolvedValueOnce({ data: { real_email_list: [] } });
        api.loginWithStoredPat.mockResolvedValue({ session_id: 'renewed' });
        expect((await refreshRealEmails())?.sessionId).toBe('renewed');
        expect(api.loginWithStoredPat).toHaveBeenCalledTimes(1);
        expect(api.callAPI).toHaveBeenLastCalledWith({ cmd: 'list_real_emails', session_id: 'renewed' });
    });
    it('startet bei Netzfehler keine Anmeldung und erhält den Cache', async () => {
        api.callAPI.mockRejectedValue(new Error('offline'));
        await expect(refreshRealEmails()).rejects.toThrow('offline');
        expect(api.loginWithStoredPat).not.toHaveBeenCalled();
        expect(mock.storage.local.data.get('real_emails')).toEqual(['old@test.invalid']);
    });
    it('schreibt nach Abmelden keine Antwort zurück', async () => {
        api.callAPI.mockImplementation(async () => {
            mock.storage.sync.data.delete('username');
            return { data: { real_email_list: ['new@test.invalid'] } };
        });
        expect(await refreshRealEmails()).toBeUndefined();
        expect(mock.storage.local.data.get('real_emails')).toEqual(['old@test.invalid']);
    });
    it('fragt ohne Konto nicht an', async () => {
        mock.storage.sync.data.delete('username');
        expect(await refreshRealEmails()).toBeUndefined();
        expect(api.callAPI).not.toHaveBeenCalled();
    });
    it('aktualisiert die sichtbare Liste und erhält eine gültige Benutzerauswahl', () => {
        const select = document.createElement('select');
        select.add(new Option('old', 'old@test.invalid'));
        updateEmailSelect(select, { emails: ['new@test.invalid'], defaultEmail: 'vault', sessionId: 's' });
        expect([...select.options].map(o => o.value)).toEqual(['vault', 'new@test.invalid']);
        expect(select.value).toBe('vault');
        select.value = 'new@test.invalid';
        updateEmailSelect(select, { emails: ['new@test.invalid', 'second@test.invalid'], defaultEmail: 'vault', sessionId: 's' });
        expect(select.value).toBe('new@test.invalid');
    });
});

it.each([
    ['options/options.html', '../../ts/options/options', 'default_email'],
    ['create-address/create-address.html', '../../ts/create-address/create-address', 'email'],
])('lädt beim Öffnen von %s die sichtbaren Adressen neu', async (html, module, selectId) => {
    const { loadHtmlBody, fireDomReady, tick, resetDocumentListeners, stubWindowNavigation } = await import('../ui/_helpers');
    vi.resetModules();
    resetDocumentListeners();
    loadHtmlBody(html);
    stubWindowNavigation();
    await import('../../ts/create-address/mailfaker');
    api.callAPI.mockResolvedValue({ data: { real_email_list: ['new@test.invalid'] } });
    await import(module);
    fireDomReady();
    await tick(8);
    const select = document.getElementById(selectId) as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['vault', 'new@test.invalid']);
    expect(select.value).toBe('vault');
    expect(mock.storage.local.data.get('real_emails')).toEqual(['new@test.invalid']);
});
