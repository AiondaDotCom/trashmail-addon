#!/bin/bash
#
# Build ZIP packages for Chrome and Firefox
# Usage:
#   ./build.sh chrome    - Chrome ZIP
#   ./build.sh firefox   - Firefox ZIP
#   ./build.sh all       - Both ZIPs
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")

# Files/dirs to exclude from ZIP
EXCLUDE=(
    "manifest_firefox.json"
    "manifest_chrome.json"
    "build.sh"
    "BUILD_README.md"
    "SOURCE_README.md"
    "README.md"
    "LICENSE"
    "update_suffixes.py"
    ".git"
    ".DS_Store"
)

build_exclude_args() {
    local args=""
    for item in "${EXCLUDE[@]}"; do
        args="$args -x ./$item"
    done
    echo "$args"
}

build_chrome() {
    local outfile="trashmail-chrome-${VERSION}.zip"
    echo "Building Chrome ZIP: $outfile"

    # Current manifest.json is Chrome (service_worker)
    # Backup and ensure Chrome manifest is active
    if grep -q '"service_worker"' manifest.json; then
        echo "  manifest.json is already Chrome format"
    elif [ -f manifest_chrome.json ]; then
        echo "  Switching to Chrome manifest"
        /bin/cp -f manifest.json manifest_firefox.json
        /bin/cp -f manifest_chrome.json manifest.json
    else
        echo "ERROR: Cannot determine Chrome manifest"
        exit 1
    fi

    rm -f "$outfile"
    cd "$SCRIPT_DIR"
    zip -r "$outfile" . $(build_exclude_args) -x "./trashmail-*.zip"
    echo "  Created: $SCRIPT_DIR/$outfile"
}

build_firefox() {
    local outfile="trashmail-firefox-${VERSION}.zip"
    echo "Building Firefox ZIP: $outfile"

    # Save current manifest
    /bin/cp -f manifest.json manifest.json.bak

    # Switch to Firefox manifest
    if [ -f manifest_firefox.json ]; then
        echo "  Switching to Firefox manifest"
        /bin/cp -f manifest_firefox.json manifest.json
    elif grep -q '"scripts"' manifest.json && grep -q '"gecko"' manifest.json; then
        echo "  manifest.json is already Firefox format"
    else
        echo "ERROR: manifest_firefox.json not found"
        /bin/mv -f manifest.json.bak manifest.json
        exit 1
    fi

    rm -f "$outfile"
    cd "$SCRIPT_DIR"
    zip -r "$outfile" . $(build_exclude_args) -x "./trashmail-*.zip" -x "./manifest.json.bak" -x "./manifest_chrome.json"
    echo "  Created: $SCRIPT_DIR/$outfile"

    # Restore original manifest
    /bin/mv -f manifest.json.bak manifest.json
    echo "  Restored original manifest.json"
}

build_source() {
    local outfile="trashmail-source-${VERSION}.zip"
    echo "Building Source ZIP: $outfile (for AMO review)"

    rm -f "$outfile"
    cd "$SCRIPT_DIR"
    zip -r "$outfile" . -x "./.git/*" -x "./.DS_Store" -x "./trashmail-*.zip" -x "./manifest.json.bak"
    echo "  Created: $SCRIPT_DIR/$outfile"
}

case "${1:-all}" in
    chrome)
        build_chrome
        ;;
    firefox)
        build_firefox
        ;;
    source)
        build_source
        ;;
    all)
        build_chrome
        build_firefox
        echo ""
        echo "Done! Upload:"
        echo "  Chrome:  $SCRIPT_DIR/trashmail-chrome-${VERSION}.zip  → Chrome Web Store"
        echo "  Firefox: $SCRIPT_DIR/trashmail-firefox-${VERSION}.zip → addons.mozilla.org"
        ;;
    *)
        echo "Usage: $0 {chrome|firefox|source|all}"
        exit 1
        ;;
esac
