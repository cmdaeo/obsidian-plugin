import { App, Modal, Notice, Setting, requestUrl } from 'obsidian';
import type { OAuthSession } from './types';
import { REDIRECT_URI } from './constants';

function randomString(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

async function sha256Base64url(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type SupportedOAuthProvider = 'github' | 'gitlab';

interface ProviderConfig {
  authUrl: string; tokenUrl: string; userApiUrl: string;
  scope: string; supportsPkce: boolean;
  parseUser(b: Record<string, unknown>): { username: string; email: string };
}

const PROVIDERS: Record<SupportedOAuthProvider, ProviderConfig> = {
  github: {
    authUrl:    'https://github.com/login/oauth/authorize',
    tokenUrl:   'https://github.com/login/oauth/access_token',
    userApiUrl: 'https://api.github.com/user',
    scope: 'repo', supportsPkce: false,
    parseUser: b => ({ username: String(b.login ?? ''), email: String(b.email ?? `${b.login}@users.noreply.github.com`) }),
  },
  gitlab: {
    authUrl:    'https://gitlab.com/oauth/authorize',
    tokenUrl:   'https://gitlab.com/oauth/token',
    userApiUrl: 'https://gitlab.com/api/v4/user',
    scope: 'read_user read_repository write_repository', supportsPkce: true,
    parseUser: b => ({ username: String(b.username ?? ''), email: String(b.email ?? '') }),
  },
};

interface PendingAuth {
  state: string; codeVerifier: string | null;
  resolve(result: { code: string; state: string } | null): void;
}
let pending: PendingAuth | null = null;

export function handleOAuthCallback(params: Record<string, string>): void {
  if (!pending) return;
  const { code, state, error, error_description } = params;
  if (error) { new Notice(`Git Sync: Authorization failed — ${error_description ?? error}`); pending.resolve(null); pending = null; return; }
  if (state !== pending.state) { new Notice('Git Sync: OAuth state mismatch — possible CSRF. Auth aborted.'); pending.resolve(null); pending = null; return; }
  pending.resolve({ code, state });
  pending = null;
}

async function exchangeCode(provider: SupportedOAuthProvider, clientId: string, clientSecret: string, code: string, codeVerifier: string | null): Promise<string> {
  const cfg = PROVIDERS[provider];
  const body: Record<string, string> = { client_id: clientId, client_secret: clientSecret, code, redirect_uri: REDIRECT_URI };
  if (cfg.supportsPkce && codeVerifier) { body.grant_type = 'authorization_code'; body.code_verifier = codeVerifier; }
  const res = await requestUrl({ url: cfg.tokenUrl, method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), throw: true });
  const json = res.json as Record<string, string>;
  if (json.error) throw new Error(json.error_description ?? json.error);
  if (!json.access_token) throw new Error('No access_token in response.');
  return json.access_token;
}

async function fetchUser(provider: SupportedOAuthProvider, token: string): Promise<{ username: string; email: string }> {
  const cfg = PROVIDERS[provider];
  const res = await requestUrl({ url: cfg.userApiUrl, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'yet-another-all-in-one/1.0' }, throw: true });
  return cfg.parseUser(res.json as Record<string, unknown>);
}

class WaitingModal extends Modal {
  private statusEl!: HTMLElement;
  constructor(app: App, private providerLabel: string, private onCancel: () => void) {
    super(app);
    this.modalEl.addClass('git-sync-waiting-modal');
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('git-sync-waiting-content');
    contentEl.createEl('p', { text: `Authorize with ${this.providerLabel}`, cls: 'git-sync-waiting-title' });
    contentEl.createEl('p', { text: 'A browser tab has opened. Approve the authorization there — this dialog closes automatically.', cls: 'setting-item-description' });
    this.statusEl = contentEl.createDiv({ cls: 'git-sync-waiting-status' });
    this.statusEl.createSpan({ cls: 'git-sync-spinner' });
    this.statusEl.createSpan({ text: 'Waiting for browser…' });
    contentEl.createEl('button', { text: 'Cancel', cls: 'git-sync-cancel-btn' })
      .addEventListener('click', () => { this.onCancel(); this.close(); });
  }
  setStatus(text: string) { if (this.statusEl) { this.statusEl.empty(); this.statusEl.createSpan({ text }); } }
  onClose() { this.contentEl.empty(); }
}

export async function runWebFlow(app: App, provider: SupportedOAuthProvider, clientId: string, clientSecret: string): Promise<OAuthSession | null> {
  const cfg = PROVIDERS[provider];
  const state = randomString(24);
  let codeVerifier: string | null = null, codeChallenge: string | null = null;
  if (cfg.supportsPkce) { codeVerifier = randomString(64); codeChallenge = await sha256Base64url(codeVerifier); }
  const params: Record<string, string> = { client_id: clientId, redirect_uri: REDIRECT_URI, scope: cfg.scope, state, response_type: 'code' };
  if (cfg.supportsPkce && codeChallenge) { params.code_challenge = codeChallenge; params.code_challenge_method = 'S256'; }
  const authUrl = `${cfg.authUrl}?${new URLSearchParams(params).toString()}`;
  const callbackPromise = new Promise<{ code: string; state: string } | null>(resolve => { pending = { state, codeVerifier, resolve }; });
  let cancelled = false;
  const modal = new WaitingModal(app, provider === 'github' ? 'GitHub' : 'GitLab', () => { cancelled = true; if (pending) { pending.resolve(null); pending = null; } });
  modal.open();
  window.open(authUrl, '_blank');
  const timer = window.setTimeout(() => { if (pending) { pending.resolve(null); pending = null; } modal.setStatus('Timed out. Please try again.'); window.setTimeout(() => modal.close(), 2000); }, 10 * 60 * 1000);
  const result = await callbackPromise;
  window.clearTimeout(timer);
  if (cancelled || !result) { modal.close(); return null; }
  try {
    modal.setStatus('Exchanging token…');
    const token = await exchangeCode(provider, clientId, clientSecret, result.code, codeVerifier);
    modal.setStatus('Fetching profile…');
    const { username, email } = await fetchUser(provider, token);
    modal.setStatus(`Signed in as ${username}`);
    window.setTimeout(() => modal.close(), 1000);
    return { provider, username, email, accessToken: token, connectedAt: new Date().toISOString(), scopes: cfg.scope.split(' ') } as OAuthSession;
  } catch (e) {
    const msg = (e as Error).message;
    modal.setStatus(msg);
    new Notice(`Git Sync: auth error — ${msg}`);
    window.setTimeout(() => modal.close(), 2500);
    return null;
  }
}

export class GiteaPATModal extends Modal {
  private token = ''; private baseUrl = '';
  constructor(app: App, private onComplete: (r: { baseUrl: string; token: string } | null) => void) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('git-sync-gitea-modal');
    new Setting(contentEl).setName('Connect Gitea self-hosted Git').setHeading();
    contentEl.createEl('p', { text: 'Create a token at your-instance/user/settings/applications with repository read/write scope.', cls: 'setting-item-description' });
    new Setting(contentEl).setName('Instance URL').addText(t => t.setPlaceholder('https://git.yourdomain.com').onChange(v => { this.baseUrl = v.trim(); }));
    new Setting(contentEl).setName('Access Token').addText(t => { t.inputEl.type = 'password'; t.setPlaceholder('Paste token here').onChange(v => { this.token = v.trim(); }); });
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('Cancel').onClick(() => { this.onComplete(null); this.close(); }))
      .addButton(btn => btn.setButtonText('Connect').setCta().onClick(() => {
        if (!this.baseUrl || !this.token) { new Notice('Please fill in both fields.'); return; }
        this.onComplete({ baseUrl: this.baseUrl, token: this.token }); this.close();
      }));
  }
  onClose() { this.contentEl.empty(); }
}