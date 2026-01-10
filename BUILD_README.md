# TrashMail Browser Extension - Build Instructions

## No Build Required

This extension uses **plain JavaScript** - no build process, bundling, or minification is required for our own code.

All JavaScript files (except third-party libraries) are unminified source code that can be read directly.

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

## How to "Build"

Since no build is required:

1. Clone the repository
2. The extension is ready to load

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
- **Requirements**: None (no Node.js, npm, or build tools needed)
- **Browser**: Firefox 109+ or Chrome 88+

## Contact

- **Developer**: Aionda GmbH
- **Website**: https://trashmail.com
- **Support**: support@trashmail.com
