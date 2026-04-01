pub mod ssh;
pub mod commands;
pub mod terminal;

use ssh::{create_ssh_manager, SshConfig};
use terminal::create_terminal_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ssh_manager = create_ssh_manager(SshConfig::default());
    let terminal_store = create_terminal_store();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            // Use a key derivation function for the vault password
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            password.hash(&mut hasher);
            let hash = hasher.finish();
            hash.to_le_bytes().to_vec()
        }).build())
        .manage(ssh_manager)
        .manage(terminal_store)
        .invoke_handler(tauri::generate_handler![
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_status,
            commands::test_workspace,
            commands::ssh_exec,
            commands::list_workspaces,
            commands::discover_projects,
            commands::exec_in_workspace,
            commands::create_project,
            commands::upload_file,
            commands::list_project_files,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_close,
            commands::terminal_resize,
            commands::terminal_open_tmux,
            commands::list_tmux_sessions,
            commands::gsd_start_auto,
            commands::gsd_stop,
            commands::open_url,
            commands::write_ssh_key,
            commands::cleanup_ssh_key,
            commands::check_update,
            commands::install_update,
        ])
        .setup(|app| {
            use tauri::tray::TrayIconBuilder;
            use tauri::Manager;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.center();
                let _ = window.set_focus();
            }

            let _tray = TrayIconBuilder::new()
                .tooltip("GSD Control")
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
