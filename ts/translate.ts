// Compatibility layer for browser and chrome
const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

document.addEventListener("DOMContentLoaded", () => {
    const numFormat = new Intl.NumberFormat();
    for (const elem of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
        const [rawStub, attr] = elem.dataset.i18n!.split("|", 2);
        const stub = rawStub!.split("?");
        const [key, formatNum] = stub[0]!.split("#");

        let text: string | undefined;
        if (key) {
            text = browser.i18n.getMessage(key, stub.slice(1));
        } else {
            text = formatNum;
        }

        if (formatNum !== undefined) {
            text = text!.replace(/\d+/g, numFormat.format as unknown as (substring: string) => string);
        }

        if (attr) {
            (elem as unknown as Record<string, unknown>)[attr] = text;
        } else {
            elem.insertAdjacentHTML("beforeend", text as string);
        }
    }
});

export {};
