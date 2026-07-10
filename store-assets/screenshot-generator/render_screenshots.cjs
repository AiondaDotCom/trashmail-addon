// Rendert die von gen_screenshots.py erzeugten HTML-Mockups als 1280x800-PNGs
// (Chrome-Web-Store-Format: 24-bit, kein Alpha).
//
// Usage: node render_screenshots.js
// Playwright wird aus src/node_modules oder dem Repo-Root-node_modules aufgeloest.
const fs = require('fs');
const path = require('path');

function resolvePlaywright() {
    const candidates = [
        path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright'),          // src/node_modules
        path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'playwright'),    // repo-root node_modules
        'playwright',
    ];
    for (const c of candidates) {
        try { return require(c); } catch { /* next */ }
    }
    throw new Error('playwright nicht gefunden - npm install playwright (oder im Repo-Root ausfuehren)');
}

const { chromium } = resolvePlaywright();
const SCREENS = path.join(__dirname, 'out', 'screens');
const manifest = JSON.parse(fs.readFileSync(path.join(SCREENS, 'manifest.json'), 'utf8'));

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    for (const item of manifest) {
        const outDir = path.join(SCREENS, 'png', item.lang);
        fs.mkdirSync(outDir, { recursive: true });
        await page.goto('file://' + item.html);
        await page.waitForTimeout(150);
        const out = path.join(outDir, `${item.lang}_${item.name}.png`);
        await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 800 } });
        console.log(out);
    }
    await browser.close();
})();
