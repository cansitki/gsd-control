use crate::ssh::SharedSshManager;
use crate::terminal::TerminalStore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub name: String,
    pub status: String,
    pub healthy: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub workspace: String,
    pub path: String,
    pub has_gsd: bool,
    pub state_md: Option<String>,
    pub project_md: Option<String>,
}

#[tauri::command]
pub async fn ssh_connect(
    ssh: State<'_, SharedSshManager>,
    host: String,
    user: String,
    key_path: String,
    coder_user: String,
) -> Result<ConnectionStatus, String> {
    let mut manager = ssh.lock().await;
    manager.config.host = host;
    manager.config.user = user;
    manager.config.key_path = key_path;
    manager.config.coder_user = coder_user;
    manager.disconnect();

    match manager.connect().await {
        Ok(()) => Ok(ConnectionStatus {
            connected: true,
            error: None,
        }),
        Err(e) => Ok(ConnectionStatus {
            connected: false,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn ssh_disconnect(ssh: State<'_, SharedSshManager>) -> Result<(), String> {
    let mut manager = ssh.lock().await;
    manager.disconnect();
    Ok(())
}

#[tauri::command]
pub async fn ssh_status(ssh: State<'_, SharedSshManager>) -> Result<ConnectionStatus, String> {
    let manager = ssh.lock().await;
    Ok(ConnectionStatus {
        connected: manager.is_connected(),
        error: None,
    })
}

#[tauri::command]
pub async fn ssh_exec(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
    command: String,
) -> Result<String, String> {
    let manager = ssh.lock().await;
    manager.exec_in_workspace(&workspace, &command).await
}

#[tauri::command]
pub async fn list_workspaces(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
) -> Result<Vec<WorkspaceInfo>, String> {
    let manager = ssh.lock().await;
    let output = manager.exec_in_workspace(&workspace, "coder list").await?;

    // Try JSON parse first, fall back to text parsing
    if let Ok(workspaces) = serde_json::from_str::<Vec<serde_json::Value>>(&output) {
        return Ok(workspaces
            .iter()
            .map(|w| WorkspaceInfo {
                name: w["name"].as_str().unwrap_or("").to_string(),
                status: w["latest_build"]["status"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string(),
                healthy: w["health"]["healthy"].as_bool().unwrap_or(false),
            })
            .collect());
    }

    // Text parsing fallback
    let mut workspaces = Vec::new();
    for line in output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let name = parts[0].split('/').last().unwrap_or(parts[0]);
            workspaces.push(WorkspaceInfo {
                name: name.to_string(),
                status: parts[2].to_string(),
                healthy: parts[3] == "true",
            });
        }
    }
    Ok(workspaces)
}

#[tauri::command]
pub async fn discover_projects(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
) -> Result<Vec<ProjectInfo>, String> {
    let manager = ssh.lock().await;
    let output = manager
        .exec_in_workspace(
            &workspace,
            "find ~ -maxdepth 3 -name .gsd -type d 2>/dev/null",
        )
        .await?;

    let mut projects = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // /home/coder/project-name/.gsd → project-name
        let project_path = line.trim_end_matches("/.gsd");
        let project_name = project_path.split('/').last().unwrap_or(project_path);

        // Skip root-level .gsd
        if project_name == "coder" || project_path == "/home/coder" {
            continue;
        }

        // Read state files
        let state_md = manager
            .exec_in_workspace(
                &workspace,
                &format!("cat {}/.gsd/STATE.md 2>/dev/null", project_path),
            )
            .await
            .ok()
            .filter(|s| !s.is_empty());

        let project_md = manager
            .exec_in_workspace(
                &workspace,
                &format!("cat {}/.gsd/PROJECT.md 2>/dev/null | head -30", project_path),
            )
            .await
            .ok()
            .filter(|s| !s.is_empty());

        projects.push(ProjectInfo {
            workspace: workspace.clone(),
            path: project_name.to_string(),
            has_gsd: true,
            state_md,
            project_md,
        });
    }

    Ok(projects)
}

#[tauri::command]
pub async fn exec_in_workspace(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
    command: String,
) -> Result<String, String> {
    let manager = ssh.lock().await;
    manager.exec_in_workspace(&workspace, &command).await
}

// ── Terminal commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn terminal_open(
    id: String,
    workspace: String,
    ssh: State<'_, SharedSshManager>,
    terminals: State<'_, TerminalStore>,
    app: AppHandle,
) -> Result<(), String> {
    let (key_path, user, host, coder_user) = {
        let mgr = ssh.lock().await;
        (
            mgr.config.key_path.clone(),
            mgr.config.user.clone(),
            mgr.config.host.clone(),
            mgr.config.coder_user.clone(),
        )
    };
    crate::terminal::open_terminal(
        id,
        workspace,
        key_path,
        coder_user,
        host,
        app,
        terminals.inner().clone(),
    )
    .await
}

#[tauri::command]
pub async fn terminal_write(
    id: String,
    data: Vec<u8>,
    terminals: State<'_, TerminalStore>,
) -> Result<(), String> {
    crate::terminal::write_terminal(&id, data, terminals.inner().clone()).await
}

#[tauri::command]
pub async fn terminal_close(
    id: String,
    terminals: State<'_, TerminalStore>,
) -> Result<(), String> {
    crate::terminal::close_terminal(&id, terminals.inner().clone()).await;
    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    terminals: State<'_, TerminalStore>,
) -> Result<(), String> {
    crate::terminal::resize_terminal(&id, cols, rows, terminals.inner().clone()).await
}

#[tauri::command]
pub async fn terminal_open_tmux(
    id: String,
    workspace: String,
    tmux_session: String,
    ssh: State<'_, SharedSshManager>,
    terminals: State<'_, TerminalStore>,
    app: AppHandle,
) -> Result<(), String> {
    let coder_user = {
        let mgr = ssh.lock().await;
        mgr.config.coder_user.clone()
    };
    crate::terminal::open_terminal_tmux(
        id,
        workspace,
        tmux_session,
        coder_user,
        app,
        terminals.inner().clone(),
    )
    .await
}

#[tauri::command]
pub async fn list_tmux_sessions(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
) -> Result<Vec<String>, String> {
    let manager = ssh.lock().await;
    let output = manager
        .exec_in_workspace(
            &workspace,
            "tmux list-sessions -F '#{session_name}' 2>/dev/null || true",
        )
        .await?;
    Ok(output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

// ── Project management ─────────────────────────────────────────────────

#[tauri::command]
pub async fn create_project(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
    project_path: String,
) -> Result<String, String> {
    let manager = ssh.lock().await;

    // Create the project directory
    let cmd = format!("mkdir -p ~/{} && echo ok", project_path);
    let output = manager.exec_in_workspace(&workspace, &cmd).await?;

    if output.trim() != "ok" {
        return Err(format!("Failed to create directory: {}", output));
    }

    Ok(format!("Created ~/{}", project_path))
}

#[tauri::command]
pub async fn upload_file(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
    project_path: String,
    file_name: String,
    file_data_base64: String,
) -> Result<String, String> {
    let manager = ssh.lock().await;

    // Ensure target directory exists
    let mkdir_cmd = format!("mkdir -p ~/{}", project_path);
    manager.exec_in_workspace(&workspace, &mkdir_cmd).await?;

    // Decode and write via base64 pipe to avoid shell escaping issues
    // Split into chunks to avoid argument-too-long errors
    let chunk_size = 60_000; // safe for shell command length
    let total = file_data_base64.len();
    let dest = format!("~/{}/{}", project_path, file_name);

    if total <= chunk_size {
        let cmd = format!(
            "echo '{}' | base64 -d > {}",
            file_data_base64, dest
        );
        manager.exec_in_workspace(&workspace, &cmd).await?;
    } else {
        // First chunk: overwrite
        let first = &file_data_base64[..chunk_size];
        let cmd = format!("printf '%s' '{}' > /tmp/_upload_b64", first);
        manager.exec_in_workspace(&workspace, &cmd).await?;

        // Remaining chunks: append
        let mut offset = chunk_size;
        while offset < total {
            let end = std::cmp::min(offset + chunk_size, total);
            let chunk = &file_data_base64[offset..end];
            let cmd = format!("printf '%s' '{}' >> /tmp/_upload_b64", chunk);
            manager.exec_in_workspace(&workspace, &cmd).await?;
            offset = end;
        }

        // Decode the reassembled base64
        let cmd = format!("base64 -d /tmp/_upload_b64 > {} && rm -f /tmp/_upload_b64", dest);
        manager.exec_in_workspace(&workspace, &cmd).await?;
    }

    Ok(format!("Uploaded {} to {}", file_name, dest))
}

#[tauri::command]
pub async fn list_project_files(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
    project_path: String,
) -> Result<Vec<FileEntry>, String> {
    let manager = ssh.lock().await;
    let cmd = format!(
        "find ~/{} -maxdepth 1 -not -path ~/{} -printf '%f\\t%s\\t%y\\n' 2>/dev/null | sort",
        project_path, project_path
    );
    let output = manager.exec_in_workspace(&workspace, &cmd).await?;

    let mut entries = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            entries.push(FileEntry {
                name: parts[0].to_string(),
                size: parts[1].parse().unwrap_or(0),
                is_dir: parts[2] == "d",
            });
        }
    }
    Ok(entries)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn gsd_start_auto(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
    project_path: String,
    milestone: Option<String>,
) -> Result<String, String> {
    let manager = ssh.lock().await;

    // Create a tmux session named after the project
    let session_name = project_path.replace('/', "-");
    let gsd_cmd = match milestone {
        Some(m) => format!("cd ~/{} && gsd auto --milestone {}", project_path, m),
        None => format!("cd ~/{} && gsd auto", project_path),
    };

    // Kill existing session if any, then start fresh
    let _ = manager.exec_in_workspace(
        &workspace,
        &format!("tmux kill-session -t {} 2>/dev/null; true", session_name),
    ).await;

    let cmd = format!(
        "tmux new-session -d -s {} '{}'",
        session_name, gsd_cmd,
    );
    manager.exec_in_workspace(&workspace, &cmd).await?;

    Ok(format!("Started GSD auto in tmux session '{}'", session_name))
}

#[tauri::command]
pub async fn gsd_stop(
    ssh: State<'_, SharedSshManager>,
    workspace: String,
    project_path: String,
) -> Result<String, String> {
    let manager = ssh.lock().await;
    let session_name = project_path.replace('/', "-");
    manager.exec_in_workspace(
        &workspace,
        &format!("tmux send-keys -t {} C-c 2>/dev/null; sleep 2; tmux kill-session -t {} 2>/dev/null; true", session_name, session_name),
    ).await?;
    Ok(format!("Stopped GSD session '{}'", session_name))
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

/// Write SSH key content to a temp file and return its path.
/// The file is created with restrictive permissions (0600).
#[tauri::command]
pub async fn write_ssh_key(profile_id: String, key_content: String) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let key_path = temp_dir.join(format!("gsd-ssh-key-{}", profile_id));

    std::fs::write(&key_path, &key_content)
        .map_err(|e| format!("Failed to write key: {}", e))?;

    // Set file permissions to 0600 (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    Ok(key_path.to_string_lossy().to_string())
}

/// Clean up a temporary SSH key file
#[tauri::command]
pub async fn cleanup_ssh_key(profile_id: String) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let key_path = temp_dir.join(format!("gsd-ssh-key-{}", profile_id));
    let _ = std::fs::remove_file(&key_path);
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    url: String,
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    github_token: String,
) -> Result<UpdateInfo, String> {
    let current_version = app.config().version.clone().unwrap_or_default();
    let repo = "cansitki/gsd-control"; // Public repo — updater endpoint matches

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("https://api.github.com/repos/{}/releases/latest", repo))
        .header("Authorization", format!("token {}", github_token))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "GSD-Control-Updater")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let release: GithubRelease = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v').to_string();

    if latest_version == current_version {
        return Ok(UpdateInfo {
            available: false,
            version: Some(latest_version),
            notes: None,
            date: None,
        });
    }

    Ok(UpdateInfo {
        available: true,
        version: Some(latest_version),
        notes: release.body,
        date: release.published_at,
    })
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    github_token: String,
) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;

    // Use the Tauri updater with auth headers.
    // The updater fetches latest.json from the configured endpoint (GitHub releases).
    // Auth header is set on the Rust HTTP client which handles redirects.
    let mut builder = app.updater_builder();
    if !github_token.is_empty() {
        builder = builder
            .header("Authorization", format!("token {}", github_token))
            .map_err(|e| format!("Failed to set auth header: {}", e))?;
    }

    let updater = builder
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?
        .ok_or_else(|| "No update available".to_string())?;

    let version = update.version.clone();

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Download/install failed: {}", e))?;

    Ok(version)
}
