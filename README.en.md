# Codex Galaxy

> **[Download the latest version](https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest)**

[简体中文](README.md) | English

Codex Galaxy is a local desktop utility for switching between Codex accounts and compatible APIs while continuing project tasks saved on the same computer.

## What it does

- Switch between an official account and multiple API profiles
- Use API-to-API switching without an official account
- Resume existing local tasks with less repeated setup
- Check old session format and safely restore it from a verified backup when needed
- Manage local plugins, downloaded marketplaces, and project data
- Check for updates automatically; Windows can install them and macOS opens the latest download page
- Use Simplified Chinese or English

## Quick start

1. Download the package for your platform from the link above.
2. Open Codex Galaxy and add an official account or API profile.
3. Select a target profile and choose **Switch and open Codex**.
4. Choose **Continue in Codex** for a local project to resume that task.

API profiles must support the OpenAI Responses API. API keys stay in encrypted local settings and are not written to project documents or logs.

## Plugins

Galaxy can install local plugins, add marketplaces supported by the Codex CLI, and bulk-install valid plugins from a local `marketplace.json`. Remote catalog availability depends on the active Codex login and official support; Galaxy does not forge official permissions. Users without an official account can still use pure API profiles, local plugins, and downloaded local marketplaces.

## Updates and platforms

GitHub Releases provides Windows x64, macOS Intel, and macOS Apple Silicon packages. Current builds are unsigned, so the operating system may show an unknown-developer warning. Download releases from this repository and follow the platform prompt.

## Local data and safety

- Codex data: `~/.codex`
- Galaxy data: `~/.codex-galaxy`
- Provider switching creates recoverable backups first
- The API gateway listens only on the local loopback interface
- Never commit `auth.json`, API keys, access tokens, or private signing files

## Development

Node.js 20 or newer is recommended:

```powershell
npm ci
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

## Contact

Author: Guan Jingyang
Email: `guanjingyang@gmail.com`

MIT License. Codex Galaxy is an independent local utility and is not an official OpenAI product.
