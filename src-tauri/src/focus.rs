//! 专注识别（移植自 main/focus.js）
//!
//! 只看「前台」软件：工作时间内用工作软件算「专注」，用其它软件算「摸鱼」。
//! - macOS：轮询系统自带 `lsappinfo`，无需权限
//! - Windows：Win32 `GetForegroundWindow` + `QueryFullProcessImageNameW`（替换原 PowerShell hack）
//! 键鼠长时间无操作或锁屏记为「离开」。

#![allow(dead_code)] // 部分函数在 commands（bridge 阶段）才被调用

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::TimeZone;
use serde::{Deserialize, Serialize};

pub const KEEP_DAYS: usize = 120;

/* ---------------- 类型 ---------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkApp {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusConfig {
    pub enabled: bool,
    pub apps: Vec<WorkApp>,
    pub idle_minutes: i64,
    pub count_overtime: bool,
    pub show_on_main: bool,
    pub show_on_widget: bool,
    pub show_in_tray: bool,
}

impl Default for FocusConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            apps: Vec::new(),
            idle_minutes: 5,
            count_overtime: false,
            show_on_main: true,
            show_on_widget: true,
            show_in_tray: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    pub is_self: bool,
}

#[derive(Debug, Clone)]
struct SeenApp {
    id: String,
    name: String,
    at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pub name: String,
    pub secs: f64,
    #[serde(default, rename = "self")]
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DayRecord {
    pub focus: f64,
    pub slack: f64,
    pub away: f64,
    pub overtime: f64,
    pub apps: BTreeMap<String, AppUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StatsData {
    pub days: BTreeMap<String, DayRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    pub state: String,
    pub app: Option<AppInfo>,
    pub is_work: bool,
}

impl Default for LiveState {
    fn default() -> Self {
        Self {
            state: "off".into(),
            app: None,
            is_work: false,
        }
    }
}

/* ---------------- 统计器 ---------------- */

pub struct FocusTracker {
    file: PathBuf,
    data: StatsData,
    current: Option<AppInfo>,
    seen: Vec<SeenApp>,
    last_at: i64,
    dirty: bool,
    last_save: i64,
    pub live: LiveState,
}

pub struct SampleInput<'a> {
    pub now_ms: i64,
    pub cfg: &'a FocusConfig,
    pub status: &'a str, // working / lunch / before / off / rest / invalid
    pub idle_seconds: f64,
    pub locked: bool,
    pub available: bool,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn day_key_from_ms(ms: i64) -> String {
    let dt = chrono::Utc.timestamp_millis_opt(ms).single().unwrap_or_else(chrono::Utc::now);
    dt.format("%Y-%m-%d").to_string()
}

impl FocusTracker {
    pub fn new(file: PathBuf) -> Self {
        let data = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str::<StatsData>(&s).ok())
            .unwrap_or_default();
        let last_save = now_ms();
        Self {
            file,
            data,
            current: None,
            seen: Vec::new(),
            last_at: 0,
            dirty: false,
            last_save,
            live: LiveState::default(),
        }
    }

    fn day(&mut self, key: &str) -> &mut DayRecord {
        self.data.days.entry(key.to_string()).or_default()
    }

    pub fn set_current(&mut self, app: Option<AppInfo>) {
        let same = match (&self.current, &app) {
            (Some(a), Some(b)) => a.id == b.id,
            (None, None) => true,
            _ => false,
        };
        if same {
            if app.is_some() {
                self.current = app;
            }
            return;
        }
        self.current = app.clone();
        if let Some(a) = app {
            self.note_app(&a);
        }
    }

    pub fn note_app(&mut self, app: &AppInfo) {
        if app.is_self || app.id == "unknown" {
            return;
        }
        self.seen.retain(|s| s.id != app.id);
        self.seen.push(SeenApp {
            id: app.id.clone(),
            name: app.name.clone(),
            at: now_ms(),
        });
    }

    /// 每秒调用一次。按距离上次采样的真实间隔累加（超过 5 秒的间隔丢弃）。
    pub fn sample(&mut self, p: SampleInput) -> LiveState {
        let dt = if self.last_at == 0 {
            0.0
        } else {
            ((p.now_ms - self.last_at) as f64) / 1000.0
        };
        self.last_at = p.now_ms;

        let app = self.current.clone();
        let is_work = app.as_ref().map(|a| p.cfg.apps.iter().any(|w| w.id == a.id)).unwrap_or(false);

        let state = if !p.cfg.enabled {
            "off".to_string()
        } else if !p.available {
            "unavailable".to_string()
        } else {
            let away = p.locked || (p.cfg.idle_minutes > 0 && p.idle_seconds >= p.cfg.idle_minutes as f64 * 60.0);
            if p.status == "working" {
                if away {
                    "away"
                } else if is_work {
                    "focus"
                } else {
                    "slack"
                }
            } else if p.cfg.count_overtime && !away && is_work {
                "overtime"
            } else {
                "outside"
            }
            .to_string()
        };

        let live = LiveState {
            state: state.clone(),
            app: app.clone(),
            is_work,
        };
        self.live = live.clone();

        if dt <= 0.0 || dt > 5.0 || !["focus", "slack", "away", "overtime"].contains(&state.as_str()) {
            return live;
        }

        let rec = self.day(&day_key_from_ms(p.now_ms));
        match state.as_str() {
            "focus" => rec.focus += dt,
            "slack" => rec.slack += dt,
            "away" => rec.away += dt,
            "overtime" => rec.overtime += dt,
            _ => {}
        }
        if state != "away" {
            if let Some(a) = &app {
                let usage = rec.apps.entry(a.id.clone()).or_insert(AppUsage {
                    name: a.name.clone(),
                    secs: 0.0,
                    is_self: false,
                });
                usage.secs += dt;
                usage.name = a.name.clone();
                if a.is_self {
                    usage.is_self = true;
                }
            }
        }
        self.dirty = true;
        if now_ms() - self.last_save > 30000 {
            self.flush();
        }
        live
    }

    pub fn today(&self, now_ms: i64, cfg: &FocusConfig) -> TodaySummary {
        let key = day_key_from_ms(now_ms);
        let rec = self.data.days.get(&key).cloned().unwrap_or_default();
        let mut apps: Vec<TodayApp> = rec
            .apps
            .iter()
            .map(|(id, a)| TodayApp {
                id: id.clone(),
                name: a.name.clone(),
                secs: a.secs,
                is_self: a.is_self,
                work: cfg.apps.iter().any(|w| w.id == *id),
            })
            .collect();
        apps.sort_by(|a, b| b.secs.partial_cmp(&a.secs).unwrap_or(std::cmp::Ordering::Equal));
        TodaySummary {
            focus: rec.focus,
            slack: rec.slack,
            away: rec.away,
            overtime: rec.overtime,
            apps,
        }
    }

    pub fn recent_apps(&self, now_ms: i64, cfg: &FocusConfig) -> Vec<TodayApp> {
        let mut map: BTreeMap<String, TodayApp> = self
            .today(now_ms, cfg)
            .apps
            .into_iter()
            .filter(|a| !a.is_self && a.id != "unknown")
            .map(|a| (a.id.clone(), a))
            .collect();
        let mut seen: Vec<&SeenApp> = self.seen.iter().collect();
        seen.sort_by(|a, b| b.at.cmp(&a.at));
        for s in seen {
            if !map.contains_key(&s.id) {
                map.insert(
                    s.id.clone(),
                    TodayApp {
                        id: s.id.clone(),
                        name: s.name.clone(),
                        secs: 0.0,
                        is_self: false,
                        work: cfg.apps.iter().any(|w| w.id == s.id),
                    },
                );
            }
        }
        map.into_values().take(30).collect()
    }

    pub fn history(&self, now_ms: i64, days: i64) -> Vec<HistoryDay> {
        let today = chrono::Utc.timestamp_millis_opt(now_ms)
            .single()
            .unwrap_or_else(chrono::Utc::now)
            .date_naive();
        let mut out = Vec::new();
        for i in (0..days).rev() {
            let d = today - chrono::Duration::days(i);
            let key = d.format("%Y-%m-%d").to_string();
            let r = self.data.days.get(&key).cloned().unwrap_or_default();
            out.push(HistoryDay {
                date: key,
                focus: r.focus + r.overtime,
                slack: r.slack,
                away: r.away,
            });
        }
        out
    }

    pub fn flush(&mut self) {
        self.last_save = now_ms();
        if !self.dirty {
            return;
        }
        self.dirty = false;
        // 保留最近 KEEP_DAYS 天
        let keys: Vec<String> = self.data.days.keys().cloned().collect();
        let mut sorted = keys.clone();
        sorted.sort();
        let remove = sorted.len().saturating_sub(KEEP_DAYS);
        for k in sorted.into_iter().take(remove) {
            self.data.days.remove(&k);
        }
        let _ = keys;
        if let Some(dir) = self.file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = self.file.with_extension("json.tmp");
        if let Ok(json) = serde_json::to_string(&self.data) {
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &self.file);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayApp {
    pub id: String,
    pub name: String,
    pub secs: f64,
    pub is_self: bool,
    pub work: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodaySummary {
    pub focus: f64,
    pub slack: f64,
    pub away: f64,
    pub overtime: f64,
    pub apps: Vec<TodayApp>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDay {
    pub date: String,
    pub focus: f64,
    pub slack: f64,
    pub away: f64,
}

/* ---------------- 空闲 / 锁屏 ---------------- */

#[cfg(target_os = "macos")]
pub fn idle_seconds() -> f64 {
    // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = u32::MAX
    unsafe { sys::CGEventSourceSecondsSinceLastEventType(0, u32::MAX) }
}

#[cfg(target_os = "macos")]
pub fn is_locked() -> bool {
    // 简化：mac 下锁屏判定暂不实现，仅靠空闲超时判定「离开」。
    false
}

#[cfg(target_os = "macos")]
mod sys {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
}

#[cfg(not(target_os = "macos"))]
pub fn idle_seconds() -> f64 {
    #[cfg(target_os = "windows")]
    {
        unsafe { win::last_input_seconds() }
    }
    #[cfg(not(target_os = "windows"))]
    {
        0.0
    }
}

#[cfg(not(target_os = "macos"))]
pub fn is_locked() -> bool {
    false
}

/* ---------------- 前台软件识别 ---------------- */

fn run_cmd(cmd: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn parse_kv(s: &str) -> BTreeMap<String, String> {
    let mut kv = BTreeMap::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\n' | b'\t' | b'\r') {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'"' {
            i += 1;
            continue;
        }
        let key_start = i + 1;
        let mut key_end = key_start;
        while key_end < bytes.len() && bytes[key_end] != b'"' {
            key_end += 1;
        }
        if key_end >= bytes.len() {
            break;
        }
        let key = &s[key_start..key_end];
        i = key_end + 1;
        while i < bytes.len() && bytes[i] != b'"' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let val_start = i + 1;
        let mut val_end = val_start;
        while val_end < bytes.len() && bytes[val_end] != b'"' {
            val_end += 1;
        }
        let val = &s[val_start..val_end];
        kv.insert(key.to_string(), val.to_string());
        i = val_end + 1;
    }
    kv
}

#[cfg(target_os = "macos")]
pub fn poll_frontmost() -> Option<AppInfo> {
    let asn = run_cmd("lsappinfo", &["front"])?;
    let asn = asn.trim().to_string();
    if asn.is_empty() {
        return None;
    }
    let out = run_cmd(
        "lsappinfo",
        &["info", "-only", "bundleid", "-only", "name", "-only", "bundlepath", &asn],
    )?;
    let kv = parse_kv(&out);
    let bundle_path = kv.get("LSBundlePath").cloned();
    let name = kv
        .get("LSDisplayName")
        .cloned()
        .or_else(|| bundle_path.as_ref().map(|p| basename_without_ext(p)));
    let id = kv
        .get("CFBundleIdentifier")
        .cloned()
        .or_else(|| name.as_ref().map(|n| format!("name:{}", n)));
    let id = id?;
    let name = name.unwrap_or_else(|| id.clone());
    let is_self = bundle_path.as_ref().map(|p| is_self_bundle(p)).unwrap_or(false);
    Some(AppInfo { id, name, is_self })
}

fn basename_without_ext(p: &str) -> String {
    let base = p.rsplit('/').next().unwrap_or(p);
    base.strip_suffix(".app").unwrap_or(base).to_string()
}

#[cfg(target_os = "macos")]
fn is_self_bundle(bundle_path: &str) -> bool {
    std::env::current_exe()
        .ok()
        .map(|e| e.to_string_lossy().starts_with(&format!("{}/", bundle_path)))
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
pub fn poll_frontmost() -> Option<AppInfo> {
    #[cfg(target_os = "windows")]
    {
        return win::foreground_app();
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/* ---------------- watcher 线程 ---------------- */

pub fn spawn_watcher(tracker: Arc<Mutex<FocusTracker>>) {
    std::thread::spawn(move || {
        loop {
            let app = poll_frontmost();
            if let Ok(mut t) = tracker.lock() {
                t.set_current(app);
            }
            std::thread::sleep(Duration::from_millis(1500));
        }
    });
}

/* ---------------- 手动选择软件 ---------------- */

pub fn describe_app_file(file: &std::path::Path) -> Result<WorkApp, String> {
    #[cfg(target_os = "macos")]
    {
        let plist = file.join("Contents").join("Info.plist");
        let read = |key: &str| -> Option<String> {
            run_cmd("plutil", &["-extract", key, "raw", "-o", "-", plist.to_str()?])
                .map(|s| s.trim().to_string())
        };
        let id = read("CFBundleIdentifier").ok_or("这不是一个有效的应用程序")?.trim().to_string();
        if id.is_empty() {
            return Err("这不是一个有效的应用程序".into());
        }
        let name = read("CFBundleDisplayName")
            .or_else(|| read("CFBundleName"))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| basename_without_ext(&file.to_string_lossy()));
        return Ok(WorkApp { id, name });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let base = file.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !base.to_lowercase().ends_with(".exe") {
            return Err("请选择 .exe 程序".into());
        }
        let id = base.to_lowercase();
        let name = base.strip_suffix(".exe").unwrap_or(base).to_string();
        return Ok(WorkApp { id, name });
    }
}

/* ---------------- Windows（cfg windows） ---------------- */

#[cfg(target_os = "windows")]
mod win {
    use super::AppInfo;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    pub fn foreground_app() -> Option<AppInfo> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0 == 0 {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return None;
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let result = QueryFullProcessImageNameW(handle, 0, PWSTR(buf.as_mut_ptr()), &mut size);
            let _ = CloseHandle(handle);
            if result.is_err() {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..size as usize]);
            let file = path.rsplit('\\').next().unwrap_or(&path).to_string();
            let id = file.to_lowercase();
            let name = file.strip_suffix(".exe").unwrap_or(&file).to_string();
            let is_self = pid == GetCurrentProcessId();
            Some(AppInfo { id, name, is_self })
        }
    }

    pub fn last_input_seconds() -> f64 {
        unsafe {
            let mut lii = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if GetLastInputInfo(&mut lii).is_ok() {
                let tick = GetTickCount();
                ((tick.saturating_sub(lii.dwTime)) as f64) / 1000.0
            } else {
                0.0
            }
        }
    }

    fn GetTickCount() -> u32 {
        unsafe { windows::Win32::System::SystemInformation::GetTickCount() }
    }
}
