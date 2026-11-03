//! 共享应用状态（被命令与后台线程共用）

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::{json, Value};

use crate::core;
use crate::focus::FocusTracker;
use crate::store::Store;

/// 各分区默认值（与 main.js 中的 APP_DEFAULTS / LOOK_DEFAULTS / FOCUS_DEFAULTS 一致）
pub fn store_defaults() -> Value {
    let work = serde_json::to_value(core::Work::defaults()).unwrap();
    json!({
        "work": work,
        "app": {
            "autoLaunch": false,
            "widgetVisible": true,
            "widgetOnTop": true,
            "widgetScale": 1,
            "widgetBounds": null,
            "trayCountdown": true,
            "notify": true,
            "closeTipShown": false
        },
        "look": {
            "library": [],
            "main": "builtin",
            "widget": "same",
            "fit": "cover",
            "dim": 15
        },
        "focus": {
            "enabled": false,
            "apps": [],
            "idleMinutes": 5,
            "countOvertime": false,
            "showOnMain": true,
            "showOnWidget": true,
            "showInTray": true
        },
        "meta": {}
    })
}

pub struct AppStateInner {
    pub store: Store,
    pub quitting: Arc<AtomicBool>,
    pub data_dir: PathBuf,
    pub focus: Arc<Mutex<FocusTracker>>,
}

impl AppStateInner {
    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    pub fn set_quitting(&self, v: bool) {
        self.quitting.store(v, Ordering::SeqCst);
    }
}

pub struct AppState(pub Mutex<AppStateInner>);

impl AppState {
    pub fn lock(&self) -> MutexGuard<'_, AppStateInner> {
        self.0.lock().unwrap()
    }
}
