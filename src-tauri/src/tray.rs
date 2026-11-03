//! 托盘 / 菜单栏：图标、菜单、倒计时文字更新

use chrono::Local;
use serde_json::{Map, Value};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
#[cfg(not(target_os = "macos"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};

use crate::{core, state::AppState, window};

pub const TRAY_ID: &str = "main";

fn b(v: &Value, k: &str, d: bool) -> bool {
    v.get(k).and_then(|x| x.as_bool()).unwrap_or(d)
}

fn packaged() -> bool {
    !cfg!(debug_assertions)
}

fn status_item_text(app: &AppHandle) -> String {
    let work = {
        let state = app.state::<AppState>();
        let g = state.lock();
        g.store.get("work")
    };
    let work = core::normalize(&work);
    let snap = core::snapshot(&work, Local::now());
    let d = core::describe(&snap);
    core::status_line(&snap, &d)
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let (app_cfg, focus_cfg) = {
        let state = app.state::<AppState>();
        let g = state.lock();
        (g.store.get("app"), g.store.get("focus"))
    };

    let status = MenuItem::with_id(app, "status", status_item_text(app), false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let open = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
    let widget_visible = CheckMenuItem::with_id(
        app,
        "widget_visible",
        "显示桌面小组件",
        true,
        b(&app_cfg, "widgetVisible", true),
        None::<&str>,
    )?;
    let widget_top = CheckMenuItem::with_id(
        app,
        "widget_top",
        "小组件置顶",
        true,
        b(&app_cfg, "widgetOnTop", true),
        None::<&str>,
    )?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![&status, &sep1, &open, &widget_visible, &widget_top];

    // macOS 独有：菜单栏倒计时开关（非 mac 为 None）
    #[cfg(target_os = "macos")]
    let tray_countdown = Some(CheckMenuItem::with_id(
        app,
        "tray_countdown",
        "菜单栏显示倒计时",
        true,
        b(&app_cfg, "trayCountdown", true),
        None::<&str>,
    )?);
    #[cfg(not(target_os = "macos"))]
    let tray_countdown: Option<CheckMenuItem<tauri::Wry>> = None;
    if let Some(tc) = &tray_countdown {
        items.push(tc);
    }

    let focus_enabled = CheckMenuItem::with_id(
        app,
        "focus_enabled",
        "识别工作 / 摸鱼",
        true,
        b(&focus_cfg, "enabled", false),
        None::<&str>,
    )?;
    let notify = CheckMenuItem::with_id(
        app,
        "notify",
        "下班提醒",
        true,
        b(&app_cfg, "notify", true),
        None::<&str>,
    )?;
    let auto_launch = CheckMenuItem::with_id(
        app,
        "auto_launch",
        "开机自启",
        packaged(),
        b(&app_cfg, "autoLaunch", false),
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出摸鱼小狐", true, None::<&str>)?;

    items.push(&focus_enabled);
    items.push(&notify);
    items.push(&auto_launch);
    items.push(&sep2);
    items.push(&quit);

    Menu::with_items(app, &items)
}

fn toggle_pref(app: &AppHandle, section: &str, key: &str) -> bool {
    let new_val = {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        let cur = b(&g.store.get(section), key, false);
        let new_val = !cur;
        let mut patch = Map::new();
        patch.insert(key.to_string(), Value::Bool(new_val));
        g.store.patch(section, Value::Object(patch));
        new_val
    };
    let _ = rebuild_menu(app);
    new_val
}

fn apply_autolaunch(app: &AppHandle, on: bool) {
    if !packaged() {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let auto = app.autolaunch();
    let r = if on { auto.enable() } else { auto.disable() };
    if let Err(e) = r {
        eprintln!("[autolaunch] {e}");
    }
}

fn quit(app: &AppHandle) {
    app.state::<AppState>().lock().set_quitting(true);
    app.exit(0);
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => window::show_main(app),
        "widget_visible" => {
            let v = toggle_pref(app, "app", "widgetVisible");
            window::set_widget_visible(app, v);
        }
        "widget_top" => {
            let v = toggle_pref(app, "app", "widgetOnTop");
            window::set_widget_on_top(app, v);
        }
        "tray_countdown" => {
            let _ = toggle_pref(app, "app", "trayCountdown");
        }
        "focus_enabled" => {
            // 专注识别 watcher 启停在后续阶段实现，先只落配置
            let _ = toggle_pref(app, "focus", "enabled");
        }
        "notify" => {
            let _ = toggle_pref(app, "app", "notify");
        }
        "auto_launch" => {
            let v = toggle_pref(app, "app", "autoLaunch");
            apply_autolaunch(app, v);
        }
        "quit" => quit(app),
        _ => {}
    }
}

/// 重建菜单（设置变化后同步勾选状态）
pub fn rebuild_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_menu(app)?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let icon = app.default_window_icon().cloned();

    let mut builder = TrayIconBuilder::with_id(TRAY_ID).menu(&menu);
    if let Some(ic) = icon {
        builder = builder.icon(ic);
    }
    builder = builder.tooltip("摸鱼小狐");

    // 平台差异（与 main.js 一致）：
    // - macOS：左键弹菜单
    // - Windows：左键打开主界面，右键弹菜单
    #[cfg(target_os = "macos")]
    {
        builder = builder.show_menu_on_left_click(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    window::show_main(tray.app_handle());
                }
            });
    }

    builder
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .build(app)?;

    Ok(())
}

/// 每秒更新托盘文字（mac 菜单栏倒计时 / win 悬停提示），按内容去重避免无谓重绘
#[allow(unused_variables)]
pub fn update_tray_text(app: &AppHandle, snap: &core::Snapshot, d: &core::Describe, last_text: &mut String) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    #[cfg(target_os = "macos")]
    {
        let show = {
            let state = app.state::<AppState>();
            let g = state.lock();
            b(&g.store.get("app"), "trayCountdown", true)
        };
        let text = if show {
            format!(" {}", d.tray)
        } else {
            String::new()
        };
        if text != *last_text {
            *last_text = text.clone();
            let _ = tray.set_title(Some(&text));
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let text = format!("摸鱼小狐\n{}", core::status_line(snap, d));
        if text != *last_text {
            *last_text = text.clone();
            let _ = tray.set_tooltip(Some(&text));
        }
    }
}
