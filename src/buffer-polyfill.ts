// Buffer polyfill for Android / JavaScriptCore
// Must be the very first import in main.ts for Android builds.
// Uses the npm 'buffer' package which provides a full Buffer implementation
// that works in any JS environment without Node.js.
import { Buffer as _Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  // @ts-ignore
  globalThis.Buffer = _Buffer;
}
