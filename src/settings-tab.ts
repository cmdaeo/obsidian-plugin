import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import { runWebFlow, GiteaPATModal } from "./oauth";
import type GitSyncPlugin from "./main";

export class GitSyncSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: GitSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("git-sync-settings");

    new Setting(containerEl).setName("Remote Repository").setHeading();

    new Setting(containerEl)
      .setName("Remote URL")
      .setDesc("HTTPS URL of your Git remote — e.g. https://github.com/user/vault.git")
      .addText((t) =>
        t.setPlaceholder("https://github.com/user/vault.git")
          .setValue(this.plugin.settings.remoteUrl)
          .onChange(async (v) => { this.plugin.settings.remoteUrl = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Branch")
      .addText((t) =>
        t.setPlaceholder("main")
          .setValue(this.plugin.settings.branchName)
          .onChange(async (v) => { this.plugin.settings.branchName = v.trim() || "main"; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl).setName("GitHub OAuth App").setHeading();

    containerEl.createEl("p", {
      text: "Register your own app at github.com/settings/developers → OAuth Apps → New. " +
            "Set the Authorization callback URL to: obsidian://git-sync-callback",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Client ID")
      .addText((t) =>
        t.setPlaceholder("Ov23li…")
          .setValue(this.plugin.settings.githubClientId)
          .onChange(async (v) => { this.plugin.settings.githubClientId = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Client Secret")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("••••••••••••••••••••••••••••••••••••••••")
          .setValue(this.plugin.settings.githubClientSecret)
          .onChange(async (v) => { this.plugin.settings.githubClientSecret = v.trim(); await this.plugin.saveSettings(); });
      });

    if (this.plugin.settings.session?.provider === "github") {
      this.renderConnectedBanner(containerEl, "github");
    } else {
      new Setting(containerEl)
        .setName("Connect")
        .addButton((btn) =>
          btn.setButtonText("Connect with GitHub").setCta().onClick(async () => {
            const { githubClientId: id, githubClientSecret: secret } = this.plugin.settings;
            if (!id || !secret) { new Notice("Git Sync: Enter your GitHub Client ID and Secret first."); return; }
            const session = await runWebFlow(this.app, "github", id, secret);
            if (session) { this.plugin.settings.session = session; await this.plugin.saveSettings(); new Notice(`Git Sync: Connected as @${session.username}`); this.display(); }
          })
        );
    }

    new Setting(containerEl).setName("GitLab OAuth App").setHeading();

    containerEl.createEl("p", {
      text: "Register at gitlab.com/-/profile/applications. Scopes: read_user, read_repository, write_repository. Redirect URI: obsidian://git-sync-callback",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Application ID")
      .addText((t) =>
        t.setPlaceholder("abc123…")
          .setValue(this.plugin.settings.gitlabClientId)
          .onChange(async (v) => { this.plugin.settings.gitlabClientId = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Secret")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("••••••••••••••••••••••••••••••••••••••••")
          .setValue(this.plugin.settings.gitlabClientSecret)
          .onChange(async (v) => { this.plugin.settings.gitlabClientSecret = v.trim(); await this.plugin.saveSettings(); });
      });

    if (this.plugin.settings.session?.provider === "gitlab") {
      this.renderConnectedBanner(containerEl, "gitlab");
    } else {
      new Setting(containerEl)
        .setName("Connect")
        .addButton((btn) =>
          btn.setButtonText("Connect with GitLab").setCta().onClick(async () => {
            const { gitlabClientId: id, gitlabClientSecret: secret } = this.plugin.settings;
            if (!id || !secret) { new Notice("Git Sync: Enter your GitLab Application ID and Secret first."); return; }
            const session = await runWebFlow(this.app, "gitlab", id, secret);
            if (session) { this.plugin.settings.session = session; await this.plugin.saveSettings(); new Notice(`Git Sync: Connected as @${session.username}`); this.display(); }
          })
        );
    }

    new Setting(containerEl).setName("Gitea (Self-hosted)").setHeading();

    if (this.plugin.settings.session?.provider === "gitea") {
      this.renderConnectedBanner(containerEl, "gitea");
    } else {
      new Setting(containerEl)
        .setName("Connect")
        .addButton((btn) =>
          btn.setButtonText("Connect Gitea instance").onClick(() =>
            new GiteaPATModal(this.app, async (result) => {
              if (!result) return;
              try {
                const res = await fetch(`${result.baseUrl}/api/v1/user`, { headers: { Authorization: `token ${result.token}` } });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const user = await res.json();
                this.plugin.settings.session = {
                  provider:    "gitea",
                  username:    user.login ?? user.username ?? "user",
                  email:       user.email ?? "",
                  accessToken: result.token
                };
                await this.plugin.saveSettings();
                new Notice(`Git Sync: Connected as ${this.plugin.settings.session!.username}`);
                this.display();
              } catch (e) {
                new Notice(`Git Sync: Could not verify Gitea token — ${(e as Error).message}`);
              }
            }).open()
          )
        );
    }

    new Setting(containerEl).setName("Sync Behaviour").setHeading();

    new Setting(containerEl).setName("Pull on startup")
      .addToggle((t) => t.setValue(this.plugin.settings.pullOnStartup).onChange(async (v) => { this.plugin.settings.pullOnStartup = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Auto-sync").setDesc("Automatically commit and push after changes (debounced)")
      .addToggle((t) => t.setValue(this.plugin.settings.autoSyncEnabled).onChange(async (v) => { this.plugin.settings.autoSyncEnabled = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Auto-sync delay (ms)")
      .addText((t) => t.setValue(String(this.plugin.settings.autoSyncDebounceMs)).onChange(async (v) => {
        const n = parseInt(v);
        if (!isNaN(n) && n >= 1000) { this.plugin.settings.autoSyncDebounceMs = n; await this.plugin.saveSettings(); }
      }));

    new Setting(containerEl).setName("Audit Log").setHeading();

    new Setting(containerEl).setName("Enable audit log")
      .addToggle((t) => t.setValue(this.plugin.settings.auditLogEnabled).onChange(async (v) => { this.plugin.settings.auditLogEnabled = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Log file path")
      .addText((t) => t.setPlaceholder("_System/SyncLog.md").setValue(this.plugin.settings.auditLogPath).onChange(async (v) => { this.plugin.settings.auditLogPath = v.trim(); await this.plugin.saveSettings(); }));
  }

  private renderConnectedBanner(containerEl: HTMLElement, provider: string): void {
    const s = this.plugin.settings.session!;
    const labels: Record<string, string> = { github: "GitHub", gitlab: "GitLab", gitea: "Gitea" };
    new Setting(containerEl)
      .setName(`✓ Connected to ${labels[provider] ?? provider}`)
      .setDesc(`@${s.username}${s.email ? ` · ${s.email}` : ""}`)
      .addButton((btn) =>
        btn.setButtonText("Disconnect").setWarning().onClick(async () => {
          this.plugin.settings.session = null;
          await this.plugin.saveSettings();
          new Notice("Git Sync: Disconnected.");
          this.display();
        })
      );
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}