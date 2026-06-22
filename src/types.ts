// types.ts

export interface OAuthSession {
  provider:    "github" | "gitlab" | "gitea";
  username:    string;
  email:       string;
  accessToken: string;
  connectedAt: string;   // ISO-8601
  scopes:      string | string[];
}

export interface GitSyncSettings {
  remoteUrl:            string;
  remoteName:           string;
  branchName:           string;
  githubClientId:       string;
  githubClientSecret:   string;
  gitlabClientId:       string;
  gitlabClientSecret:   string;
  session:              OAuthSession | null;
  pullOnStartup:        boolean;
  autoSyncEnabled:      boolean;
  autoSyncDebounceMs:   number;
  auditLogEnabled:      boolean;
  auditLogPath:         string;
}

export const DEFAULT_SETTINGS: GitSyncSettings = {
  remoteUrl:          "",
  remoteName:         "origin",
  branchName:         "main",
  githubClientId:     "",
  githubClientSecret: "",
  gitlabClientId:     "",
  gitlabClientSecret: "",
  session:            null,
  pullOnStartup:      true,
  autoSyncEnabled:    false,
  autoSyncDebounceMs: 5000,
  auditLogEnabled:    true,
  auditLogPath:       "_System/SyncLog.md",
};

export type GitResult =
  | { ok: true;  message: string; sha?: string }
  | { ok: false; error: Error };