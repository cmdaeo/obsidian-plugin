#!/usr/bin/env node
// scripts/release.mjs
// Usage: npm run release -- 1.2.3
// Validates the new version, bumps all files, commits, tags, and pushes.

import fs from 'fs';
import { execSync } from 'child_process';

const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const ok   = s => console.log(c.green + '✔ ' + c.reset + s);
const fail = s => { console.error(c.red + '✖ ' + c.reset + s); process.exit(1); };
const info = s => console.log(c.cyan  + 'ℹ ' + c.reset + s);
const warn = s => console.log(c.yellow + '⚠ ' + c.reset + s);
const hr   = () => console.log(c.dim + '─'.repeat(54) + c.reset);

function run(cmd)     { try { execSync(cmd, { stdio: 'inherit' }); } catch (e) { fail(`Command failed: ${cmd}\n${e.message}`); } }
function capture(cmd) { try { return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim(); } catch { return ''; } }

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
}
function isGreater(candidate, current) {
  const a = parseSemver(candidate), b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false; // equal
}

// ── Entry point ──────────────────────────────────────────────────────────────

const newVersion = process.argv[2]?.trim();
console.log(c.bold + 'YAP – Release' + c.reset);

// 1. Version argument
if (!newVersion) fail('No version supplied.\n  npm run release -- <version>\n  npm run release -- 1.2.3');
if (!parseSemver(newVersion)) fail(`${newVersion} is not a valid semver version. (MAJOR.MINOR.PATCH, e.g. 1.2.3)`);

// 2. Load current files
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
const pkg      = JSON.parse(fs.readFileSync('package.json',  'utf8'));
const current  = manifest.version;
info(`Current version: ${c.bold}${current}${c.reset}`);
info(`New version    : ${c.bold}${newVersion}${c.reset}`);
hr();

// 3. Reject same version
if (newVersion === current) fail(`Version ${newVersion} is already current. You must increment.`);

// 4. Reject duplicates in versions.json
if (versions[newVersion]) fail(`Version ${newVersion} already exists in versions.json. Re-releases are not allowed.`);

// 5. Reject downgrade
if (!isGreater(newVersion, current)) fail(`${newVersion} is not greater than current version ${current}. Only incrementing is allowed.`);

ok(`${newVersion} > ${current} — valid`);

// 6. Check remote exists
const remote = capture('git remote get-url origin');
if (!remote) fail('No git remote "origin" configured. Add one:\n  git remote add origin <url>');
ok(`Remote: ${remote}`);

// 7. Check tag does not exist locally
const localTag = capture(`git tag -l ${newVersion}`);
if (localTag) fail(`Tag ${newVersion} already exists locally. Delete it first:\n  git tag -d ${newVersion}`);

// 8. Check tag does not exist on remote
const remoteTag = capture(`git ls-remote --tags origin refs/tags/${newVersion}`);
if (remoteTag) fail(`Tag ${newVersion} already exists on remote origin. Re-releases are not allowed.`);

ok('Tag is unique locally and on remote');

// 9. Warn about dirty working tree — will commit everything staged/versioned
const dirty = capture('git status --porcelain');
if (dirty) {
  warn('Uncommitted changes detected — they will be included in the release commit');
  console.log(c.dim + dirty + c.reset);
}

// 10. Bump files
hr();
info('Bumping files');
manifest.version       = newVersion;
versions[newVersion]   = manifest.minAppVersion;
pkg.version            = newVersion;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
fs.writeFileSync('package.json',  JSON.stringify(pkg,      null, 2) + '\n');
ok('manifest.json');
ok('versions.json');
ok('package.json');

// 11. Stage
hr();
info('Staging');
run('git add manifest.json versions.json package.json');
run('git add -u'); // stage any other tracked modified files
ok('Staged');

// 12. Commit
const commitMsg = `chore: release ${newVersion}`;
info(`Committing: ${commitMsg}`);
run(`git commit -m "${commitMsg}"`);
ok('Committed');

// 13. Annotated tag
info(`Tagging ${newVersion}`);
run(`git tag -a ${newVersion} -m "Release ${newVersion}"`);
ok(`Tagged ${newVersion}`);

// 14. Push commit, then tag (two separate pushes — both required for CI)
hr();
info('Pushing commit');
run('git push origin HEAD');
ok('Commit pushed');

info(`Pushing tag ${newVersion}`);
run(`git push origin ${newVersion}`);
ok('Tag pushed — GitHub Actions will build and publish the release');

// 15. Done
hr();
const repoUrl = remote.replace(/\.git$/, '').replace('git@github.com:', 'https://github.com/');
console.log(c.bold + c.green + `Released ${newVersion}` + c.reset);
console.log(c.dim + 'Track the workflow at:' + c.reset);
console.log(`  ${repoUrl}/actions`);