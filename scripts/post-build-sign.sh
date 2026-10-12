#!/bin/bash
# Post-build: re-sign SPIA.app with camera entitlements so macOS grants camera permission.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENTITLEMENTS="$REPO/src-tauri/entitlements.plist"
APP="$REPO/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/SPIA.app"

if [ ! -d "$APP" ]; then
  echo "❌ SPIA.app not found at $APP"
  exit 1
fi

echo "✍️  Signing sidecar binary..."
codesign --force --sign - --entitlements "$ENTITLEMENTS" \
  "$APP/Contents/Resources/binaries/spia-engine-dist/spia-engine"

echo "✍️  Signing app bundle..."
codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$APP"

echo "✅ Done. Camera entitlement embedded."

echo ""
echo "💉  Injecting install helper into DMG..."
"$REPO/scripts/inject-into-dmg.sh"
