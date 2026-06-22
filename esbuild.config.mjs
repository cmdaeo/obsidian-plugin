import esbuild from "esbuild";
import process from "process";
import { mkdirSync, copyFileSync, existsSync } from "fs";

const prod = process.argv.includes("production");

const banner = `/*
THIS IS A GENERATED/COMPILED FILE.
Source: https://github.com/cmdaeo/obsidian-plugin
*/`;

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function copyReleaseFiles() {
  ensureDir("release");
  copyFileSync("manifest.json", "release/manifest.json");
  try { copyFileSync("styles/main.css", "release/styles.css"); } catch (_) {}

  const testDir = "C:/Users/Miguel/Documents/Obsidian Vault/.obsidian/plugins/yet-another-all-in-one";
  try {
    ensureDir(testDir);
    if (existsSync("release/main.js")) copyFileSync("release/main.js", `${testDir}/main.js`);
    copyFileSync("release/manifest.json", `${testDir}/manifest.json`);
    if (existsSync("release/styles.css")) copyFileSync("release/styles.css", `${testDir}/styles.css`);
    console.log("Success copying the files.");
  } catch (e) {
    console.error("Could not copy to local test vault:", e.message);
  }
}

const config = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",   // resolves isomorphic-git browser entry points
  target: "es2018",
  banner: { js: banner },
  outfile: "release/main.js",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  logLevel: "info",
  // obsidian + codemirror are provided by the host app at runtime
  external: [
    "obsidian",
    "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands",
    "@codemirror/language", "@codemirror/lint", "@codemirror/search",
    "@codemirror/state", "@codemirror/view",
    "@lezer/common", "@lezer/highlight", "@lezer/lr",
  ],
  // shims.js polyfills Buffer + process before any module code runs
  inject: ["./shims.js"],
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
};

if (prod) {
  ensureDir("release");
  await esbuild.build(config);
  copyReleaseFiles();
  console.log("\n✓ release/  — single CJS bundle, cross-platform\n");
  process.exit(0);
} else {
  const ctx = await esbuild.context({
    ...config,
    plugins: [{
      name: "copy-release-files",
      setup(build) { build.onEnd(() => copyReleaseFiles()); },
    }],
  });
  await ctx.watch();
  console.log("[watch] release/");
}
