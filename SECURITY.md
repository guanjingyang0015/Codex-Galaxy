# Security Policy

## Reporting a vulnerability

Please report security issues privately to `guanjingyang@gmail.com`.

Do not include real API keys, OAuth tokens, `auth.json`, browser cookies, complete chat histories, or unredacted credential files in a report. A minimal reproduction using temporary profiles and fake keys is preferred.

## Data boundary

Codex Galaxy stores its profile data locally and uses Electron `safeStorage` for API keys and captured official-account snapshots. The API gateway listens only on `127.0.0.1`. The project does not operate a Galaxy cloud service.

Galaxy's local error log at `~/.codex-galaxy/logs/galaxy.log` records only bounded operation, timestamp, error-type, and redacted error information. Review it before sharing and never include API keys, OAuth tokens, chat bodies, request bodies, or unredacted local paths in a report.

Official login still uses the official Codex OAuth flow. Codex Galaxy does not bypass passwords, verification codes, organization policy, or upstream access controls.

## Supported versions

Security fixes are released against the latest published version. Users should upgrade over their existing installation and keep backups of `~/.codex` and `~/.codex-galaxy` before testing major changes.

## Release documentation rule

Security, recovery, account-switching, and local-data behavior changes must be reflected in both READMEs, the in-app Chinese and English guide, and the matching release notes before publication. The project’s documentation consistency checks are part of the release gate.
