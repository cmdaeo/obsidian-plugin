import { Notice, Vault } from "obsidian";
import { GitEngine } from "./git-engine";
import { AuditLog } from "./audit-log";
import { GitSyncSettings } from "./types";

export class SyncManager {
  private engine:  GitEngine;
  private log:     AuditLog;
  private timer:   ReturnType<typeof setTimeout> | null = null;
  private busy =   false;

  constructor(private vault: Vault) {
    this.engine = new GitEngine(vault);
    this.log    = new AuditLog(vault);
  }

  // ── Shared context builder ─────────────────────────────────────────────────

  private baseCtx(settings: GitSyncSettings) {
    return {
      remoteUrl: settings.remoteUrl  || "(none)",
      branch:    settings.branchName || "main",
      provider:  settings.session?.provider ?? "none",
      username:  settings.session?.username ?? "(unauthenticated)",
    };
  }

  // ── Public commands ────────────────────────────────────────────────────────

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
          commitResult.ok ? (commitResult.message.startsWith("SKIPPED") ? "SKIPPED" : "SUCCESS") : "FAILURE",
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

    // Pre-flight guards — log specific reason for skips instead of silent failures
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

    const isRepo = await this.engine.isRepo();
    if (!isRepo) {
      await this.log.append(
        AuditLog.event(
          "STARTUP_PULL", "SKIPPED",
          "Vault is not a Git repo yet. Run 'Git Sync: Clone remote into vault' first.",
          { ...this.baseCtx(settings), isRepo: false }
        ),
        settings
      );
      return;
    }

    if (!this.acquireLock()) return;
    try {
      const result = await this.engine.pull(settings);
      await this.log.append(
        AuditLog.event(
          "STARTUP_PULL",
          result.ok ? "SUCCESS" : "FAILURE",
          result.ok ? result.message : result.error.message,
          result.ok
            ? { ...this.baseCtx(settings), isRepo: true }
            : { ...this.baseCtx(settings), isRepo: true, ...AuditLog.errorContext(result.error) }
        ),
        settings
      );
      if (!result.ok) new Notice(`Git Sync startup pull failed: ${result.error.message}`);
    } finally { this.releaseLock(); }
  }

  scheduleAutoSync(settings: GitSyncSettings): void {
    if (!settings.autoSyncEnabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.runAutoSync(settings), settings.autoSyncDebounceMs);
  }

  private async runAutoSync(settings: GitSyncSettings): Promise<void> {
    if (!this.acquireLock()) { this.scheduleAutoSync(settings); return; }
    try {
      const commitResult = await this.engine.commit(settings, `auto-sync @ ${new Date().toISOString()}`);
      if (!commitResult.ok) {
        await this.log.append(
          AuditLog.event("AUTO_SYNC", "FAILURE", commitResult.error.message,
            { ...this.baseCtx(settings), ...AuditLog.errorContext(commitResult.error) }),
          settings
        );
        return;
      }
      if (commitResult.message.startsWith("SKIPPED")) return;

      const pushResult = await this.engine.push(settings);
      await this.log.append(
        AuditLog.event(
          "AUTO_SYNC",
          pushResult.ok ? "SUCCESS" : "FAILURE",
          pushResult.ok ? `${commitResult.message} → pushed` : pushResult.error.message,
          pushResult.ok
            ? { ...this.baseCtx(settings), sha: (commitResult as any).sha }
            : { ...this.baseCtx(settings), ...AuditLog.errorContext(pushResult.error) }
        ),
        settings
      );
    } finally { this.releaseLock(); }
  }

  // ── Lock ───────────────────────────────────────────────────────────────────

  private acquireLock(): boolean {
    if (this.busy) { new Notice("Git Sync: An operation is already in progress."); return false; }
    this.busy = true;
    return true;
  }

  private releaseLock(): void { this.busy = false; }

  destroy(): void { if (this.timer) clearTimeout(this.timer); }
}
