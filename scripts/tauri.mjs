// `npm run tauri ...`: runs the Tauri CLI, and for dev/build stamps the
// version from the commit count (see version.mjs).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, currentVersion } from "./version.mjs";

const args = process.argv.slice(2);
if (args[0] === "dev" || args[0] === "build") {
  const file = join(mkdtempSync(join(tmpdir(), "make-tools-")), "version.conf.json");
  writeFileSync(file, JSON.stringify({ version: currentVersion() }));
  // Right after the subcommand, so it lands before any `--` passthrough args.
  args.splice(1, 0, "--config", file);
}
const r = spawnSync("npx", ["tauri", ...args], { cwd: ROOT, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
