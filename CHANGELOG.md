# Changelog

All notable changes to Yet Another All-In-One are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [1.0.1] — 2026-06-21

### Added

- Initial release
- Git Sync module: isomorphic-git engine (pure JS, no native binaries)
- Cross-platform: Windows desktop and Android
- Obsidian `requestUrl` HTTP adapter — replaces `fetch`, bypasses mobile CSP
- Node-compatible FS adapter with proper `isDirectory`, `isFile`, `stat` methods
- Auto-sync: background debounced commit & push on file changes
- Startup pull on vault open
- Manual commands: Pull, Commit & Push, Init, Clone
- Settings UI: remote URL, branch, credentials, auto-sync toggle
- Audit log: append-only Markdown table in `_System/SyncLog.md`
- Structured JSON context blocks: remote, branch, provider, error details
- Startup pull skips with specific reason instead of silent failures
- GitHub Actions release workflow: tag push → build → release assets
- `release.mjs` script for release automation
- `revert-release.mjs` script — removes tags and undoes commit only (no file edits)