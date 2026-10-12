#!/usr/bin/env python3
"""
Generates the DMG background from the user's Artboard22.png design.
Composites: arrow between SPIA icon & Applications icon in the left card.
Icon positions for Finder are printed at the end for reference in inject-into-dmg.sh
"""

from PIL import Image, ImageDraw
import os

REPO     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC      = os.path.join(REPO, "public", "Artboard22.png")
OUT      = os.path.join(REPO, "src-tauri", "icons", "dmg_background.png")
APP_ICON = os.path.join(REPO, "src-tauri", "icons", "128x128@2x.png")

# ── load base image ─────────────────────────────────────────────────────
base = Image.open(SRC).convert("RGBA")
W, H = base.size   # 660 × 400

draw = ImageDraw.Draw(base)

# ── card geometry (measured from Artboard22.png) ─────────────────────────
# Left card:  x 38–325, y 118–270  → center (181, 194)
# Right card: x 413–624, y 118–270 → center (519, 194)
LEFT_CX,  CARD_CY = 181, 194
RIGHT_CX           = 519

# ── app icon in left card (left half) ────────────────────────────────────
ICON_SZ = 52
try:
    icon = Image.open(APP_ICON).convert("RGBA")
    icon = icon.resize((ICON_SZ, ICON_SZ), Image.LANCZOS)
    # place icon left-of-center in left card
    icon_x = LEFT_CX - 60 - ICON_SZ // 2
    icon_y = CARD_CY - ICON_SZ // 2
    base.paste(icon, (icon_x, icon_y), icon)
except Exception as e:
    print(f"  icon skipped: {e}")

# ── arrow between SPIA icon and Applications icon ─────────────────────────
# Arrow sits right-of-center in left card
ARROW_COLOR = (64, 80, 191, 255)   # #4050BF

AX = LEFT_CX + 10   # horizontal center of arrow
AY = CARD_CY        # vertical center
AW = 32             # total arrow width
AH = 18             # total arrow height
HEAD = 12           # arrowhead depth
SHAFT_H = 7         # shaft height

# Points for a right-pointing filled arrow:
#   shaft left → shaft right → shoulder top → tip → shoulder bottom → shaft right bottom → shaft left bottom
pts = [
    (AX - AW // 2,          AY - SHAFT_H // 2),   # shaft left-top
    (AX + AW // 2 - HEAD,   AY - SHAFT_H // 2),   # shaft right-top
    (AX + AW // 2 - HEAD,   AY - AH // 2),        # shoulder top
    (AX + AW // 2,          AY),                   # tip
    (AX + AW // 2 - HEAD,   AY + AH // 2),        # shoulder bottom
    (AX + AW // 2 - HEAD,   AY + SHAFT_H // 2),   # shaft right-bottom
    (AX - AW // 2,          AY + SHAFT_H // 2),   # shaft left-bottom
]
draw.polygon(pts, fill=ARROW_COLOR)

# ── save ──────────────────────────────────────────────────────────────────
out = base.convert("RGB")
out.save(OUT, "PNG")
print(f"✅  Saved: {OUT}  ({W}×{H})")

# ── print Finder icon positions for inject-into-dmg.sh ───────────────────
# Finder icon positions are in window coordinates (top-left origin of window content).
# Window is 660×400. Icon label is below icon; position = center of icon.
print()
print("── Finder icon positions (for AppleScript) ──")
print(f"  SPIA.app       → ({LEFT_CX - 60}, {CARD_CY})")
print(f"  Applications   → ({LEFT_CX + 60}, {CARD_CY})")
print(f"  Install SPIA   → ({RIGHT_CX}, {CARD_CY})")
