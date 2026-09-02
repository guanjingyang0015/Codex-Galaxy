# Codex Galaxy

> **[Download the latest version](https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest)**

[简体中文](README.md) | English

Codex Galaxy is a local desktop utility for switching between Codex accounts and compatible APIs while continuing project tasks saved on the same computer.

**Current stable version: Codex Galaxy 1.9.6**

## What it does

- Switch between an official account and multiple API profiles
- Use API-to-API switching without an official account
- Resume existing local tasks with less repeated setup
- Block switching only for a genuinely recent unfinished reply, not for a stale `inProgress` marker left by a crashed session
- Rebuild complete thread details by merging local SQLite history with rollout files instead of showing a truncated tail
- Check old session format and safely restore it from a verified backup when needed
- Manage local plugins, downloaded marketplaces, and project data
- Check for updates automatically; Windows can install them and macOS opens the latest download page
- Use Simplified Chinese or English

## Quick start

1. Download the package for your platform from the link above.
2. Open Codex Galaxy and add an official account or API profile.
3. Select a target profile and choose **Switch and open Codex**.
4. Choose **Continue in Codex** for a local project to resume that task.
5. If Codex is merely idle, Galaxy requests a graceful close and waits for local writes; it blocks only when a recent reply is actually unfinished.
6. After switching, reopen the project. Local Codex files, SQLite data, and chat history remain in place; Galaxy never repairs this by deleting `config.toml`.

API profiles must support the OpenAI Responses API. API keys stay in encrypted local settings and are not written to project documents or logs.

## History and switching protection in 1.9.5/1.9.6

- Before switching, Galaxy checks local Codex turn state. Recent activity is protected; an old unfinished marker with no later terminal turn is treated as a crash residue after the safety window.
- Galaxy performs one authoritative local project synchronization when it starts, so reopening the app does not keep serving an old derived cache.
- Thread details merge rollout messages with user/assistant items already present in the local `thread_history` SQLite database and de-duplicate them. Details are no longer capped at 200 messages.
- The current installed version is placed first in the release record, so a new installation does not continue to display an older release as the latest record.
- If recovery is needed, keep redacted screenshots and error text. Do not delete `config.toml`, `~/.codex`, or `~/.codex-galaxy`.

## Plugins

Galaxy can install local plugins, add marketplaces supported by the Codex CLI, and bulk-install valid plugins from a local `marketplace.json`. Remote catalog availability depends on the active Codex login and official support; Galaxy does not forge official permissions. Users without an official account can still use pure API profiles, local plugins, and downloaded local marketplaces.

## Updates and platforms

GitHub Releases provides Windows x64, macOS Intel, and macOS Apple Silicon packages. Current builds are unsigned, so the operating system may show an unknown-developer warning. Download releases from this repository and follow the platform prompt. Install over the existing version; manual uninstall is unnecessary, and local accounts, projects, and history are retained.

Every release updates the version surfaces, both READMEs, the Chinese and English in-app guide, release notes, regression tests, and installer artifacts together. A version is not considered released until the documentation consistency check and the GitHub publication checks pass.

## Local data and safety

- Codex data: `~/.codex`
- Galaxy data: `~/.codex-galaxy`
- Provider switching creates recoverable backups first
- The API gateway listens only on the local loopback interface
- Never commit `auth.json`, API keys, access tokens, complete chat histories, or private signing files
- Never delete `config.toml` as a switching or history repair

## Development

Node.js 20 or newer is recommended:

```powershell
npm ci
npm test
npm start
```

`npm test` includes a documentation synchronization regression check. The current version must appear in both READMEs, the in-app guide, the static page, release notes, and release tests; user-visible behavior changes must update the corresponding instructions.

Build Windows:

```powershell
npm run dist:win
```

Build macOS:

```bash
npm run dist:mac
```

## Contact

Author: Guan Jingyang
Email: `guanjingyang@gmail.com`

MIT License. Codex Galaxy is an independent local utility and is not an official OpenAI product.
