# Yet Another All-In-One

> Because one plugin is never enough.

A growing all-in-one Obsidian plugin. No bloat, no fluff — just the features you actually want, in one place.

## Modules

### Git Sync

Local-first, cross-platform Git synchronization. No proprietary cloud, no native binaries — works on Windows and Android.

**Features**
- **isomorphic-git** — pure JavaScript Git engine
- **Android-safe** — uses Obsidian's `requestUrl` instead of raw `fetch`
- **Auto-sync** — debounced commit & push on file changes
- **Startup pull** — keeps vault current on open
- **Audit log** — detailed history in `_System/SyncLog.md`

## Installation

1. Download `main.js`, `manifest.json`, `styles.css` from the latest GitHub release
2. Copy to `.obsidian/plugins/yet-another-all-in-one/` in your vault
3. Enable in **Settings → Community Plugins**

## Setup (Git Sync)

1. **Settings → Yet Another All-In-One**
2. Set Remote URL (e.g. `https://github.com/user/vault.git`)
3. Connect with GitHub OAuth or paste a Personal Access Token
4. Run **Yet Another All-In-One: Clone remote into vault** (first time) or **Yet Another All-In-One: Initialise repository** (existing vault)

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