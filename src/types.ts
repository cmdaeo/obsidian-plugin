// types.ts — Shared types for Vault Git Sync plugin

export interface OAuthSession {
  provider:    "github" | "gitlab" | "gitea" | "none";
  accessToken: string;
  username:    string;
  email:       string;
  avatarUrl?:  string;
  expiresAt?:  number; // unix ms — optional, for token expiry warnings
}

export interface GitSyncSettings {
  remoteUrl:            string;
  remoteName:           string;
  branchName:           string;
  // OAuth App credentials (user-provided — never hardcoded)
  githubClientId:       string;
  githubClientSecret:   string;
  gitlabClientId:       string;
  gitlabClientSecret:   string;
  autoSyncEnabled:      boolean;
  autoSyncDebounceMs:   number;
  pullOnStartup:        boolean;
  auditLogEnabled:      boolean;
  auditLogPath:         string;
  session:              OAuthSession | null;
}

export const DEFAULT_SETTINGS: GitSyncSettings = {
  remoteUrl:           "",
  remoteName:          "origin",
  branchName:          "main",
  githubClientId:      "",
  githubClientSecret:  "",
  gitlabClientId:      "",
  gitlabClientSecret:  "",
  autoSyncEnabled:     false,
  autoSyncDebounceMs:  30_000,
  pullOnStartup:       true,
  auditLogEnabled:     true,
  auditLogPath:        "_System/Sync_Log.md",
  session:             null,
};

// ── Audit log types ────────────────────────────────────────────────────────────

export type SyncEventType =
  | "STARTUP_PULL"
  | "PULL"
  | "COMMIT"
  | "PUSH"
  | "CLONE"
  | "INIT"
  | "AUTO_SYNC"
  | "AUTH"
  | "SKIPPED"
  | "ERROR";

export type SyncStatus = "SUCCESS" | "FAILURE" | "SKIPPED";

export interface SyncEvent {
  timestamp:  string;
  type:       SyncEventType;
  status:     SyncStatus;
  message:    string;
  context?: {
    remoteUrl?:  string;
    branch?:     string;
    provider?:   string;
    username?:   string;
    isRepo?:     boolean;
    httpStatus?: number;
    httpUrl?:    string;
    sha?:        string;
    errorName?:  string;
    errorStack?: string;
    errorData?:  string;
  };
}

export type GitResult =
  | { ok: true;  message: string; sha?: string }
  | { ok: false; error: Error };