import { Stronghold, Client } from "@tauri-apps/plugin-stronghold";
import { appDataDir } from "@tauri-apps/api/path";

let strongholdInstance: Stronghold | null = null;
let clientInstance: Client | null = null;

const VAULT_PASSWORD = "gsd-control-vault";
const CLIENT_NAME = "gsd-secrets";

async function getClient(): Promise<Client> {
  if (clientInstance) return clientInstance;

  const dir = await appDataDir();
  const vaultPath = `${dir}/vault.hold`;

  strongholdInstance = await Stronghold.load(vaultPath, VAULT_PASSWORD);

  try {
    clientInstance = await strongholdInstance.loadClient(CLIENT_NAME);
  } catch {
    clientInstance = await strongholdInstance.createClient(CLIENT_NAME);
  }

  return clientInstance;
}

export async function setSecret(key: string, value: string): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  const data = Array.from(new TextEncoder().encode(value));
  await store.insert(key, data);
  await strongholdInstance!.save();
}

export async function getSecret(key: string): Promise<string> {
  const client = await getClient();
  const store = client.getStore();
  try {
    const data = await store.get(key);
    if (data) {
      return new TextDecoder().decode(new Uint8Array(data));
    }
  } catch {
    // Key doesn't exist
  }
  return "";
}

export async function removeSecret(key: string): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  try {
    await store.remove(key);
    await strongholdInstance!.save();
  } catch {
    // Key didn't exist
  }
}

// Keys for secrets stored in the vault
export const SECRET_KEYS = {
  TELEGRAM_BOT_TOKEN: "telegram_bot_token",
  TELEGRAM_CHAT_ID: "telegram_chat_id",
  GITHUB_TOKEN: "github_token",
  // SSH keys are stored per-profile: ssh_key_<profileId>
  sshKey: (profileId: string) => `ssh_key_${profileId}`,
} as const;
