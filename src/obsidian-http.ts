// ─────────────────────────────────────────────────────────────────────────────
// obsidian-http.ts — Custom isomorphic-git HTTP client using Obsidian's
// requestUrl API.
//
// isomorphic-git/http/web uses raw fetch(), which is blocked by Obsidian's
// Content Security Policy on mobile. Obsidian's requestUrl() bypasses CSP and
// CORS restrictions, making it the correct transport for both desktop and
// Android.
// ─────────────────────────────────────────────────────────────────────────────

import { requestUrl } from "obsidian";

// Consume an async iterable of Uint8Array chunks into a single Uint8Array
async function collectBody(
  body?: AsyncIterableIterator<Uint8Array> | Iterable<Uint8Array>
): Promise<Uint8Array | undefined> {
  if (!body) return undefined;

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }
  if (chunks.length === 0) return undefined;

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Normalize header values to strings (isomorphic-git can pass string arrays)
function flattenHeaders(raw: Record<string, string | string[]> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

export const obsidianHttp = {
  async request({
    url,
    method = "GET",
    headers = {},
    body,
    onProgress,
  }: {
    url: string;
    method?: string;
    headers?: Record<string, string | string[]>;
    body?: AsyncIterableIterator<Uint8Array> | Iterable<Uint8Array>;
    onProgress?: (p: { loaded: number; total: number }) => void;
  }) {
    const flatHeaders = flattenHeaders(headers);
    const reqBody = await collectBody(body);

    let res;
    try {
      res = await requestUrl({
        url,
        method,
        headers: flatHeaders,
        body: reqBody ? reqBody.buffer : undefined,
        throw: false, // handle errors ourselves for better diagnostics
      });
    } catch (e: any) {
      // Wrap network errors with the URL for better audit log context
      throw new Error(`HTTP ${method} ${url} — network error: ${e?.message ?? String(e)}`);
    }

    if (res.status >= 400) {
      // Surface HTTP errors with status + URL so audit log shows real cause
      throw new Error(`HTTP ${method} ${url} — status ${res.status}`);
    }

    // isomorphic-git expects body as an async iterable of Uint8Array
    const responseBytes = res.arrayBuffer
      ? new Uint8Array(res.arrayBuffer)
      : new Uint8Array();

    async function* bodyIterator() { yield responseBytes; }

    return {
      url,
      method,
      statusCode: res.status,
      statusMessage: String(res.status),
      headers: flattenHeaders(res.headers as Record<string, string>),
      body: bodyIterator(),
    };
  },
};
