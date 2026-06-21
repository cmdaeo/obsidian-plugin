// version-bump.mjs — run before tagging a release
// Syncs versions.json and package.json from manifest.json.
// Usage: edit manifest.json version, then run `npm run version`.
import fs from "fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const pkg      = JSON.parse(fs.readFileSync("package.json", "utf8"));

versions[manifest.version] = manifest.minAppVersion;
pkg.version = manifest.version;

fs.writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
fs.writeFileSync("package.json",  JSON.stringify(pkg,      null, 2) + "\n");

console.log(`\n✓ Bumped to ${manifest.version}`);
console.log(`  versions.json → ${manifest.version}: ${manifest.minAppVersion}`);
console.log(`  package.json  → ${manifest.version}\n`);
console.log("Next steps:");
console.log("  git add manifest.json versions.json package.json");
console.log(`  git commit -m "chore: release ${manifest.version}"`);
console.log(`  git tag ${manifest.version}`);
console.log("  git push && git push --tags\n");
