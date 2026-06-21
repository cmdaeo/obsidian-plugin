import git from "isomorphic-git";
import { Vault } from "obsidian";
import { buildFsAdapter } from "./fs-adapter";
import { obsidianHttp as http } from "./obsidian-http";
import { GitSyncSettings } from "./types";

export type GitResult =
  | { ok: true;  message: string; sha?: string }
  | { ok: false; error: Error };

function toError(e: unknown): Error {
  if (e instanceof Error) {
    // isomorphic-git wraps causes in .cause or .data
    const nested = (e as any).cause;
    if (nested instanceof Error) return nested;
    const extra = (e as any).data ? ` · data=${JSON.stringify((e as any).data)}` : "";
    return new Error(e.message + extra);
  }
  return new Error(String(e));
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
      onAuthFailure: ({ url }: { url: string }) => {
        throw new Error(`Auth rejected by ${url} — token expired? Reconnect in settings.`);
      },
    };
  }

  private author(settings: GitSyncSettings) {
    return {
      name:  settings.session?.username ?? "Obsidian Git Sync",
      email: settings.session?.email    ?? "git-sync@obsidian.local",
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
      return { ok: false, error: new Error("Vault is not a Git repo yet. Run 'Git Sync: Clone remote into vault' or 'Git Sync: Initialise repository' first.") };

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
      const matrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const dirty = matrix.some(([, h, w, s]) => h !== 1 || w !== 1 || s !== 1);
      if (!dirty) return { ok: true, message: "SKIPPED: Nothing to commit." };

      const msg = message ?? `vault sync @ ${new Date().toISOString()}`;
      const sha = await git.commit({
        fs: this.fs, dir: this.dir,
        message: msg,
        author: this.author(settings),
      });
      return { ok: true, message: `Committed: ${sha.slice(0, 7)} — ${msg}`, sha };
    } catch (e) { return { ok: false, error: toError(e) }; }
  }

  async push(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    try {
      const result = await git.push({
        fs: this.fs, http, dir: this.dir,
        remote: settings.remoteName,
        remoteRef: settings.branchName,
        force: false,
        ...this.buildAuth(settings),
      });
      if (result.error) return { ok: false, error: new Error(result.error) };
      return { ok: true, message: `Pushed → ${settings.remoteName}/${settings.branchName}` };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }
}
