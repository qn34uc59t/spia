import ShaderBackground from './components/ShaderBackground';
import { useState, useEffect, useRef } from "react";

import "./index.css";
import { open, confirm, message } from "@tauri-apps/plugin-dialog";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
// import { readDir, remove } from "@tauri-apps/plugin-fs";
// import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import {
  initEngine, getCameras, configure, startEngine, stopEngine,
  startPreview, stopPreview,
  saveSecret, loadSecret, authenticateWithTouchId,
  onEngineEvent, Camera
} from "./lib/engine";

// Storage keys
const STORE_KEY = "spia_settings";
function loadSettings(): any {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}
function saveSettings(s: any) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

interface EventFile {
  name: string;
  path: string;
  timestamp: Date;
}
interface EventGroup {
  dateStr: string;
  files: EventFile[];
}

const Thumbnail = ({ path }: { path: string }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    const thumbPath = path.replace(".mp4", ".jpg");
    invoke("read_file_bytes", { path: thumbPath }).then((bytes: unknown) => {
      if (!active) return;
      const u8 = new Uint8Array(bytes as number[]);
      const blob = new Blob([u8], { type: "image/jpeg" });
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch(() => {});
    return () => { 
      active = false; 
      if (url) URL.revokeObjectURL(url); 
    };
  }, [path]);
  
  if (src) return <img src={src} className="event-thumbnail" style={{ width: 40, height: 28, objectFit: 'cover', borderRadius: 4, marginRight: 12, backgroundColor: 'rgba(255,255,255,0.1)' }} />;
  return (
    <div className="event-icon" title="Play Video">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
    </div>
  );
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [initErr, setInitErr] = useState("");
  const [cameras, setCameras] = useState<Camera[]>([]);

  const [activeTab, setActiveTab] = useState<"monitor" | "settings" | "countdown" | "onboarding" | "events">("monitor");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [slideDirection, setSlideDirection] = useState<"right" | "left">("right");
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [running, setRunning] = useState(false);

  // Sync running state to tray icon
  useEffect(() => {
    invoke('set_tray_active', { active: running }).catch(console.error);
  }, [running]);

  // Events State
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Settings
  const [cameraIndex, setCameraIndex] = useState(0);
  const [sensitivity, setSensitivity] = useState(2);
  const [cooldown, setCooldown] = useState(6);
  const [savePath, setSavePath] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [discordUrl, setDiscordUrl] = useState("");
  const [armCountdown, setArmCountdown] = useState(3);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [preventSleep, setPreventSleep] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");

  // Masking State
  const [zoneMask, setZoneMask] = useState<boolean[]>(Array(144).fill(false));
  const [isMaskingMode, setIsMaskingMode] = useState(false);
  const isPainting = useRef<boolean>(false);
  const paintValue = useRef<boolean>(true);

  // Token UI
  const [tokenMode, setTokenMode] = useState<"password" | "text" | "edit">("password");
  const [editToken, setEditToken] = useState("");

  // Countdown State
  const [countdownLeft, setCountdownLeft] = useState(3);
  const timerRef = useRef<any>(null);

  // Settings Guide State
  const [showSettingsGuide, setShowSettingsGuide] = useState(false);
  const [settingsGuideMode, setSettingsGuideMode] = useState<"intro" | "telegram" | "discord">("intro");
  const [settingsGuideStep, setSettingsGuideStep] = useState(0);

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  // Password Prompt Modal
  const [passwordPrompt, setPasswordPrompt] = useState<{
    isOpen: boolean;
    reason: string;
    onSuccess: (pwd?: string) => void;
  }>({ isOpen: false, reason: "", onSuccess: () => {} });
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handlePasswordSubmit = () => {
    if (passwordPrompt.reason === "Set New Master Password") {
      if (passwordInput.length < 4) {
        setPasswordError("Password must be at least 4 characters.");
        return;
      }
      passwordPrompt.onSuccess(passwordInput);
      setPasswordPrompt({ ...passwordPrompt, isOpen: false });
      setPasswordInput("");
    } else {
      if (passwordInput === masterPassword) {
        passwordPrompt.onSuccess();
        setPasswordPrompt({ ...passwordPrompt, isOpen: false });
        setPasswordInput("");
      } else {
        setPasswordError("Incorrect password.");
      }
    }
  };

  useEffect(() => {
    if (activeTab === "events") {
      loadEvents();
    }
  }, [activeTab, savePath]);

  const loadEvents = async () => {
    if (!savePath) return;
    try {
      const entries: string[] = await invoke("get_events", { path: savePath });
      const files: EventFile[] = [];
      for (const name of entries) {
        const parts = name.replace("motion_", "").replace(".mp4", "").split("_");
        if (parts.length === 2) {
           const year = parseInt(parts[0].substring(0, 4));
           const month = parseInt(parts[0].substring(4, 6)) - 1;
           const day = parseInt(parts[0].substring(6, 8));
           const h = parseInt(parts[1].substring(0, 2));
           const m = parseInt(parts[1].substring(2, 4));
           const s = parseInt(parts[1].substring(4, 6));
           files.push({ name: name, path: `${savePath}/${name}`, timestamp: new Date(year, month, day, h, m, s) });
        }
      }
      
      files.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      const groups = new Map<string, EventFile[]>();
      files.forEach(f => {
        const dateStr = f.timestamp.toLocaleDateString("en-US", { month: 'long', day: 'numeric', year: 'numeric' });
        if (!groups.has(dateStr)) groups.set(dateStr, []);
        groups.get(dateStr)!.push(f);
      });
      
      const result: EventGroup[] = [];
      const expanded: Record<string, boolean> = {};
      groups.forEach((files, dateStr) => {
        result.push({ dateStr, files });
        expanded[dateStr] = false;
      });
      if (result.length > 0 && Object.keys(expandedGroups).length === 0) {
        expanded[result[0].dateStr] = true;
      } else {
        Object.keys(expandedGroups).forEach(k => {
          if (expanded[k] !== undefined) expanded[k] = expandedGroups[k];
        });
      }
      
      setEventGroups(result);
      setExpandedGroups(expanded);
      
    } catch (e) {
      console.error("Failed to load events", e);
    }
  };

  const deleteEvent = async (f: EventFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirm(`Are you sure you want to delete this event?`, { title: "Confirm Deletion", kind: "warning" });
    if (!confirmed) return;
    try {
      await invoke("delete_event", { path: f.path });
      await loadEvents();
    } catch (err) {
      console.error(err);
    }
  };

  const copyEvent = async (f: EventFile, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.share) {
        try {
          const bytes: number[] = await invoke("read_file_bytes", { path: f.path });
          const u8 = new Uint8Array(bytes);
          const blob = new Blob([u8], { type: "video/mp4" });
          const file = new File([blob], f.name, { type: "video/mp4" });
          await navigator.share({
            files: [file],
            title: f.name
          });
          return;
        } catch (shareErr) {
          console.warn("Web Share API failed, falling back to copy", shareErr);
        }
      }
      
      await invoke("copy_file_to_clipboard", { path: f.path });
      setCopiedPath(f.path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };

//   const _revealEvent = async (f: EventFile, e: React.MouseEvent) => {
//     e.stopPropagation();
//     try {
//       await invoke("reveal_file", { path: f.path });
//     } catch (err) {
//       console.error(err);
//     }
//   };

  const playEvent = async (f: EventFile) => {
    try {
      await invoke("play_file", { path: f.path });
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    (async () => {
      try { await initEngine(); } catch (e) { setInitErr("EngineInit: " + e); return; }

      // Listen for tray events
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen("tray_toggle_surveillance", () => {
          setRunning(prev => {
            const next = !prev;
            if (next) {
              startEngine();
            } else {
              stopEngine();
            }
            return next;
          });
        });
      });

      getCameras().then(cams => setCameras(cams)).catch(console.error);
      loadSecret("SPIA_App", "Bot_Token").then(token => {
        setTgToken(token);
        setEditToken(token);
        if (!token) setTokenMode("edit");
      }).catch(console.error);

      loadSecret("SPIA_App", "Discord_Webhook").then(url => {
        if (url) setDiscordUrl(url);
      }).catch(console.error);

      const s = loadSettings();

      loadSecret("SPIA_App", "Chat_ID").then(chat => {
        if (chat) setTgChatId(chat);
        else if (s.tgChatId) setTgChatId(s.tgChatId);
      }).catch(console.error);

      if (s.savePath) setSavePath(s.savePath);
      if (!s.onboardingCompleted) {
        setActiveTab("onboarding");
      } else {
        // Onboarding already done
        // Preview is off by default until user presses "show preview" or "start surveillance" starts the engine
      }
      if (s.armCountdown !== undefined) setArmCountdown(s.armCountdown);
      if (s.zoneMask) setZoneMask(s.zoneMask);
      if (s.autoCleanup !== undefined) setAutoCleanup(s.autoCleanup);
      if (s.preventSleep !== undefined) {
        setPreventSleep(s.preventSleep);
        invoke("set_keep_awake", { active: s.preventSleep }).catch(console.error);
      }
      if (s.masterPassword) setMasterPassword(s.masterPassword);

      isEnabled().then(setAutostartEnabled).catch(console.error);

      setTimeout(() => setReady(true), 1500);
    })();

    return onEngineEvent((e: any) => {
      if (e.type === "frame" && e.data) {
        setVideoSrc(`data:image/jpeg;base64,${e.data}`);
      }
    });
  }, []);

  const doStartEngine = async () => {
    setTransitioning(true);
    await new Promise(r => setTimeout(r, 400));
    setTransitioning(false);
    await configure({
      camera_index: cameraIndex,
      save_path: savePath,
      sensitivity: [0.2, 0.5, 0.8][sensitivity],
      cooldown: cooldown,
      telegram_token: tgToken,
      telegram_chat_id: tgChatId,
      discord_webhook_url: discordUrl,
      zone_mask: zoneMask
    });
    await startEngine();
    setRunning(true);
    setActiveTab("monitor");
  };

  const handleStartClick = () => {
    if (!savePath) return;
    setTransitioning(true);
    setTimeout(() => {
      setTransitioning(false);
      if (armCountdown > 0) {
        setCountdownLeft(armCountdown);
        setActiveTab("countdown");
        timerRef.current = setInterval(() => {
          setCountdownLeft(prev => {
            if (prev <= 1) {
              clearInterval(timerRef.current);
              doStartEngine();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        doStartEngine();
      }
    }, 400);
  };

  const handleStop = async () => {
    await stopEngine();
    setRunning(false);
    setVideoSrc(null);
  };

  const handleTokenAction = async (action: "reveal" | "edit" | "save", overrideToken?: string) => {
    if (action === "save") {
      const tokenToSave = overrideToken !== undefined ? overrideToken : editToken;
      await saveSecret("SPIA_App", "Bot_Token", tokenToSave);
      setTgToken(tokenToSave);
      
      const s = loadSettings();
      if (!s.masterPassword && tokenToSave) {
        const wantsProtect = await confirm("Would you like to set a Master Password to protect your Bot Token?", { title: "Protect Your Token", kind: "info" });
        if (wantsProtect) {
          setPasswordPrompt({
            isOpen: true,
            reason: "Set New Master Password",
            onSuccess: (newPwd) => {
              setMasterPassword(newPwd as string);
              s.masterPassword = newPwd;
              saveSettings(s);
              setTokenMode("password");
            }
          });
          return;
        }
      }
      setTokenMode("password");
      return;
    }

    const reason = action === "reveal" ? "View Bot Token" : "Edit Bot Token";
    
    if (masterPassword) {
      setPasswordPrompt({
        isOpen: true,
        reason: `Enter Master Password to ${action}`,
        onSuccess: () => {
          setTokenMode(action === "reveal" ? "text" : "edit");
        }
      });
      return;
    }

    const ok = await authenticateWithTouchId(reason);
    if (ok) {
      setTokenMode(action === "reveal" ? "text" : "edit");
    } else {
      await message("Touch ID is unavailable or failed.\nPlease set a Master Password in the Security section below to protect your tokens.", { 
        title: "Authentication Failed", 
        kind: "error" 
      });
    }
  };

  const handleToggleAutostart = async (checked: boolean) => {
    setAutostartEnabled(checked);
    try {
      if (checked) {
        await enable();
        invoke("open_login_items_settings").catch(console.error);
      } else {
        await disable();
      }
    } catch (err) {
      console.error("Autostart toggle error:", err);
      isEnabled().then(setAutostartEnabled).catch(console.error);
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: savePath || undefined
      });
      if (selected && typeof selected === "string") {
        setSavePath(selected);
        const s = loadSettings();
        s.savePath = selected;
        saveSettings(s);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePaint = (index: number, val: boolean) => {
    setZoneMask(prev => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleSaveMask = async () => {
    setIsMaskingMode(false);
    const s = loadSettings();
    s.zoneMask = zoneMask;
    saveSettings(s);
    if (running) {
      await configure({ zone_mask: zoneMask });
    }
  };

  if (initErr) {
    return (
      <div style={{ padding: 40, color: "red", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center", height: "100vh" }}>
        <h3>SPIA Error</h3>
        <p>{initErr}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div data-tauri-drag-region style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100vh", color: "#888", gap: "24px" }}>
        <ShaderBackground />
        <h1 className="logo" style={{ fontSize: "64px", marginBottom: "0", zIndex: 1 }}>spia</h1>
        <div className="progress-bar-container" style={{ zIndex: 1 }}>
          <div className="progress-bar-fill"></div>
        </div>
      </div>
    );
  }


  if (activeTab === "onboarding") {
    const handleNext = () => {
      if (onboardingStep < 3) {
        setSlideDirection("right");
        setOnboardingStep(s => s + 1);
      } else {
        if (dontShowAgain) {
          const s = loadSettings();
          s.onboardingCompleted = true;
          saveSettings(s);
        }
        setActiveTab("monitor");
      }
    };

    const handlePrev = () => {
      if (onboardingStep > 0) {
        setSlideDirection("left");
        setOnboardingStep(s => s - 1);
      }
    };

    return (
      <div data-tauri-drag-region className="onboarding-screen">
        <ShaderBackground />
        <button className="nav-arrow nav-arrow-left" onClick={handlePrev} style={{ opacity: onboardingStep === 0 ? 0 : 1, pointerEvents: onboardingStep === 0 ? "none" : "auto" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        <div className={`onboarding-content slide-${slideDirection} ${onboardingStep === 3 ? "onboarding-content-last" : ""}`} key={onboardingStep}>
          {onboardingStep === 0 && (
            <>
              <img src="/scr_1.png?v=3" className="onboarding-img" alt="Screen 1" />
              <h2 className="onboarding-header">This is SPIA</h2>
              <p className="onboarding-body">A macOS motion detection and surveillance application that operates quietly in the background. It uses your built-in or external cameras to monitor for physical motion and automatically capture high-quality video clips.</p>
              <button className="onboarding-cta onboarding-cta-ghost" onClick={handleNext}>
                Continue
              </button>
            </>
          )}
          {onboardingStep === 1 && (
            <>
              <img src="/scr_2.png?v=3" className="onboarding-img" alt="Screen 2" />
              <h2 className="onboarding-header">Total Visibility</h2>
              <p className="onboarding-body">Review automatically captured video clips of motion events and enable auto-cleanup to manage local disk space.</p>
              <button className="onboarding-cta onboarding-cta-ghost" onClick={handleNext}>
                Continue
              </button>
            </>
          )}
          {onboardingStep === 2 && (
            <>
              <img src="/scr_3.png?v=3" className="onboarding-img" alt="Screen 3" />
              <h2 className="onboarding-header">Secure Local Processing</h2>
              <p className="onboarding-body">Your video feeds are processed directly on your Mac, not on external cloud servers. All connection credentials for your alerts are locked safely inside the native macOS Keychain.</p>
              <button className="onboarding-cta onboarding-cta-ghost" onClick={handleNext}>
                Continue
              </button>
            </>
          )}
          {onboardingStep === 3 && (
            <>
              <img src="/scr_4.png?v=3" className="onboarding-img" alt="Screen 4" />
              <h2 className="onboarding-header">Get Mobile Alerts</h2>
              <p className="onboarding-body">Find out immediately if someone is at your desk. The app sends recorded video clips straight to your phone via Telegram or Discord the moment motion is detected.</p>
              <button className="onboarding-cta" onClick={handleNext}>
                Enter SPIA
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cta-icon"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </button>
            </>
          )}
        </div>

        {onboardingStep === 3 && (
          <label className="onboarding-checkbox-label">
            <input
              type="checkbox"
              className="onboarding-checkbox"
              checked={dontShowAgain}
              onChange={e => setDontShowAgain(e.target.checked)}
            />
            <span>Do not show again</span>
          </label>
        )}

        <button className="nav-arrow nav-arrow-right" onClick={handleNext} style={{ opacity: onboardingStep === 3 ? 0 : 1, pointerEvents: onboardingStep === 3 ? "none" : "auto" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>

        <div className="onboarding-dots">
          <span className={`dot ${onboardingStep === 0 ? "active" : ""}`} />
          <span className={`dot ${onboardingStep === 1 ? "active" : ""}`} />
          <span className={`dot ${onboardingStep === 2 ? "active" : ""}`} />
          <span className={`dot ${onboardingStep === 3 ? "active" : ""}`} />
        </div>
      </div>
    );
  }

  if (activeTab === "countdown") {
    return (
      <div data-tauri-drag-region className={`countdown-screen${transitioning ? " dissolve-out" : " dissolve-in"}`}>
        <ShaderBackground />
        <div className="countdown-number">{countdownLeft}</div>
      </div>
    );
  }

  const canStart = cameras.length > 0 && ((tgToken.trim() !== "" && tgChatId.trim() !== "") || discordUrl.trim() !== "") && savePath.trim() !== "";
  const sensLabel = sensitivity === 0 ? "Low" : sensitivity === 1 ? "Medium" : "High";

  const EyeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
  );

  const EyeOffIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
  );

  const PencilIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
  );

  return (
    <div data-tauri-drag-region className={`app-container${transitioning ? " dissolve-out" : ""}`}>
      {passwordPrompt.isOpen && (
        <div style={{ position: 'absolute', top:0, left:0, right:0, bottom:0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' }}>
          <div style={{ backgroundColor: 'rgba(35,35,37,0.95)', padding: 18, borderRadius: 16, width: 280, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', backdropFilter: 'blur(20px)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 15, fontWeight: 600, color: 'white' }}>{passwordPrompt.reason}</h3>
            <input 
              type="password" 
              style={{ width: '100%', marginBottom: 12, backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 8px', fontSize: 13, color: 'white', outline: 'none' }} 
              autoFocus 
              value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setPasswordError(""); }}
              onKeyDown={e => {
                if (e.key === 'Enter') handlePasswordSubmit();
                if (e.key === 'Escape') {
                  setPasswordPrompt({ ...passwordPrompt, isOpen: false });
                  setPasswordInput("");
                  setPasswordError("");
                }
              }}
            />
            {passwordError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 16 }}>{passwordError}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
              <button style={{ flex: 1, padding: '8px 0', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)', border: 'none', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }} onClick={() => { setPasswordPrompt({ ...passwordPrompt, isOpen: false }); setPasswordInput(""); setPasswordError(""); }}>Cancel</button>
              <button style={{ flex: 1, padding: '8px 0', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.45)', border: 'none', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }} onClick={handlePasswordSubmit}>OK</button>
            </div>
          </div>
        </div>
      )}

      <ShaderBackground opacity={0.4} />
      <div data-tauri-drag-region className="header">
        <h1 data-tauri-drag-region className="logo" style={{ userSelect: "none", cursor: "default" }}>spia</h1>
        {(activeTab === "monitor" || activeTab === "settings" || activeTab === "events") && (
          <div data-tauri-drag-region style={{ display: "flex", gap: "16px", flex: 1, justifyContent: "flex-end", paddingLeft: "32px", alignItems: "center" }}>
            <button 
              className="btn-text" 
              onClick={() => setActiveTab("monitor")}
              style={{ color: activeTab === "monitor" ? "#fff" : "rgba(255, 255, 255, 0.5)" }}
            >
              Monitor
            </button>
            <button 
              className="btn-text" 
              onClick={() => setActiveTab("events")}
              style={{ color: activeTab === "events" ? "#fff" : "rgba(255, 255, 255, 0.5)" }}
            >
              Events
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button 
                className="btn-text" 
                onClick={() => {
                  setActiveTab("settings");
                  const s = loadSettings();
                  if (!tgToken && !discordUrl && !s.settingsGuideSeenAt) {
                    setShowSettingsGuide(true);
                    setSettingsGuideMode("intro");
                    setSettingsGuideStep(0);
                  }
                }}
                style={{ color: activeTab === "settings" ? "#fff" : "rgba(255, 255, 255, 0.5)" }}
              >
                Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {activeTab === "events" ? (
        <div className="page-content events-page" style={eventGroups.length > 0 ? { justifyContent: 'flex-start' } : {}}>
          {eventGroups.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Events</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Auto-delete old events (7 days)</span>
                <input 
                  type="checkbox" 
                  className="onboarding-checkbox" 
                  checked={autoCleanup} 
                  onChange={e => {
                    setAutoCleanup(e.target.checked);
                    const s = loadSettings();
                    s.autoCleanup = e.target.checked;
                    saveSettings(s);
                    configure({ auto_cleanup: e.target.checked }).catch(console.error);
                  }} 
                />
              </label>
            </div>
          )}
          {eventGroups.length === 0 ? (
            <div className="empty-state">
              <div className="glass-folder-icon">
                <svg width="120" height="96" viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" className="folder-back">
                  <path d="M4 16C4 11.5817 7.58172 8 12 8H40.2319C42.8712 8 45.3409 9.30907 46.8924 11.5173L53.1076 20.3571C54.1423 21.83 55.7888 22.7027 57.5891 22.7027H108C112.418 22.7027 116 26.2844 116 30.7027V88C116 92.4183 112.418 96 108 96H12C7.58172 96 4 92.4183 4 88V16Z" fill="url(#folder_back_gradient)"/>
                  <defs>
                    <linearGradient id="folder_back_gradient" x1="60" y1="8" x2="60" y2="96" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#3B82F6"/>
                      <stop offset="1" stopColor="#1E40AF"/>
                    </linearGradient>
                  </defs>
                </svg>
                <div className="folder-front"></div>
              </div>
              
              <h3 className="empty-title">No events recorded yet</h3>
              <p className="empty-subtitle">Your surveillance history will appear here.</p>
              
              <button className="btn-primary-large" style={{ width: "auto", padding: "12px 32px" }} onClick={() => setActiveTab("monitor")}>
                Start Surveillance
              </button>
            </div>
          ) : (
            <div className="events-list">
              {eventGroups.map((group) => (
                <div key={group.dateStr} className="event-group">
                  <div 
                    className="event-group-header" 
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [group.dateStr]: !prev[group.dateStr] }))}
                  >
                    <div className="event-group-title">
                      {group.dateStr}
                      <span className="event-badge">{group.files.length}</span>
                    </div>
                    <svg 
                      className={`event-chevron ${expandedGroups[group.dateStr] ? 'expanded' : ''}`} 
                      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </div>
                  {expandedGroups[group.dateStr] && (
                    <div className="event-group-content">
                      {group.files.map((file) => (
                        <div key={file.name} className="event-item" onClick={() => playEvent(file)} style={{ cursor: "pointer" }}>
                          <div className="event-item-left">
                            <Thumbnail path={file.path} />
                            <span className="event-time">
                              {file.timestamp.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                            </span>
                          </div>
                          <div className="event-actions">
                            <button className="icon-btn-small" title="Share / Copy" onClick={(e) => copyEvent(file, e)}>
                              {copiedPath === file.path ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                                  <polyline points="16 6 12 2 8 6"></polyline>
                                  <line x1="12" y1="2" x2="12" y2="15"></line>
                                </svg>
                              )}
                            </button>
                            <button className="icon-btn-small delete" title="Delete Event" onClick={(e) => deleteEvent(file, e)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === "monitor" ? (
        <div className="page-content">
          <div className="preview-container">
            {videoSrc && previewVisible ? (
              <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%', borderRadius: 12, overflow: 'hidden' }}>
                <img src={videoSrc} className="preview-video" alt="Camera Feed" style={{ display: 'block' }} />
                <div 
                  className="mask-grid-overlay" 
                  style={{ pointerEvents: isMaskingMode ? 'auto' : 'none', opacity: isMaskingMode ? 1 : 0.55 }}
                  onMouseLeave={() => { isPainting.current = false; }}
                  onMouseUp={() => { isPainting.current = false; }}
                >
                  {zoneMask.map((isMasked, i) => (
                    <div 
                      key={i} 
                      className={`mask-cell ${isMasked ? 'masked' : ''}`}
                      style={{ border: isMaskingMode ? undefined : 'none' }}
                      onMouseDown={() => {
                        if (!isMaskingMode) return;
                        isPainting.current = true;
                        paintValue.current = !isMasked;
                        handlePaint(i, !isMasked);
                      }}
                      onMouseEnter={() => {
                        if (isMaskingMode && isPainting.current) handlePaint(i, paintValue.current);
                      }}
                    />
                  ))}
                </div>
                {!isMaskingMode && (
                  <button
                    className="preview-eye-btn"
                    style={{ right: 48 }}
                    onClick={() => setIsMaskingMode(true)}
                    title="Edit Motion Zones"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <path d="M3 9h18" />
                      <path d="M3 15h18" />
                      <path d="M9 3v18" />
                      <path d="M15 3v18" />
                    </svg>
                  </button>
                )}
                {!isMaskingMode && (
                  <button
                    className="preview-eye-btn"
                    onClick={() => { setPreviewVisible(false); stopPreview().catch(console.error); }}
                    title="Hide preview"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  </button>
                )}
              </div>
            ) : (
              <div style={{ position: 'relative', width: '100%', borderRadius: 12, overflow: 'hidden' }}>
                <div className={`preview-placeholder${videoSrc && !previewVisible ? " paused" : ""}`}>
                  <span className="placeholder-text">{videoSrc && !previewVisible ? "Preview Paused" : "Camera Feed Disabled"}</span>
                </div>
                {!isMaskingMode && (
                  <button
                    className="preview-eye-btn"
                    onClick={() => { setPreviewVisible(true); startPreview().catch(console.error); }}
                    title="Show preview"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>

          {isMaskingMode ? (
            <div className="controls-section" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '120px', padding: '16px 0' }}>
              <div style={{ textAlign: 'center', marginBottom: '16px', color: 'rgba(255,255,255,0.7)', fontSize: '13px', lineHeight: '1.5' }}>
                <p style={{ margin: '0 0 4px 0', fontWeight: 500, color: '#fff', fontSize: '14px' }}>Configure Motion Zones</p>
                <p style={{ margin: 0 }}>Click and drag over the video feed to highlight areas to ignore. Motion detected in these zones won't trigger alerts or recordings.</p>
              </div>
              <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                <button className="btn-outline" style={{ flex: 1 }} onClick={() => setZoneMask(Array(144).fill(false))}>
                  Clear All
                </button>
                <button className="btn-primary-large" style={{ flex: 1, padding: '8px 16px' }} onClick={handleSaveMask}>
                  Save Mask
                </button>
              </div>
            </div>
          ) : (
            <div className="controls-section">
              <div className="control-row">
                <label>Select Camera</label>
                <div className="control-right">
                  <select
                    className="dropdown"
                    value={cameraIndex}
                    onChange={e => setCameraIndex(Number(e.target.value))}
                  >
                    {cameras.map(c => (
                      <option key={c.index} value={c.index}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="control-row">
                <label>Cooldown Time</label>
                <div className="control-right">
                  <input
                    type="range"
                    min="5" max="15" step="1"
                    value={cooldown}
                    onChange={e => setCooldown(Number(e.target.value))}
                  />
                  <span className="val-text">{cooldown} sec</span>
                </div>
              </div>

              <div className="control-row">
                <label>Camera Sensitivity</label>
                <div className="control-right">
                  <input
                    type="range"
                    min="0" max="2" step="1"
                    value={sensitivity}
                    onChange={e => setSensitivity(Number(e.target.value))}
                  />
                  <span className="val-text">{sensLabel}</span>
                </div>
              </div>
            </div>
          )}

          <div className="bottom-action">
            {!isMaskingMode && (
              running ? (
                <button className="btn-primary-large btn-danger" onClick={handleStop}>
                  Stop the Surveillance
                </button>
              ) : (
                <button
                  className={`btn-primary-large ${!canStart ? "btn-disabled" : ""}`}
                  onClick={handleStartClick}
                  disabled={!canStart}
                >
                  {!((tgToken && tgChatId) || discordUrl)
                    ? "Set Messaging Config in Settings"
                    : !savePath
                      ? "Set Save Path in Settings"
                      : cameras.length === 0
                        ? "No Cameras Found"
                        : "Start the Surveillance"}
                </button>
              )
            )}
          </div>
        </div>
      ) : (
        <div className="page-content settings-page" style={{ position: "relative" }}>
          


          <div className="settings-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h3 className="settings-header" style={{ marginBottom: 0 }}>TELEGRAM BOT SETTINGS</h3>
              <button 
                className="help-btn"
                onClick={() => {
                  setSettingsGuideMode("telegram");
                  setSettingsGuideStep(1);
                  setShowSettingsGuide(true);
                }}
                title="Telegram Setup Guide"
                style={{ padding: 0, opacity: 0.5, marginTop: -2 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </button>
            </div>

            <div className="form-group">
              <label className="field-label">Bot Token</label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  id="bot-token-input"
                  type={tokenMode === "password" && tgToken ? "password" : "text"}
                  className="input-field"
                  style={{ flex: 1, opacity: tokenMode !== "edit" && tgToken ? 0.7 : 1 }}
                  value={tokenMode === "edit" || !tgToken ? editToken : tgToken}
                  readOnly={tokenMode !== "edit" && !!tgToken}
                  onChange={e => setEditToken(e.target.value)}
                  placeholder="Paste your Telegram Bot Token here..."
                />

                {(tokenMode === "edit" || !tgToken) ? (
                  <button 
                    className={`btn-primary ${!editToken ? "btn-disabled" : ""}`}
                    style={{ padding: "0 16px", height: "36px", fontSize: 13, borderRadius: 6, whiteSpace: "nowrap", opacity: !editToken ? 0.5 : 1 }}
                    disabled={!editToken}
                    onClick={() => {
                      if (editToken) {
                        handleTokenAction("save");
                      }
                    }}
                  >
                    Save
                  </button>
                ) : (
                  <>
                    <button className="icon-btn" onClick={() => {
                      if (tokenMode === "text") setTokenMode("password");
                      else handleTokenAction("reveal");
                    }}>
                      {tokenMode === "text" ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                    <button className="icon-btn" onClick={() => handleTokenAction("edit")}>
                      <PencilIcon />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="field-label">Chat ID</label>
              <input
                type="text"
                className="input-field"
                value={tgChatId}
                onChange={e => setTgChatId(e.target.value)}
                onBlur={() => {
                  saveSecret("SPIA_App", "Chat_ID", tgChatId);
                }}
              />
            </div>
          </div>

          <div className="settings-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h3 className="settings-header" style={{ marginBottom: 0 }}>DISCORD SETTINGS</h3>
              <button 
                className="help-btn"
                onClick={() => {
                  setSettingsGuideMode("discord");
                  setSettingsGuideStep(1);
                  setShowSettingsGuide(true);
                }}
                title="Discord Setup Guide"
                style={{ padding: 0, opacity: 0.5, marginTop: -2 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </button>
            </div>
            <div className="form-group">
              <label className="field-label">Webhook URL</label>
              <input
                type="text"
                className="input-field"
                value={discordUrl}
                onChange={e => setDiscordUrl(e.target.value)}
                onBlur={() => {
                  saveSecret("SPIA_App", "Discord_Webhook", discordUrl);
                }}
                placeholder="https://discord.com/api/webhooks/..."
              />
            </div>
          </div>

          <div className="settings-group">
            <h3 className="settings-header">GENERAL SETTINGS</h3>

            <div className="control-row" style={{ marginTop: "8px" }}>
              <label className="field-label" style={{ width: "120px" }}>Arm Countdown</label>
              <select
                className="dropdown"
                value={armCountdown}
                onChange={e => {
                  const val = Number(e.target.value);
                  setArmCountdown(val);
                  const s = loadSettings();
                  s.armCountdown = val;
                  saveSettings(s);
                }}
              >
                <option value={0}>0 sec</option>
                <option value={3}>3 sec</option>
                <option value={5}>5 sec</option>
                <option value={10}>10 sec</option>
              </select>
            </div>

            <div className="form-group" style={{ marginTop: "8px" }}>
              <label className="field-label">Save Path</label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="text"
                  className="input-field"
                  value={savePath}
                  placeholder="e.g. ~/SPIA"
                  readOnly
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-outline"
                  onClick={handleBrowse}
                >
                  Browse
                </button>
              </div>
            </div>

            <div className="control-row" style={{ marginTop: "16px", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span className="field-label" style={{ marginBottom: "2px", display: "block" }}>Launch at Login</span>
                <span style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.4)", display: "block" }}>Starts in top bar on boot</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autostartEnabled}
                  onChange={e => handleToggleAutostart(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="control-row" style={{ marginTop: "16px", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span className="field-label" style={{ marginBottom: "2px", display: "block" }}>Prevent Mac from Sleeping</span>
                <span style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.4)", display: "block" }}>Keeps computer awake while SPIA is open</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={preventSleep}
                  onChange={e => {
                    const checked = e.target.checked;
                    setPreventSleep(checked);
                    const s = loadSettings();
                    s.preventSleep = checked;
                    saveSettings(s);
                    invoke("set_keep_awake", { active: checked }).catch(console.error);
                  }}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          {(tgToken || discordUrl) && (
            <div className="settings-group" style={{ marginTop: 24 }}>
              <h3 className="settings-header">SECURITY & ACCESS</h3>
              <div className="form-group">
                <label className="field-label">App Master Password (Fallback)</label>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
                  If your Mac doesn't have Touch ID, set a master password to protect your tokens.
                </div>
                
                {masterPassword ? (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }} onClick={() => {
                      setPasswordPrompt({ 
                        isOpen: true, 
                        reason: "Enter Current Password", 
                        onSuccess: () => {
                          setTimeout(() => {
                            setPasswordPrompt({
                              isOpen: true,
                              reason: "Set New Master Password",
                              onSuccess: (newPwd) => {
                                setMasterPassword(newPwd as string);
                                const s = loadSettings();
                                s.masterPassword = newPwd;
                                saveSettings(s);
                              }
                            });
                          }, 150);
                        }
                      });
                    }}>Change Password</button>
                    <button className="btn-primary btn-danger" style={{ padding: '8px 16px', fontSize: 13 }} onClick={() => {
                      setPasswordPrompt({ 
                        isOpen: true, 
                        reason: "Enter Current Password to Remove", 
                        onSuccess: () => {
                          setMasterPassword("");
                          const s = loadSettings();
                          s.masterPassword = "";
                          saveSettings(s);
                        }
                      });
                    }}>Remove Password</button>
                  </div>
                ) : (
                  <button className="btn-primary" style={{ padding: '8px 16px', fontSize: 13, alignSelf: 'flex-start' }} onClick={() => {
                    setPasswordPrompt({ 
                      isOpen: true, 
                      reason: "Set New Master Password", 
                      onSuccess: (newPwd) => {
                        setMasterPassword(newPwd as string);
                        const s = loadSettings();
                        s.masterPassword = newPwd;
                        saveSettings(s);
                      }
                    });
                  }}>Set Master Password</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showSettingsGuide && (
        <div className="settings-guide-overlay" style={{ zIndex: 99999 }}>
          <div className="settings-guide-card">
            
            {settingsGuideMode === "intro" ? (
              <div className="settings-guide-intro-screen">
                <div style={{ marginBottom: 32, textAlign: 'center' }}>
                  <p className="settings-guide-intro" style={{ marginBottom: 0, fontSize: 16 }}>
                    <strong>SPIA</strong> works great on its own, meaning it saves videos on your mac, but connecting Telegram or Discord lets you get instant alerts on your phone — even when you're away.
                  </p>
                </div>
                
                <div style={{ display: 'flex', gap: 12, width: '100%', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button 
                      className="btn-primary" 
                      style={{ flex: 1, padding: "10px 16px" }}
                      onClick={() => { setSettingsGuideMode("telegram"); setSettingsGuideStep(1); }}
                    >
                      Setup Telegram
                    </button>
                    <button 
                      className="btn-primary" 
                      style={{ flex: 1, padding: "10px 16px" }}
                      onClick={() => { setSettingsGuideMode("discord"); setSettingsGuideStep(1); }}
                    >
                      Setup Discord
                    </button>
                  </div>
                  <button 
                    className="btn-outline" 
                    style={{ width: '100%', padding: "10px 16px" }}
                    onClick={() => {
                      setShowSettingsGuide(false);
                      const s = loadSettings();
                      s.settingsGuideSeenAt = Date.now();
                      saveSettings(s);
                    }}
                  >
                    Skip, I'm a genius
                  </button>
                </div>
              </div>
            ) : (
              <>
                {settingsGuideMode === "telegram" ? (
                  <div className="settings-guide-step-content" style={{ marginTop: 0 }}>
                    {settingsGuideStep === 1 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 1: Create a Bot</h4>
                        <p className="settings-guide-step-text">
                          Open Telegram on your phone or Mac and search for <strong>@BotFather</strong>. 
                          Send him the command <code>/newbot</code>. He will ask you to choose a name and a username for your bot.
                        </p>
                      </>
                    )}
                    {settingsGuideStep === 2 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 2: Get the Token</h4>
                        <p className="settings-guide-step-text">
                          After creating the bot, BotFather will give you a token that looks like this: <code>1234567:ABCdef...</code><br/><br/>
                          Copy this token and paste it into the <strong>Bot Token</strong> field in SPIA.
                        </p>
                      </>
                    )}
                    {settingsGuideStep === 3 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 3: Start the Bot</h4>
                        <p className="settings-guide-step-text">
                          Find your newly created bot in Telegram (search for the username you gave it). 
                          Open the chat with your bot and click <strong>Start</strong> or send the command <code>/start</code>.
                        </p>
                      </>
                    )}
                    {settingsGuideStep === 4 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 4: Get Chat ID</h4>
                        <p className="settings-guide-step-text">
                          The most reliable way to get your Chat ID is using an ID bot.<br/><br/>
                          Search for <strong>@userinfobot</strong> in Telegram and click Start. It will instantly reply with your ID (e.g., <code>Id: 123456789</code>). Copy this number into the <strong>Chat ID</strong> field.<br/><br/>
                          <span style={{ fontSize: "0.9em", opacity: 0.7 }}>
                            <em>Tip: To send alerts to a group, add your bot to the group, then add <strong>@RawDataBot</strong> to the group to reveal its ID.</em>
                          </span>
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="settings-guide-step-content" style={{ marginTop: 0 }}>
                    {settingsGuideStep === 1 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 1: Server Settings</h4>
                        <p className="settings-guide-step-text">
                          Open Discord, go to the server where you want to receive notifications, and click the server name at the top left to open the dropdown menu. Select <strong>Server Settings</strong>.
                        </p>
                      </>
                    )}
                    {settingsGuideStep === 2 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 2: Integrations</h4>
                        <p className="settings-guide-step-text">
                          In the Server Settings menu, click on <strong>Integrations</strong> in the left sidebar, then click on <strong>Webhooks</strong>.
                        </p>
                      </>
                    )}
                    {settingsGuideStep === 3 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 3: Create Webhook</h4>
                        <p className="settings-guide-step-text">
                          Click the <strong>New Webhook</strong> button. Give it a name (like "SPIA Alerts") and choose which channel it should post in.
                        </p>
                      </>
                    )}
                    {settingsGuideStep === 4 && (
                      <>
                        <h4 className="settings-guide-step-title">Step 4: Copy URL</h4>
                        <p className="settings-guide-step-text">
                          Click the <strong>Copy Webhook URL</strong> button at the bottom of the webhook settings. Paste this URL into the <strong>Webhook URL</strong> field in SPIA.
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div className="settings-guide-nav">
                  <button 
                    className="btn-text" 
                    onClick={() => {
                      if (settingsGuideStep > 1) {
                        setSettingsGuideStep(prev => prev - 1);
                      } else {
                        setShowSettingsGuide(false);
                      }
                    }}
                  >
                    ← Back
                  </button>
                  
                  <span className="settings-guide-progress">Step {settingsGuideStep} / 4</span>
                  
                  {settingsGuideStep < 4 ? (
                    <button 
                      className="btn-text" 
                      onClick={() => setSettingsGuideStep(prev => prev + 1)}
                      style={{ color: "#fff" }}
                    >
                      Next →
                    </button>
                  ) : (
                    <button 
                      className="btn-primary" 
                      style={{ padding: "4px 16px" }}
                      onClick={() => {
                        setShowSettingsGuide(false);
                        const s = loadSettings();
                        s.settingsGuideSeenAt = Date.now();
                        saveSettings(s);
                      }}
                    >
                      Done
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
