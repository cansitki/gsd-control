use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Maps Coder workspace names to their SSH alias hostnames.
/// Uses the coder_user stored in SshConfig.
pub fn workspace_ssh_host(coder_name: &str, coder_user: &str) -> String {
    format!("main.{}.{}.coder", coder_name, coder_user)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    /// Coder instance host — used for connectivity check
    pub host: String,
    pub user: String,
    pub key_path: String,
    /// Coder username (used in SSH alias: main.<workspace>.<coder_user>.coder)
    pub coder_user: String,
}

impl Default for SshConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            user: "admin".to_string(),
            key_path: String::new(),
            coder_user: String::new(),
        }
    }
}

pub struct SshManager {
    pub config: SshConfig,
    connected: bool,
}

impl SshManager {
    pub fn new(config: SshConfig) -> Self {
        Self { config, connected: false }
    }

    pub fn update_config(&mut self, host: &str, user: &str, key_path: &str) {
        self.config.host = host.to_string();
        self.config.user = user.to_string();
        self.config.key_path = key_path.to_string();
        // Extract coder user from host if it follows pattern: main.<ws>.<user>.coder
        // Otherwise keep existing coder_user
    }

    pub fn set_coder_user(&mut self, coder_user: &str) {
        self.config.coder_user = coder_user.to_string();
    }

    pub async fn connect(&mut self) -> Result<(), String> {
        if self.config.host.is_empty() {
            return Err("No SSH host configured. Set it in Settings.".to_string());
        }
        // Try to connect via the host directly to verify connectivity
        let output = Command::new("ssh")
            .args([
                "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=15",
                "-o", "BatchMode=yes",
                &format!("{}@{}", self.config.user, self.config.host),
                "echo ok",
            ])
            .output()
            .await
            .map_err(|e| format!("SSH connect failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if stdout.trim() == "ok" {
            self.connected = true;
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Err(format!("Connection test failed: {}", stderr.trim()))
        }
    }

    /// Run a command inside a workspace via its direct SSH alias
    pub async fn exec_in_workspace(
        &self,
        workspace: &str,
        command: &str,
    ) -> Result<String, String> {
        let host = workspace_ssh_host(workspace, &self.config.coder_user);
        let output = Command::new("ssh")
            .args([
                "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=15",
                "-o", "BatchMode=yes",
                &host,
                command,
            ])
            .output()
            .await
            .map_err(|e| format!("SSH exec failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() || !stdout.is_empty() {
            if stdout.is_empty() && !stderr.is_empty() {
                Ok(stderr)
            } else {
                Ok(stdout)
            }
        } else {
            Err(format!("SSH error: {}", stderr.trim()))
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }

    pub fn disconnect(&mut self) {
        self.connected = false;
    }
}

pub type SharedSshManager = Arc<Mutex<SshManager>>;

pub fn create_ssh_manager(config: SshConfig) -> SharedSshManager {
    Arc::new(Mutex::new(SshManager::new(config)))
}
