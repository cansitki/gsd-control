import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { getSecret, setSecret, SECRET_KEYS } from "../lib/secrets";

/**
 * Loads secrets from Stronghold vault on mount,
 * syncs changes back to vault when config changes.
 */
export function useSecrets() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const loaded = useRef(false);

  // Load secrets from vault on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    (async () => {
      try {
        const [botToken, chatId, githubToken] = await Promise.all([
          getSecret(SECRET_KEYS.TELEGRAM_BOT_TOKEN),
          getSecret(SECRET_KEYS.TELEGRAM_CHAT_ID),
          getSecret(SECRET_KEYS.GITHUB_TOKEN),
        ]);

        const updates: Record<string, unknown> = {};
        if (botToken || chatId) {
          updates.telegram = {
            botToken: botToken || config.telegram.botToken,
            chatId: chatId || config.telegram.chatId,
          };
        }
        if (githubToken) {
          updates.githubToken = githubToken;
        }

        if (Object.keys(updates).length > 0) {
          updateConfig(updates as Partial<typeof config>);
        }
      } catch (e) {
        console.warn("Failed to load secrets from vault:", e);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save secrets to vault when they change
  const prevConfig = useRef(config);
  useEffect(() => {
    const prev = prevConfig.current;
    prevConfig.current = config;

    if (!loaded.current) return;

    (async () => {
      try {
        if (config.telegram.botToken !== prev.telegram.botToken) {
          await setSecret(SECRET_KEYS.TELEGRAM_BOT_TOKEN, config.telegram.botToken);
        }
        if (config.telegram.chatId !== prev.telegram.chatId) {
          await setSecret(SECRET_KEYS.TELEGRAM_CHAT_ID, config.telegram.chatId);
        }
        if (config.githubToken !== prev.githubToken) {
          await setSecret(SECRET_KEYS.GITHUB_TOKEN, config.githubToken);
        }
      } catch (e) {
        console.warn("Failed to save secrets to vault:", e);
      }
    })();
  }, [config]);
}
