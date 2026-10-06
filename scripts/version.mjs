// Reads the current app version from git + tauri.conf.json.
// Run directly to print it: node scripts/version.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appVersion } from "./release-lib.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function tauriConfig() {
  return JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
}

export function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function currentVersion() {
  return appVersion(tauriConfig().version, Number(git("rev-list", "--count", "HEAD")));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(currentVersion());
}
