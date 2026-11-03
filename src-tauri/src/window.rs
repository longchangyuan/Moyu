//! 窗口管理：主窗口、桌面小组件窗口

use serde_json::Value;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::state::AppState;

pub const WIDGET_BASE: f64 = 240.0;

fn get_f64(v: &Value, key: &str, def: f64) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(def)
}

fn get_bool(v: &Value, key: &str, def: bool) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(def)
}

/// 读取小组件设置（scale + 置顶），不持有锁
fn widget_cfg(app: &AppHandle) -> (f64, bool) {
    let state = app.state::<AppState>();
    let g = state.lock();
    let cfg = g.store.get("app");
    (get_f64(&cfg, "widgetScale", 1.0), get_bool(&cfg, "widgetOnTop", true))
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_minimized().unwrap_or(false) {
            let _ = win.unminimize();
        }
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// 创建桌面小组件窗口（无边框、透明、置顶、不进任务栏）
pub fn create_widget(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("widget").is_some() {
        // 已存在，仅显示
        if let Some(w) = app.get_webview_window("widget") {
            let _ = w.show();
        }
        return Ok(());
    }

    let (scale, on_top) = widget_cfg(app);
    let size = (WIDGET_BASE * scale).round();

    let win = WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("widget.html".into()))
        .title("摸鱼小狐 · 小组件")
        .inner_size(size, size)
        .decorations(false)
        .transparent(true)
        .always_on_top(on_top)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .fullscreen(false)
        .shadow(false)
        .visible(false)
        .build()?;

    // 默认位置：主屏右上角（与 main.js widgetPosition 默认值一致）
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let wa = monitor.work_area();
        let x = wa.position.x + wa.size.width as i32 - size as i32 - 24;
        let y = wa.position.y + 24;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    let _ = win.show();
    Ok(())
}

pub fn hide_widget(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.close();
    }
}

pub fn set_widget_on_top(app: &AppHandle, on_top: bool) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.set_always_on_top(on_top);
    }
}

pub fn set_widget_visible(app: &AppHandle, visible: bool) {
    if visible {
        let _ = create_widget(app);
    } else {
        hide_widget(app);
    }
}

pub fn set_widget_scale(app: &AppHandle, scale: f64) {
    if let Some(w) = app.get_webview_window("widget") {
        let size = (WIDGET_BASE * scale).round();
        let _ = w.set_size(LogicalSize::new(size, size));
        let _ = w.set_zoom(scale);
    }
}
