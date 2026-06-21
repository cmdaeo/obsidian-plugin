// ─────────────────────────────────────────────────────────────────────────────
// oauth.ts — OAuth 2.0 Authorization Code Flow
//
// Each user registers their own GitHub/GitLab OAuth App and enters their own
// Client ID + Secret in the plugin settings. Nothing is hardcoded or shared.
//
// GitHub OAuth Apps: no PKCE, state-only CSRF protection.
// GitLab:            PKCE supported (S256).
// ─────────────────────────────────────────────────────────────────────────────

import { App, Modal, Notice, requestUrl } from "obsidian";
import { OAuthSession, AuthProvider } from "./types";
import { REDIRECT_URI } from "./constants";

// ── PKCE ──────────────────────────────────────────────────────────────────────

function generateRandomString(length = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join("");
}

async function sha256Base64url(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Provider configs ──────────────────────────────────────────────────────────

export type SupportedOAuthProvider = "github" | "gitlab";

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  userApiUrl: string;
  scope: string;
  supportsPkce: boolean;
  parseUser: (b: Record<string, unknown>) => { username: string; email: string };
}

const PROVIDERS: Record<SupportedOAuthProvider, ProviderConfig> = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userApiUrl: "https://api.github.com/user",
    scope: "repo",
    supportsPkce: false,
    parseUser: (b) => ({
      username: String(b.login ?? ""),
      email: String(b.email ?? `${b.login}@users.noreply.github.com`),
    }),
  },
  gitlab: {
    authUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    userApiUrl: "https://gitlab.com/api/v4/user",
    scope: "read_user read_repository write_repository",
    supportsPkce: true,
    parseUser: (b) => ({
      username: String(b.username ?? ""),
      email: String(b.email ?? ""),
    }),
  },
};

export { REDIRECT_URI };

// ── Pending auth state ────────────────────────────────────────────────────────

interface PendingAuth {
  state: string;
  codeVerifier: string | null;
  resolve: (result: { code: string; state: string } | null) => void;
}

let _pending: PendingAuth | null = null;

export function handleOAuthCallback(params: Record<string, string>): void {
  if (!_pending) return;
  const { code, state, error, error_description } = params;

  if (error) {
    new Notice(`Git Sync: Authorization failed — ${error_description ?? error}`);
    _pending.resolve(null);
    _pending = null;
    return;
  }
  if (state !== _pending.state) {
    new Notice("Git Sync: OAuth state mismatch — possible CSRF. Auth aborted.");
    _pending.resolve(null);
    _pending = null;
    return;
  }
  _pending.resolve({ code, state });
  _pending = null;
}

// ── Token exchange ─────────────────────────────────────────────────────────────

async function exchangeCodeForToken(
  provider: SupportedOAuthProvider,
  clientId: string,
  clientSecret: string,
  code: string,
  codeVerifier: string | null
): Promise<string> {
  const cfg = PROVIDERS[provider];

  const bodyObj: Record<string, string> = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI,
  };

  if (cfg.supportsPkce && codeVerifier) {
    bodyObj.grant_type = "authorization_code";
    bodyObj.code_verifier = codeVerifier;
  }

  const res = await requestUrl({
    url: cfg.tokenUrl,
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
    throw: true,
  });

  const body = res.json as Record<string, string>;
  if (body.error) throw new Error(body.error_description ?? body.error);
  if (!body.access_token) throw new Error("No access_token in response.");
  return body.access_token;
}

// ── User profile ──────────────────────────────────────────────────────────────

async function fetchProviderUser(
  provider: SupportedOAuthProvider,
  token: string
): Promise<{ username: string; email: string }> {
  const cfg = PROVIDERS[provider];
  const res = await requestUrl({
    url: cfg.userApiUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "obsidian-git-sync/1.0",
    },
    throw: true,
  });
  return cfg.parseUser(res.json as Record<string, unknown>);
}

// ── Waiting modal ─────────────────────────────────────────────────────────────

class WaitingForBrowserModal extends Modal {
  private statusEl!: HTMLElement;

  constructor(app: App, private providerName: string, private onCancel: () => void) {
    super(app);
    this.modalEl.addClass("git-sync-waiting-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Authorize with ${this.providerName}` });
    contentEl.createEl("p", {
      text: "A browser tab has opened. Approve the authorization there — this dialog closes automatically.",
      cls: "setting-item-description",
    });
    this.statusEl = contentEl.createDiv({ cls: "git-sync-waiting-indicator" });
    this.statusEl.createSpan({ cls: "git-sync-spinner" });
    this.statusEl.createSpan({ text: " Waiting for browser…" });
    contentEl.createEl("button", { text: "Cancel", cls: "git-sync-cancel-btn" })
      .addEventListener("click", () => { this.onCancel(); this.close(); });
  }

  setStatus(text: string) { if (this.statusEl) this.statusEl.setText(text); }
  onClose() { this.contentEl.empty(); }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runWebFlow(
  app: App,
  provider: SupportedOAuthProvider,
  clientId: string,
  clientSecret: string
): Promise<OAuthSession | null> {
  const cfg = PROVIDERS[provider];
  const state = generateRandomString(24);

  let codeVerifier: string | null = null;
  let codeChallenge: string | null = null;
  if (cfg.supportsPkce) {
    codeVerifier = generateRandomString(64);
    codeChallenge = await sha256Base64url(codeVerifier);
  }

  const urlParams: Record<string, string> = {
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: cfg.scope,
    state,
    response_type: "code",
  };
  if (cfg.supportsPkce && codeChallenge) {
    urlParams.code_challenge = codeChallenge;
    urlParams.code_challenge_method = "S256";
  }

  const authUrl = `${cfg.authUrl}?${new URLSearchParams(urlParams).toString()}`;

  const callbackPromise = new Promise<{ code: string; state: string } | null>(
    (resolve) => { _pending = { state, codeVerifier, resolve }; }
  );

  window.open(authUrl, "_blank");

  const providerLabel = provider === "github" ? "GitHub" : "GitLab";

  return new Promise((resolve) => {
    let cancelled = false;

    const modal = new WaitingForBrowserModal(app, providerLabel, () => {
      cancelled = true;
      if (_pending) { _pending.resolve(null); _pending = null; }
      resolve(null);
    });
    modal.open();

    const timeout = setTimeout(() => {
      if (_pending) { _pending.resolve(null); _pending = null; }
      modal.setStatus("✗ Timed out. Please try again.");
      setTimeout(() => modal.close(), 2000);
      resolve(null);
    }, 10 * 60 * 1000);

    callbackPromise.then(async (result) => {
      clearTimeout(timeout);
      if (cancelled || !result) { modal.close(); return; }

      modal.setStatus("✓ Authorized! Exchanging token…");
      try {
        const token = await exchangeCodeForToken(
          provider, clientId, clientSecret, result.code, codeVerifier
        );
        modal.setStatus("Fetching profile…");
        const { username, email } = await fetchProviderUser(provider, token);
        const session: OAuthSession = {
          provider, username, email,
          accessToken: token,
          authorizedAt: new Date().toISOString(),
          scopes: cfg.scope.split(" "),
        };
        modal.setStatus(`✓ Signed in as @${username}`);
        setTimeout(() => modal.close(), 1000);
        resolve(session);
      } catch (e) {
        modal.setStatus(`✗ ${(e as Error).message}`);
        new Notice(`Git Sync auth error: ${(e as Error).message}`);
        setTimeout(() => modal.close(), 2500);
        resolve(null);
      }
    });
  });
}

// ── Gitea PAT modal ───────────────────────────────────────────────────────────

export class GiteaPATModal extends Modal {
  private token = "";
  private baseUrl = "";

  constructor(app: App, private onComplete: (r: { baseUrl: string; token: string } | null) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Connect Gitea / self-hosted Git" });
    contentEl.createEl("p", {
      text: "Create a token at your-instance/user/settings/applications with repository read/write scope.",
      cls: "setting-item-description",
    });

    const mkLabel = (text: string) => {
      const l = contentEl.createEl("label", { text });
      l.style.cssText = "display:block;margin-top:1rem;font-size:var(--font-small)";
      return l;
    };

    mkLabel("Instance URL");
    const urlInput = contentEl.createEl("input", { type: "text", placeholder: "https://git.yourdomain.com", cls: "git-sync-full-input" });
    urlInput.addEventListener("input", () => (this.baseUrl = urlInput.value.trim()));

    mkLabel("Access Token");
    const tokenInput = contentEl.createEl("input", { type: "password", placeholder: "Paste token here…", cls: "git-sync-full-input" });
    tokenInput.addEventListener("input", () => (this.token = tokenInput.value.trim()));

    const btnRow = contentEl.createDiv({ cls: "git-sync-btn-row" });
    btnRow.createEl("button", { text: "Cancel" })
      .addEventListener("click", () => { this.onComplete(null); this.close(); });
    btnRow.createEl("button", { text: "Connect", cls: "mod-cta" })
      .addEventListener("click", () => {
        if (!this.baseUrl || !this.token) { new Notice("Please fill in both fields."); return; }
        this.onComplete({ baseUrl: this.baseUrl, token: this.token });
        this.close();
      });
  }

  onClose() { this.contentEl.empty(); }
}
