/// <reference types="node" />
// Round-trips the user's real Makebot files, using temporary copies. Runs only
// when the git-ignored Makebot/ folder exists (or MAKEBOT_DIR points at one).
// Files hold credentials: failures report the file name and byte offset only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { accountsOf, appendLines, oddLines, parseAccounts } from "./accounts";
import { parseProfiles, serializeProfiles } from "./profiles";
import * as proxyFormat from "./proxies";
import { cleanInputs, joinBrokenLines, parseTasks, serializeTasks, TASK_COL } from "./tasks";
import { breakdown, generateRows, inferPlan, SPLIT_FIELDS } from "../../modules/tasks/build";
import { taskCount, type TaskContext } from "../../modules/tasks/schema";

const root = process.env.MAKEBOT_DIR ?? path.resolve(__dirname, "../../../Makebot");

function firstDifference(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function realFolder(sub: string, ext = ".csv") {
  const dir = path.join(root, sub);
  const available = fs.existsSync(dir);
  const names = available ? fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(ext)) : [];
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
    tmp = "";
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

describe.skipIf(!tasks.available || !profiles.available)("real task files: builder (temporary copies)", () => {
  afterAll(() => {
    tasks.cleanup();
    profiles.cleanup();
  });

  const ctx = (): TaskContext => ({
    ready: true,
    profileGroups: new Map(
      profiles.names.map((n) => {
        const doc = parseProfiles(profiles.read(n).toString("utf8"));
        const names = doc.rows.flatMap((r) => (r.kind === "record" ? [r.values[0]] : []));
        return [n.replace(/\.csv$/i, ""), names];
      }),
    ),
    proxyGroups: new Set(),
    accountGroups: new Set(),
    sites: [],
  });

  const rowsOf = (name: string) =>
    cleanInputs(joinBrokenLines(parseTasks(tasks.read(name).toString("utf8")))).rows.flatMap((r) =>
      r.kind === "record" ? [r.values] : [],
    );

  /** Tasks per profile, per input and per input × field value; no values are reported on failure. */
  const counts = (rows: string[][], c: TaskContext) => {
    const b = breakdown(rows, c);
    const perInput = b.by.input.map(({ value }) => {
      const own = breakdown(
        rows.filter((r) => r[TASK_COL.input] === value),
        c,
      );
      return [value, SPLIT_FIELDS.map((f) => own.by[f].map((x) => `${x.value}=${x.count}`).sort())];
    });
    return JSON.stringify({
      profiles: [...b.profiles].map(([g, l]) => [g, l.map((x) => `${x.value}=${x.count}`).sort()]).sort(),
      inputs: perInput.sort(),
    });
  };

  it.each(tasks.names)("%s: breakdown total matches the task counts", (name) => {
    const c = ctx();
    const rows = rowsOf(name);
    const b = breakdown(rows, c);
    const known = rows.map((r) => taskCount(r, c)).filter((n): n is number => n !== null);
    expect(b.total, `${name}: total`).toBe(known.reduce((a, n) => a + n, 0));
    expect(b.unknownRows, `${name}: unknown rows`).toBe(rows.length - known.length);
  });

  it.each(tasks.names)("%s: rebuilding from the inferred plan keeps every count", (name) => {
    const c = ctx();
    const rows = rowsOf(name);
    const rebuilt = generateRows(inferPlan(rows, c));
    expect(counts(rebuilt, c) === counts(rows, c), `${name}: counts changed`).toBe(true);
  });
});

/** The text with spaces, quotes and line breaks removed, for comparing fixes. */
const bytesWithout = (s: string) => s.replace(/[ "\r\n]/g, "");

const accounts = realFolder("account", ".txt");

describe.skipIf(!accounts.available)("real account files (temporary copies)", () => {
  afterAll(accounts.cleanup);

  it("finds account files", () => {
    expect(accounts.names.length).toBeGreaterThan(0);
  });

  it.each(accounts.names)("%s: every line is an account", (name) => {
    const doc = parseAccounts(accounts.read(name).toString("utf8"));
    expect(oddLines(doc).length, `${name}: unrecognized lines`).toBe(0);
  });

  it.each(accounts.names)("%s: appending keeps every existing byte", (name) => {
    const bytes = accounts.read(name);
    const text = bytes.toString("utf8");
    const count = accountsOf(parseAccounts(text)).length;
    const out = appendLines(text, ["new@example.com:pw"]);
    const prefix = Buffer.from(out, "utf8").subarray(0, bytes.length);
    const diff = firstDifference(bytes, prefix);
    expect(diff, `${name}: first difference at byte ${diff}`).toBe(-1);
    expect(accountsOf(parseAccounts(out)).length).toBe(count + 1);
  });
});

const proxies = realFolder("proxy", ".txt");

describe.skipIf(!proxies.available)("real proxy files (temporary copies)", () => {
  afterAll(proxies.cleanup);
  const { countProxies, fromEditorText, oddLines: oddProxies, parseProxies, shuffleProxies, toEditorText } = proxyFormat;

  it("finds proxy files", () => {
    expect(proxies.names.length).toBeGreaterThan(0);
  });

  it.each(proxies.names)("%s: every line is a proxy, and each counts", (name) => {
    const text = proxies.read(name).toString("utf8");
    const p = parseProxies(text);
    expect(oddProxies(p.lines).length, `${name}: odd lines`).toBe(0);
    expect(countProxies(p)).toBe(p.lines.length);
  });

  it.each(proxies.names)("%s: through the editor unchanged gives the same bytes", (name) => {
    const bytes = proxies.read(name);
    const text = bytes.toString("utf8");
    const out = Buffer.from(fromEditorText(toEditorText(text), text), "utf8");
    const diff = firstDifference(bytes, out);
    expect(diff, `${name}: first difference at byte ${diff}`).toBe(-1);
  });

  it.each(proxies.names)("%s: editing the first line in the editor changes only those bytes", (name) => {
    const bytes = proxies.read(name);
    const text = bytes.toString("utf8");
    const lines = toEditorText(text).split("\n");
    const first = lines[0];
    lines[0] = "203.0.113.9:8080";
    const out = fromEditorText(lines.join("\n"), text);
    const expected = Buffer.from("203.0.113.9:8080" + text.slice(first.length), "utf8");
    const diff = firstDifference(expected, Buffer.from(out, "utf8"));
    expect(diff, `${name}: first difference at byte ${diff}`).toBe(-1);
  });

  it.each(proxies.names)("%s: shuffling keeps every line, the line endings and the final newline", (name) => {
    const text = proxies.read(name).toString("utf8");
    const before = parseProxies(text);
    const out = shuffleProxies(text);
    const after = parseProxies(out);
    expect(out.length).toBe(text.length);
    expect(after.eol).toBe(before.eol);
    expect(after.trailingNewline).toBe(before.trailingNewline);
    expect(after.bom).toBe(before.bom);
    // Compared as sorted lists; never printed.
    const same = [...after.lines].sort().join("\n") === [...before.lines].sort().join("\n");
    expect(same, `${name}: lines differ after shuffling`).toBe(true);
    const unchanged = after.lines.join("\n") === before.lines.join("\n");
    if (before.lines.length > 1) expect(unchanged, `${name}: order didn't change`).toBe(false);
  });

  it.each(proxies.names)("%s: adding a line at the end in the editor keeps every existing byte", (name) => {
    const bytes = proxies.read(name);
    const text = bytes.toString("utf8");
    const shown = toEditorText(text);
    const out = fromEditorText(shown + (shown.endsWith("\n") ? "" : "\n") + "203.0.113.9:8080", text);
    const diff = firstDifference(bytes, Buffer.from(out, "utf8").subarray(0, bytes.length));
    expect(diff, `${name}: first difference at byte ${diff}`).toBe(-1);
    expect(countProxies(parseProxies(out))).toBe(countProxies(parseProxies(text)) + 1);
  });
});
