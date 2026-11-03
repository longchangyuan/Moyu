//! 每秒心跳：计算快照、更新托盘文字、触发系统通知

use std::time::Duration;

use chrono::Local;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{core, events, focus, state::AppState, tray};

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn tick(app: &AppHandle, last_status: &mut Option<String>, warned_ten_min: &mut String, last_tray_text: &mut String) {
    let (work_raw, app_cfg, focus_cfg_raw, focus_tracker) = {
        let state = app.state::<AppState>();
        let g = state.lock();
        (
            g.store.get("work"),
            g.store.get("app"),
            g.store.get("focus"),
            g.focus.clone(),
        )
    };
    let work = core::normalize(&work_raw);
    let snap = core::snapshot(&work, Local::now());
    let d = core::describe(&snap);

    let notify_enabled = app_cfg.get("notify").and_then(|x| x.as_bool()).unwrap_or(true);

    tray::update_tray_text(app, &snap, &d, last_tray_text);

    // 专注采样 + 实时推送
    let focus_cfg: focus::FocusConfig = serde_json::from_value(focus_cfg_raw).unwrap_or_default();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let (live, summary) = {
        let mut tracker = focus_tracker.lock().unwrap();
        tracker.sample(focus::SampleInput {
            now_ms,
            cfg: &focus_cfg,
            status: &snap.status,
            idle_seconds: focus::idle_seconds(),
            locked: focus::is_locked(),
            available: focus_cfg.enabled,
        });
        let summary = tracker.today(now_ms, &focus_cfg);
        (tracker.live.clone(), summary)
    };
    events::emit(
        app,
        events::FOCUS_LIVE,
        &serde_json::json!({
            "live": live,
            "show": { "main": focus_cfg.show_on_main, "widget": focus_cfg.show_on_widget },
            "enabled": focus_cfg.enabled,
            "focus": summary.focus,
            "slack": summary.slack,
            "away": summary.away,
            "overtime": summary.overtime,
            "error": ""
        }),
    );

    if notify_enabled {
        if let Some(prev) = last_status.as_ref() {
            if (prev.as_str() == "working" || prev.as_str() == "lunch") && snap.status == "off" {
                notify(
                    app,
                    "下班啦！",
                    &format!("今日已赚 ¥{}，辛苦啦，快去钓鱼吧~", core::format_money(snap.daily, 2)),
                );
            }
            let day_key = core::date_key(Local::now().date_naive());
            if snap.status == "working"
                && snap.countdown <= 600.0
                && snap.countdown > 590.0
                && *warned_ten_min != day_key
            {
                *warned_ten_min = day_key;
                notify(app, "还有 10 分钟下班", "收拾收拾，准备溜了~");
            }
            if prev.as_str() == "before" && snap.status == "working" {
                notify(app, "开始上班啦", "今天也要元气满满地摸鱼哦");
            }
        }
    }

    *last_status = Some(snap.status.clone());
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_status: Option<String> = None;
        let mut warned_ten_min = String::new();
        let mut last_tray_text = String::new();
        loop {
            tick(&app, &mut last_status, &mut warned_ten_min, &mut last_tray_text);
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
