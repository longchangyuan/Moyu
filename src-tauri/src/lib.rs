mod backgrounds;
mod commands;
mod core;
mod events;
mod focus;
mod protocol;
mod state;
mod store;
mod ticker;
mod tray;
mod window;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

use state::{AppState, AppStateInner};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol(backgrounds::SCHEME, protocol::handle)
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::save_work,
            commands::set_app,
            commands::look_pick,
            commands::look_import,
            commands::look_import_files,
            commands::look_remove,
            commands::look_set,
            commands::focus_get,
            commands::focus_set,
            commands::focus_add,
            commands::focus_remove,
            commands::focus_pick,
            commands::open_main,
            commands::open_data_folder,
            commands::update_ack,
        ])
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = store::Store::new(dir.join("config.json"), state::store_defaults());
            let tracker = Arc::new(Mutex::new(focus::FocusTracker::new(dir.join("focus-stats.json"))));
            focus::spawn_watcher(tracker.clone());
            app.manage(AppState(Mutex::new(AppStateInner {
                store,
                quitting: Arc::new(AtomicBool::new(false)),
                data_dir: dir.clone(),
                focus: tracker,
            })));

            // 主窗口关闭 → 隐藏（常驻托盘）
            if let Some(win) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                win.clone().on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let quitting = handle.state::<AppState>().lock().is_quitting();
                        if !quitting {
                            api.prevent_close();
                            let _ = win.hide();
                        }
                    }
                });
            }

            if let Err(e) = tray::create_tray(app.handle()) {
                eprintln!("[tray] {e}");
            }

            let widget_visible = {
                let state = app.state::<AppState>();
                let g = state.lock();
                g.store
                    .get("app")
                    .get("widgetVisible")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(true)
            };
            if widget_visible {
                if let Err(e) = window::create_widget(app.handle()) {
                    eprintln!("[widget] {e}");
                }
            }

            ticker::spawn(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
