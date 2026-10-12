"""
recorder.py – Frame buffer and MP4 export.

Maintains a rolling pre-buffer of frames. On trigger, captures
additional post-trigger frames and exports to MP4 via ffmpeg.
All export work runs in a background thread.
"""

import os
import shutil
import subprocess
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from threading import Thread

import cv2
import numpy as np


def _recordings_dir() -> Path:
    """Return (and create) the recordings directory."""
    d = Path.home() / "Library" / "Application Support" / "SPIA" / "recordings"
    d.mkdir(parents=True, exist_ok=True)
    return d


class FrameRecorder:
    """Buffers frames and exports motion clips to MP4."""

    def __init__(
        self,
        fps: int = 30,
        pre_seconds: float = 1.0,
        post_seconds: float = 3.0,
        cooldown_seconds: float = 15.0,
    ):
        self._fps = fps
        self._pre_seconds = pre_seconds
        self._post_seconds = post_seconds
        self._cooldown_seconds = cooldown_seconds

        pre_count = int(fps * pre_seconds)
        self._pre_buffer: deque[np.ndarray] = deque(maxlen=pre_count)

        self._recording = False
        self._post_frames: list[np.ndarray] = []
        self._post_target = int(fps * post_seconds)

        self._last_export_time: float = 0.0
        self._on_export_done = None  # callback(path: str)

    # -- public config -------------------------------------------------------

    @property
    def cooldown_seconds(self) -> float:
        return self._cooldown_seconds

    @cooldown_seconds.setter
    def cooldown_seconds(self, value: float):
        self._cooldown_seconds = max(5.0, value)

    @property
    def on_export_done(self):
        return self._on_export_done

    @on_export_done.setter
    def on_export_done(self, callback):
        """Set callback(path: str) called when MP4 is ready."""
        self._on_export_done = callback

    @property
    def save_path(self) -> str:
        return getattr(self, "_save_path", str(_recordings_dir()))
        
    @save_path.setter
    def save_path(self, path: str):
        self._save_path = path

    # -- frame feed ----------------------------------------------------------

    def feed(self, frame: np.ndarray):
        """Feed every frame from the capture thread."""
        if self._recording:
            self._post_frames.append(frame.copy())
            if len(self._post_frames) >= self._post_target:
                self._finalize()
        else:
            self._pre_buffer.append(frame.copy())

    def trigger(self):
        """Called when motion is detected. Starts post-trigger recording.

        Returns True if recording started, False if on cooldown.
        """
        now = time.monotonic()
        if now - self._last_export_time < self._cooldown_seconds:
            return False
        if self._recording:
            return False

        self._recording = True
        self._post_frames = []
        return True

    def reset(self):
        """Reset all buffers (e.g. on camera switch)."""
        self._pre_buffer.clear()
        self._post_frames = []
        self._recording = False

    # -- internal ------------------------------------------------------------

    def _finalize(self):
        """Combine pre + post buffers and export in background."""
        frames = list(self._pre_buffer) + self._post_frames
        self._pre_buffer.clear()
        self._post_frames = []
        self._recording = False
        self._last_export_time = time.monotonic()

        if not frames:
            return

        h, w = frames[0].shape[:2]
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        target_dir = Path(self.save_path)
        target_dir.mkdir(parents=True, exist_ok=True)
        out_path = str(target_dir / f"motion_{stamp}.mp4")
        thumb_path = str(target_dir / f"motion_{stamp}.jpg")

        # Resolve ffmpeg once — covers both terminal PATH and .app bundle
        ffmpeg_bin = (
            shutil.which("ffmpeg")
            or shutil.which("ffmpeg", path="/opt/homebrew/bin:/usr/local/bin:/usr/bin")
            or "/opt/homebrew/bin/ffmpeg"
        )

        # Save a thumbnail from the middle frame (to avoid blank startups)
        mid_idx = len(frames) // 2
        cv2.imwrite(thumb_path, frames[mid_idx])

        Thread(
            target=self._export_mp4,
            args=(frames, w, h, out_path, ffmpeg_bin),
            daemon=True,
        ).start()

    def _export_mp4(self, frames: list[np.ndarray], w: int, h: int, path: str, ffmpeg_bin: str = "ffmpeg"):
        """Pipe raw BGR frames to ffmpeg and produce an MP4."""
        import logging
        _log = logging.getLogger("spia")

        if not os.path.isfile(ffmpeg_bin):
            _log.error(f"ffmpeg not found at '{ffmpeg_bin}'. MP4 export skipped.")
            return

        cmd = [
            ffmpeg_bin,
            "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{w}x{h}",
            "-r", str(self._fps),
            "-i", "-",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            path,
        ]

        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            for frame in frames:
                proc.stdin.write(frame.tobytes())
            proc.stdin.close()
            proc.wait(timeout=30)

            if proc.returncode == 0 and os.path.exists(path):
                if self._on_export_done:
                    self._on_export_done(path)
            else:
                stderr_out = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
                _log.error(f"ffmpeg exited with code {proc.returncode}. stderr: {stderr_out[:500]}")
        except Exception as e:
            _log.error(f"Exception during MP4 export: {e}")
