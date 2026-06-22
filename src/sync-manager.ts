import { App, Notice, Vault } from "obsidian";
import { GitEngine } from "./git-engine";
import { AuditLog } from "./audit-log";
import { GitSyncSettings } from "./types";
import { SyncCenterModal } from "./sync-modal";

function isConflictError(err: Error): boolean {
  const m = err.message || "";
  return m.includes("MergeNotSupported")
    || m.includes("not a simple fast-forward")
    || m.includes("Merges with conflicts")
    || m.includes("Merge conflict")
    || (err.constructor && err.constructor.name === "MergeNotSupportedError")
    || (err.constructor && err.constructor.name === "PushRejectedError");
}

export class SyncManager {
  private engine:  GitEngine;
  private log:     AuditLog;
  private timer:   number | null = null;
  private watcher: number | null = null;
  private busy =   false;
  private app:     App;

  constructor(app: App, vault: Vault) {
    this.app    = app;
    this.engine = new GitEngine(vault);
    this.log    = new AuditLog(vault);
  }

  private get vault(): Vault { return this.app.vault; }

  private baseCtx(settings: GitSyncSettings) {
    return {
      remoteUrl: settings.remoteUrl  || "(none)",
      branch:    settings.branchName || "main",
      provider:  settings.session?.provider ?? "none",
      username:  settings.session?.username ?? "(unauthenticated)",
    };
  }

  private acquireLock(): boolean {
    if (this.busy) { new Notice("Git Sync: Already running — please wait."); return false; }
    this.busy = true;
    return true;
  }

  private releaseLock(): void { this.busy = false; }

  // ── Open Sync Center ────────────────────────────────────────────────────────

  async openSyncCenter(settings: GitSyncSettings): Promise<void> {
    new Notice("Git Sync: Fetching sync status…");
    const status = await this.engine.getSyncStatus(settings);

    new SyncCenterModal(
      this.app,
      status,
      // Force Push
      async () => {
        new Notice("Git Sync: Force pushing…");
        const result = await this.engine.forcePush(settings);
        await this.log.append(
          AuditLog.event(
            "PUSH",
            result.ok ? "SUCCESS" : "FAILURE",
            result.ok ? result.message : result.error.message,
            result.ok ? this.baseCtx(settings) : { ...this.baseCtx(settings), ...AuditLog.errorContext(result.error) }
          ),
          settings
        );
        new Notice(result.ok ? `✓ ${result.message}` : `✗ Force push failed: ${result.error.message}`);
      },
      // Force Pull
      async () => {
        new Notice("Git Sync: Force pulling…");
        const result = await this.engine.forcePull(settings);
        await this.log.append(
          AuditLog.event(
            "PULL",
            result.ok ? "SUCCESS" : "FAILURE",
            result.ok ? result.message : result.error.message,
            result.ok ? this.baseCtx(settings) : { ...this.baseCtx(settings), ...AuditLog.errorContext(result.error) }
          ),
          settings
        );
        new Notice(result.ok ? `✓ ${result.message}` : `✗ Force pull failed: ${result.error.message}`);
      },
      // Resolve single conflict
      async (filepath: string, keepLocal: boolean) => {
        const conflict = status.conflicts.find(c => c.filepath === filepath);
        if (!conflict) return;
        const chosen = keepLocal ? conflict.localContent : conflict.remoteContent;
        if (chosen === null) {
          await this.engine.resolveConflictDelete(settings, filepath);
        } else {
          await this.engine.resolveConflict(settings, filepath, chosen);
        }
        new Notice(`Resolved: ${filepath} → keeping ${keepLocal ? "local" : "remote"}`);
      },
      // Finalize merge
      async () => {
        new Notice("Git Sync: Finalizing merge…");
        const mergeResult = await this.engine.finalizeMerge(settings);
        if (!mergeResult.ok) {
          new Notice(`✗ Merge commit failed: ${mergeResult.error.message}`);
          return;
        }
        new Notice("Git Sync: Pushing merge…");
        const pushResult = await this.engine.push(settings);
        await this.log.append(
          AuditLog.event(
            "PUSH",
            pushResult.ok ? "SUCCESS" : "FAILURE",
            pushResult.ok ? "Merge commit pushed." : pushResult.error.message,
            pushResult.ok ? this.baseCtx(settings) : { ...this.baseCtx(settings), ...AuditLog.errorContext(pushResult.error) }
          ),
          settings
        );
        new Notice(pushResult.ok ? "✓ Merge complete & pushed." : `✗ Push after merge failed: ${pushResult.error.message}`);
      },
    ).open();
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  async init(settings: GitSyncSettings): Promise<void> {
    if (!this.acquireLock()) return;
    try {
      new Notice("Git Sync: Initialising repository…");
      const result = await this.engine.init(settings);
      if (result.ok) await this.engine.addRemote(settings);
      await this.log.append(
        AuditLog.event(
          "INIT",
          result.ok ? "SUCCESS" : "FAILURE",
          result.ok ? result.message : result.error.message,
          result.ok
            ? this.baseCtx(settings)
            : { ...this.baseCtx(settings), ...AuditLog.errorContext(result.error) }
        ),
        settings
      );
      new Notice(result.ok ? `✓ ${result.message}` : `✗ Init failed: ${result.error.message}`);
    } finally { this.releaseLock(); }
  }

  // ── Clone ───────────────────────────────────────────────────────────────────

  async clone(settings: GitSyncSettings): Promise<void> {
    if (!this.acquireLock()) return;
    try {
      new Notice("Git Sync: Cloning…");
      const result = await this.engine.clone(settings);
      await this.log.append(
        AuditLog.event(
          "CLONE",
          result.ok ? "SUCCESS" : "FAILURE",
          result.ok ? result.message : result.error.message,
          result.ok
            ? this.baseCtx(settings)
            : { ...this.baseCtx(settings), ...AuditLog.errorContext(result.error) }
        ),
        settings
      );
      new Notice(result.ok ? `✓ ${result.message}` : `✗ Clone failed: ${result.error.message}`);
    } finally { this.releaseLock(); }
  }

  // ── Pull ────────────────────────────────────────────────────────────────────

  async manualPull(settings: GitSyncSettings): Promise<void> {
    if (!this.acquireLock()) return;
    try {
      new Notice("Git Sync: Pulling…");
      const isRepo = await this.engine.isRepo();
      const result = await this.engine.pull(settings);

      if (!result.ok && isConflictError(result.error)) {
        await this.log.append(
          AuditLog.event("PULL", "FAILURE", result.error.message,
            { ...this.baseCtx(settings), isRepo, ...AuditLog.errorContext(result.error) }),
          settings
        );
        new Notice("Git Sync: Merge conflict detected — opening Sync Center.");
        this.releaseLock();
        await this.openSyncCenter(settings);
        return;
      }

      await this.log.append(
        AuditLog.event(
          "PULL",
          result.ok ? "SUCCESS" : "FAILURE",
          result.ok ? result.message : result.error.message,
          result.ok
            ? { ...this.baseCtx(settings), isRepo }
            : { ...this.baseCtx(settings), isRepo, ...AuditLog.errorContext(result.error) }
        ),
        settings
      );
      new Notice(result.ok ? `✓ ${result.message}` : `✗ Pull failed: ${result.error.message}`);
    } finally { this.releaseLock(); }
  }

  // ── Commit & Push ───────────────────────────────────────────────────────────

  async manualCommitAndPush(settings: GitSyncSettings, msg?: string): Promise<void> {
    if (!this.acquireLock()) return;
    try {
      new Notice("Git Sync: Committing…");
      const commitResult = await this.engine.commit(settings, msg);
      await this.log.append(
        AuditLog.event(
          "COMMIT",
          commitResult.ok
            ? (commitResult.message.startsWith("SKIPPED") ? "SKIPPED" : "SUCCESS")
            : "FAILURE",
          commitResult.ok ? commitResult.message : commitResult.error.message,
          commitResult.ok
            ? { ...this.baseCtx(settings), sha: (commitResult as { sha?: string }).sha }
            : { ...this.baseCtx(settings), ...AuditLog.errorContext(commitResult.error) }
        ),
        settings
      );
      if (!commitResult.ok) { new Notice(`✗ Commit failed: ${commitResult.error.message}`); return; }
      if (commitResult.message.startsWith("SKIPPED")) { new Notice("Git Sync: Nothing to commit."); return; }

      new Notice("Git Sync: Pushing…");
      const pushResult = await this.engine.push(settings);

      if (!pushResult.ok && isConflictError(pushResult.error)) {
        await this.log.append(
          AuditLog.event("PUSH", "FAILURE", pushResult.error.message,
            { ...this.baseCtx(settings), ...AuditLog.errorContext(pushResult.error) }),
          settings
        );
        new Notice("Git Sync: Push rejected (diverged) — opening Sync Center.");
        this.releaseLock();
        await this.openSyncCenter(settings);
        return;
      }

      await this.log.append(
        AuditLog.event(
          "PUSH",
          pushResult.ok ? "SUCCESS" : "FAILURE",
          pushResult.ok ? pushResult.message : pushResult.error.message,
          pushResult.ok
            ? this.baseCtx(settings)
            : { ...this.baseCtx(settings), ...AuditLog.errorContext(pushResult.error) }
        ),
        settings
      );
      new Notice(pushResult.ok ? `✓ Synced: ${commitResult.message}` : `✗ Push failed: ${pushResult.error.message}`);
    } finally { this.releaseLock(); }
  }

  // ── Startup Pull ────────────────────────────────────────────────────────────

  async startupPull(settings: GitSyncSettings): Promise<void> {
    if (!settings.pullOnStartup) return;
    if (!settings.remoteUrl) {
      await this.log.append(
        AuditLog.event("STARTUP_PULL", "SKIPPED", "No remote URL configured.", this.baseCtx(settings)),
        settings
      );
      return;
    }
    if (!settings.session?.accessToken) {
      await this.log.append(
        AuditLog.event("STARTUP_PULL", "SKIPPED", "Not authenticated — connect in settings first.", this.baseCtx(settings)),
        settings
      );
      return;
    }
    if (!this.acquireLock()) return;
    try {
      const isRepo = await this.engine.isRepo();
      const result = await this.engine.pull(settings);

      if (!result.ok && isConflictError(result.error)) {
        await this.log.append(
          AuditLog.event("STARTUP_PULL", "FAILURE", result.error.message,
            { ...this.baseCtx(settings), isRepo, ...AuditLog.errorContext(result.error) }),
          settings
        );
        new Notice("Git Sync: Startup pull conflict — opening Sync Center.");
        this.releaseLock();
        await this.openSyncCenter(settings);
        return;
      }

      await this.log.append(
        AuditLog.event(
          "STARTUP_PULL",
          result.ok ? "SUCCESS" : "FAILURE",
          result.ok ? result.message : result.error.message,
          result.ok
            ? { ...this.baseCtx(settings), isRepo }
            : { ...this.baseCtx(settings), isRepo, ...AuditLog.errorContext(result.error) }
        ),
        settings
      );
      if (!result.ok) new Notice(`Git Sync: Startup pull failed — ${result.error.message}`);
    } finally { this.releaseLock(); }
  }

  // ── Auto Sync & File Watchers ───────────────────────────────────────────────

  startFileWatchers(settings: GitSyncSettings): void {
    // 1. Initial sync of the ignore file
    void this.engine.syncIgnoreFile(settings.ignoreFilePath);

    // 2. Listen for modifications
    this.vault.on("modify", (file) => {
      // Sync ignore file if it was modified
      if (file.path === settings.ignoreFilePath) {
        void this.engine.syncIgnoreFile(settings.ignoreFilePath);
      }

      // Trigger auto-sync if enabled
      if (settings.autoSyncEnabled) {
        if (this.timer) window.clearTimeout(this.timer);
        const debounceMs = settings.autoSyncDebounceMs ?? 5000;
        this.timer = window.setTimeout(() => {
          this.manualCommitAndPush(settings).catch(() => {});
        }, debounceMs);
      }
    });
  }

  stopAutoSync(): void {
    if (this.timer)   { window.clearTimeout(this.timer);   this.timer   = null; }
  }
}