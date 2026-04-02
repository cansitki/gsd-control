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
        .manage(ssh_manager)
        .manage(terminal_store)
        .invoke_handler(tauri::generate_handler![
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_status,
            commands::test_workspace,
            commands::ssh_health_check,
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

                // Hide window on close instead of destroying it.
                // The tray icon reopens it. This prevents the "stuck" state
                // where the app process lives but the window is gone.
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
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
