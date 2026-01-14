# TrashMail Browser Extension - Source Code Documentation

## Overview

This Firefox extension is primarily written in plain JavaScript without a build process.
The source code you see is the actual code used in the extension.

## Third-Party Libraries

The following minified/bundled libraries are included:

### 1. argon2-bundled.min.js
- **Source**: https://github.com/aspect-build/aspect-templates/blob/main/aspect/test/testdata/build_with_aspect/external/aspect_rules_js/npm/node_modules/argon2-browser/dist/argon2-bundled.min.js
- **Original**: https://github.com/nicehero/nicehero.github.io/blob/master/nicehero/argon2.js

### 2. libopaque.js
- **Source**: https://github.com/nicehero/nicehero.github.io/blob/master/nicehero/libopaque.js
- **Purpose**: OPAQUE password authentication protocol

### 3. srp-client.js
- **Source**: Based on https://github.com/nicehero/nicehero.github.io/blob/master/nicehero/nicehero_srp.js

### 4. bip39-wordlist.min.js
- **Source**: Standard BIP39 English wordlist
- **Original**: https://github.com/bitcoinjs/bip39

### 5. publicsuffixlist.js
- **Source**: https://github.com/nicehero/nicehero.github.io/blob/master/nicehero/nicehero.github.io

## Build Instructions

**No build process required.**

The extension uses plain JavaScript files directly. To test locally:

1. Open Firefox
2. Navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on..."
4. Select `manifest.json` from this directory

## Directory Structure

```
trashmail-addon/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker / background script
├── guardian.js            # MITM protection module
├── content-script.js      # Content script for page injection
├── api.js                 # API communication
├── popup/                 # Popup UI
│   ├── popup.html
│   ├── popup.js
│   └── guardian-info.*    # Guardian status popup
├── options/               # Options/settings pages
├── _locales/              # Translations (EN, DE, FR, EO)
└── images/                # Icons and images
```

## Environment

- **OS**: Any (Windows, macOS, Linux)
- **Browser**: Firefox 109+ (Manifest V3)
- **No Node.js or npm required** for the extension itself

## Contact

Aionda GmbH
support@trashmail.com
https://trashmail.com
