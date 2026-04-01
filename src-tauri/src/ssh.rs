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
        if self.config.host.is_empty() && self.config.coder_user.is_empty() {
            return Err("No host or Coder username configured.".to_string());
        }

        let mut args = vec![
            "-o".to_string(), "StrictHostKeyChecking=no".to_string(),
            "-o".to_string(), "ConnectTimeout=15".to_string(),
            "-o".to_string(), "BatchMode=yes".to_string(),
        ];

        // Add key file if configured
        if !self.config.key_path.is_empty() {
            args.push("-i".to_string());
            args.push(self.config.key_path.clone());
        }

        // Try connecting via the host directly (with key)
        if !self.config.host.is_empty() {
            let mut direct_args = args.clone();
            direct_args.push(format!("{}@{}", self.config.user, self.config.host));
            direct_args.push("echo ok".to_string());

            let output = Command::new("ssh")
                .args(&direct_args)
                .output()
                .await
                .map_err(|e| format!("SSH connect failed: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            if stdout.trim() == "ok" {
                self.connected = true;
                return Ok(());
            }

            // If no Coder user, report the direct SSH error
            if self.config.coder_user.is_empty() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Err(format!("Connection failed: {}", stderr.trim()));
            }

            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            log::warn!("Direct SSH failed ({}), trying Coder alias...", stderr.trim());
        }

        // If we have a Coder user configured, mark as tentatively connected
        // Real connection test happens via test_workspace() with a workspace name
        if !self.config.coder_user.is_empty() {
            self.connected = true;
            return Ok(());
        }

        Err("Connection failed — check host, user, and key".to_string())
    }

    /// Test connection to a specific Coder workspace
    pub async fn test_workspace(&self, workspace: &str) -> Result<(), String> {
        let host = workspace_ssh_host(workspace, &self.config.coder_user);
        let output = Command::new("ssh")
            .args([
                "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=15",
                "-o", "BatchMode=yes",
                &host,
                "echo ok",
            ])
            .output()
            .await
            .map_err(|e| format!("SSH test failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if stdout.trim() == "ok" {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Err(format!("Workspace unreachable: {}", stderr.trim()))
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
