# Vault Git Sync

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
2. Copy to `.obsidian/plugins/vault-git-sync/` in your vault
3. Enable in **Settings → Community Plugins**

## Setup

1. **Settings → Vault Git Sync**
2. Set **Remote URL** (e.g. `https://github.com/user/vault.git`)
3. Connect with **GitHub** (OAuth) or paste a **Personal Access Token**
4. Run `Vault Git Sync: Clone remote into vault` (first time)
   or `Vault Git Sync: Initialise repository` (existing vault)

## Releasing a new version

```sh
npm run release -- 1.0.1
```

## License

MIT
