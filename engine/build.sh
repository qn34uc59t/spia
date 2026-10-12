#!/bin/bash
# Packages the Python engine into a standalone binary for Tauri sidecar.
# Output: ../src-tauri/binaries/spia-engine-aarch64-apple-darwin
set -e
cd "$(dirname "$0")"

pip3 install -r requirements.txt pyinstaller -q

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then ARCH="aarch64"; fi
TARGET_TRIPLE="${ARCH}-apple-darwin"
OUTDIR="../src-tauri/binaries"
mkdir -p "$OUTDIR"

pyinstaller \
  --onedir \
  --contents-directory . \
  --name "spia-engine" \
  --distpath "$OUTDIR" \
  --specpath /tmp/spia-spec \
  --clean \
  main.py

# Tauri sidecar naming convention requires the target triple suffix

# Move the compiled directory
rm -rf "$OUTDIR/spia-engine-dist"
mv "$OUTDIR/spia-engine" "$OUTDIR/spia-engine-dist"

# Create the proxy bash script that Tauri will call as the sidecar.
# Inside .app bundles Tauri copies resources to Contents/Resources, not MacOS.
LAUNCHER="$OUTDIR/spia-engine-${TARGET_TRIPLE}"
cat > "$LAUNCHER" << 'LAUNCHER_EOF'
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BUNDLE_ENGINE="$SCRIPT_DIR/../Resources/binaries/spia-engine-dist/spia-engine"
DEV_ENGINE="$SCRIPT_DIR/spia-engine-dist/spia-engine"
if [ -x "$BUNDLE_ENGINE" ]; then
    exec "$BUNDLE_ENGINE" "$@"
elif [ -x "$DEV_ENGINE" ]; then
    exec "$DEV_ENGINE" "$@"
else
    echo '{"type":"error","msg":"spia-engine binary not found"}' >&1
    exit 1
fi
LAUNCHER_EOF
chmod +x "$LAUNCHER"

echo "Engine built: $OUTDIR/spia-engine-dist"
