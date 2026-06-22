import { Vault } from "obsidian";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { buildFsAdapter } from "./fs-adapter";
import { GitSyncSettings, GitResult } from "./types";

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function categorizeError(err: Error, remoteUrl: string): Error {
  const m = err.message;
  if (m.includes("status 401") || m.includes("status 403"))
    return new Error(`Auth rejected by ${remoteUrl} — token may be expired. Reconnect in settings.`);
  if (m.includes("status 404"))
    return new Error(`Repository not found: ${remoteUrl} — check the remote URL.`);
  if (m.includes("network error") || m.includes("Failed to fetch") || m.includes("NetworkError"))
    return new Error(`Network unreachable — check internet connection. (${remoteUrl})`);
  if (m.includes("MergeNotSupportedFastForwardOnly"))
    return new Error("Merge conflict — fast-forward not possible. Resolve conflicts then push.");
  return err;
}

export class GitEngine {
  private fs: ReturnType<typeof buildFsAdapter>;
  private readonly dir = "/";

  constructor(private vault: Vault) {
    this.fs = buildFsAdapter(vault);
  }

  private buildAuth(settings: GitSyncSettings) {
    const { session } = settings;
    if (!session?.accessToken) return {};
    return {
      onAuth: () => ({ username: session.username || "oauth2", password: session.accessToken }),
      // AuthFailureCallback receives (url: string) — NOT destructured { url: string }
      onAuthFailure: (url: string) => {
        throw new Error(`Auth rejected by ${url} — token expired? Reconnect in settings.`);
      },
    };
  }

  private author(settings: GitSyncSettings) {
    return {
      name:  settings.session?.username ?? "Git Sync",
      email: settings.session?.email    ?? "git-sync@vault.local",
    };
  }

  private validateForNetwork(settings: GitSyncSettings): Error | null {
    if (!settings.remoteUrl)
      return new Error("Remote URL is not configured. Set it in Git Sync → Settings.");
    if (!settings.session?.accessToken)
      return new Error("Not authenticated. Connect to GitHub/GitLab in Git Sync → Settings.");
    try { new URL(settings.remoteUrl); }
    catch { return new Error(`Remote URL is invalid: "${settings.remoteUrl}"`); }
    return null;
  }

  async isRepo(): Promise<boolean> {
    try {
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" });
      return true;
    } catch { return false; }
  }

  async init(settings: GitSyncSettings): Promise<GitResult> {
    try {
      await git.init({ fs: this.fs, dir: this.dir, defaultBranch: settings.branchName || "main" });
      return { ok: true, message: "Repository initialised." };
    } catch (e) { return { ok: false, error: toError(e) }; }
  }

  async addRemote(settings: GitSyncSettings): Promise<GitResult> {
    try {
      try { await git.deleteRemote({ fs: this.fs, dir: this.dir, remote: settings.remoteName }); }
      catch { /* not yet set */ }
      await git.addRemote({ fs: this.fs, dir: this.dir, remote: settings.remoteName, url: settings.remoteUrl });
      return { ok: true, message: `Remote '${settings.remoteName}' → ${settings.remoteUrl}` };
    } catch (e) { return { ok: false, error: toError(e) }; }
  }

  async clone(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    try {
      await git.clone({
        fs: this.fs, http, dir: this.dir,
        url: settings.remoteUrl,
        ref: settings.branchName,
        singleBranch: true,
        depth: 1,
        ...this.buildAuth(settings),
      });
      return { ok: true, message: `Cloned ${settings.remoteUrl} (${settings.branchName})` };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }

  async pull(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    const isRepo = await this.isRepo();
    if (!isRepo)
      return { ok: false, error: new Error("Vault is not a Git repo yet. Run 'Clone' or 'Initialise repository' first.") };
    try {
      await git.pull({
        fs: this.fs, http, dir: this.dir,
        url: settings.remoteUrl,
        ref: settings.branchName,
        remote: settings.remoteName,
        fastForwardOnly: true,
        author: this.author(settings),
        ...this.buildAuth(settings),
      });
      return { ok: true, message: "Pull complete (fast-forward)." };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }

  async commit(settings: GitSyncSettings, message?: string): Promise<GitResult> {
    try {
      await git.add({ fs: this.fs, dir: this.dir, filepath: "." });
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const changed = status.filter(([, head, workdir, stage]) => head !== 1 || workdir !== 1 || stage !== 1);
      if (changed.length === 0) return { ok: true, message: "SKIPPED — nothing to commit." };
      const sha = await git.commit({
        fs: this.fs, dir: this.dir,
        author: this.author(settings),
        message: message || `vault sync ${new Date().toISOString()}`,
      });
      return { ok: true, message: `Committed ${changed.length} file(s).`, sha };
    } catch (e) { return { ok: false, error: toError(e) }; }
  }

  async push(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    try {
      await git.push({
        fs: this.fs, http, dir: this.dir,
        remote: settings.remoteName,
        ref: settings.branchName,
        ...this.buildAuth(settings),
      });
      return { ok: true, message: "Push complete." };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }
}