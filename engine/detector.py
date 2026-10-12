"""
detector.py – Motion detection using BackgroundSubtractorMOG2.

Compares incoming frames against a learned background model.
Returns bounding rectangles for regions with significant motion.
"""

import cv2
import numpy as np


class MotionDetector:
    """Detects motion in a video stream using background subtraction."""

    def __init__(self, sensitivity: float = 0.5):
        """
        Args:
            sensitivity: 0.0 (least sensitive) to 1.0 (most sensitive).
                         Controls minimum contour area threshold.
        """
        self._subtractor = cv2.createBackgroundSubtractorMOG2(
            history=300,
            varThreshold=50,
            detectShadows=False,
        )
        self._sensitivity = sensitivity
        self._warmup_frames = 0
        self.zone_mask = None

    @property
    def sensitivity(self) -> float:
        return self._sensitivity

    @sensitivity.setter
    def sensitivity(self, value: float):
        self._sensitivity = max(0.0, min(1.0, value))

    def _min_contour_area(self) -> float:
        """Map sensitivity to minimum contour area.

        High sensitivity → small area threshold → detects smaller movements.
        Low sensitivity → large area threshold → ignores small movements.
        """
        # Range: 1000 (insensitive) down to 50 (very sensitive)
        return 1000 - (self._sensitivity * 950)

    def detect(self, frame: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Process a frame and return bounding rects of detected motion.

        Args:
            frame: BGR numpy array from camera.

        Returns:
            List of (x, y, w, h) tuples for each motion region.
            Empty list if no significant motion or still warming up.
        """
        # Let the background model learn for the first ~30 frames
        if self._warmup_frames < 30:
            self._subtractor.apply(frame, learningRate=0.05)
            self._warmup_frames += 1
            return []

        # Apply background subtraction
        mask = self._subtractor.apply(frame, learningRate=0.002)

        # Apply user exclusion zones if configured
        if self.zone_mask is not None:
            if len(self.zone_mask) == 16 * 9:
                h, w = mask.shape
                grid = np.array(self.zone_mask, dtype=np.uint8).reshape((9, 16))
                exclusion_mask = cv2.resize(grid, (w, h), interpolation=cv2.INTER_NEAREST)
                
                # Zero out mask where exclusion_mask is anything greater than 0
                mask[exclusion_mask > 0] = 0
            else:
                print(f"[Detector] Warning: zone_mask has length {len(self.zone_mask)} instead of 144", file=sys.stderr)

        # Clean up noise
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel, iterations=2)

        # Find contours
        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        min_area = self._min_contour_area()
        rects = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area >= min_area:
                rects.append(cv2.boundingRect(cnt))

        return rects, mask

    def reset(self):
        """Reset the background model (e.g. after camera switch)."""
        self._subtractor = cv2.createBackgroundSubtractorMOG2(
            history=300,
            varThreshold=50,
            detectShadows=False,
        )
        self._warmup_frames = 0
