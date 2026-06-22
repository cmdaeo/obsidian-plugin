#!/usr/bin/env node
// scripts/revert-release.mjs
// Reverts a failed release so you can re-run `npm run release -- <version>` cleanly.
//
// What it does (and ONLY this):
//   1. Deletes the local tag (if present)
//   2. Deletes the remote tag (if present)
//   3. Soft-resets HEAD to undo the version-bump commit
//      (leaves manifest.json / versions.json / package.json staged with bumped content,
//       but that's fine — `release` will overwrite them anyway)
//
// What it does NOT do:
//   - It does NOT edit or restore any files
//   - It does NOT force-push the branch
//   - It does NOT touch the working tree
//
// After running this, fix whatever failed, then:
//   npm run release -- <same-version>
//
// Usage:
//   npm run revert-release              # auto-detects version from HEAD commit message
//   npm run revert-release -- 1.0.1     # explicit version

import { execSync } from 'child_process';

const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const ok   = s => console.log(c.green + '✔ ' + c.reset + s);
const fail = s => { console.error(c.red + '✖ ' + c.reset + s); process.exit(1); };
const info = s => console.log(c.cyan  + 'ℹ ' + c.reset + s);
const warn = s => console.log(c.yellow + '⚠ ' + c.reset + s);
const skip = s => console.log(c.dim   + '– skip: ' + s + c.reset);
const hr   = () => console.log(c.dim + '─'.repeat(54) + c.reset);

function run(cmd)     { try { execSync(cmd, { stdio: 'inherit' }); } catch (e) { fail(`Command failed: ${cmd}\n${e.message}`); } }
function capture(cmd) { try { return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim(); } catch { return ''; } }

// ── Resolve target version ───────────────────────────────────────────────────

console.log(c.bold + 'YAP – Revert Release' + c.reset);

let targetVersion = process.argv[2]?.trim() ?? null;

if (!targetVersion) {
  const lastMsg = capture('git log -1 --pretty=%s');
  const m = /^chore: release (.+)$/.exec(lastMsg);
  if (m) {
    targetVersion = m[1];
    info(`Auto-detected from HEAD commit: ${c.bold}${targetVersion}${c.reset}`);
  } else {
    fail(
      `Could not auto-detect version from HEAD commit.\nHEAD: ${lastMsg}\nSupply it explicitly:\n  npm run revert-release -- 1.0.1`
    );
  }
} else {
  info(`Target version: ${c.bold}${targetVersion}${c.reset}`);
}

hr();

// ── Probe ────────────────────────────────────────────────────────────────────

const hasLocal  = capture(`git tag -l ${targetVersion}`).length > 0;
const hasRemote = capture(`git ls-remote --tags origin refs/tags/${targetVersion}`).length > 0;
const remote    = capture('git remote get-url origin');

info(`Local tag  : ${hasLocal  ? c.green + 'exists' + c.reset : c.dim + 'not found' + c.reset}`);
info(`Remote tag : ${hasRemote ? c.green + 'exists' + c.reset : c.dim + 'not found' + c.reset}`);

// ── 1. Delete local tag ──────────────────────────────────────────────────────

hr();
if (hasLocal) {
  info(`Deleting local tag ${targetVersion}`);
  run(`git tag -d ${targetVersion}`);
  ok('Local tag deleted');
} else {
  skip(`Local tag ${targetVersion} not present`);
}

// ── 2. Delete remote tag ─────────────────────────────────────────────────────

if (!remote) {
  warn('No remote origin — skipping remote tag deletion.');
} else if (hasRemote) {
  info(`Deleting remote tag ${targetVersion} from origin`);
  run(`git push origin :refs/tags/${targetVersion}`);
  ok('Remote tag deleted');
} else {
  skip(`Remote tag ${targetVersion} not on remote`);
}

// ── 3. Undo the version-bump commit ────────────────────────────────────────────

hr();
info('Undoing version-bump commit (soft reset)');
run('git reset --soft HEAD~1');

info('Restoring version files to their pre-release state');
run('git restore --staged manifest.json versions.json package.json');
run('git checkout HEAD manifest.json versions.json package.json');
ok('Commit undone and version numbers reverted — other modified files remain staged');

// ── 4. Advisory: GitHub release ──────────────────────────────────────────────

if (remote) {
  const repoUrl = remote.replace(/\.git$/, '').replace('git@github.com:', 'https://github.com/');
  warn('If GitHub Actions published a release, delete it manually:');
  console.log(`  ${repoUrl}/releases/tag/${targetVersion}`);
  console.log(`  or: gh release delete ${targetVersion} --yes`);
}

// ── Done ─────────────────────────────────────────────────────────────────────

hr();
console.log(c.bold + c.green + 'Done.' + c.reset + ` Tag(s) removed, commit undone.`);
console.log(`Fix the issue, then re-release:`);
console.log(`  ${c.bold}npm run release -- ${targetVersion}${c.reset}`);