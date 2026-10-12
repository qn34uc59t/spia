import sys
import json
import time
import threading
import traceback
import cv2
import numpy as np
import base64
import os
import logging
from logging.handlers import RotatingFileHandler

# File-based log so we can diagnose the built .app without a terminal
_log_dir = os.path.expanduser("~/Library/Logs/SPIA")
os.makedirs(_log_dir, exist_ok=True)
_fh = RotatingFileHandler(os.path.join(_log_dir, "engine.log"), maxBytes=2*1024*1024, backupCount=2)
_fh.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
_file_logger = logging.getLogger("spia")
_file_logger.setLevel(logging.DEBUG)
_file_logger.addHandler(_fh)

import detector
import recorder
import telegram_bot
import discord_webhook

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
sys.stdin.reconfigure(encoding="utf-8")

class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False  # True means ARMED
        self.previewing = False # True means previewing
        self.camera_index = 0
        self.save_path = ""
        self.telegram_token = ""
        self.telegram_chat_id = ""
        self.discord_webhook_url = ""
        self.sensitivity = 50
        self.cooldown = 5
        self.zone_mask = None
        self.auto_cleanup = True
        self.last_preview_time = 0

state = State()
camera_thread = None

# Global instances
motion_detector = detector.MotionDetector(sensitivity=0.5)
frame_recorder = recorder.FrameRecorder(fps=30, cooldown_seconds=5)

def on_export_done(path):
    log(f"Export done: {path}")
    with state.lock:
        token = state.telegram_token
        chat_id = state.telegram_chat_id
        discord_url = state.discord_webhook_url
    if token and chat_id:
        telegram_bot.send_video(token, chat_id, path, caption="🚨 Motion Detected by SPIA!")
    if discord_url:
        discord_webhook.send_video(discord_url, path, content="🚨 Motion Detected by SPIA!")

frame_recorder.on_export_done = on_export_done

def emit(event_type, **kwargs):
    msg = {"type": event_type}
    msg.update(kwargs)
    try:
        print(json.dumps(msg), flush=True)
    except Exception as e:
        print(f"[Engine] Failed to emit: {e}", file=sys.stderr)

def log(msg):
    print(f"[Engine] {msg}", file=sys.stderr, flush=True)
    _file_logger.info(msg)

def motion_loop():
    log("Camera loop started")
    cap = None
    try:
        with state.lock:
            cam_idx = state.camera_index

        # macOS TCC race: the OS may grant camera permission AFTER cv2 already
        # opened the device (returning a dummy that reads no frames). Retry
        # reopening the camera until we get a real frame or are told to stop.
        MAX_OPEN_ATTEMPTS = 20  # ~10 s total
        RETRY_DELAY = 0.5
        got_frame = False

        for attempt in range(MAX_OPEN_ATTEMPTS):
            with state.lock:
                if not state.previewing:
                    log("Preview cancelled before camera opened")
                    return

            if cap:
                cap.release()
                cap = None

            cap = cv2.VideoCapture(cam_idx)
            if not cap.isOpened():
                log(f"Camera not opened (attempt {attempt+1}), retrying...")
                time.sleep(RETRY_DELAY)
                continue

            ret, _ = cap.read()
            if ret:
                got_frame = True
                log(f"Camera opened successfully on attempt {attempt+1}")
                break
            else:
                log(f"Camera opened but no frames yet (attempt {attempt+1}), retrying...")
                time.sleep(RETRY_DELAY)

        if not got_frame:
            emit("error", msg="Camera returned no frames. Please check camera permissions in System Settings.")
            return

        while True:
            with state.lock:
                is_previewing = state.previewing
                is_running = state.running
                if not is_previewing and not is_running:
                    break

            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue
                
            h, w = frame.shape[:2]
            new_w = 640
            new_h = int(h * (new_w / w))
            
            # --- MOTION DETECTION AND RECORDING ---
            with state.lock:
                is_armed = state.running
            
            # We copy the frame for preview so we can draw rects on it
            # But we resize it FIRST to speed up encoding
            # Ensure dimensions are divisible by 2 (H.264 requirement)
            new_h = new_h if new_h % 2 == 0 else new_h - 1
            frame_resized = cv2.resize(frame, (new_w, new_h))
            
            if is_armed:
                frame_recorder.feed(frame)
                result = motion_detector.detect(frame_resized)
                
                # Unwrap the tuple if we got one (fallback for warmup frames)
                if isinstance(result, tuple):
                    rects, bw_mask = result
                else:
                    rects, bw_mask = result, None
                
                # Draw the python zone_mask directly onto frame_resized so we can see if it aligns!
                with state.lock:
                    zmask = state.zone_mask
                if zmask and len(zmask) == 16 * 9:
                    grid = np.array(zmask, dtype=np.uint8).reshape((9, 16))
                    ex_mask_resized = cv2.resize(grid, (new_w, new_h), interpolation=cv2.INTER_NEAREST)
                    # Create a red overlay
                    overlay = frame_resized.copy()
                    overlay[ex_mask_resized == 1] = [0, 0, 255] # Red BGR
                    cv2.addWeighted(overlay, 0.3, frame_resized, 0.7, 0, frame_resized)
                
                if rects:
                    if frame_recorder.trigger():
                        log("Motion triggered! Recording started.")
                    
                    # Draw green squares on the preview
                    for (rx, ry, rw, rh) in rects:
                        pt1 = (rx, ry)
                        pt2 = (rx + rw, ry + rh)
                        cv2.rectangle(frame_resized, pt1, pt2, (0, 255, 0), 2)
                

            else:
                # Disarmed: gently reset the models so they do not hold stale background
                motion_detector.reset()
                frame_recorder.reset()
                
            if is_previewing:
                now = time.time()
                if now - state.last_preview_time >= 1.0 / 15.0: # Cap at 15 FPS
                    state.last_preview_time = now
                    ret_jpg, buffer = cv2.imencode(".jpg", frame_resized, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
                    if ret_jpg:
                        b64 = base64.b64encode(buffer).decode("utf-8")
                        emit("frame", data=b64)
                
            time.sleep(0.01)
            
    except Exception as e:
        emit("error", msg=f"Crash in motion loop: {e}")
        log(traceback.format_exc())
    finally:
        if cap:
            cap.release()
        emit("stopped")
        log("Camera loop ended")

def handle_command(cmd_str):
    global camera_thread
    if not cmd_str.strip():
        return
    try:
        cmd = json.loads(cmd_str)
        action = cmd.get("action")
        log(f"CMD received: {action}")
        
        if action == "get_cameras":
            cams = {"0": "Default Camera"}
            emit("cameras_list", cameras=cams)
            
        elif action == "start_preview":
            with state.lock:
                state.previewing = True
                
            if camera_thread is None or not camera_thread.is_alive():
                camera_thread = threading.Thread(target=motion_loop, daemon=True)
                camera_thread.start()
                
        elif action == "stop_preview":
            with state.lock:
                state.previewing = False
            
        elif action == "configure":
            cfg = cmd.get("config", {})
            with state.lock:
                state.camera_index = cfg.get("camera_index", state.camera_index)
                state.save_path = cfg.get("save_path", state.save_path)
                state.telegram_token = cfg.get("telegram_token", state.telegram_token)
                state.telegram_chat_id = cfg.get("telegram_chat_id", state.telegram_chat_id)
                state.discord_webhook_url = cfg.get("discord_webhook_url", state.discord_webhook_url)
                state.sensitivity = cfg.get("sensitivity", state.sensitivity)
                state.cooldown = cfg.get("cooldown", state.cooldown)
                state.auto_cleanup = cfg.get("auto_cleanup", state.auto_cleanup)
                if "zone_mask" in cfg:
                    state.zone_mask = cfg["zone_mask"]
                
                # Apply config to recorder and detector
                frame_recorder.cooldown_seconds = state.cooldown
                frame_recorder.save_path = state.save_path
                motion_detector.sensitivity = state.sensitivity / 100.0
                motion_detector.zone_mask = state.zone_mask
                
            log("Configuration updated")
            
        elif action == "start":
            with state.lock:
                state.running = True
                do_cleanup = state.auto_cleanup
                
            if camera_thread is None or not camera_thread.is_alive():
                camera_thread = threading.Thread(target=motion_loop, daemon=True)
                camera_thread.start()
                
            # Clean up events older than 7 days
            if do_cleanup:
                save_dir = state.save_path or os.path.expanduser("~/Documents/security camera videos")
                if os.path.exists(save_dir):
                    now = time.time()
                    cutoff = now - (7 * 86400)
                    try:
                        for filename in os.listdir(save_dir):
                            if filename.endswith(".mp4") or filename.endswith(".jpg"):
                                filepath = os.path.join(save_dir, filename)
                                if os.path.getmtime(filepath) < cutoff:
                                    os.remove(filepath)
                                    log(f"Cleaned up old event: {filename}")
                    except Exception as e:
                        log(f"Cleanup error: {e}")
                    
            log("Armed system")
            
        elif action == "stop":
            with state.lock:
                state.running = False
            log("Disarmed system")
            
        elif action == "status":
            with state.lock:
                r = state.running
            emit("status_response", running=r)
            
        elif action == "test_telegram":
            # Test connection
            with state.lock:
                token = state.telegram_token
            ok = telegram_bot.test_connection(token)
            emit("test_telegram_result", ok=ok)
            
        elif action == "test_discord":
            with state.lock:
                url = state.discord_webhook_url
            ok = discord_webhook.test_connection(url)
            emit("test_discord_result", ok=ok)
            
        else:
            log(f"Unknown action: {action}")
            
    except Exception as e:
        log(f"Error handling command: {e}")

def main():
    log("Engine started. Waiting for commands.")

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                log("EOF reached. Parent process died. Exiting.")
                with state.lock:
                    state.running = False
                    state.previewing = False
                break
            
            handle_command(line)
        except Exception as e:
            log(f"Fatal error reading stdin: {e}")
            break
            
    sys.exit(0)

if __name__ == "__main__":
    main()
