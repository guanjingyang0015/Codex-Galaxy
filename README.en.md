# Codex Galaxy

> **[Download the latest version](https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest)**

[简体中文](README.md) | English

Codex Galaxy is a local desktop utility for switching between Codex accounts and compatible APIs while continuing project tasks saved on the same computer.

**Current version: Codex Galaxy 2.2.0**

The in-app guide is now organized by stage: **first account setup → daily account switching → failure recovery → features**. Open **Guide** and choose only the stage you need instead of reading one long page.

## What it does

- Switch between an official account and multiple API profiles
- Use API-to-API switching without an official account
- Resume existing local tasks with less repeated setup
- List unfinished chats and scheduled tasks before switching so they can be opened and completed
- Continue projects and chat history stored on this computer across accounts and APIs
- Check old session format and safely restore it from a verified backup when needed
- Manage local plugins, downloaded marketplaces, and project data
- Record a timestamped redacted local log so switch failures can be inspected and reported
- Check for updates automatically; Windows can install them and macOS opens the latest download page
- Open a prominent GPT Top-up page from the header to view plans, prices, availability, and the contact QR code without signing in or purchasing online
- Use Simplified Chinese or English

## Quick start

1. Download the package for your platform from the link above.
2. Open Codex Galaxy and add an official account or API profile.
3. Select a target profile and choose **Switch and open Codex**.
4. Choose **Continue in Codex** for a local project to resume that task.
5. If Codex is merely idle, Galaxy requests a graceful close and waits for local writes; it blocks only when a recent reply is actually unfinished.
6. After switching, reopen the project. Local Codex files, SQLite data, and chat history remain in place; Galaxy never repairs this by deleting `config.toml`.
7. If switching fails, open **Log** at the top to inspect or copy the redacted reason; never delete configuration or chat data.

API profiles must support the OpenAI Responses API. API keys stay in encrypted local settings and are not written to project documents or logs.

## API relay audit and ranking

- Clicking **API audit** on a saved API profile now reads its encrypted local configuration and starts immediately, without asking for the platform, Base URL, API key, or model again. Only **Test new API** opens the temporary-input form.
- Every click on a saved profile's **API audit** adds another background job without waiting for the previous one. Galaxy runs up to three audits concurrently and queues the rest with separate status and progress; there is no separate bulk button.
- The audit checks `/models`, Responses output, model listing, capability probes, latency, and usage shape, then gives a 100-point compatibility reference score. GPT/o models use reasoning-effort probes; other models use deterministic consistency probes.
- The score is split into model identity 40, protocol 25, reasoning 15, stability 10, and latency 10. The configured Model ID is the expected model. If `gpt-6` is expected but responses declare `gpt-5.6-sol` or `gpt-5.5`, the report marks a mismatch and caps the total at 49. If responses omit the model field, Galaxy reports that identity cannot be verified instead of guessing.
- Audits run in the background, usually taking about 20–60 seconds and up to roughly 68 seconds when probes time out. Galaxy shows a live remaining-time estimate, allows other work to continue, and displays both a system notification and result dialog when finished.
- Successful audits automatically submit redacted results without another checkbox. The server receives no API key, request body, full output, or chat history.
- **API ranking** defaults to an all-model overall board and can switch to GPT, DeepSeek, Gemini, or any other tested model. Each provider shows protocol, model, capability, stability, and latency components.
- A site's ranking score is its highest test in the last 7 days; when the current test is the only recent one, that score is used. The UI also shows the network and per-site 90-day highs for excellent/good/usable/inconclusive/high-risk comparison.
- GPT/o-series models use reasoning-effort probes. Common models such as DeepSeek and Gemini use three deterministic Responses consistency probes without GPT reasoning parameters, so their model, protocol, stability, and latency evidence remains useful.
- The public ranking endpoint is `https://api.vx314490015.cn`, connected to the isolated service through a dedicated Cloudflare Tunnel rather than another project's tunnel or port.

## Usage and recovery notes

- Before switching, Galaxy protects unfinished work and lists the matching chat or scheduled task in the prompt.
- Galaxy refreshes the local project list when it starts so existing tasks remain easy to find.
- Task details show history saved on this computer.
- The current installed version is placed first in the release record, so a new installation does not continue to display an older release as the latest record.
- If recovery is needed, open **Log** and keep redacted screenshots and error text. Do not delete `config.toml`, `~/.codex`, or `~/.codex-galaxy`.
- If the bottom-right area shows only one model and its reasoning level, leave the API profile's model ID blank and switch again so Galaxy refreshes the relay `/models` catalog. If the relay returns only one model, or Codex Desktop's official-account gate hides custom models, that is an upstream/provider limitation; the CLI model list can be checked separately.
- Even when an exact GPT model ID is configured, Galaxy reads `/models` on the first switch and saves the full selectable catalog; the configured model remains the default.

## API ↔ official switching steps

### API → official

1. Wait for the current API reply to finish; switch only when Codex is idle.
2. Make sure the official profile is saved and captured. The first time, sign in to the official account in Codex, wait for the project list, then return to Galaxy and click **Capture**.
3. Select the official profile and choose **Switch and open Codex**.
4. If Windows shows setup or login, finish it in Codex. Wait until the project list is normal, then return to Galaxy and click **Done, continue sync**.
5. Wait for progress to reach 100%, then choose **Continue in Codex** from the project list.

### official → API

1. Add or edit the API profile with Base URL and API Key. The model ID is optional; Direct API mode is recommended.
2. Select the API profile and choose **Switch and open Codex**.
3. Galaxy closes an idle Codex gracefully, saves the official login snapshot, removes official OAuth from the live `auth.json`, keeps only the API provider's own credential, synchronizes provider/project records, and opens Codex again.
4. Wait for progress to reach 100%, then choose **Continue in Codex**. Direct API mode can run after Galaxy exits; Compatibility gateway mode requires Galaxy to remain running.
5. If switching fails, open **Log** at the top and copy the redacted log and error text. The default file is `~/.codex-galaxy/logs/galaxy.log`; each record contains UTC and local time.

### API → API

1. Select the target API profile and verify its Base URL, API Key, and model ID.
2. Choose **Switch and open Codex**.
3. Galaxy updates only the provider, model, and required thread indexes; it does not rewrite gigabytes of history for an API-to-API switch.
4. Wait for 100%, then choose **Continue in Codex**.

Version 1.9.9 fixes official → API switches that rolled back to the official account. A current Codex official `auth.json` can contain an empty `OPENAI_API_KEY` field; version 1.9.8 incorrectly treated field presence as legacy API authentication and reported `api-auth-legacy`. Galaxy now treats only a non-empty key as a legacy API credential and never leaves official OAuth active in API mode. The captured official login remains encrypted in Galaxy and is restored unchanged when switching back, without requiring a manual official logout or process termination.

Version 1.13.0 adds a continuously appendable audit queue, fixes profile-card layout, and adds 7-day best-score ranking, 90-day history comparison, component scores, model filters, and useful non-GPT probes.

When a chat history is large, Galaxy warns before direct resume. Click **Copy new-chat continuation prompt**, create a new chat in the same project, and paste it. The prompt includes the original `codex://threads/...` deep link, so Codex knows exactly which chat to continue.

During an official switch, Galaxy no longer merges the current API profile's Windows sandbox table into the official profile; a saved official profile keeps its own sandbox settings. Galaxy also never writes `[model_providers.openai]` as an override of Codex's built-in provider, and removes that stale entry from older snapshots automatically. This prevents Codex from surfacing a `config_load` error as the misleading Windows setup screen, without requiring deletion of `config.toml`. During first-time official login, if Windows setup stalls, choose **Compatibility retry** in the prompt to explicitly use the `unelevated` backend. After login reaches the normal project list, choose **Done, continue sync** and Galaxy will recapture and verify the official state.

## Plugins

Galaxy can install local plugins, add marketplaces supported by the Codex CLI, and bulk-install valid plugins from a local `marketplace.json`. Remote catalog availability depends on the active Codex login and official support; Galaxy does not forge official permissions. Users without an official account can still use pure API profiles, local plugins, and downloaded local marketplaces.

## Updates and platforms

GitHub Releases provides Windows x64, macOS Intel, and macOS Apple Silicon packages. Current builds are unsigned, so the operating system may show an unknown-developer warning. Download releases from this repository and follow the platform prompt. Install over the existing version; manual uninstall is unnecessary, and local accounts, projects, and history are retained.

Every release updates the version surfaces, both READMEs, the Chinese and English in-app guide, release notes, release metadata, regression tests, and installer artifacts together. A version is not considered released until the documentation consistency check and the GitHub publication checks pass.

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

2.0.0 improves compatibility when reopening an older task after switching from an API to an official account. After upgrading, wait for replies to finish, switch to the official profile in Galaxy, then reopen the task. Capture each official account after its own login; saved accounts can then switch independently. Expired login requires reauthentication; plans and quotas remain separate.

2.0.0 shows the complete API ranking directly on the homepage with model filtering and refresh. The ranking dialog, recent preview, current-model status, and duplicate audit button are removed. Use ↑ / ↓ on any account card to persist account order; editing preserves it. When unfinished tasks block switching, the dialog lists chat titles, projects and last activity, labels scheduled tasks, and can open the specific chat. Unreadable activity still blocks switching. The guide now covers official A → official B after separately signing in and capturing each account.

2.1.0 improves ranking readability with larger names, details and scores, compact filters, collapsed explanations and content-sized rows that do not stretch into empty space. Account cards add To top and To bottom alongside stepwise movement; order is saved while other accounts retain their relative positions.

2.1.1 refines the project description and in-app guide so public documentation focuses on account switching, task prompts, local history, API audits, and ranking features users can directly use.

2.2.0 adds a softly animated GPT Top-up button to the app header. It opens the Codex Galaxy plan page with current plans, prices, availability, consultation steps, and the contact QR code; the page has no login, cart, order lookup, or online checkout.
