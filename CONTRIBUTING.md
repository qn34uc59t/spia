# Contributing to SPIA

Thank you for your interest in contributing to SPIA! We welcome bug fixes, documentation improvements, and feature contributions that respect our privacy and local-processing guarantees.

---

## Architecture & Principles

1. **Local-First Privacy:** All video analysis and frame tracking execute strictly on the local machine. Feeds or telemetry must never be sent to third-party tracking services.
2. **Native macOS Conventions:** Keep the UI snappy and unobtrusive in the macOS menu bar. Follow Tauri v2 and React best practices.
3. **Resilient Computer Vision:** Keep OpenCV processing in the dedicated Python sidecar so the front-end UI thread is never blocked.

---

## Development Setup

### Prerequisites

- **macOS:** 14.0 (Sonoma) or newer (Apple Silicon)
- **Node.js:** 20+ & npm
- **Rust:** stable toolchain (`rustup default stable`) with target `aarch64-apple-darwin`
- **Python:** 3.12+

### Running Locally

```bash
# Clone the repository
git clone https://github.com/qn34uc59t/spia.git
cd spia

# Install frontend dependencies
npm install

# Install engine dependencies
cd engine && pip install -r requirements.txt && cd ..

# Run in dev mode (hot reload)
npm run tauri dev
```

---

## Verifying Full Builds

Before opening a pull request, ensure the complete production pipeline succeeds:

```bash
npm run build:all
```

This verifies that:
1. `spia-engine` compiles with PyInstaller.
2. The Tauri application builds and packages.
3. The camera entitlements and code signing succeed.
4. The DMG installer packaging completes.

---

## Pull Request Guidelines

1. **Branching:** Create feature branches off `main` (e.g. `feature/mask-inversion` or `fix/camera-reconnect`).
2. **Commit Messages:** Follow conventional commit formatting (e.g. `fix: handle camera reconnect timeout`).
3. **Focused Changes:** Keep changes scoped to a single fix or feature for easier review.
