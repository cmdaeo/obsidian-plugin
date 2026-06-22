import { Notice, Vault } from "obsidian";
import { GitEngine } from "./git-engine";
import { AuditLog } from "./audit-log";
import { GitSyncSettings } from "./types";

export class SyncManager {
  private engine:  GitEngine;
  private log:     AuditLog;
  private timer:   ReturnType<typeof setTimeout> | null = null;
  private watcher: ReturnType<typeof setInterval>  | null = null;
  private busy =   false;

  constructor(private vault: Vault) {
    this.engine = new GitEngine(vault);
    this.log    = new AuditLog(vault);
  }

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

  async manualPull(settings: GitSyncSettings): Promise<void> {
    if (!this.acquireLock()) return;
    try {
      new Notice("Git Sync: Pulling…");
      const isRepo = await this.engine.isRepo();
      const result = await this.engine.pull(settings);
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
            ? { ...this.baseCtx(settings), sha: (commitResult as any).sha }
            : { ...this.baseCtx(settings), ...AuditLog.errorContext(commitResult.error) }
        ),
        settings
      );
      if (!commitResult.ok) { new Notice(`✗ Commit failed: ${commitResult.error.message}`); return; }
      if (commitResult.message.startsWith("SKIPPED")) { new Notice("Git Sync: Nothing to commit."); return; }

      new Notice("Git Sync: Pushing…");
      const pushResult = await this.engine.push(settings);
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

  startAutoSync(settings: GitSyncSettings): void {
    this.stopAutoSync();
    const debounceMs = settings.autoSyncDebounceMs ?? 5000;
    this.vault.on("modify", () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.manualCommitAndPush(settings).catch(() => {});
      }, debounceMs);
    });
  }

  stopAutoSync(): void {
    if (this.timer)   { clearTimeout(this.timer);   this.timer   = null; }
    if (this.watcher) { clearInterval(this.watcher); this.watcher = null; }
  }
}