// shims.js — injected by esbuild as the first code in the bundle.
// Ensures Buffer and process globals exist in both Electron (desktop)
// and JavaScriptCore (Android) environments.
import { Buffer as BufferPolyfill } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = BufferPolyfill;
}

if (typeof globalThis.process === "undefined") {
  globalThis.process = {
    env: { NODE_ENV: "production" },
    platform: "browser",
    version: "v0.0.0",
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
  };
}
