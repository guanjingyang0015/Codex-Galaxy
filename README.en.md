# Codex Galaxy

English | [简体中文](README.md)

Codex Galaxy is a local desktop app for switching Codex authentication profiles and continuing the same local project threads across official subscriptions, relay APIs, and other Responses-compatible providers.

A typical workflow starts on an official account, switches to a relay when the quota is low, and continues the same thread with GPT, Gemini, DeepSeek, or another compatible model. The local conversation history stays in place; Galaxy changes the active credentials, provider route, and model used for subsequent turns.

## Highlights

- Add and switch between any number of official accounts and API profiles.
- Use multiple API profiles without owning or signing in to an official account.
- Preserve local thread IDs, message history, tool calls, project titles, and project continuity.
- Keep API keys and captured official snapshots in Electron `safeStorage`.
- Route API profiles through a loopback-only Responses gateway on `127.0.0.1:43821`.
- Discover models through a provider's standard `/models` endpoint or use an explicit model ID.
- Support GPT-family catalogs and strict single-model catalogs for Gemini, DeepSeek, Claude, Qwen, GLM, and arbitrary vendors.
- Correct stale-model compaction requests at the local gateway without rewriting historical messages.
- Use transactional switching with backups and full rollback when authentication, launch, or synchronization fails.
- Skip unchanged histories during official-compatibility checks and scan only the selected root thread when possible.
- Remove only incompatible relay-generated message IDs when returning to the official provider.
- Show clear real-time switching, scan, cleanup, and launch progress.
- Keep the main workbench within a single 1240×820 window, with Simplified Chinese and English UI options.
- Show a click-through `Codex Galaxy x.x.x` marker on the active external Codex Desktop window on Windows.
- Check GitHub releases automatically. Windows can download and verify the official installer; unsigned macOS builds open the fixed latest-release page instead.

## Install

Download the package for your platform from GitHub Releases:

- Windows x64: `Codex-Galaxy-*-Windows-x64.exe`
- macOS Intel: `Codex-Galaxy-*-macOS-x64.dmg`
- macOS Apple Silicon: `Codex-Galaxy-*-macOS-arm64.dmg`

The current builds are unsigned. Windows SmartScreen or macOS Gatekeeper may display an unknown-developer warning. macOS packages are built by GitHub Actions but still require real-device validation and signing.

Existing users can install a newer version over version 0.1.0 or later. The installer retains both `~/.codex-galaxy` and `~/.codex`. Finish any active API-backed task before upgrading because the installer closes Galaxy and its local gateway.

The top update action checks GitHub automatically. On Windows it downloads the exact installer and verifies SHA-256 before setup. On macOS, where current builds have no Apple Developer signature, it only opens `https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest` so the user can choose the Intel x64 or Apple Silicon arm64 DMG.

## First use

1. Open Codex Galaxy and add one or more relay API profiles. Enter a name, Base URL, API key, and optionally a model ID.
2. An official account is not required for API-to-API switching.
3. To use an official account, sign in through the official Codex application, add an official profile in Galaxy, and capture it once.
4. Select the target profile and choose **Switch and open Codex**.
5. Wait for the progress indicator to reach 100%, then continue working in Codex.

In the thread list, **View details** only reads the local thread summary. **Continue in Codex** switches to the selected profile when necessary and resumes that exact task.

When an API profile is active, closing the Galaxy window sends it to the system tray so the local gateway can continue serving Codex. Exiting Galaxy from the tray stops the gateway and may interrupt an active API task.

The app includes copy-only registration buttons for RightAPI and ZYG Token. These URLs contain the author's referral parameters; using them is optional.

## Version 1.4.0

- Added automatic startup checks, six-hour periodic checks, and a visible manual update action.
- Windows downloads only the exact installer from the trusted project Release and launches setup only after SHA-256 verification.
- macOS opens the fixed official latest-release page and never downloads, mounts, or launches an unsigned DMG inside Galaxy.
- GitHub Actions builds Windows x64 and native macOS x64/arm64 packages, generates checksum files, and publishes tagged Releases.

## Version 1.3.1

- Fixed context priority after switching custom API models. Compaction summaries, handoff notes, and unfinished plans are background only; the latest user message defines the current request.
- Older work is resumed only when the user explicitly asks to continue it.
- Simple questions no longer trigger tools or project edits merely because an old summary mentions unfinished implementation work.
- Removed the redundant version pill from the Galaxy main-window action area. The compact header version and the external Windows Codex marker remain.
- Removed accidental `2.0.0` metadata, duplicate relay buttons, and unsupported message-coloring code left by the affected model response.

Windows x64 release:

- File: `Codex-Galaxy-1.3.1-Windows-x64.exe`
- Size: `104400218` bytes
- SHA-256: `1BDB230AA181EC6BD743FECC7F15E218B92EF8242D8D198F1C57577836E62A7B`

## Local data and security

- Codex data: `~/.codex`
- Galaxy data: `~/.codex-galaxy`
- Profile metadata: `profiles.json` without plaintext secrets
- Encrypted credentials: `vault.json`
- Local thread index: `conversation-library.json`

Never commit `.codex`, `.codex-galaxy`, `auth.json`, API keys, access tokens, or private signing files.

Galaxy does not provide a cloud synchronization service. It reads and updates local Codex configuration and thread routing on the user's computer. The local gateway accepts connections only from the loopback interface and does not log API keys or request bodies.

Relay APIs must support the OpenAI Responses API semantics used by Codex. Chat Completions-only or Anthropic Messages-only endpoints are not directly supported. Upstream encrypted reasoning content may remain provider-bound.

## Development

Node.js 22 or newer is recommended.

```powershell
npm ci
npm run icons
npm test
npm start
```

Build Windows:

```powershell
npm run dist:win
```

Build macOS:

```bash
npm run dist:mac
```

GitHub Actions tests the project and builds Windows x64, macOS x64, and macOS arm64 artifacts.

## License and contact

MIT License. See [LICENSE](LICENSE).

Author: Guan Jingyang — `guanjingyang@gmail.com`

The provider-switching boundary was informed by the public CodexPlusPlus implementation. Thread resumption relies on the public Codex CLI and Codex App Server interfaces. Codex Galaxy is an independent local utility and is not an official OpenAI product.
