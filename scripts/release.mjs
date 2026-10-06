// `npm run release [-- --notes "What changed"] [-- --skip-tests]`
//
// Builds a signed installer for the current commit and publishes it as a
// GitHub release, so installed apps get the update prompt. Needs the GitHub
// CLI (`gh auth login`) and the signing key from docs/RELEASING.md.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assetUrl,
  builtInstallerName,
  installerAssetName,
  latestJson,
  notesFromSubjects,
  releaseRepo,
  tagFor,
} from "./release-lib.mjs";
import { ROOT, currentVersion, git, tauriConfig } from "./version.mjs";

function fail(msg) {
  console.error(`\nRelease stopped: ${msg}`);
  process.exit(1);
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${cmd} ${args[0] ?? ""} failed`);
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const config = tauriConfig();
const repo = (() => {
  try {
    return releaseRepo(config.plugins?.updater?.endpoints?.[0]);
  } catch (e) {
    fail(e.message);
  }
})();

if (git("status", "--porcelain")) fail("there are uncommitted changes. Commit them first, so the version matches a commit.");
if (spawnSync("gh", ["--version"], { shell: true }).status !== 0) {
  fail("the GitHub CLI isn't installed. Install it (winget install GitHub.cli) and run `gh auth login`.");
}

const version = currentVersion();
const tag = tagFor(version);
if (git("tag", "--list", tag)) fail(`${tag} was already released. Make a commit first.`);

const lastTag = git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0];
const notes =
  argValue("--notes") ??
  notesFromSubjects(git("log", "--format=%s", lastTag ? `${lastTag}..HEAD` : "-20").split("\n"));

console.log(`Releasing Make Tools ${version} to ${repo}\n\n${notes}\n`);

if (!process.argv.includes("--skip-tests")) run("npm", ["test"]);

const keyFile = join(homedir(), ".tauri", "make-tools.key");
const signingEnv = {};
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  if (!existsSync(keyFile)) fail(`no signing key at ${keyFile} (see docs/RELEASING.md).`);
  signingEnv.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8");
  signingEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";
}
run("node", ["scripts/tauri.mjs", "build"], signingEnv);

const bundleDir = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
const built = join(bundleDir, builtInstallerName(config.productName, version));
if (!existsSync(built) || !existsSync(`${built}.sig`)) fail(`can't find ${built} and its .sig`);

const outDir = join(ROOT, "src-tauri", "target", "release", "upload");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const assetName = installerAssetName(version);
copyFileSync(built, join(outDir, assetName));
writeFileSync(
  join(outDir, "latest.json"),
  latestJson({
    version,
    notes,
    pubDate: new Date().toISOString(),
    signature: readFileSync(`${built}.sig`, "utf8"),
    url: assetUrl(repo, version, assetName),
  }),
);
const notesFile = join(outDir, "notes.md");
writeFileSync(notesFile, notes);

run("gh", [
  "release",
  "create",
  tag,
  `"${join(outDir, assetName)}"`,
  `"${join(outDir, "latest.json")}"`,
  "--repo",
  repo,
  "--title",
  `"Make Tools ${version}"`,
  "--notes-file",
  `"${notesFile}"`,
]);
git("tag", tag);
console.log(`\nReleased ${version}. Installed apps will offer it on their next start.`);
