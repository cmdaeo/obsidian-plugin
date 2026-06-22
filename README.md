# YAP — Yet Another Plugin

Local-first, cross-platform Git synchronization for Obsidian. No proprietary cloud, no native binaries — works on Windows and Android.

## Features

- **isomorphic-git** — pure JavaScript Git engine
- **Android-safe** — uses Obsidian's `requestUrl` instead of raw `fetch`
- **Auto-sync** — debounced commit & push on file changes
- **Startup pull** — keeps vault current on open
- **Audit log** — detailed history in `_System/SyncLog.md`

## Installation

1. Download `main.js`, `manifest.json`, `styles.css` from the latest GitHub release
2. Copy to `.obsidian/plugins/yet-another-plugin/` in your vault
3. Enable in **Settings → Community Plugins**

## Setup

1. **Settings → YAP**
2. Set Remote URL (e.g. `https://github.com/user/vault.git`)
3. Connect with GitHub OAuth or paste a Personal Access Token
4. Run **YAP: Clone remote into vault** (first time) or **YAP: Initialise repository** (existing vault)

## Releasing a new version

```sh
npm run release -- 1.0.2
```

If a release fails mid-way, revert it (tags + commit only — no file edits) so you can re-run:

```sh
npm run revert-release          # auto-detects version from HEAD commit
npm run revert-release -- 1.0.2 # or specify explicitly
```

## License

MIT