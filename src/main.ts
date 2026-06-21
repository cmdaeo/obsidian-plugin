// ─────────────────────────────────────────────────────────────────────────────
// main.ts — Plugin entry-point
// ─────────────────────────────────────────────────────────────────────────────

import { Plugin, Modal, App, Setting } from "obsidian";
import { GitSyncSettings, DEFAULT_SETTINGS } from "./types";
import { SyncManager } from "./sync-manager";
import { GitEngine } from "./git-engine";
import { GitSyncSettingsTab } from "./settings-tab";
import { handleOAuthCallback } from "./oauth";

export default class GitSyncPlugin extends Plugin {
  settings!: GitSyncSettings;
  private syncManager!: SyncManager;

  async onload() {
    await this.loadSettings();
    this.syncManager = new SyncManager(this.app.vault);

    this.addSettingTab(new GitSyncSettingsTab(this.app, this));

    // ── OAuth callback handler ─────────────────────────────────────────────
    // Handles obsidian://git-sync-callback?code=…&state=…
    // GitHub/GitLab redirect here after the user approves the OAuth app.
    this.registerObsidianProtocolHandler(
      "git-sync-callback",
      (params) => handleOAuthCallback(params)
    );

    // ── Commands ───────────────────────────────────────────────────────────

    this.addCommand({
      id: "git-sync-pull",
      name: "Pull",
      callback: () => this.syncManager.manualPull(this.settings),
    });

    this.addCommand({
      id: "git-sync-commit-push",
      name: "Commit & Push",
      callback: () => this.syncManager.manualCommitAndPush(this.settings),
    });

    this.addCommand({
      id: "git-sync-commit-push-custom",
      name: "Commit & Push (custom message)…",
      callback: () => {
        new CommitMessageModal(this.app, async (msg) => {
          await this.syncManager.manualCommitAndPush(this.settings, msg);
        }).open();
      },
    });

    this.addCommand({
      id: "git-sync-init",
      name: "Initialise repository",
      callback: async () => {
        const engine = new GitEngine(this.app.vault);
        const initResult = await engine.init(this.settings);
        if (initResult.ok && this.settings.remoteUrl) {
          await engine.addRemote(this.settings);
        }
        console.log("[VaultGitSync] init:", initResult);
      },
    });

    this.addCommand({
      id: "git-sync-clone",
      name: "Clone remote into vault",
      callback: () => {
        new CloneConfirmModal(this.app, async () => {
          const engine = new GitEngine(this.app.vault);
          const result = await engine.clone(this.settings);
          console.log("[VaultGitSync] clone:", result);
        }).open();
      },
    });

    // ── Vault hooks ────────────────────────────────────────────────────────

    (["modify", "create", "delete", "rename"] as const).forEach((evt) => {
      this.registerEvent(
        this.app.vault.on(evt as "modify", () =>
          this.syncManager.scheduleAutoSync(this.settings)
        )
      );
    });

    // ── Startup pull ───────────────────────────────────────────────────────
    setTimeout(() => this.syncManager.startupPull(this.settings), 2000);
  }

  onunload() {
    this.syncManager.destroy();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ── Modals ─────────────────────────────────────────────────────────────────────

class CommitMessageModal extends Modal {
  private message = "";

  constructor(app: App, private onSubmit: (msg: string) => Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Commit message" });
    new Setting(contentEl).addText((text) => {
      text.setPlaceholder("Describe your changes…").onChange((v) => (this.message = v));
      text.inputEl.style.width = "100%";
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
      setTimeout(() => text.inputEl.focus(), 50);
    });
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Commit & Push").setCta().onClick(() => this.submit())
    );
  }

  private async submit() {
    const msg = this.message.trim();
    this.close();
    await this.onSubmit(msg || `manual commit @ ${new Date().toISOString()}`);
  }

  onClose() { this.contentEl.empty(); }
}

class CloneConfirmModal extends Modal {
  constructor(app: App, private onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Clone remote into vault?" });
    contentEl.createEl("p", {
      text: "This will clone the remote repository into your vault root. Existing files may be overwritten.",
    });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText("Clone").setWarning().onClick(async () => {
          this.close();
          await this.onConfirm();
        })
      );
  }

  onClose() { this.contentEl.empty(); }
}
