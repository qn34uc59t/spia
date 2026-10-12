#!/bin/bash
# SPIA Install Helper
# Double-click this after dragging SPIA to Applications.

APP_DEST="/Applications/SPIA.app"
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_SRC="$DIR/SPIA.app"

echo ""
echo "SPIA Install Helper"
echo "-------------------"
echo ""

if [ -d "$APP_DEST" ]; then
    echo "SPIA is already in Applications. Updating/Overwriting..."
    rm -rf "$APP_DEST"
fi

if [ ! -d "$APP_SRC" ]; then
    echo "❌  Could not find SPIA.app next to this script."
    echo "    Make sure you are running this from the DMG."
    echo ""
    read -rp "Press Return to close..."
    exit 1
fi

echo "Copying SPIA.app to /Applications..."
cp -R "$APP_SRC" "$APP_DEST"

echo "Removing macOS quarantine from SPIA.app..."
xattr -cr "$APP_DEST"

echo "✅  Installation complete! You can now open SPIA from your Applications folder."
echo ""
read -rp "Press Return to close..."
