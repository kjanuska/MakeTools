import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import type { FileEntry } from "../../lib/fs";
import { setCell } from "./ops";
import { ProfileStore } from "./store";

const H = PROFILE_HEADER;
const row = (name: string, zip = "62701") =>
  `${name},Jane,Doe,jane@example.com,101 Main St,,Springfield,IL,${zip},US,2175550100,4111111111111111,01,28,123`;
const GOOD = `${H}\r\n${row("1")}\r\n${row("2")}\r\n`;
const BAD = `${H}\r\n${row("1", "ZIP")}\r\n`;

const entry = (name: string): FileEntry => ({ name, path: `C:\\m\\profile\\${name}`, size: 1, modifiedMs: 1 });

function backend(files: Record<string, string>, opts: { failSave?: string } = {}) {
  const disk = new Map(Object.entries(files).map(([n, t]) => [entry(n).path, t]));
  const saves: { path: string; text: string }[] = [];
  const reads: string[] = [];
  mockIPC((cmd, args) => {
    const a = args as { path: string; text: string };
    if (cmd === "read_text") {
      reads.push(a.path);
      if (!disk.has(a.path)) throw "The system cannot find the file specified. (os error 2)";
      return { text: disk.get(a.path), lineEnding: "crlf", hasBom: false };
    }
    if (cmd === "save_text") {
      if (opts.failSave) throw opts.failSave;
      saves.push({ path: a.path, text: a.text });
      disk.set(a.path, a.text);
      return null;
    }
    throw `unexpected ${cmd}`;
  });
  return { disk, saves, reads };
}

const yes = async () => true;
const no = async () => false;

describe("ProfileStore", () => {
  it("loads a file with its validation state", async () => {
    backend({ "g.csv": GOOD, "b.csv": BAD });
    const store = new ProfileStore();
    await store.scan([entry("g.csv"), entry("b.csv")]);
    expect(store.get(entry("g.csv").path)).toMatchObject({ dirty: false, errorCount: 0 });
    expect(store.get(entry("b.csv").path)).toMatchObject({ dirty: false, errorCount: 1 });
  });

  it("records read errors", async () => {
    backend({});
    const store = new ProfileStore();
    await store.load(entry("missing.csv"));
    expect(store.get(entry("missing.csv").path)).toBeUndefined();
    expect(store.loadError(entry("missing.csv").path)).toContain("cannot find the file");
  });

  it("tracks edits as dirty until they match the file again", async () => {
    backend({ "g.csv": GOOD });
    const store = new ProfileStore();
    const f = entry("g.csv");
    await store.load(f);
    const id = store.get(f.path)!.doc.rows[0].id;
    store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    expect(store.get(f.path)!.dirty).toBe(true);
    expect(store.dirtyEntries().map((e) => e.file.name)).toEqual(["g.csv"]);
    store.update(f.path, (d) => setCell(d, id, "city", "Springfield"));
    expect(store.get(f.path)!.dirty).toBe(false);
  });

  it("keeps unsaved edits when the file is scanned again, unless forced", async () => {
    const { disk } = backend({ "g.csv": GOOD });
    const store = new ProfileStore();
    const f = entry("g.csv");
    await store.load(f);
    const id = store.get(f.path)!.doc.rows[0].id;
    store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    disk.set(f.path, BAD);
    await store.scan([f]);
    expect(store.get(f.path)!.serialized).toBe(GOOD.replace("Springfield", "Chicago"));
    await store.load(f, true);
    expect(store.get(f.path)!.serialized).toBe(BAD);
    expect(store.get(f.path)!.dirty).toBe(false);
  });

  it("re-reads clean files on scan", async () => {
    const { disk } = backend({ "g.csv": GOOD });
    const store = new ProfileStore();
    const f = entry("g.csv");
    await store.load(f);
    disk.set(f.path, BAD);
    await store.scan([f]);
    expect(store.get(f.path)!.errorCount).toBe(1);
  });

  it("discards edits", async () => {
    backend({ "g.csv": GOOD });
    const store = new ProfileStore();
    const f = entry("g.csv");
    await store.load(f);
    const id = store.get(f.path)!.doc.rows[0].id;
    store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    store.discard(f.path);
    expect(store.get(f.path)).toMatchObject({ dirty: false, serialized: GOOD });
  });

  it("notifies subscribers on change", async () => {
    backend({ "g.csv": GOOD });
    const store = new ProfileStore();
    const fn = vi.fn();
    store.subscribe(fn);
    await store.load(entry("g.csv"));
    expect(fn).toHaveBeenCalled();
    expect(store.getVersion()).toBeGreaterThan(0);
  });

  it("saves exactly the edited text and is clean afterwards", async () => {
    const { saves } = backend({ "g.csv": GOOD });
    const store = new ProfileStore();
    const f = entry("g.csv");
    await store.load(f);
    const id = store.get(f.path)!.doc.rows[1].id;
    store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    await expect(store.save(f.path, yes)).resolves.toEqual({ ok: true, verified: true });
    expect(saves).toEqual([{ path: f.path, text: `${H}\r\n${row("1")}\r\n${row("2").replace("Springfield", "Chicago")}\r\n` }]);
    expect(store.get(f.path)!.dirty).toBe(false);
  });

  it("won't save a file with errors", async () => {
    const { saves } = backend({ "b.csv": BAD });
    const store = new ProfileStore();
    const f = entry("b.csv");
    await store.load(f);
    const id = store.get(f.path)!.doc.rows[0].id;
    store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    await expect(store.save(f.path, yes)).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(saves).toEqual([]);
  });

  it("asks before overwriting a file changed on disk", async () => {
    const { disk, saves } = backend({ "g.csv": GOOD });
    const store = new ProfileStore();
    const f = entry("g.csv");
    await store.load(f);
    const id = store.get(f.path)!.doc.rows[0].id;
    store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    disk.set(f.path, GOOD + `${row("3")}\r\n`);
    const confirm = vi.fn(no);
    await expect(store.save(f.path, confirm)).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(confirm).toHaveBeenCalledWith(f);
    expect(saves).toEqual([]);
    await expect(store.save(f.path, yes)).resolves.toEqual({ ok: true, verified: true });
    expect(saves).toHaveLength(1);
  });

  it("reports save errors and keeps the edits", async () => {
    backend({ "g.csv": GOOD }, { failSave: "Access is denied. (os error 5)" });
    const store = new ProfileStore();
    const f = entry("g.csv");
    await store.load(f);
    const id = store.get(f.path)!.doc.rows[0].id;
    store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    await expect(store.save(f.path, yes)).resolves.toEqual({ ok: false, reason: "error", error: "Access is denied. (os error 5)" });
    expect(store.get(f.path)!.dirty).toBe(true);
  });

  it("doesn't edit read-only files", async () => {
    backend({ "x.csv": "a,b\r\n1,2\r\n" });
    const store = new ProfileStore();
    const f = entry("x.csv");
    await store.load(f);
    const before = store.get(f.path);
    store.update(f.path, (d) => ({ ...d, rows: [] }));
    expect(store.get(f.path)).toBe(before);
    expect(before!.errorCount).toBe(0);
  });

  it("saveAll saves valid changed files and reports the rest", async () => {
    const { saves, disk } = backend({ "a.csv": GOOD, "b.csv": BAD, "c.csv": GOOD, "d.csv": GOOD, "e.csv": GOOD });
    const store = new ProfileStore();
    const files = ["a.csv", "b.csv", "c.csv", "d.csv", "e.csv"].map(entry);
    await store.scan(files);
    for (const f of files.slice(0, 4)) {
      const id = store.get(f.path)!.doc.rows[0].id;
      store.update(f.path, (d) => setCell(d, id, "city", "Chicago"));
    }
    disk.set(files[2].path, "changed elsewhere");
    const confirm = vi.fn(no);
    const r = await store.saveAll(confirm);
    expect(r.saved.map((e) => e.file.name)).toEqual(["a.csv", "d.csv"]);
    expect(r.invalid.map((e) => e.file.name)).toEqual(["b.csv"]);
    expect(r.cancelled.map((e) => e.file.name)).toEqual(["c.csv"]);
    expect(r.failed).toEqual([]);
    expect(saves.map((s) => s.path)).toEqual([files[0].path, files[3].path]);
    expect(store.dirtyEntries().map((e) => e.file.name)).toEqual(["b.csv", "c.csv"]);
  });
});
