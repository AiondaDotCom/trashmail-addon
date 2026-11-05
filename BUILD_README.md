# TrashMail Browser Extension - Build Instructions

## Build from source

Our own code is written in TypeScript (`ts/`) and bundled with esbuild into the
shipped `.js` files. The bundles are **not minified**. Required: Node.js 20+ and npm.

```sh
npm ci            # installs exactly the versions in package-lock.json
npm run build     # esbuild ts/... --bundle --format=iife --target=es2020 --outdir=. --outbase=ts
```

Recent npm versions may report that esbuild's `postinstall` script was not approved;
the build works without it (the platform binary comes from esbuild's optional
dependencies, e.g. `@esbuild/darwin-arm64`).

This rebuilds `api.js`, `guardian.js`, `background.js`, `content-script.js`,
`translate.js`, `popup/popup.js`, `popup/guardian-info.js`, `options/options.js`,
`options/welcome.js`, `create-address/create-address.js`,
`create-address/mailfaker.js` and `help/ki-hilfe.js`.

The only difference to the submitted files are esbuild's path comments: our release
build runs from the parent directory, so they read `// trashmail-addon/ts/api.ts`
instead of `// ts/api.ts`. Code is identical (checked for all 12 files on 05.11.2026).

### Bundled npm packages (open source, MIT)

`help/ki-hilfe.js` (the "Ask AI" help window) contains, unmodified:

- `@noble/post-quantum` 0.5.4 (ML-KEM-1024) - https://github.com/paulmillr/noble-post-quantum
- `@noble/curves` 2.0.1 (X25519) - https://github.com/paulmillr/noble-curves
- `@noble/hashes` 1.8.0 and 2.0.1 (SHA-256, HKDF, SHA-3) - https://github.com/paulmillr/noble-hashes

They encrypt the help requests end to end (X25519 + ML-KEM-1024, AES-256-GCM).

## Directory Structure

```
trashmail-addon/
├── manifest.json           # Extension manifest (Firefox)
├── manifest_chrome.json    # Chrome variant
├── manifest_firefox.json   # Firefox variant (backup)
├── background.js           # Background script (source)
├── api.js                  # API client (source)
├── translate.js            # i18n helper (source)
├── content-script.js       # Content script (source)
├── publicsuffixlist.js     # Domain helper (source)
├── srp-client.js           # SRP authentication (source)
├── opaque-client.js        # OPAQUE authentication (source)
├── popup/                  # Popup UI (source)
├── options/                # Options/Settings UI (source)
├── create-address/         # Create address UI (source)
├── _locales/               # Translations (JSON)
└── images/                 # Icons
```

## Third-Party Libraries (Open Source)

These are external open-source libraries, not our code:

### 1. argon2-bundled.min.js
- **Purpose**: Argon2 password hashing (WASM)
- **Source**: https://github.com/nickvergessen/argon2-wasm
- **License**: MIT

### 2. libopaque.js
- **Purpose**: OPAQUE zero-knowledge authentication protocol (WASM)
- **Source**: https://github.com/nickvergessen/libopaque
- **License**: MIT

These libraries are pre-compiled WASM binaries. The original source repositories are linked above.

## Load the extension

### Load in Firefox:
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json`

### Load in Chrome:
1. Rename `manifest_chrome.json` to `manifest.json`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the extension directory

## Environment

- **OS**: Any (Windows, macOS, Linux)
- **Requirements**: Node.js 20+ and npm, only to rebuild the bundles (see above)
- **Browser**: Firefox 109+ or Chrome 88+

## Contact

- **Developer**: Aionda GmbH
- **Website**: https://mail.aionda.com
- **Support**: support@aionda.com
