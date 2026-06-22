// version-bump.mjs
// Usage: edit manifest.json version first, then run `npm run version`
// This syncs versions.json + package.json and stages the files.
import fs from "fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const pkg      = JSON.parse(fs.readFileSync("package.json",  "utf8"));

if (versions[manifest.version]) {
  console.warn(`⚠ versions.json already has an entry for ${manifest.version}`);
}

versions[manifest.version] = manifest.minAppVersion;
pkg.version = manifest.version;

fs.writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
fs.writeFileSync("package.json",  JSON.stringify(pkg,      null, 2) + "\n");

const v = manifest.version;
console.log(`\n✓ Bumped to ${v}`);
console.log(`  versions.json → "${v}": "${manifest.minAppVersion}"`);
console.log(`  package.json  → "${v}"\n`);
console.log("─────────────────────────────────────────────");
console.log("Run these commands to trigger the release:\n");
console.log(`  git add manifest.json versions.json package.json`);
console.log(`  git commit -m "chore: release ${v}"`);
console.log(`  git tag ${v}`);
console.log(`  git push origin main`);
console.log(`  git push origin ${v}`);
console.log("\nGitHub Actions will build and publish automatically.\n");
