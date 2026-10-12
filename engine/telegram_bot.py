"""
telegram_bot.py – Telegram Bot API integration.

Handles sending videos/animations and polling for commands.
"""

import threading
import time
from pathlib import Path
from typing import Callable

import requests

BASE_URL = "https://api.telegram.org/bot{}"

def test_connection(token: str) -> bool:
    """Check if the token is valid."""
    if not token:
        return False
    try:
        resp = requests.get(BASE_URL.format(token) + "/getMe", timeout=5)
        return resp.status_code == 200
    except Exception:
        return False

def send_video(
    token: str,
    chat_id: str,
    video_path: str,
    caption: str = "",
) -> bool:
    """Send an MP4 file to a Telegram chat."""
    if not token or not chat_id:
        print("Missing token or chat_id")
        return False
    
    url = BASE_URL.format(token) + "/sendVideo"
    
    try:
        with open(video_path, "rb") as f:
            filename = Path(video_path).name
            files = {"video": (filename, f, "video/mp4")}
            data = {"chat_id": chat_id, "caption": caption}
            print(f"Sending video {filename} to {chat_id}...")
            resp = requests.post(url, data=data, files=files, timeout=60)
            if resp.status_code == 200:
                print("Send OK")
                return True
            else:
                print(f"Telegram API Error: {resp.status_code} - {resp.text}")
                return False
    except Exception as e:
        print(f"Exception sending video: {e}")
        return False

def start_polling(
    token: str,
    chat_id: str,
    on_command: Callable[[str], None],
) -> Callable[[], None]:
    """Start long polling in a background thread.
    
    Returns a stop() function.
    """
    running = True
    
    def _poll_thread():
        url = BASE_URL.format(token) + "/getUpdates"
        offset = None
        
        while running:
            try:
                params = {"timeout": 10, "allowed_updates": ["message"]}
                if offset is not None:
                    params["offset"] = offset
                    
                resp = requests.get(url, params=params, timeout=15)
                if resp.status_code != 200:
                    time.sleep(2)
                    continue
                    
                data = resp.json()
                for update in data.get("result", []):
                    offset = update["update_id"] + 1
                    msg = update.get("message", {})
                    
                    # Only accept commands from our configured chat_id
                    if str(msg.get("chat", {}).get("id")) != str(chat_id):
                        continue
                        
                    text = msg.get("text", "")
                    if text.startswith("/"):
                        on_command(text.split("@")[0].strip())
                        
            except Exception:
                time.sleep(2)
                
    thread = threading.Thread(target=_poll_thread, daemon=True)
    if token and chat_id:
        thread.start()
        
    def stop():
        nonlocal running
        running = False
        
    return stop
