# GSD Control

A native macOS app for monitoring and managing AI coding agents running on remote workspaces.

Track costs, tokens, session status, and terminal access across multiple projects — all from your menu bar.

## Features

- **Dashboard** — live status of all projects: active, idle, or offline. Cost and token usage per project and totals.
- **Terminal** — SSH into remote workspaces with tmux session management. Reattach to running sessions, view in tabs or 2/4/6 grid layout.
- **Session Manager** — see all remote tmux sessions, their activity status, and kill idle ones.
- **Notifications** — Telegram alerts for milestone completions, auto-mode stops, errors, and rate limits.
- **Auto-updater** — check for updates and install directly from GitHub Releases.
- **Setup Wizard** — first-launch configuration with SSH key upload (stored in encrypted vault).
- **Multiple SSH Profiles** — switch between different servers/environments.

## Security

- SSH keys and tokens stored in an encrypted file in the app data directory — never in plaintext on disk
- All shell command inputs sanitized against injection
- No telemetry, no analytics, no data collection
- Secrets excluded from localStorage persistence

## Tech Stack

- [Tauri v2](https://v2.tauri.app) — Rust backend, web frontend
- [React](https://react.dev) + [TypeScript](https://typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com)
- [xterm.js](https://xtermjs.org) — terminal emulator
- [Zustand](https://zustand-demo.pmnd.rs) — state management

## Install

Download the latest `.dmg` from [Releases](https://github.com/cansitki/gsd-control/releases).

After opening:
```bash
xattr -cr /Applications/GSD\ Control.app
```

## Development

```bash
npm ci
npm run tauri dev
```

## Build

```bash
npm run tauri build -- --target aarch64-apple-darwin
```

Output: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`

## License

MIT
