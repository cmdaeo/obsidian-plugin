import { Vault } from "obsidian";
import * as git from "isomorphic-git";
import http from "./obsidian-http";
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

export interface ConflictFile {
  filepath: string;
  localContent: string | null;   // null = file deleted locally
  remoteContent: string | null;  // null = file deleted on remote
}

export interface SyncStatus {
  ahead: number;
  behind: number;
  conflicts: ConflictFile[];
  localBranch: string | null;
  remoteBranch: string;
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
      await this.fs.promises.stat(".git/HEAD");
      return true;
    } catch { return false; }
  }

  async init(settings: GitSyncSettings): Promise<GitResult> {
    try {
      await git.init({ fs: this.fs, dir: this.dir, defaultBranch: settings.branchName || "main" });
      await this.ensureDefaultGitignore();
      return { ok: true, message: "Repository initialised." };
    } catch (e) { return { ok: false, error: toError(e) }; }
  }

  private async ensureDefaultGitignore() {
    try {
      await this.fs.promises.stat("/.gitignore");
    } catch {
      await this.fs.promises.writeFile("/.gitignore", `# Default ignored files\n${this.vault.configDir}/\n_System/\n`, "utf8");
    }
  }

  async syncIgnoreFile(ignorePath: string): Promise<void> {
    const targetPath = ignorePath || "_System/ignore.md";
    let content = "";
    
    // 1. Try to read from the visible ignore file
    try {
      content = (await this.fs.promises.readFile("/" + targetPath, "utf8")).toString();
    } catch {
      // 2. If it doesn't exist, try to read from existing .gitignore
      try {
        content = (await this.fs.promises.readFile("/.gitignore", "utf8")).toString();
      } catch {
        // 3. Neither exists, use defaults
        content = `# Default ignored files\n${this.vault.configDir}/\n_System/\n`;
      }
      
      // Attempt to write the visible file so the user can see it
      try {
        // Ensure parent directory exists (basic implementation)
        const parts = targetPath.split("/");
        if (parts.length > 1) {
          const dir = "/" + parts.slice(0, -1).join("/");
          try { await this.fs.promises.stat(dir); } 
          catch { await this.fs.promises.mkdir(dir); }
        }
        await this.fs.promises.writeFile("/" + targetPath, content, "utf8");
      } catch {
        // Ignore failures to create the visible file (e.g. invalid path)
      }
    }
    
    // 4. Always mirror the content to .gitignore
    try {
      await this.fs.promises.writeFile("/.gitignore", content, "utf8");
    } catch { /* Ignore */ }
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
        ...this.buildAuth(settings),
      });
      await this.ensureDefaultGitignore();
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
        singleBranch: true,
        fastForwardOnly: true,
        author: this.author(settings),
        ...this.buildAuth(settings),
      });
      return { ok: true, message: "Pull complete (fast-forward)." };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }

  private async ensureBranch(branch: string) {
    if (!branch) return;
    try {
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" });
      const current = await git.currentBranch({ fs: this.fs, dir: this.dir });
      if (current && current !== branch) {
        const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
        if (!branches.includes(branch)) await git.branch({ fs: this.fs, dir: this.dir, ref: branch });
        await git.checkout({ fs: this.fs, dir: this.dir, ref: branch });
      }
    } catch {
      await git.init({ fs: this.fs, dir: this.dir, defaultBranch: branch });
    }
  }

  async commit(settings: GitSyncSettings, message?: string): Promise<GitResult> {
    try {
      await this.ensureBranch(settings.branchName);
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const changedOrIgnoredFiles: { filepath: string, action: "add" | "remove" }[] = [];

      for (const [filepath, head, workdir, stage] of status) {
        const isChanged = head !== 1 || workdir !== 1 || stage !== 1;
        const ignored = await git.isIgnored({ fs: this.fs, dir: this.dir, filepath });
        
        if (ignored && head === 1) {
          // It's tracked, but now it's ignored -> Untrack it
          changedOrIgnoredFiles.push({ filepath, action: "remove" });
        } else if (!ignored && isChanged) {
          // It's changed and not ignored -> Add or remove depending on workdir
          changedOrIgnoredFiles.push({ filepath, action: workdir === 0 ? "remove" : "add" });
        }
      }

      if (changedOrIgnoredFiles.length === 0) return { ok: true, message: "SKIPPED — nothing to commit." };

      await Promise.all(
        changedOrIgnoredFiles.map(async (f) => {
          if (f.action === "remove") {
            await git.remove({ fs: this.fs, dir: this.dir, filepath: f.filepath });
          } else {
            await git.add({ fs: this.fs, dir: this.dir, filepath: f.filepath });
          }
        })
      );

      const sha = await git.commit({
        fs: this.fs, dir: this.dir,
        author: this.author(settings),
        message: message || `vault sync ${new Date().toISOString()}`,
      });
      return { ok: true, message: `Committed ${changedOrIgnoredFiles.length} file(s).`, sha };
    } catch (e) { return { ok: false, error: toError(e) }; }
  }

  async push(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    try {
      const current = await git.currentBranch({ fs: this.fs, dir: this.dir });
      await git.push({
        fs: this.fs, http, dir: this.dir,
        remote: settings.remoteName,
        ref: current || settings.branchName || "main",
        ...this.buildAuth(settings),
      });
      return { ok: true, message: "Push complete." };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }

  async fetch(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    try {
      await git.fetch({
        fs: this.fs, http, dir: this.dir,
        url: settings.remoteUrl,
        remote: settings.remoteName,
        ref: settings.branchName,
        singleBranch: true,
        ...this.buildAuth(settings),
      });
      return { ok: true, message: "Fetch complete." };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }

  async getSyncStatus(settings: GitSyncSettings): Promise<SyncStatus> {
    const branch = settings.branchName || "main";
    const remote = settings.remoteName || "origin";

    // Fetch first to get latest remote state
    await this.fetch(settings);

    let localOid: string | null = null;
    let remoteOid: string | null = null;
    let localBranch: string | null = null;

    try {
      localBranch = await git.currentBranch({ fs: this.fs, dir: this.dir }) ?? null;
      localOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" });
    } catch { /* no local commits */ }

    try {
      remoteOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/remotes/${remote}/${branch}` });
    } catch { /* no remote tracking */ }

    // If either side is missing, we can't compute ahead/behind
    if (!localOid || !remoteOid) {
      return { ahead: localOid ? 1 : 0, behind: remoteOid ? 1 : 0, conflicts: [], localBranch, remoteBranch: branch };
    }

    // Same commit — fully synced
    if (localOid === remoteOid) {
      return { ahead: 0, behind: 0, conflicts: [], localBranch, remoteBranch: branch };
    }

    // Count ahead/behind by walking logs
    let ahead = 0;
    let behind = 0;

    try {
      const localLog = await git.log({ fs: this.fs, dir: this.dir, ref: "HEAD" });
      const remoteLog = await git.log({ fs: this.fs, dir: this.dir, ref: `refs/remotes/${remote}/${branch}` });
      const remoteOids = new Set(remoteLog.map(c => c.oid));
      const localOids = new Set(localLog.map(c => c.oid));

      for (const c of localLog) {
        if (remoteOids.has(c.oid)) break;
        ahead++;
      }
      for (const c of remoteLog) {
        if (localOids.has(c.oid)) break;
        behind++;
      }
    } catch { /* could not compute */ }

    // Detect file-level conflicts via tree walk
    const conflicts: ConflictFile[] = [];
    try {
      await git.walk({
        fs: this.fs, dir: this.dir,
        trees: [git.TREE({ ref: localOid }), git.TREE({ ref: remoteOid })],
        map: async (filepath, entries) => {
          if (!entries || filepath === ".") return;
          const [local, remote] = entries;
          const localType = local ? await local.type() : null;
          const remoteType = remote ? await remote.type() : null;
          // Only compare blobs (files), not trees
          if (localType === "tree" || remoteType === "tree") return;

          const localHash = local ? await local.oid() : null;
          const remoteHash = remote ? await remote.oid() : null;

          if (localHash !== remoteHash) {
            // Read contents for diff
            let localContent: string | null = null;
            let remoteContent: string | null = null;

            try {
              if (local) {
                const blob = await local.content();
                if (blob) localContent = new TextDecoder().decode(blob);
              }
            } catch { /* binary or unreadable */ }

            try {
              if (remote) {
                const blob = await remote.content();
                if (blob) remoteContent = new TextDecoder().decode(blob);
              }
            } catch { /* binary or unreadable */ }

            conflicts.push({ filepath, localContent, remoteContent });
          }
        },
      });
    } catch { /* walk failed */ }

    return { ahead, behind, conflicts, localBranch, remoteBranch: branch };
  }

  async resolveConflict(settings: GitSyncSettings, filepath: string, content: string): Promise<void> {
    // Write the chosen content and stage it
    await this.fs.promises.writeFile(`/${filepath}`, content);
    await git.add({ fs: this.fs, dir: this.dir, filepath });
  }

  async resolveConflictDelete(settings: GitSyncSettings, filepath: string): Promise<void> {
    // Remove the file and stage the deletion
    try { await this.fs.promises.unlink(`/${filepath}`); } catch { /* already gone */ }
    await git.remove({ fs: this.fs, dir: this.dir, filepath });
  }

  async finalizeMerge(settings: GitSyncSettings): Promise<GitResult> {
    try {
      const branch = settings.branchName || "main";
      const remote = settings.remoteName || "origin";
      const remoteOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/remotes/${remote}/${branch}` });

      const sha = await git.commit({
        fs: this.fs, dir: this.dir,
        author: this.author(settings),
        message: `Merge remote ${branch} — conflicts resolved`,
        parent: [await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" }), remoteOid],
      });
      return { ok: true, message: "Merge complete.", sha };
    } catch (e) { return { ok: false, error: toError(e) }; }
  }

  async forcePush(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    try {
      const current = await git.currentBranch({ fs: this.fs, dir: this.dir });
      await git.push({
        fs: this.fs, http, dir: this.dir,
        remote: settings.remoteName,
        ref: current || settings.branchName || "main",
        force: true,
        ...this.buildAuth(settings),
      });
      return { ok: true, message: "Force push complete." };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }

  async forcePull(settings: GitSyncSettings): Promise<GitResult> {
    const invalid = this.validateForNetwork(settings);
    if (invalid) return { ok: false, error: invalid };
    try {
      const branch = settings.branchName || "main";
      const remote = settings.remoteName || "origin";

      // Fetch latest
      await git.fetch({
        fs: this.fs, http, dir: this.dir,
        url: settings.remoteUrl,
        remote,
        ref: branch,
        singleBranch: true,
        ...this.buildAuth(settings),
      });

      // Hard reset: point HEAD to the remote commit
      const remoteOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/remotes/${remote}/${branch}` });

      // Write the branch ref directly to match remote
      await this.fs.promises.writeFile(`.git/refs/heads/${branch}`, remoteOid + "\n");

      // Checkout to overwrite working tree
      await git.checkout({
        fs: this.fs, dir: this.dir,
        ref: branch,
        force: true,
      });

      return { ok: true, message: "Force pull complete — local files overwritten with remote." };
    } catch (e) { return { ok: false, error: categorizeError(toError(e), settings.remoteUrl) }; }
  }
}