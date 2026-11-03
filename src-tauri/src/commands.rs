//! Tauri command 处理器（1:1 对应 main/preload.js 暴露的 window.moyu IPC 全集）

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::{backgrounds, core, events, focus, state::AppState, window};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

fn changelog() -> Value {
    json!([
        {
            "version": "1.2.0",
            "date": "2026-10-31",
            "notes": [
                "新增「专注」：识别你是在认真工作还是在摸鱼",
                "把常用的工作软件加进列表，用它们算专注，用其它软件算摸鱼；后台开着的软件不算",
                "长时间不操作或锁屏算「离开」，判定时间可调",
                "统计今日专注时长、摸鱼时长、摸鱼赚了多少钱、专注率，以及近 7 天趋势",
                "可选：下班后、休息日用工作软件计为加班",
                "主界面、桌面小组件、托盘分别可以显示或隐藏",
                "安装包更小：只保留中英文语言包；mac 版按芯片分成两个包"
            ]
        },
        {
            "version": "1.1.0",
            "date": "2026-10-31",
            "notes": [
                "新增「外观」设置：主界面和桌面小组件都能换成自定义背景",
                "支持图片（PNG/JPG/WebP/BMP）、GIF 动图和视频（MP4/WebM/MOV）",
                "主界面和小组件可以用不同背景，也可以让小组件跟随主界面",
                "可选择铺满或完整显示，还能调节遮罩暗度，保证文字看得清",
                "素材可直接拖进窗口导入，重复的素材会自动识别",
                "新增「应用」页：查看版本、更新日志、打开数据文件夹",
                "安装新版本会直接覆盖升级，原有设置和背景都会保留"
            ]
        },
        {
            "version": "1.0.0",
            "date": "2026-10-31",
            "notes": [
                "下班倒计时、今日实时收入、日薪、时薪、距离休息与发薪",
                "小狐狸钓鱼场景，随时间与状态变化，可点击互动",
                "桌面悬浮小组件、菜单栏倒计时、上下班提醒、开机自启",
                "双休 / 单休 / 大小周 / 自定义休息日，节假日与调休"
            ]
        }
    ])
}

fn public_prefs(app_cfg: &Value) -> Value {
    let mut p = app_cfg.as_object().cloned().unwrap_or_default();
    p.remove("widgetBounds");
    p.remove("closeTipShown");
    Value::Object(p)
}

fn normalize_focus(raw: Value) -> focus::FocusConfig {
    let mut c: focus::FocusConfig = serde_json::from_value(raw).unwrap_or_default();
    if ![0, 2, 5, 10, 15, 30].contains(&c.idle_minutes) {
        c.idle_minutes = 5;
    }
    let mut seen = std::collections::HashSet::new();
    c.apps.retain(|a| !a.id.is_empty() && seen.insert(a.id.clone()));
    for a in c.apps.iter_mut() {
        a.name = a.name.chars().take(60).collect();
    }
    c
}

/* ---------------- 状态 ---------------- */

#[tauri::command]
pub fn get_state(state: State<'_, AppState>) -> Value {
    let g = state.lock();
    let work = core::normalize(&g.store.get("work"));
    let work_value = serde_json::to_value(&work).unwrap();
    let app_value = public_prefs(&g.store.get("app"));
    let look_value = g.store.get("look");
    drop(g);
    json!({
        "work": work_value,
        "app": app_value,
        "look": look_value,
        "platform": std::env::consts::OS,
        "version": APP_VERSION,
        "packaged": !cfg!(debug_assertions),
        "changelog": changelog(),
        "updateInfo": null
    })
}

#[tauri::command]
pub fn save_work(app: AppHandle, state: State<'_, AppState>, work: Value) -> Value {
    let normalized = core::normalize(&work);
    let errors = core::validate(&normalized);
    if !errors.is_empty() {
        return json!({ "ok": false, "errors": errors });
    }
    let work_value = serde_json::to_value(&normalized).unwrap();
    {
        let mut g = state.lock();
        g.store.set("work", work_value.clone());
    }
    events::emit(&app, events::WORK_CHANGED, &work_value);
    json!({ "ok": true, "work": work_value })
}

#[tauri::command]
pub fn set_app(app: AppHandle, state: State<'_, AppState>, patch: Value) -> Value {
    const ALLOWED: [&str; 6] = ["autoLaunch", "widgetVisible", "widgetOnTop", "widgetScale", "trayCountdown", "notify"];
    let mut clean = serde_json::Map::new();
    if let Some(p) = patch.as_object() {
        for k in ALLOWED {
            if let Some(v) = p.get(k) {
                clean.insert(k.to_string(), v.clone());
            }
        }
    }

    if let Some(v) = clean.get("widgetVisible") {
        window::set_widget_visible(&app, v.as_bool().unwrap_or(true));
        clean.remove("widgetVisible");
    }
    if let Some(v) = clean.get("widgetScale") {
        let s = v.as_f64().unwrap_or(1.0);
        window::set_widget_scale(&app, s);
        clean.remove("widgetScale");
    }

    if !clean.is_empty() {
        {
            let mut g = state.lock();
            g.store.patch("app", Value::Object(clean.clone()));
        }
        if let Some(v) = clean.get("autoLaunch") {
            let on = v.as_bool().unwrap_or(false);
            if !cfg!(debug_assertions) {
                use tauri_plugin_autostart::ManagerExt;
                let auto = app.autolaunch();
                let _ = if on { auto.enable() } else { auto.disable() };
            }
        }
        if let Some(v) = clean.get("widgetOnTop") {
            window::set_widget_on_top(&app, v.as_bool().unwrap_or(true));
        }
    }

    let g = state.lock();
    let app_value = public_prefs(&g.store.get("app"));
    drop(g);
    events::emit(&app, events::APP_CHANGED, &app_value);
    app_value
}

/* ---------------- 外观 ---------------- */

fn normalize_look(raw: Value) -> Value {
    let mut l = raw.as_object().cloned().unwrap_or_default();
    if !l.contains_key("library") {
        l.insert("library".into(), json!([]));
    }
    if !l.contains_key("main") {
        l.insert("main".into(), json!("builtin"));
    }
    if !l.contains_key("widget") {
        l.insert("widget".into(), json!("same"));
    }
    if !l.contains_key("fit") {
        l.insert("fit".into(), json!("cover"));
    }
    if !l.contains_key("dim") {
        l.insert("dim".into(), json!(15));
    }
    Value::Object(l)
}

fn backgrounds_dir(state: &State<'_, AppState>) -> PathBuf {
    state.lock().data_dir.join("backgrounds")
}

#[tauri::command]
pub async fn look_pick(app: AppHandle, state: State<'_, AppState>, target: String) -> Result<Value, String> {
    let files = app
        .dialog()
        .file()
        .add_filter("图片、GIF 动图、视频", &backgrounds::PICK_EXTENSIONS)
        .add_filter("所有文件", &["*"])
        .blocking_pick_files();

    let paths: Vec<PathBuf> = match files {
        Some(files) => files.into_iter().filter_map(|f| f.into_path().ok()).collect(),
        None => {
            let g = state.lock();
            return Ok(json!({ "look": g.store.get("look"), "added": [], "duplicates": [], "errors": [], "canceled": true }));
        }
    };
    Ok(import_backgrounds(&app, &state, &paths, &target))
}

#[tauri::command]
pub async fn look_import(app: AppHandle, state: State<'_, AppState>, paths: Vec<String>, target: String) -> Result<Value, String> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    Ok(import_backgrounds(&app, &state, &paths, &target))
}

#[tauri::command]
pub async fn look_import_files(app: AppHandle, state: State<'_, AppState>, files: Vec<Value>, target: String) -> Result<Value, String> {
    // 拖拽导入：前端把 File 字节读进来，这里落成临时文件再走统一导入流程
    let dir = state.lock().data_dir.join("backgrounds");
    let stamp = chrono::Utc::now().timestamp_millis();
    let mut tmp_paths: Vec<PathBuf> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("import").to_string();
        let bytes: Vec<u8> = f
            .get("bytes")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64().map(|x| x as u8)).collect())
            .unwrap_or_default();
        if bytes.is_empty() {
            continue;
        }
        let tmp = dir.join(format!(".import-{}-{}-{}", stamp, i, name));
        if std::fs::write(&tmp, &bytes).is_ok() {
            tmp_paths.push(tmp);
        }
    }
    let result = import_backgrounds(&app, &state, &tmp_paths, &target);
    for p in tmp_paths {
        let _ = std::fs::remove_file(p);
    }
    Ok(result)
}

fn import_backgrounds(app: &AppHandle, state: &State<'_, AppState>, paths: &[PathBuf], target: &str) -> Value {
    let dir = backgrounds_dir(state);
    let mut lib: Vec<backgrounds::BackgroundItem> = {
        let g = state.lock();
        let look = g.store.get("look");
        serde_json::from_value(look.get("library").cloned().unwrap_or(json!([]))).unwrap_or_default()
    };

    let mut added: Vec<String> = Vec::new();
    let mut duplicates: Vec<String> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    let mut first_id: Option<String> = None;

    for p in paths.iter().take(30) {
        let r = backgrounds::import(p, &dir, &lib);
        match r {
            backgrounds::ImportResult { ok: true, duplicate: true, item: Some(item), .. } => {
                duplicates.push(item.name.clone());
            }
            backgrounds::ImportResult { ok: true, duplicate: false, item: Some(item), .. } => {
                if first_id.is_none() {
                    first_id = Some(item.id.clone());
                }
                added.push(item.name.clone());
                lib.insert(0, item);
            }
            backgrounds::ImportResult { error: Some(e), .. } => {
                errors.push(json!({ "name": p.file_name().and_then(|s| s.to_str()).unwrap_or(""), "error": e }));
            }
            _ => {}
        }
    }

    // 更新 look.library
    let lib_value = serde_json::to_value(&lib).unwrap();
    let mut g = state.lock();
    let mut look = g.store.get("look");
    if let Some(obj) = look.as_object_mut() {
        obj.insert("library".into(), lib_value);
        if let Some(id) = &first_id {
            if target == "main" || target == "widget" {
                obj.insert(target.to_string(), json!(id));
            }
        }
    }
    let saved = normalize_look(look.clone());
    g.store.set("look", saved.clone());
    drop(g);

    events::emit(app, events::LOOK_CHANGED, &saved);
    json!({
        "look": saved,
        "added": added,
        "duplicates": duplicates,
        "errors": errors
    })
}

#[tauri::command]
pub fn look_remove(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    let dir = backgrounds_dir(&state);
    let mut g = state.lock();
    let look = g.store.get("look");
    let lib: Vec<backgrounds::BackgroundItem> =
        serde_json::from_value(look.get("library").cloned().unwrap_or(json!([]))).unwrap_or_default();
    let item = lib.iter().find(|x| x.id == id).cloned();
    let new_lib: Vec<backgrounds::BackgroundItem> = lib.into_iter().filter(|x| x.id != id).collect();

    let mut next = look.clone();
    if let Some(obj) = next.as_object_mut() {
        obj.insert("library".into(), serde_json::to_value(&new_lib).unwrap());
    }
    let saved = normalize_look(next);
    g.store.set("look", saved.clone());
    drop(g);

    if let Some(item) = item {
        backgrounds::remove(&dir, &item);
    }
    events::emit(&app, events::LOOK_CHANGED, &saved);
    saved
}

#[tauri::command]
pub fn look_set(app: AppHandle, state: State<'_, AppState>, patch: Value) -> Value {
    let mut g = state.lock();
    let look = g.store.get("look");
    let mut next = look.clone();
    if let Some(p) = patch.as_object() {
        if let Some(obj) = next.as_object_mut() {
            for (k, v) in p {
                if matches!(k.as_str(), "main" | "widget" | "fit" | "dim") {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
    let saved = normalize_look(next);
    g.store.set("look", saved.clone());
    drop(g);
    events::emit(&app, events::LOOK_CHANGED, &saved);
    saved
}

/* ---------------- 专注 ---------------- */

#[tauri::command]
pub fn focus_get(state: State<'_, AppState>) -> Value {
    let (cfg, tracker) = {
        let g = state.lock();
        let cfg = normalize_focus(g.store.get("focus"));
        (cfg, g.focus.clone())
    };
    let now_ms = chrono::Utc::now().timestamp_millis();
    let tracker = tracker.lock().unwrap();
    json!({
        "cfg": tracker_cfg_value(&cfg),
        "live": tracker.live,
        "error": "",
        "today": tracker.today(now_ms, &cfg),
        "recent": tracker.recent_apps(now_ms, &cfg),
        "history": tracker.history(now_ms, 7),
        "platform": std::env::consts::OS
    })
}

fn tracker_cfg_value(cfg: &focus::FocusConfig) -> Value {
    serde_json::to_value(cfg).unwrap()
}

#[tauri::command]
pub fn focus_set(app: AppHandle, state: State<'_, AppState>, patch: Value) -> Value {
    let mut g = state.lock();
    let cur = g.store.get("focus");
    let mut next = serde_json::to_value(normalize_focus(cur)).unwrap();
    if let Some(p) = patch.as_object() {
        if let Some(obj) = next.as_object_mut() {
            for k in ["enabled", "idleMinutes", "countOvertime", "showOnMain", "showOnWidget", "showInTray", "apps"] {
                if let Some(v) = p.get(k) {
                    obj.insert(k.to_string(), v.clone());
                }
            }
        }
    }
    let cfg = normalize_focus(next);
    let cfg_value = serde_json::to_value(&cfg).unwrap();
    g.store.set("focus", cfg_value.clone());
    drop(g);
    events::emit(&app, events::FOCUS_CONFIG, &cfg_value);
    cfg_value
}

#[tauri::command]
pub fn focus_add(app: AppHandle, state: State<'_, AppState>, app_item: Value) -> Value {
    let id = app_item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let name = app_item.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
    if id.is_empty() {
        return focus_cfg_value(&state);
    }
    let mut g = state.lock();
    let mut cfg = normalize_focus(g.store.get("focus"));
    cfg.apps.retain(|a| a.id != id);
    cfg.apps.push(focus::WorkApp { id, name });
    let cfg_value = serde_json::to_value(&cfg).unwrap();
    g.store.set("focus", cfg_value.clone());
    drop(g);
    events::emit(&app, events::FOCUS_CONFIG, &cfg_value);
    cfg_value
}

#[tauri::command]
pub fn focus_remove(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    let mut g = state.lock();
    let mut cfg = normalize_focus(g.store.get("focus"));
    cfg.apps.retain(|a| a.id != id);
    let cfg_value = serde_json::to_value(&cfg).unwrap();
    g.store.set("focus", cfg_value.clone());
    drop(g);
    events::emit(&app, events::FOCUS_CONFIG, &cfg_value);
    cfg_value
}

fn focus_cfg_value(state: &State<'_, AppState>) -> Value {
    let g = state.lock();
    let cfg = normalize_focus(g.store.get("focus"));
    drop(g);
    serde_json::to_value(&cfg).unwrap()
}

#[tauri::command]
pub async fn focus_pick(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let is_mac = cfg!(target_os = "macos");
    let exts: &[&str] = if is_mac { &["app"] } else { &["exe"] };
    let name = if is_mac { "应用程序" } else { "程序" };
    let files = app.dialog().file().add_filter(name, exts).blocking_pick_files();

    let mut added: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    if let Some(files) = files {
        for f in files {
            if let Ok(path) = f.into_path() {
                match focus::describe_app_file(&path) {
                    Ok(wa) => {
                        let mut g = state.lock();
                        let mut cfg = normalize_focus(g.store.get("focus"));
                        cfg.apps.retain(|a| a.id != wa.id);
                        cfg.apps.push(wa.clone());
                        g.store.set("focus", serde_json::to_value(&cfg).unwrap());
                        drop(g);
                        added.push(wa.name);
                    }
                    Err(e) => errors.push(e),
                }
            }
        }
    }
    let cfg = focus_cfg_value(&state);
    events::emit(&app, events::FOCUS_CONFIG, &cfg);
    Ok(json!({ "cfg": cfg, "added": added, "errors": errors }))
}

/* ---------------- 其它（事件式） ---------------- */

#[tauri::command]
pub fn open_main(app: AppHandle) {
    window::show_main(&app);
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle, state: State<'_, AppState>) {
    let dir = state.lock().data_dir.clone();
    let _ = app.opener().open_path(dir.to_string_lossy().to_string(), None::<&str>);
}

#[tauri::command]
pub fn update_ack() {
    // 版本更新提示已确认（updateInfo 暂未实现，保留空实现）
}
