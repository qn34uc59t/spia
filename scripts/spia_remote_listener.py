#!/usr/bin/env python3
"""
spia_remote_listener.py: Fallback global key listener for AB Shutter remote.

LIMITATION NOTE:
Because pynput / macOS CGEventTap operates at the window server event level,
it receives global keystrokes and cannot distinguish between the AB Shutter
remote and your built-in / USB MacBook keyboard. Any press of the designated
keys (Volume Up or Enter) will trigger the script.

For device-restricted filtering by Vendor ID / Product ID, use Karabiner-Elements instead.
"""

import os
import subprocess
import sys
import time

try:
    from pynput import keyboard
except ImportError:
    print("pynput is required for the fallback listener. Install it with: pip3 install pynput", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONTROL_SCRIPT = os.path.join(SCRIPT_DIR, "spia-control.sh")

last_trigger_time = 0.0
DEBOUNCE_SECONDS = 1.0

def run_control(action: str):
    global last_trigger_time
    now = time.time()
    if now - last_trigger_time < DEBOUNCE_SECONDS:
        return
    last_trigger_time = now
    subprocess.run(["/bin/bash", CONTROL_SCRIPT, action])

def on_press(key):
    try:
        # Check for Volume Up (iOS button)
        if hasattr(key, "name") and key.name in ("media_volume_up", "volume_up"):
            print("Remote Start detected (Volume Up)")
            run_control("start")
        elif key == keyboard.Key.media_volume_up:
            print("Remote Start detected (Volume Up)")
            run_control("start")
        # Check for Enter / Return (Android button)
        elif key in (keyboard.Key.enter,):
            # To avoid accidental triggers when typing normally, you can optionally require a modifier
            # or leave it as pure Enter for remote usage.
            print("Remote Stop detected (Enter)")
            run_control("stop")
    except Exception as e:
        print(f"Error handling key: {e}", file=sys.stderr)

def main():
    print("Starting SPIA remote key listener...")
    print("NOTE: Global keystrokes are intercepted. Enter/Volume-Up will trigger SPIA.")
    with keyboard.Listener(on_press=on_press) as listener:
        listener.join()

if __name__ == "__main__":
    main()
