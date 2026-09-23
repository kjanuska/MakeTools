/// <reference types="node" />
// Round-trips the user's real Makebot files, using temporary copies. Runs only
// when the git-ignored Makebot/ folder exists (or MAKEBOT_DIR points at one).
// Files hold credentials: failures report the file name and byte offset only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseProfiles, serializeProfiles } from "./profiles";

const root = process.env.MAKEBOT_DIR ?? path.resolve(__dirname, "../../../Makebot");
const profileDir = path.join(root, "profile");
const available = fs.existsSync(profileDir);

function firstDifference(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe.skipIf(!available)("real profile files (temporary copies)", () => {
  const tmp = available ? fs.mkdtempSync(path.join(os.tmpdir(), "make-tools-real-")) : "";
  const names = available ? fs.readdirSync(profileDir).filter((n) => n.toLowerCase().endsWith(".csv")) : [];
  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds profile files", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)("%s round-trips byte for byte", (name) => {
    const copy = path.join(tmp, name);
    fs.copyFileSync(path.join(profileDir, name), copy);
    const bytes = fs.readFileSync(copy);
    const out = Buffer.from(serializeProfiles(parseProfiles(bytes.toString("utf8"))), "utf8");
    const diff = firstDifference(bytes, out);
    // Only the offset is reported, never the contents.
    expect(diff, `${name}: first difference at byte ${diff}`).toBe(-1);
  });
});
