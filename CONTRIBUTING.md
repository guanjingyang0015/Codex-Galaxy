# Contributing

Thanks for helping improve Codex Galaxy.

## Before opening an issue

- Search existing issues.
- State the Galaxy version, Codex Desktop/CLI version, operating system, profile type, and exact switching path.
- Remove API keys, OAuth tokens, account IDs, email addresses, complete chat text, and private project paths.
- Include the smallest reproducible error message or a redacted screenshot.

## Development

Use Node.js 22 or newer:

```powershell
npm ci
npm test
npm start
```

Keep changes focused. Add or update a regression test for authentication, provider switching, history compatibility, gateway behavior, or release metadata changes.

Before submitting a pull request:

```powershell
npm test
npm audit --omit=dev
git diff --check
```

Do not commit generated installers, `node_modules`, `.codex`, `.codex-galaxy`, `.codex-project`, `auth.json`, environment files, credentials, or signing keys.
