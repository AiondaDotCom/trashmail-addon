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
    "ts"
    "tests"
    "tsconfig.json"
    "build.sh"
    "BUILD_README.md"
    "SOURCE_README.md"
    "README.md"
    "LICENSE"
    "update_suffixes.py"
    ".git"
    ".DS_Store"
)

# Build the -x exclude arguments as a real array. The patterns MUST stay
# quoted when passed to zip: an unquoted ./.git/* gets glob-expanded by the
# shell (non-recursively) before zip ever sees it, which is why .git used to
# leak into the package. As array elements they reach zip verbatim and zip
# does the (recursive) matching itself.
EXCLUDE_ARGS=()
for item in "${EXCLUDE[@]}"; do
    # Exclude the entry itself AND, for directories, its whole contents.
    EXCLUDE_ARGS+=( -x "./$item" -x "./$item/*" )
done

build_chrome() {
    local outfile="aionda-mail-chrome-${VERSION}.zip"
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
    zip -r "$outfile" . "${EXCLUDE_ARGS[@]}" -x "./trashmail-*.zip" -x "./aionda-mail-*.zip"
    echo "  Created: $SCRIPT_DIR/$outfile"
}

build_firefox() {
    local outfile="aionda-mail-firefox-${VERSION}.zip"
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
    zip -r "$outfile" . "${EXCLUDE_ARGS[@]}" -x "./trashmail-*.zip" -x "./aionda-mail-*.zip" -x "./manifest.json.bak" -x "./manifest_chrome.json"
    echo "  Created: $SCRIPT_DIR/$outfile"

    # Restore original manifest
    /bin/mv -f manifest.json.bak manifest.json
    echo "  Restored original manifest.json"
}

build_source() {
    local outfile="aionda-mail-source-${VERSION}.zip"
    echo "Building Source ZIP: $outfile (for AMO review)"

    rm -f "$outfile"
    cd "$SCRIPT_DIR"
    zip -r "$outfile" . -x "./.git/*" -x "./.DS_Store" -x "./trashmail-*.zip" -x "./aionda-mail-*.zip" -x "./manifest.json.bak"
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
        echo "  Chrome:  $SCRIPT_DIR/aionda-mail-chrome-${VERSION}.zip  → Chrome Web Store"
        echo "  Firefox: $SCRIPT_DIR/aionda-mail-firefox-${VERSION}.zip → addons.mozilla.org"
        ;;
    *)
        echo "Usage: $0 {chrome|firefox|source|all}"
        exit 1
        ;;
esac
