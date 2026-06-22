import './buffer-polyfill';
import { Plugin, Modal, App, Setting, Notice } from 'obsidian';
import type { GitSyncSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { SyncManager } from './sync-manager';
import { GitSyncSettingsTab } from './settings-tab';
import { handleOAuthCallback } from './oauth';

export type { GitSyncPlugin };

class GitSyncPlugin extends Plugin {
  settings!: GitSyncSettings;
  syncManager!: SyncManager;

  async onload() {
    await this.loadSettings();
    this.syncManager = new SyncManager(this.app.vault, this);

    this.addSettingTab(new GitSyncSettingsTab(this.app, this));

    this.registerObsidianProtocolHandler('git-sync-callback', params =>
      handleOAuthCallback(params));

    this.addCommand({
      id: 'git-sync-pull',
      name: 'Pull',
      callback: () => this.syncManager.manualPull(this.settings),
    });

    this.addCommand({
      id: 'git-sync-commit-push',
      name: 'Commit & Push',
      callback: () => this.syncManager.manualCommitAndPush(this.settings),
    });

    this.addCommand({
      id: 'git-sync-commit-push-custom',
      name: 'Commit & Push (custom message)',
      callback: () =>
        new CommitMessageModal(this.app, async msg => {
          await this.syncManager.manualCommitAndPush(this.settings, msg);
        }).open(),
    });

    this.addCommand({
      id: 'git-sync-init',
      name: 'Initialise repository',
      callback: () => this.syncManager.init(this.settings),
    });

    this.addCommand({
      id: 'git-sync-clone',
      name: 'Clone remote into vault',
      callback: () => this.syncManager.clone(this.settings),
    });

    if (this.settings.pullOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        this.syncManager.startupPull(this.settings);
      });
    }

    if (this.settings.autoSyncEnabled) {
      this.syncManager.startAutoSync(this.settings);
    }
  }

  async onunload() {
    this.syncManager?.stopAutoSync();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

export default GitSyncPlugin;

class CommitMessageModal extends Modal {
  private value = '';

  constructor(app: App, private onSubmit: (msg: string) => Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('git-sync-commit-modal');

    new Setting(contentEl).setName('Commit message').setHeading();

    new Setting(contentEl)
      .setName('Message')
      .addText(t => {
        t.setPlaceholder('vault sync')
          .setValue(this.value)
          .onChange(v => { this.value = v; });
        t.inputEl.addClass('git-sync-commit-input');
        setTimeout(() => t.inputEl.focus(), 50);
      });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Commit & Push')
        .setCta()
        .onClick(async () => {
          this.close();
          await this.onSubmit(this.value.trim() || 'vault sync');
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}