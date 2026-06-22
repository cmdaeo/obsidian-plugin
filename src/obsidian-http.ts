import { requestUrl } from "obsidian";
import type { HttpClient, GitHttpRequest, GitHttpResponse } from "isomorphic-git";

export const obsidianHttp: HttpClient = {
  async request({
    url,
    method,
    headers,
    body,
  }: GitHttpRequest): Promise<GitHttpResponse> {
    let bodyBytes: Uint8Array | undefined;
    if (body) {
      const chunks: Uint8Array[] = [];
      if (Symbol.asyncIterator in body) {
        for await (const chunk of body) {
          chunks.push(chunk);
        }
      } else {
        for (const chunk of body as Iterable<Uint8Array>) {
          chunks.push(chunk);
        }
      }
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      bodyBytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength; }
    }

    const res = await requestUrl({
      url,
      method,
      headers,
      // Explicit cast: SharedArrayBuffer is not assignable to string | ArrayBuffer | undefined
      body: bodyBytes ? (bodyBytes.buffer as ArrayBuffer) : undefined,
      throw: false,
    });

    return {
      url,
      method,
      statusCode:    res.status,
      statusMessage: String(res.status),
      headers:       res.headers,
      body: (async function*() { yield new Uint8Array(res.arrayBuffer); })(),
    };
  },
};

export default obsidianHttp;