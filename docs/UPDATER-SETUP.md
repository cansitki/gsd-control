# Updater Setup Guide

How to generate signing keys, build with signing enabled, and verify update artifacts for GSD Control.

## 1. Generate Signing Keys

```bash
npx tauri signer generate -w ~/.tauri/gsd-control.key
```

This produces:
- **Private key:** `~/.tauri/gsd-control.key` (keep secret, never commit)
- **Public key:** printed to stdout (also saved as `~/.tauri/gsd-control.key.pub`)

Copy the public key string from the output — you'll need it in the next step.

## 2. Update tauri.conf.json

Replace the placeholder pubkey in `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "pubkey": "<PASTE_YOUR_PUBLIC_KEY_HERE>",
    "endpoints": [
      "https://github.com/OWNER/REPO/releases/latest/download/latest.json"
    ]
  }
}
```

Also replace `OWNER/REPO` with the actual GitHub repository (e.g. `your-org/gsd-control`).

## 3. Build with Signing

```bash
TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/gsd-control.key) npm run tauri build
```

If your private key has a password:

```bash
TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/gsd-control.key) TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password" npm run tauri build
```

Look for these in the build output:
- `Signing` messages indicating the updater artifacts are being signed
- No signing errors

## 4. Verify Artifacts

After a successful build, check for these files in `src-tauri/target/release/bundle/macos/`:

```bash
ls -la src-tauri/target/release/bundle/macos/*.tar.gz*
```

You should see:
- `GSD Control.app.tar.gz` — the compressed app bundle for updates
- `GSD Control.app.tar.gz.sig` — the Ed25519 signature file

Both files must exist for the updater to work. The `.sig` file proves the update was signed with your private key.

## 5. CI Setup (GitHub Actions)

The release workflow at `.github/workflows/release.yml` automates signed builds and GitHub Release publishing. It triggers on any tag push matching `v*`.

### 5.1 Create the GitHub Repository

Push your project to GitHub if you haven't already. The workflow expects a standard GitHub repository with Actions enabled.

### 5.2 Add Signing Secrets

Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add:

1. **`TAURI_SIGNING_PRIVATE_KEY`** — paste the full contents of `~/.tauri/gsd-control.key`
2. **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`** (optional) — only if your key has a password

These secrets are injected as environment variables during the CI build. Without `TAURI_SIGNING_PRIVATE_KEY`, the workflow will fail at the signing step.

### 5.3 Workflow Trigger

The workflow fires on tag pushes matching `v*`:

```yaml
on:
  push:
    tags:
      - 'v*'
```

This means pushing a tag like `v0.1.0`, `v1.0.0-beta.1`, or `v2.3.4` will trigger a release build. Commits to branches do **not** trigger the workflow.

### 5.4 Workflow File

The full workflow lives at `.github/workflows/release.yml`. It:

- Builds for both `aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel)
- Uses `tauri-apps/tauri-action@v0` to build, sign, and publish
- Sets `releaseDraft: false` so releases are published immediately
- Requires `contents: write` permission to create GitHub Releases

## 6. Publishing a Release

### 6.1 Bump the Version

Update the version in **all three** of these files — they must match:

| File | Field |
|---|---|
| `package.json` | `"version": "0.2.0"` |
| `src-tauri/tauri.conf.json` | `"version": "0.2.0"` |
| `src-tauri/Cargo.toml` | `version = "0.2.0"` |

You can verify they're consistent by running:

```bash
bash scripts/verify-ci.sh
```

The "Version consistency" checks will flag any mismatch.

### 6.2 Create and Push a Version Tag

Commit the version bump, then tag and push:

```bash
git add -A
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main --tags
```

Or tag and push separately:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The tag name must start with `v` to trigger the workflow.

### 6.3 What the CI Does

When the tag is pushed, the GitHub Actions workflow:

1. **Checks out** the code at the tagged commit
2. **Installs** Node.js dependencies (`npm ci`) and the Rust toolchain
3. **Builds** the Tauri app for both architectures (`aarch64-apple-darwin` and `x86_64-apple-darwin`) in parallel
4. **Signs** the updater artifacts (`.tar.gz`) using the `TAURI_SIGNING_PRIVATE_KEY` secret, producing `.sig` files
5. **Generates** `latest.json` containing the download URLs, version, signature, and release notes
6. **Creates a GitHub Release** with the tag name, attaching all artifacts and `latest.json`

### 6.4 Verify the Release

After the workflow completes:

1. Go to the **Releases** page in your GitHub repository
2. Confirm the release is listed (not draft) with the correct tag
3. Check that these artifacts are attached:
   - `GSD Control.app.tar.gz` (one per architecture)
   - `GSD Control.app.tar.gz.sig` (one per architecture)
   - `latest.json`
4. Verify `latest.json` is accessible at:
   ```
   https://github.com/OWNER/REPO/releases/latest/download/latest.json
   ```
   Replace `OWNER/REPO` with your repository.

### 6.5 How the App Detects Updates

When the app launches, the Tauri updater plugin:

1. Fetches `latest.json` from the endpoint configured in `src-tauri/tauri.conf.json`
2. Compares the `version` field in `latest.json` against the running app's version
3. If a newer version is available, downloads the architecture-appropriate `.tar.gz` artifact
4. Verifies the download's Ed25519 signature (`.sig`) against the public key embedded in the app
5. Extracts and installs the update
6. Relaunches the app with the new version

The update check happens automatically on launch. No user action is required beyond running the app.

## 7. Troubleshooting

### Missing Signing Key Secret

**Symptom:** CI build fails with a signing error or missing `TAURI_SIGNING_PRIVATE_KEY`.

**Fix:** Ensure the secret is added in **Settings → Secrets and variables → Actions** with the exact name `TAURI_SIGNING_PRIVATE_KEY`. Paste the full private key contents, including the `-----BEGIN` and `-----END` lines.

### Version Mismatch

**Symptom:** `verify-ci.sh` reports version inconsistency, or the app doesn't detect a published update.

**Fix:** All three version sources must match exactly:
- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`

Run `bash scripts/verify-ci.sh` to check.

### OWNER/REPO Placeholder Not Replaced

**Symptom:** The app can't fetch `latest.json` — the updater endpoint still contains `OWNER/REPO`.

**Fix:** Open `src-tauri/tauri.conf.json` and replace the endpoint URL placeholder with your actual GitHub org and repository name. Run `bash scripts/verify-updater.sh` to confirm.

### Draft vs Published Releases

**Symptom:** The release exists on GitHub but the app doesn't see the update.

**Fix:** The updater endpoint points to `/releases/latest/download/latest.json`, which only resolves for **published** (non-draft) releases. The workflow sets `releaseDraft: false`, so releases should be published automatically. If a release is stuck as a draft, manually publish it from the GitHub Releases page.

### Verify Config Locally

Run both verification scripts to check your local configuration before pushing:

```bash
bash scripts/verify-updater.sh   # Validates updater config, keys, and artifacts
bash scripts/verify-ci.sh        # Validates CI workflow structure and version consistency
```

Both scripts should report all checks passed.

## 8. Validation

Run the verification scripts to confirm all config is wired correctly:

```bash
bash scripts/verify-updater.sh
bash scripts/verify-ci.sh
```
