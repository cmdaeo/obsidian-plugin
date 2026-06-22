// ─────────────────────────────────────────────────────────────────────────────
// fs-adapter.ts — Maps isomorphic-git's fs interface → Obsidian's Vault API
//
// isomorphic-git expects a Node.js-style fs object. Critically, stat() and
// lstat() results must have isFile(), isDirectory(), isSymbolicLink() methods
// — plain metadata objects crash with "r.isDirectory is not a function".
// ─────────────────────────────────────────────────────────────────────────────

import { Vault, normalizePath as obsNormalize } from "obsidian";

// ── Stat object ───────────────────────────────────────────────────────────────

function makeStats(kind: "file" | "dir", size = 0, mtimeMs = Date.now()) {
  const mode = kind === "dir" ? 0o040755 : 0o100644;
  return {
    type: kind,
    mode,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    atimeMs: mtimeMs,
    birthtimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 0,
    // Methods isomorphic-git requires — returning plain object without these
    // causes "r.isDirectory is not a function" at runtime.
    isFile()         { return kind === "file"; },
    isDirectory()    { return kind === "dir";  },
    isSymbolicLink() { return false;           },
    isBlockDevice()  { return false;           },
    isCharacterDevice() { return false;        },
    isFIFO()         { return false;           },
    isSocket()       { return false;           },
  };
}

// ── Path normalization ────────────────────────────────────────────────────────

function toVaultPath(p: string): string {
  // isomorphic-git passes paths rooted at the git dir with a leading "/".
  // Obsidian paths are relative — strip the leading slash.
  const rel = p.startsWith("/") ? p.slice(1) : p;
  return obsNormalize(rel) || ".";
}

// ── Core stat implementation ──────────────────────────────────────────────────

async function statImpl(vault: Vault, p: string) {
  const vp = toVaultPath(p);

  const exists = await vault.adapter.exists(vp);
  if (!exists) {
    const err = new Error(`ENOENT: no such file or directory, stat '${p}'`) as Error & { code?: string };
    err.code = "ENOENT";
    throw err;
  }

  // Try to stat via Obsidian adapter — it returns { type, size, mtime, ctime }
  try {
    const s = await vault.adapter.stat(vp);
    if (s) {
      return makeStats(
        s.type === "folder" ? "dir" : "file",
        s.size ?? 0,
        s.mtime ?? Date.now()
      );
    }
  } catch {
    // adapter.stat threw — fall through to directory probe
  }

  // Fallback: probe whether it's a directory by attempting to list it
  try {
    await vault.adapter.list(vp);
    return makeStats("dir", 0, Date.now());
  } catch {
    // Not a directory — treat as file with unknown size
    return makeStats("file", 0, Date.now());
  }
}

// ── Adapter builder ───────────────────────────────────────────────────────────

export function buildFsAdapter(vault: Vault) {
  const adapter = vault.adapter;

  const promises = {
    // ── Read ────────────────────────────────────────────────────────────────
    async readFile(p: string, opts?: { encoding?: string } | string): Promise<Buffer | string> {
      const vp = toVaultPath(p);
      const enc = typeof opts === "string" ? opts : opts?.encoding;
      if (enc === "utf8" || enc === "utf-8") {
        return adapter.read(vp);
      }
      const ab = await adapter.readBinary(vp);
      return Buffer.from(ab);
    },

    // ── Write ───────────────────────────────────────────────────────────────
    async writeFile(
      p: string,
      data: string | Buffer | Uint8Array,
      _opts?: unknown
    ): Promise<void> {
      const vp = toVaultPath(p);

      // Ensure parent directory exists before writing
      const dir = vp.includes("/") ? vp.split("/").slice(0, -1).join("/") : "";
      if (dir && !(await adapter.exists(dir))) {
        await adapter.mkdir(dir);
      }

      if (typeof data === "string") {
        await adapter.write(vp, data);
      } else {
        const buf = data instanceof Buffer ? data : Buffer.from(data);
        await adapter.writeBinary(vp, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      }
    },

    // ── Delete ──────────────────────────────────────────────────────────────
    async unlink(p: string): Promise<void> {
      await adapter.remove(toVaultPath(p));
    },

    // ── Rename ──────────────────────────────────────────────────────────────
    async rename(src: string, dst: string): Promise<void> {
      const vsrc = toVaultPath(src);
      const vdst = toVaultPath(dst);
      const data = await adapter.readBinary(vsrc);
      const dstDir = vdst.includes("/") ? vdst.split("/").slice(0, -1).join("/") : "";
      if (dstDir && !(await adapter.exists(dstDir))) await adapter.mkdir(dstDir);
      await adapter.writeBinary(vdst, data);
      await adapter.remove(vsrc);
    },

    // ── Stat / lstat ─────────────────────────────────────────────────────────
    async stat(p: string)  { return statImpl(vault, p); },
    async lstat(p: string) { return statImpl(vault, p); }, // no symlinks

    // ── Directory ────────────────────────────────────────────────────────────
    async mkdir(p: string, _opts?: unknown): Promise<void> {
      const vp = toVaultPath(p);
      if (!(await adapter.exists(vp))) await adapter.mkdir(vp);
    },

    async rmdir(p: string): Promise<void> {
      // adapter.rmdir may not exist on all platforms — try both
      const vp = toVaultPath(p);
      if ("rmdir" in adapter && typeof adapter.rmdir === "function") {
        await adapter.rmdir(vp, false);
      } else {
        await adapter.remove(vp);
      }
    },

    async readdir(p: string): Promise<string[]> {
      const vp = toVaultPath(p);
      const listed = await adapter.list(vp);
      const all = [...listed.files, ...listed.folders];
      // Return basenames only, no trailing slashes
      return all.map((f) => f.replace(/\/$/, "").split("/").pop() ?? f);
    },

    // ── Unsupported ──────────────────────────────────────────────────────────
    async symlink(): Promise<void>  { throw new Error("symlinks not supported"); },
    async readlink(): Promise<string> { throw new Error("symlinks not supported"); },
  };

  return { promises };
}
