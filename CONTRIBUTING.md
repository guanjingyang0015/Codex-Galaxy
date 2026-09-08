# Contributing

Thanks for helping improve Codex Galaxy.

## Before opening an issue

- Search existing issues.
- State the Galaxy version, Codex Desktop/CLI version, operating system, profile type, and exact switching path.
- Remove API keys, OAuth tokens, account IDs, email addresses, complete chat text, and private project paths.
- Include the smallest reproducible error message, a redacted screenshot, and the redacted text copied from Galaxy's top “日志” / “Log” window when available.

## Development

Use Node.js 22 or newer:

```powershell
npm ci
npm test
npm start
```

Keep changes focused. Add or update a regression test for authentication, provider switching, history compatibility, gateway behavior, background audit progress, or release metadata changes. Saved-profile audit tests must prove the encrypted profile key is consumed in the main process without being exposed to renderer fields or logs.

Before submitting a pull request:

```powershell
npm test
npm audit --omit=dev
git diff --check
```

## Documentation and release rule

Every user-visible change must update all affected instructions in the same change: `README.md`, `README.en.md`, the Chinese and English in-app tutorial in `public/app.js` / `public/index.html`, the matching `release-notes/v<version>.md`, and any relevant security or recovery guidance. Version surfaces, release metadata, tests, and installer artifacts must remain consistent.

Switch and IPC failures are recorded in the local `~/.codex-galaxy/logs/galaxy.log` file with UTC/local time and secrets/request content redacted. Keep the log local until it has been reviewed; never submit API keys, OAuth tokens, chat bodies, or unredacted log content.

`npm test` includes a documentation synchronization regression test. Do not bypass or weaken it to make a release pass. A version is not released until documentation checks, tests, builds, commit, tag, GitHub Actions, public Release, and asset verification all succeed.

Do not commit generated installers, `node_modules`, `.codex`, `.codex-galaxy`, `.codex-project`, `auth.json`, environment files, credentials, or signing keys.

For homepage/account-order changes, verify all ranking rows are present without opening a dialog, reordering survives editing, and blocked switching lists scheduled tasks with the correct chat target. Use an isolated Codex home and synthetic credentials for account tests; do not restart an active user session for UI validation.

Public user documentation should describe user-visible product behavior and omit internal deployment controls, credentials, and administration procedures. Keep the documentation consistency check aligned with this boundary.
