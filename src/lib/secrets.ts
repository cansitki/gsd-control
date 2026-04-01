import { readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";

/**
 * Simple encrypted secrets storage using Tauri fs plugin.
 * Stores secrets as XOR-obfuscated JSON in appDataDir/secrets.json.
 * Not cryptographically secure — just not plaintext on disk.
 * Replaces the previous native secrets plugin which crashed on ARM64 macOS.
 */

const SECRETS_FILE = "secrets.json";
const OBFUSCATION_KEY = "gsd-control-vault-2024";

let cache: Record<string, string> | null = null;

function obfuscate(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const key = new TextEncoder().encode(OBFUSCATION_KEY);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ key[i % key.length];
  }
  return btoa(String.fromCharCode(...result));
}

function deobfuscate(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const key = new TextEncoder().encode(OBFUSCATION_KEY);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ key[i % key.length];
  }
  return new TextDecoder().decode(result);
}

async function loadSecrets(): Promise<Record<string, string>> {
  if (cache) return cache;

  try {
    const content = await readTextFile(SECRETS_FILE, { baseDir: BaseDirectory.AppData });
    const plain = deobfuscate(content);
    cache = JSON.parse(plain);
    console.log("Secrets: loaded from disk");
    return cache!;
  } catch {
    // File doesn't exist or is corrupted — start fresh
    console.log("Secrets: starting fresh (no existing file or read error)");
    cache = {};
    return cache;
  }
}

async function saveSecrets(): Promise<void> {
  if (!cache) return;

  try {
    // Ensure app data directory exists
    const dir = await appDataDir();
    await mkdir(dir, { recursive: true }).catch(() => {});

    const plain = JSON.stringify(cache);
    const encoded = obfuscate(plain);
    await writeTextFile(SECRETS_FILE, encoded, { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.error("Secrets: failed to save —", e);
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  const secrets = await loadSecrets();
  secrets[key] = value;
  await saveSecrets();
}

export async function getSecret(key: string): Promise<string> {
  const secrets = await loadSecrets();
  return secrets[key] || "";
}

export async function removeSecret(key: string): Promise<void> {
  const secrets = await loadSecrets();
  delete secrets[key];
  await saveSecrets();
}

// Keys for secrets stored in the vault
export const SECRET_KEYS = {
  TELEGRAM_BOT_TOKEN: "telegram_bot_token",
  TELEGRAM_CHAT_ID: "telegram_chat_id",
  GITHUB_TOKEN: "github_token",
  // SSH keys are stored per-profile: ssh_key_<profileId>
  sshKey: (profileId: string) => `ssh_key_${profileId}`,
} as const;
