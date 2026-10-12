<p align="center">
  <img src="assets/app-icon.png" width="128" height="128" alt="SPIA App Icon" />
</p>

<h1 align="center">SPIA</h1>

<p align="center">
  <strong>Intelligent camera motion surveillance and alert dispatch for macOS.</strong>
</p>

<p align="center">
  <a href="https://github.com/qn34uc59t/spia/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/qn34uc59t/spia/ci.yml?branch=main&style=flat-square&label=CI" alt="CI Status" /></a>
  <a href="https://github.com/qn34uc59t/spia/releases"><img src="https://img.shields.io/github/v/release/qn34uc59t/spia?style=flat-square" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/macOS-14.0%2B%20Apple%20Silicon-black?style=flat-square&logo=apple" alt="macOS 14.0+" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-1.80%2B-orange?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.12" />
</p>

---

## What is SPIA?

**SPIA** is a discreet, native macOS motion detection and surveillance system. Operating quietly from your macOS menu bar, SPIA monitors camera feeds using an optimized OpenCV computer vision pipeline running locally on your hardware.

When motion is detected in your monitored space, SPIA instantly triggers automated video capture and securely dispatches high-definition MP4 clips to your configured **Telegram** or **Discord** channels.

---

## Interface & Preview

<p align="center">
  <img src="assets/scr_1.png" alt="SPIA Surveillance Interface" width="380" />
</p>
<p align="center">
  <em>Discreet menu bar surveillance console with instant arming, live state, and quick logs.</em>
</p>

<br />

<p align="center">
  <img src="assets/scr_3.png" alt="Zone Masking & Controls" width="380" />
</p>
<p align="center">
  <em>Interactive 12x12 zone masking grid to ignore static backgrounds, ceiling fans, or pets.</em>
</p>

---

## Key Features

- **Advanced Motion Detection:** OpenCV-driven optical change tracking with customizable sensitivity thresholds.
- **12x12 Interactive Zone Masking:** Ignore windows, trees, pets, or fans with granular click-to-mask exclusion tiles.
- **Biometric Keychain Protection:** Telegram tokens and Discord webhooks are encrypted in the macOS Keychain and protected via Touch ID authentication.
- **Automated Video Dispatch:** Instantaneous MP4 packaging and dispatch via Telegram Bots or Discord Webhooks.
- **Prevent Mac Sleep:** Built-in macOS keep-awake assertion ensures continuous background vigilance while on battery or adapter.
- **Zero-Cloud & 100% Local:** All frame analysis, detection algorithms, and disk management execute on your Mac.

---

## Installation

### Method 1: Homebrew (Recommended)

```bash
brew install --cask qn34uc59t/tap/spia
```

Quarantine flags are automatically bypassed during installation. Update with:
```bash
brew upgrade spia
```

### Method 2: Pre-built DMG Installer

1. Download **`SPIA-v0.1.4.dmg`** from [GitHub Releases](https://github.com/qn34uc59t/spia/releases).
2. Open the disk image.
3. Drag **SPIA.app** to your `/Applications` folder, or double-click **Install SPIA.command**.
4. Launch SPIA from Spotlight or Launchpad.

---

## Architecture

SPIA pairs the speed and battery-efficiency of native macOS components with a high-performance Python computer vision sidecar:

```mermaid
graph TD
    UI[React / Vite Webview UI] <-->|IPC Commands & Events| Rust[Tauri 2 Native Backend]
    Rust <-->|Biometrics & Secrets| Keychain[macOS Touch ID & Keychain]
    Rust <-->|STDIO JSON Protocol| Engine[PyInstaller OpenCV Engine]
    Camera[AVFoundation Camera Feed] --> Engine
    Engine -->|Motion Triggered| Record[MP4 Video Encoder]
    Record -->|HTTPS Webhook / API| Dispatch[Telegram Bot & Discord Alerts]
```

- **Frontend:** Lightweight React UI with transparent glass styling running in Tauri.
- **Backend (Rust):** Handles OS-level integrations, Touch ID authentication, LaunchAgent autostart, and system tray management.
- **Engine (Python Sidecar):** Runs as an independent compiled process (`spia-engine`) communicating with Tauri over JSON STDIO, guaranteeing the UI never drops frames during heavy encoding workloads.

---

## Building from Source

### Prerequisites

- Node.js 20+ & npm
- Rust (`rustup default stable`) with `aarch64-apple-darwin` target
- Python 3.12+

```bash
# 1. Clone repository
git clone https://github.com/qn34uc59t/spia.git
cd spia

# 2. Install dependencies
npm install
cd engine && pip install -r requirements.txt && cd ..

# 3. Build sidecar, application, and DMG
npm run build:all
```

---

## Security & Privacy Guarantee

- **No Remote Telemetry:** No tracking, telemetry, or diagnostic metrics are gathered or transmitted.
- **Direct Dispatch:** Video evidence is routed exclusively to endpoints explicitly provided by you (your own Telegram Bot or private Discord Webhook).
- **Entitlements:** Camera permissions are requested through Apple's native Privacy TCC model.
