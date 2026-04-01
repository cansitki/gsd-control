/**
 * Sanitize a string for safe interpolation into shell commands.
 * Removes any characters that aren't alphanumeric, dash, underscore, dot, or slash.
 */
export function sanitizeShellArg(input: string): string {
  return input.replace(/[^a-zA-Z0-9._\-\/]/g, "");
}

/**
 * Escape a string for safe use inside single quotes in a shell command.
 * Replaces single quotes with the pattern '\'' (end quote, escaped quote, start quote).
 */
export function escapeShellSingleQuote(input: string): string {
  return input.replace(/'/g, "'\\''");
}

/**
 * Validate a folder/project name — only safe characters allowed.
 */
export function isValidFolderName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

/**
 * Validate a tmux session name — only safe characters.
 */
export function isValidSessionName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}
