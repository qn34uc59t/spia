#!/bin/bash
# Injects "Install SPIA.command" into the built DMG and configures layout via AppleScript.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$REPO/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
HELPER_SRC="$REPO/scripts/install-helper.command"
HELPER_NAME="Install SPIA.command"
BG_SRC="$REPO/src-tauri/icons/dmg_background.png"  # padded to 2560x1600 to prevent white borders when resizing

# Find the built DMG
DMG_ORIG=$(find "$BUNDLE_DIR" -name "*.dmg" ! -name "*_rw.dmg" | head -n 1)
if [ -z "$DMG_ORIG" ]; then
  echo "❌  No .dmg found in $BUNDLE_DIR"
  exit 1
fi

echo "📦  Found: $DMG_ORIG"

DMG_RW="${DMG_ORIG%.dmg}_rw.dmg"

# Detach any leftover mounts
hdiutil detach /Volumes/SPIA                                   -quiet -force 2>/dev/null || true
hdiutil detach "/Volumes/SPIA 2"                               -quiet -force 2>/dev/null || true
hdiutil detach "/Volumes/Install Spia"                         -quiet -force 2>/dev/null || true
hdiutil detach "/Volumes/Install SPIA, your home security app" -quiet -force 2>/dev/null || true

# Convert to read-write
echo "🔧  Converting DMG to read-write..."
rm -f "$DMG_RW"
hdiutil convert "$DMG_ORIG" -format UDRW -o "$DMG_RW" -quiet

# Mount WITH Finder visibility so AppleScript can address it
echo "📂  Mounting..."
MOUNT_LINE=$(hdiutil attach "$DMG_RW" -readwrite -noverify | grep Apple_HFS)
MOUNT_DEV=$(echo "$MOUNT_LINE" | awk '{print $1}')
MOUNT_POINT=$(echo "$MOUNT_LINE" | sed 's|.*Apple_HFS[[:space:]]*||')
VOLUME_NAME=$(basename "$MOUNT_POINT")
echo "    Volume: $VOLUME_NAME  at  $MOUNT_POINT"

# Rename volume
NEW_VOLUME_NAME="Install Spia"
diskutil rename "$VOLUME_NAME" "$NEW_VOLUME_NAME" 2>/dev/null || true
VOLUME_NAME="$NEW_VOLUME_NAME"
MOUNT_POINT="/Volumes/$NEW_VOLUME_NAME"
echo "    Renamed to: $VOLUME_NAME"

# Copy helper and set permissions
echo "📋  Injecting \"$HELPER_NAME\"..."
cp "$HELPER_SRC" "$MOUNT_POINT/$HELPER_NAME"
chmod +x "$MOUNT_POINT/$HELPER_NAME"

# Remove old .DS_Store so Finder creates a fresh one
rm -f "$MOUNT_POINT/.DS_Store"

# Copy @2x Retina background into hidden folder inside DMG
mkdir -p "$MOUNT_POINT/.background"
cp "$BG_SRC" "$MOUNT_POINT/.background/background.png"

# Give Finder a moment to register the volume
sleep 2

# Configure Finder layout via AppleScript
echo "🎨  Configuring DMG layout via Finder..."
osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {400, 100, 1060, 560}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 80
    set text size of opts to 11
    set background picture of opts to file ".background:background.png"
    set position of item "SPIA.app"       of container window to {120, 197}
    set position of item "Applications"   of container window to {240, 197}
    set position of item "$HELPER_NAME"   of container window to {514, 197}
    close
    open
    update without registering applications
    delay 3
    close
  end tell
end tell
APPLESCRIPT

# Flush filesystem writes
sync

# Detach
echo "💾  Detaching..."
hdiutil detach "$MOUNT_POINT" -quiet -force

# Repack as compressed read-only, overwrite original
echo "📦  Repacking..."
hdiutil convert "$DMG_RW" -format UDZO -o "$DMG_ORIG" -quiet -ov

# Cleanup temp
rm -f "$DMG_RW"

echo "✅  Done: $DMG_ORIG"
