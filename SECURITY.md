# Security Policy

## Reporting a vulnerability

Please report security issues privately to `guanjingyang@gmail.com`.

Do not include real API keys, OAuth tokens, `auth.json`, browser cookies, complete chat histories, or unredacted credential files in a report. A minimal reproduction using temporary profiles and fake keys is preferred.

## Data boundary

Codex Galaxy stores its profile data locally and uses Electron `safeStorage` for API keys and captured official-account snapshots. The API gateway listens only on `127.0.0.1`.

The optional public relay ranking service receives only bounded, redacted compatibility metrics after a successful audit. API keys, OAuth data, prompts, complete outputs, request bodies, and chat history are rejected or omitted before submission. The public endpoint is isolated behind its own Cloudflare Tunnel and does not reuse another project's tunnel or port.

The public top-up information page is read-only. It does not accept Codex credentials, payment details, orders, account registration, or login data.

Galaxy's local log at `~/.codex-galaxy/logs/galaxy.log` records only bounded operation, timestamp, local time, error-type, and redacted error information. Review it before sharing and never include API keys, OAuth tokens, chat bodies, request bodies, or unredacted local paths in a report.

Official login still uses the official Codex OAuth flow. Codex Galaxy does not bypass passwords, verification codes, organization policy, or upstream access controls.

## Supported versions

Security fixes are released against the latest published version. Users should upgrade over their existing installation and keep backups of `~/.codex` and `~/.codex-galaxy` before testing major changes.

## Release documentation rule

Security, recovery, account-switching, and local-data behavior changes must be reflected in both READMEs, the in-app Chinese and English guide, and the matching release notes before publication. The project’s documentation consistency checks are part of the release gate.

Account order and task details (2.0.0): moving accounts changes only the profile list order, never vault credentials. Switch-blocking task titles and project paths are read locally and are not submitted to API ranking services. Opening a task accepts only an ID from the current sender-bound confirmation; an unfinished-task confirmation cannot authorize a switch.
