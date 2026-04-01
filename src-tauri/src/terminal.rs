use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};

pub struct TerminalSession {
    pub stdin_tx: mpsc::Sender<Vec<u8>>,
}

pub type TerminalStore = Arc<Mutex<HashMap<String, TerminalSession>>>;

pub fn create_terminal_store() -> TerminalStore {
    Arc::new(Mutex::new(HashMap::new()))
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TerminalData {
    pub id: String,
    pub data: Vec<u8>,
}

pub async fn open_terminal(
    id: String,
    workspace: String,
    _key_path: String,
    coder_user: String,
    _host: String,
    app: AppHandle,
    store: TerminalStore,
) -> Result<(), String> {
    // Connect directly to the workspace via its SSH alias
    let ssh_host = crate::ssh::workspace_ssh_host(&workspace, &coder_user);

    let mut child = Command::new("/usr/bin/ssh")
        .env("PATH", crate::ssh::shell_path())
        .args([
            "-tt",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=30",
            &ssh_host,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("No stdout")?;
    let mut stderr = child.stderr.take().ok_or("No stderr")?;
    let mut stdin = child.stdin.take().ok_or("No stdin")?;

    // Channel for sending input to the process
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<Vec<u8>>(256);

    // Store the session
    {
        let mut store = store.lock().await;
        store.insert(id.clone(), TerminalSession { stdin_tx });
    }

    let id_clone = id.clone();
    let app_clone = app.clone();

    // Task: read stdout and emit to frontend
    tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_clone.emit(
                        &format!("terminal_data_{}", id_clone),
                        buf[..n].to_vec(),
                    );
                }
            }
        }
        // Terminal closed
        let _ = app_clone.emit(&format!("terminal_closed_{}", id_clone), ());
    });

    let id_clone2 = id.clone();
    let app_clone2 = app.clone();

    // Task: read stderr and emit to frontend
    tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        loop {
            match stderr.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_clone2.emit(
                        &format!("terminal_data_{}", id_clone2),
                        buf[..n].to_vec(),
                    );
                }
            }
        }
    });

    // Task: pipe stdin_rx → process stdin
    tokio::spawn(async move {
        while let Some(data) = stdin_rx.recv().await {
            if stdin.write_all(&data).await.is_err() {
                break;
            }
        }
    });

    // Wait for the process to exit (non-blocking — runs in background)
    let id_exit = id.clone();
    let app_exit = app.clone();
    let store_exit = store.clone();
    tokio::spawn(async move {
        let _ = child.wait().await;
        let mut store = store_exit.lock().await;
        store.remove(&id_exit);
        let _ = app_exit.emit(&format!("terminal_closed_{}", id_exit), ());
    });

    Ok(())
}

/// Open a terminal that attaches to an existing tmux session on the workspace
pub async fn open_terminal_tmux(
    id: String,
    workspace: String,
    tmux_session: String,
    coder_user: String,
    app: AppHandle,
    store: TerminalStore,
) -> Result<(), String> {
    let ssh_host = crate::ssh::workspace_ssh_host(&workspace, &coder_user);

    // SSH in and attach to the tmux session
    // Set TERM so tmux can use terminal capabilities (clear, colors, etc.)
    let tmux_cmd = format!("TERM=xterm-256color tmux attach-session -t {}", tmux_session);
    let mut child = Command::new("/usr/bin/ssh")
        .env("PATH", crate::ssh::shell_path())
        .args([
            "-tt",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=30",
            "-o", "SetEnv=TERM=xterm-256color",
            &ssh_host,
            &tmux_cmd,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("No stdout")?;
    let mut stderr = child.stderr.take().ok_or("No stderr")?;
    let mut stdin = child.stdin.take().ok_or("No stdin")?;

    let (stdin_tx, mut stdin_rx) = mpsc::channel::<Vec<u8>>(256);

    {
        let mut store = store.lock().await;
        store.insert(id.clone(), TerminalSession { stdin_tx });
    }

    let id_clone = id.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_clone.emit(
                        &format!("terminal_data_{}", id_clone),
                        buf[..n].to_vec(),
                    );
                }
            }
        }
        let _ = app_clone.emit(&format!("terminal_closed_{}", id_clone), ());
    });

    let id_clone2 = id.clone();
    let app_clone2 = app.clone();
    tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        loop {
            match stderr.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_clone2.emit(
                        &format!("terminal_data_{}", id_clone2),
                        buf[..n].to_vec(),
                    );
                }
            }
        }
    });

    tokio::spawn(async move {
        while let Some(data) = stdin_rx.recv().await {
            if stdin.write_all(&data).await.is_err() {
                break;
            }
        }
    });

    let id_exit = id.clone();
    let app_exit = app.clone();
    let store_exit = store.clone();
    tokio::spawn(async move {
        let _ = child.wait().await;
        let mut store = store_exit.lock().await;
        store.remove(&id_exit);
        let _ = app_exit.emit(&format!("terminal_closed_{}", id_exit), ());
    });

    Ok(())
}

pub async fn write_terminal(
    id: &str,
    data: Vec<u8>,
    store: TerminalStore,
) -> Result<(), String> {
    let store = store.lock().await;
    if let Some(session) = store.get(id) {
        session.stdin_tx.send(data).await.map_err(|e| e.to_string())
    } else {
        Err(format!("Terminal {} not found", id))
    }
}

pub async fn close_terminal(id: &str, store: TerminalStore) {
    let mut store = store.lock().await;
    store.remove(id);
}

pub async fn resize_terminal(
    _id: &str,
    _cols: u16,
    _rows: u16,
    _store: TerminalStore,
) -> Result<(), String> {
    // Resize is best-effort with this approach
    // Full PTY resize support requires the nix crate — can add later
    Ok(())
}
