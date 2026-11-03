//! 事件名与 emit 辅助（对应 main.js 中 broadcast 的通道）

use tauri::{AppHandle, Emitter};

pub const WORK_CHANGED: &str = "work:changed";
pub const APP_CHANGED: &str = "app:changed";
pub const LOOK_CHANGED: &str = "look:changed";
pub const FOCUS_LIVE: &str = "focus:live";
pub const FOCUS_CONFIG: &str = "focus:config";

pub fn emit<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    let _ = app.emit(event, payload);
}
