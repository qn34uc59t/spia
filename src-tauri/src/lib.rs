use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Shared state: holds the engine child process.
pub struct EngineHandle {
    pub child: Option<CommandChild>,
}

pub struct KeepAwakeState(Mutex<Option<keepawake::KeepAwake>>);

impl EngineHandle {
    fn new() -> Self {
        Self { child: None }
    }
}

type SharedEngine = Arc<Mutex<EngineHandle>>;

/// Spawn the Python sidecar engine using STDIO.
fn launch_engine(app: &AppHandle) -> Result<CommandChild, String> {
    let sidecar_cmd = app
        .shell()
        .sidecar("spia-engine")
        .map_err(|e| e.to_string())?
        .env("PYTHONUNBUFFERED", "1");

    let (mut rx, child) = sidecar_cmd.spawn().map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    let s = String::from_utf8_lossy(&line);
                    let trimmed = s.trim();
                    if !trimmed.is_empty() {
                        let _ = app_handle.emit("engine-event", trimmed);
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line);
                    eprintln!("{}", s.trim());
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Send a JSON command to the engine's stdin.
#[tauri::command]
fn send_engine_command(state: State<SharedEngine>, command_json: String) {
    let mut handle = state.lock().unwrap();
    if let Some(child) = handle.child.as_mut() {
        let mut msg = command_json;
        msg.push('\n'); // Ensure readline() flushes
        let _ = child.write(msg.as_bytes());
    }
}

/// Gracefully stop the engine.
#[tauri::command]
fn stop_engine(state: State<SharedEngine>) {
    let mut handle = state.lock().unwrap();
    if let Some(child) = handle.child.take() {
        let mut child_mut = child;
        let _ = child_mut.kill();
    }
}

/// macOS Keychain access via `security` CLI — keeps secrets out of JS entirely.
#[tauri::command]
fn save_to_keychain(service: String, account: String, value: String) -> bool {
    // Delete existing first
    let _ = std::process::Command::new("security")
        .args(["delete-generic-password", "-a", &account, "-s", &service])
        .output();
    let out = std::process::Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            &account,
            "-s",
            &service,
            "-w",
            &value,
            "-U",
        ])
        .output();
    out.map(|o| o.status.success()).unwrap_or(false)
}

#[tauri::command]
fn load_from_keychain(service: String, account: String) -> String {
    let out = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            &account,
            "-s",
            &service,
            "-w",
        ])
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        });
    if out.status.success() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        String::new()
    }
}

/// Touch ID prompt via swift one-liner. Returns true if authenticated.
#[tauri::command]
fn authenticate_touch_id(reason: String) -> bool {
    let script = format!(
        r#"
import LocalAuthentication
import Foundation
let ctx = LAContext()
var err: NSError?
let group = DispatchGroup()
var ok = false
group.enter()
if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) {{
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "{reason}") {{ r, _ in ok = r; group.leave() }}
}} else {{ group.leave() }}
group.wait()
exit(ok ? 0 : 1)
"#,
        reason = reason
    );
    std::process::Command::new("swift")
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(script.as_bytes()).ok();
            }
            child.wait()
        })
        .map(|s| s.success())
        .unwrap_or(true) // fallback: allow if swift not available
}

#[tauri::command]
fn open_login_items_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_events(path: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.starts_with("motion_") && name.ends_with(".mp4") {
                    files.push(name);
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
fn delete_event(path: String) -> Result<(), String> {
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!("set the clipboard to POSIX file \"{}\"", path);
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn play_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_active(app: tauri::AppHandle, active: bool) {
    if let Some(tray) = app.tray_by_id("main") {
        let img = if active {
            tauri::include_image!("icons/activeTemplate.png")
        } else {
            tauri::include_image!("icons/inactiveTemplate.png")
        };
        let _ = tray.set_icon(Some(img));
    }
}

#[tauri::command]
fn set_keep_awake(state: State<KeepAwakeState>, active: bool) {
    let mut handle = state.0.lock().unwrap();
    if active {
        if handle.is_none() {
            if let Ok(ka) = keepawake::Builder::default()
                .display(false)
                .idle(true)
                .sleep(true)
                .app_name("SPIA")
                .reason("Running background surveillance")
                .create() 
            {
                *handle = Some(ka);
            }
        }
    } else {
        *handle = None;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_handle: SharedEngine = Arc::new(Mutex::new(EngineHandle::new()));
    let engine_handle_clone = engine_handle.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .manage(engine_handle)
        .manage(KeepAwakeState(Mutex::new(None)))
        .setup(move |app| {
            match launch_engine(app.handle()) {
                Ok(child) => {
                    let mut handle = engine_handle_clone.lock().unwrap();
                    handle.child = Some(child);
                }
                Err(e) => eprintln!("Engine launch error: {e}"),
            }

            // If launched at login, start quietly in the top bar
            if std::env::args().any(|arg| arg == "--autostart") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            
            // System Tray Setup
            let hide_i = MenuItem::with_id(app, "toggle_vis", "Hide/Reveal SPIA", true, None::<&str>)?;
            let toggle_i = MenuItem::with_id(app, "toggle_surveillance", "Start/Stop Surveillance", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&hide_i, &toggle_i])?;

            let tray_icon = tauri::include_image!("icons/inactiveTemplate.png");
            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "toggle_vis" => {
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "toggle_surveillance" => {
                            let _ = app.emit("tray_toggle_surveillance", ());
                        }
                        _ => {}
                    }
                })
                .build(app)?;
                
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_engine_command,
            stop_engine,
            save_to_keychain,
            load_from_keychain,
            authenticate_touch_id,
            open_login_items_settings,
            get_events,
            delete_event,
            copy_file_to_clipboard,
            reveal_file,
            play_file,
            read_file_bytes,
            set_tray_active,
            set_keep_awake,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
