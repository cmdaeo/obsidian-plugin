// ─────────────────────────────────────────────────────────────────────────────
// sync-modal.ts — Sync Center Modal for conflict resolution & status overview
// ─────────────────────────────────────────────────────────────────────────────

import { App, Modal, ButtonComponent } from "obsidian";
import type { SyncStatus, ConflictFile } from "./git-engine";

type Resolution = "local" | "remote";

export class SyncCenterModal extends Modal {
  private resolutions = new Map<string, Resolution>();
  private resolved = new Set<string>();

  constructor(
    app: App,
    private status: SyncStatus,
    private onForcePush: () => Promise<void>,
    private onForcePull: () => Promise<void>,
    private onResolve: (filepath: string, keepLocal: boolean) => Promise<void>,
    private onFinalize: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("git-sync-center-modal");

    this.renderHeader(contentEl);
    this.renderStatusBadges(contentEl);

    if (this.status.conflicts.length > 0) {
      this.renderTopActions(contentEl);
      this.renderConflictList(contentEl);
    } else {
      this.renderNoConflicts(contentEl);
    }

    this.renderActions(contentEl);
  }

  private renderHeader(el: HTMLElement) {
    const header = el.createDiv({ cls: "git-sync-center-header" });
    header.createEl("h2", { text: "Sync Center", cls: "git-sync-center-title" });
    header.createEl("p", {
      text: "Local and remote histories have diverged. Choose how to resolve.",
      cls: "git-sync-center-subtitle",
    });
  }

  private renderStatusBadges(el: HTMLElement) {
    const badges = el.createDiv({ cls: "git-sync-status-badges" });

    const aheadBadge = badges.createDiv({ cls: "git-sync-badge git-sync-badge-ahead" });
    aheadBadge.createSpan({ cls: "git-sync-badge-icon", text: "↑" });
    aheadBadge.createSpan({ text: `${this.status.ahead} commit${this.status.ahead !== 1 ? "s" : ""} ahead` });

    const behindBadge = badges.createDiv({ cls: "git-sync-badge git-sync-badge-behind" });
    behindBadge.createSpan({ cls: "git-sync-badge-icon", text: "↓" });
    behindBadge.createSpan({ text: `${this.status.behind} commit${this.status.behind !== 1 ? "s" : ""} behind` });

    const branchBadge = badges.createDiv({ cls: "git-sync-badge git-sync-badge-branch" });
    branchBadge.createSpan({ cls: "git-sync-badge-icon", text: "⎇" });
    branchBadge.createSpan({ text: `${this.status.localBranch ?? "(detached)"} → ${this.status.remoteBranch}` });
  }

  private renderNoConflicts(el: HTMLElement) {
    const box = el.createDiv({ cls: "git-sync-no-conflicts" });
    box.createEl("p", { text: "No file-level conflicts detected, but histories have diverged." });
    box.createEl("p", {
      text: "Use Force Push to overwrite the remote, or Force Pull to overwrite local files.",
      cls: "git-sync-muted",
    });
  }

  private renderConflictList(el: HTMLElement) {
    const section = el.createDiv({ cls: "git-sync-conflicts-section" });
    section.createEl("h3", { text: `Conflicting Files (${this.status.conflicts.length})`, cls: "git-sync-section-title" });

    const list = section.createDiv({ cls: "git-sync-conflict-list" });

    for (const conflict of this.status.conflicts) {
      this.renderConflictItem(list, conflict);
    }
  }

  private renderConflictItem(parent: HTMLElement, conflict: ConflictFile) {
    const item = parent.createDiv({ cls: "git-sync-conflict-item" });

    // File header row
    const header = item.createDiv({ cls: "git-sync-conflict-header" });
    const nameEl = header.createSpan({ cls: "git-sync-conflict-filename", text: conflict.filepath });

    const statusLabel = conflict.localContent === null
      ? "deleted locally"
      : conflict.remoteContent === null
        ? "deleted on remote"
        : "modified in both";
    header.createSpan({ cls: "git-sync-conflict-status", text: statusLabel });

    // Resolution indicator
    if (this.resolved.has(conflict.filepath)) {
      nameEl.addClass("git-sync-resolved");
      const res = this.resolutions.get(conflict.filepath);
      header.createSpan({
        cls: "git-sync-resolved-badge",
        text: `✓ Keeping ${res === "local" ? "local" : "remote"}`,
      });
    }

    // Expand / diff button
    const btnRow = item.createDiv({ cls: "git-sync-conflict-actions" });
    const diffContainer = item.createDiv({ cls: "git-sync-diff-container git-sync-hidden" });

    new ButtonComponent(btnRow)
      .setButtonText("View Diff")
      .setClass("git-sync-btn-secondary")
      .onClick(() => {
        const isVisible = !diffContainer.hasClass("git-sync-hidden");
        diffContainer.toggleClass("git-sync-hidden", isVisible);
        if (!isVisible && diffContainer.childElementCount === 0) {
          this.renderDiff(diffContainer, conflict);
        }
      });

    new ButtonComponent(btnRow)
      .setButtonText("Keep Local")
      .setClass("git-sync-btn-local")
      .onClick(() => this.selectResolution(conflict, "local", item));

    new ButtonComponent(btnRow)
      .setButtonText("Keep Remote")
      .setClass("git-sync-btn-remote")
      .onClick(() => this.selectResolution(conflict, "remote", item));
  }

  private renderDiff(container: HTMLElement, conflict: ConflictFile) {
    container.empty();
    const diffView = container.createDiv({ cls: "git-sync-diff-view" });

    // Side-by-side panels
    const panels = diffView.createDiv({ cls: "git-sync-diff-panels" });

    // Local panel
    const localPanel = panels.createDiv({ cls: "git-sync-diff-panel git-sync-diff-local" });
    localPanel.createDiv({ cls: "git-sync-diff-panel-header", text: "📄 Local (Your Version)" });
    const localPre = localPanel.createEl("pre", { cls: "git-sync-diff-content" });
    localPre.createEl("code", { text: conflict.localContent ?? "(file deleted)" });

    // Remote panel
    const remotePanel = panels.createDiv({ cls: "git-sync-diff-panel git-sync-diff-remote" });
    remotePanel.createDiv({ cls: "git-sync-diff-panel-header", text: "☁ Remote (GitHub Version)" });
    const remotePre = remotePanel.createEl("pre", { cls: "git-sync-diff-content" });
    remotePre.createEl("code", { text: conflict.remoteContent ?? "(file deleted)" });

    // Highlight differences line-by-line
    if (conflict.localContent && conflict.remoteContent) {
      this.highlightDiffs(localPre, remotePre, conflict.localContent, conflict.remoteContent);
    }
  }

  private highlightDiffs(localPre: HTMLElement, remotePre: HTMLElement, local: string, remote: string) {
    const localLines = local.split("\n");
    const remoteLines = remote.split("\n");
    const maxLines = Math.max(localLines.length, remoteLines.length);

    localPre.empty();
    remotePre.empty();

    for (let i = 0; i < maxLines; i++) {
      const ll = localLines[i] ?? "";
      const rl = remoteLines[i] ?? "";

      const localLine = localPre.createDiv({ cls: "git-sync-diff-line" });
      const remoteLine = remotePre.createDiv({ cls: "git-sync-diff-line" });

      localLine.createSpan({ cls: "git-sync-diff-linenum", text: String(i + 1) });
      remoteLine.createSpan({ cls: "git-sync-diff-linenum", text: String(i + 1) });

      const localCode = localLine.createSpan({ cls: "git-sync-diff-code" });
      const remoteCode = remoteLine.createSpan({ cls: "git-sync-diff-code" });

      localCode.textContent = ll;
      remoteCode.textContent = rl;

      if (ll !== rl) {
        localLine.addClass("git-sync-diff-changed-local");
        remoteLine.addClass("git-sync-diff-changed-remote");
      }
    }
  }

  private async selectResolution(conflict: ConflictFile, choice: Resolution, itemEl: HTMLElement) {
    this.resolutions.set(conflict.filepath, choice);
    this.resolved.add(conflict.filepath);

    await this.onResolve(conflict.filepath, choice === "local");

    // Re-render just this item
    itemEl.empty();
    this.renderConflictItem(itemEl.parentElement!, conflict);
    // Remove the wrapper since renderConflictItem creates its own
    itemEl.remove();

    this.updateFinalizeButton();
  }

  private finalizeBtn: ButtonComponent | null = null;

  private renderTopActions(el: HTMLElement) {
    const mergeRow = el.createDiv({ cls: "git-sync-top-actions" });

    this.finalizeBtn = new ButtonComponent(mergeRow)
      .setButtonText(`✓ Complete Merge (${this.resolved.size}/${this.status.conflicts.length} resolved)`)
      .setCta()
      .setDisabled(this.resolved.size < this.status.conflicts.length)
      .onClick(async () => {
        this.close();
        await this.onFinalize();
      });
      
    // Styles are now handled by .git-sync-top-actions in CSS
  }

  private renderActions(el: HTMLElement) {
    const actions = el.createDiv({ cls: "git-sync-center-actions" });

    // Separator
    actions.createEl("hr", { cls: "git-sync-divider" });

    const label = actions.createDiv({ cls: "git-sync-actions-label" });
    label.createEl("span", { text: "Quick Actions", cls: "git-sync-section-title" });
    label.createEl("p", {
      text: "These will overwrite either your local vault or the remote repository entirely.",
      cls: "git-sync-muted",
    });

    const btnRow = actions.createDiv({ cls: "git-sync-center-btn-row" });

    new ButtonComponent(btnRow)
      .setButtonText("⬆ Force Push (overwrite remote)")
      .setClass("git-sync-btn-danger")
      .onClick(async () => {
        this.close();
        await this.onForcePush();
      });

    new ButtonComponent(btnRow)
      .setButtonText("⬇ Force Pull (overwrite local)")
      .setClass("git-sync-btn-warning")
      .onClick(async () => {
        this.close();
        await this.onForcePull();
      });

    // Cancel
    const cancelRow = actions.createDiv({ cls: "git-sync-center-btn-row git-sync-center-cancel" });
    new ButtonComponent(cancelRow)
      .setButtonText("Cancel")
      .onClick(() => this.close());
  }

  private updateFinalizeButton() {
    if (!this.finalizeBtn) return;
    const allResolved = this.resolved.size >= this.status.conflicts.length;
    this.finalizeBtn.setDisabled(!allResolved);
    this.finalizeBtn.setButtonText(
      `✓ Complete Merge (${this.resolved.size}/${this.status.conflicts.length} resolved)`
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
