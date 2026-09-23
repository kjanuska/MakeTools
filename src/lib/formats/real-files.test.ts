/// <reference types="node" />
// Round-trips the user's real Makebot files, using temporary copies. Runs only
// when the git-ignored Makebot/ folder exists (or MAKEBOT_DIR points at one).
// Files hold credentials: failures report the file name and byte offset only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseProfiles, serializeProfiles } from "./profiles";
import { cleanInputs, joinBrokenLines, parseTasks, serializeTasks } from "./tasks";

const root = process.env.MAKEBOT_DIR ?? path.resolve(__dirname, "../../../Makebot");

function firstDifference(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function realFolder(sub: string) {
  const dir = path.join(root, sub);
  const available = fs.existsSync(dir);
  const names = available ? fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".csv")) : [];
  let tmp = "";
  /** Bytes of a temporary copy of a real file. */
  const read = (name: string) => {
    tmp ||= fs.mkdtempSync(path.join(os.tmpdir(), "make-tools-real-"));
    const copy = path.join(tmp, name);
    fs.copyFileSync(path.join(dir, name), copy);
    return fs.readFileSync(copy);
  };
  const cleanup = () => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { available, names, read, cleanup };
}

const profiles = realFolder("profile");

describe.skipIf(!profiles.available)("real profile files (temporary copies)", () => {
  afterAll(profiles.cleanup);

  it("finds profile files", () => {
    expect(profiles.names.length).toBeGreaterThan(0);
  });

  it.each(profiles.names)("%s round-trips byte for byte", (name) => {
    const bytes = profiles.read(name);
    const out = Buffer.from(serializeProfiles(parseProfiles(bytes.toString("utf8"))), "utf8");
    const diff = firstDifference(bytes, out);
    // Only the offset is reported, never the contents.
    expect(diff, `${name}: first difference at byte ${diff}`).toBe(-1);
  });
});

const tasks = realFolder("task");

describe.skipIf(!tasks.available)("real task files (temporary copies)", () => {
  afterAll(tasks.cleanup);

  it("finds task files", () => {
    expect(tasks.names.length).toBeGreaterThan(0);
  });

  it.each(tasks.names)("%s round-trips byte for byte", (name) => {
    const bytes = tasks.read(name);
    const out = Buffer.from(serializeTasks(parseTasks(bytes.toString("utf8"))), "utf8");
    const diff = firstDifference(bytes, out);
    expect(diff, `${name}: first difference at byte ${diff}`).toBe(-1);
  });

  it.each(tasks.names)("%s parses completely after the automatic fixes", (name) => {
    const doc = cleanInputs(joinBrokenLines(parseTasks(tasks.read(name).toString("utf8"))));
    expect(doc.headerOk, `${name}: header`).toBe(true);
    const raw = doc.rows.filter((r) => r.kind === "raw").length;
    expect(raw, `${name}: unparseable lines left`).toBe(0);
    // The fixes only remove spaces and join lines: every other character is kept.
    const before = bytesWithout(tasks.read(name).toString("utf8"));
    const after = bytesWithout(serializeTasks(doc));
    expect(after === before, `${name}: fixes changed more than spaces, quotes and line breaks`).toBe(true);
  });
});

/** The text with spaces, quotes and line breaks removed, for comparing fixes. */
const bytesWithout = (s: string) => s.replace(/[ "\r\n]/g, "");
