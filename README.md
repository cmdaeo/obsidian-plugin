# Git Sync — Obsidian Plugin

Local-first, cross-platform Git synchronization for Obsidian.
No proprietary cloud, no native binaries — works on Windows and Android.

## Features

- **isomorphic-git** — pure JavaScript Git engine
- **Android-safe** — uses Obsidian's `requestUrl` instead of raw `fetch`
- **Auto-sync** — debounced commit + push on file changes
- **Startup pull** — keeps vault current on open
- **Audit log** — detailed history in `_System/Sync_Log.md`

## Installation

1. Download `main.js`, `manifest.json`, `styles.css` from the latest [GitHub release](https://github.com/cmdaeo/obsidian-plugin/releases)
2. Copy to `.obsidian/plugins/obsidian-git-sync/` in your vault
3. Enable in **Settings → Community Plugins**

## Setup

1. **Settings → Git Sync**
2. Set **Remote URL** (e.g. `https://github.com/user/vault.git`)
3. Connect with **GitHub** (OAuth) or paste a **Personal Access Token**
4. Run `Git Sync: Clone remote into vault` (first time)
   or `Git Sync: Initialise repository` (existing vault)

## Releasing a new version

```sh
# 1. Edit manifest.json version field
# 2. Run version script
npm run version

# 3. Commit + tag + push
git commit -m "chore: release 1.0.1"
git tag 1.0.1
git push && git push --tags
# GitHub Actions builds and publishes the release automatically
```

## License

MIT
