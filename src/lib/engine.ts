/**
 * engine.ts - Typed client for the Python SPIA engine using Tauri STDIO.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

let _wsListeners: Array<(event: EngineEvent) => void> = [];

export type EngineEvent =
  | { type: "motion_started" }
  | { type: "clip_ready"; path: string }
  | { type: "stopped" }
  | { type: "error"; msg: string }
  | { type: "cameras_list"; cameras: Record<string, string> }
  | { type: "status_response"; running: boolean }
  | { type: "test_telegram_result"; ok: boolean }
  | { type: "test_discord_result"; ok: boolean };

export interface Camera {
  index: number;
  name: string;
}

export interface Config {
  camera_index: number;
  save_path: string;
  telegram_token: string;
  telegram_chat_id: string;
  discord_webhook_url: string;
  sensitivity: number;
  cooldown: number;
  zone_mask?: boolean[];
  auto_cleanup?: boolean;
}

/** Call once on app init to subscribe to engine events. */
export async function initEngine(): Promise<void> {
  await listen<string>("engine-event", (event) => {
    try {
      const payload: EngineEvent = JSON.parse(event.payload);
      _wsListeners.forEach((fn) => fn(payload));
    } catch (e) {
      console.error("Failed to parse engine event:", event.payload, e);
    }
  });
}

export function onEngineEvent(fn: (e: EngineEvent) => void): () => void {
  _wsListeners.push(fn);
  return () => { _wsListeners = _wsListeners.filter((f) => f !== fn); };
}

async function sendCmd(action: string, kwargs: Record<string, any> = {}) {
  const payload = JSON.stringify({ action, ...kwargs });
  await invoke("send_engine_command", { commandJson: payload });
}

export async function getCameras(): Promise<Camera[]> {
  return new Promise(async (resolve) => {
    const unsub = onEngineEvent((e) => {
      if (e.type === "cameras_list") {
        unsub();
        const cams = Object.entries(e.cameras).map(([idx, name]) => ({
          index: parseInt(idx),
          name,
        }));
        resolve(cams);
      }
    });
    await sendCmd("get_cameras");
  });
}

export async function configure(cfg: Partial<Config>): Promise<void> {
  await sendCmd("configure", { config: cfg });
}

export async function startEngine(): Promise<void> {
  await sendCmd("start");
}

export async function stopEngine(): Promise<void> {
  await sendCmd("stop");
}

export async function startPreview(): Promise<void> {
  await sendCmd("start_preview");
}

export async function stopPreview(): Promise<void> {
  await sendCmd("stop_preview");
}

export async function getStatus(): Promise<{ running: boolean }> {
  return new Promise(async (resolve) => {
    const unsub = onEngineEvent((e) => {
      if (e.type === "status_response") {
        unsub();
        resolve({ running: e.running });
      }
    });
    await sendCmd("status");
  });
}

export async function testTelegram(
  token: string,
  chat_id: string
): Promise<{ ok: boolean; error?: string }> {
  return new Promise(async (resolve) => {
    const unsub = onEngineEvent((e) => {
      if (e.type === "test_telegram_result") {
        unsub();
        resolve({ ok: e.ok });
      }
    });
    await sendCmd("test_telegram", { token, chat_id });
  });
}

export async function testDiscord(_url?: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise(async (resolve) => {
    const unsub = onEngineEvent((e) => {
      if (e.type === "test_discord_result") {
        unsub();
        resolve({ ok: e.ok });
      }
    });
    await sendCmd("test_discord");
  });
}

// ── Keychain via Rust ─────────────────────────────────────────────────────────
export async function saveSecret(service: string, account: string, value: string): Promise<void> {
  await invoke("save_to_keychain", { service, account, value });
}

export async function loadSecret(service: string, account: string): Promise<string> {
  return invoke<string>("load_from_keychain", { service, account });
}

export async function authenticateWithTouchId(reason: string): Promise<boolean> {
  return invoke<boolean>("authenticate_touch_id", { reason });
}
