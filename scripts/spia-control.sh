#!/bin/bash
# spia-control.sh: Start or stop SPIA via Bluetooth remote or shell
set -e

APP_PATH="/Applications/SPIA.app"
DEV_APP="$(cd "$(dirname "$0")/../src-tauri/target/release/bundle/macos" 2>/dev/null && pwd)/SPIA.app"

resolve_app() {
  if [ -d "$APP_PATH" ]; then
    echo "$APP_PATH"
  elif [ -d "$DEV_APP" ]; then
    echo "$DEV_APP"
  else
    echo ""
  fi
}

is_running() {
  pgrep -ix "spia" >/dev/null 2>&1
}

case "$1" in
  start)
    # Check if SPIA is already running (prevent double starts)
    if is_running; then
      echo "SPIA is already running. Ignoring start command."
      exit 0
    fi

    TARGET_APP="$(resolve_app)"
    if [ -z "$TARGET_APP" ]; then
      echo "Error: SPIA.app not found in /Applications or build directory." >&2
      exit 1
    fi

    echo "Launching SPIA with --autostart..."
    open -a "$TARGET_APP" --args --autostart
    ;;

  stop)
    echo "Signaling clean stop to SPIA..."
    touch /tmp/spia.stop

    # Wait up to 15 seconds for SPIA to finish export and exit cleanly
    WAITED=0
    while is_running && [ $WAITED -lt 30 ]; do
      sleep 0.5
      WAITED=$((WAITED + 1))
    done

    # Clean up stop file if still present
    rm -f /tmp/spia.stop /tmp/spia.pid 2>/dev/null || true

    if is_running; then
      echo "Force quitting remaining SPIA process..."
      killall -9 spia 2>/dev/null || true
    else
      echo "SPIA stopped cleanly."
    fi
    ;;

  toggle)
    if is_running; then
      "$0" stop
    else
      "$0" start
    fi
    ;;

  status)
    if is_running; then
      echo "SPIA is running (PID: $(pgrep -ix spia))"
    else
      echo "SPIA is not running"
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
