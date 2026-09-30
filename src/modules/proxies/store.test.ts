import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../lib/fs";
import { shuffleProxies } from "../../lib/formats/proxies";
import { ProxyStore } from "./store";

const PATH = "C:\\Makebot\\proxy\\p.txt";
const FILE: FileEntry = { name: "p.txt", path: PATH, size: 0, modifiedMs: 1 };
const TEXT = "h1:80:u:p\r\nh2:80:u:p\r\nh3:80";

let disk: Map<string, string>;
let saves: { path: string; text: string }[];
/** Text read back after a save, when set (to simulate a mismatch). */
let readBackOverride: string | null;

beforeEach(() => {
  disk = new Map([[PATH, TEXT]]);
  saves = [];
  readBackOverride = null;
  mockIPC((cmd, a) => {
    const args = a as Record<string, string>;
    switch (cmd) {
      case "read_text": {
        if (!disk.has(args.path)) throw "The system cannot find the file specified. (os error 2)";
        const text = saves.length && readBackOverride !== null ? readBackOverride : disk.get(args.path)!;
        return { text, lineEnding: "crlf", hasBom: false };
      }
      case "save_text":
        saves.push({ path: args.path, text: args.text });
        disk.set(args.path, args.text);
        return null;
      default:
        throw `unexpected command ${cmd}`;
    }
  });
});

const yes = vi.fn(async () => true);
const no = vi.fn(async () => false);

async function loaded() {
  const s = new ProxyStore();
  await s.load(FILE);
  return s;
}

describe("ProxyStore", () => {
  it("keeps the text exactly as read, not dirty", async () => {
    const s = await loaded();
    expect(s.get(PATH)!.text).toBe(TEXT);
    expect(s.get(PATH)!.dirty).toBe(false);
    expect(s.dirtyEntries()).toEqual([]);
  });

  it("Save all with no edits writes nothing", async () => {
    const s = await loaded();
    const r = await s.saveAll(yes);
    expect(r.saved).toEqual([]);
    expect(saves).toEqual([]);
  });

  it("an edit is unsaved until saved; saving writes exactly the edited text", async () => {
    const s = await loaded();
    s.update(PATH, (t) => shuffleProxies(t, () => 0));
    const edited = s.get(PATH)!.text;
    expect(edited).not.toBe(TEXT);
    expect(s.get(PATH)!.dirty).toBe(true);
    expect(s.dirtyEntries().map((e) => e.file.name)).toEqual(["p.txt"]);
    expect(saves).toEqual([]);

    expect(await s.save(PATH, yes)).toEqual({ ok: true, verified: true });
    expect(saves).toEqual([{ path: PATH, text: edited }]);
    expect(s.get(PATH)!.dirty).toBe(false);
    expect(s.get(PATH)!.loaded.text).toBe(edited);
  });

  it("an edit that gives the same text isn't a change", async () => {
    const s = await loaded();
    const v = s.getVersion();
    s.update(PATH, (t) => t);
    expect(s.getVersion()).toBe(v);
    expect(s.get(PATH)!.dirty).toBe(false);
  });

  it("editing back to the file's text is no longer dirty", async () => {
    const s = await loaded();
    s.update(PATH, () => "x:1");
    s.update(PATH, () => TEXT);
    expect(s.get(PATH)!.dirty).toBe(false);
  });

  it("discard goes back to the text on disk", async () => {
    const s = await loaded();
    s.update(PATH, () => "x:1");
    s.discard(PATH);
    expect(s.get(PATH)!.text).toBe(TEXT);
    expect(s.get(PATH)!.dirty).toBe(false);
  });

  it("stage loads other contents (a backup) as unsaved changes", async () => {
    const s = await loaded();
    expect(s.stage(PATH, "old:1\r\n")).toEqual({ ok: true });
    expect(s.get(PATH)!.text).toBe("old:1\r\n");
    expect(s.get(PATH)!.dirty).toBe(true);
    expect(saves).toEqual([]);
    expect(new ProxyStore().stage(PATH, "x")).toEqual({ ok: false, error: "File isn't loaded." });
  });

  it("reloading keeps unsaved edits", async () => {
    const s = await loaded();
    s.update(PATH, () => "x:1");
    disk.set(PATH, "changed:2");
    await s.load(FILE);
    expect(s.get(PATH)!.text).toBe("x:1");
  });

  it("reloading an unedited file picks up changes on disk", async () => {
    const s = await loaded();
    disk.set(PATH, "changed:2");
    await s.load(FILE);
    expect(s.get(PATH)!.text).toBe("changed:2");
    expect(s.get(PATH)!.dirty).toBe(false);
  });

  it("asks before overwriting a file changed on disk; no = nothing written", async () => {
    const s = await loaded();
    s.update(PATH, () => "x:1");
    disk.set(PATH, "someone else:2");
    expect(await s.save(PATH, no)).toEqual({ ok: false, reason: "cancelled" });
    expect(saves).toEqual([]);
    expect(no).toHaveBeenCalledWith(FILE);
    expect(await s.save(PATH, yes)).toEqual({ ok: true, verified: true });
    expect(disk.get(PATH)).toBe("x:1");
  });

  it("reports a file that doesn't read back the same", async () => {
    const s = await loaded();
    s.update(PATH, () => "x:1");
    readBackOverride = "x:1\n";
    expect(await s.save(PATH, yes)).toEqual({ ok: true, verified: false });
    // What's on disk is shown, not what was meant to be written.
    expect(s.get(PATH)!.text).toBe("x:1\n");
    const r = await (async () => {
      s.update(PATH, () => "y:2");
      return s.saveAll(yes);
    })();
    expect(r.failed.map((f) => f.error)).toEqual(["the file on disk doesn't match what was written"]);
  });

  it("Save all saves every changed file and lists cancelled ones", async () => {
    const other: FileEntry = { name: "q.txt", path: "C:\\Makebot\\proxy\\q.txt", size: 0, modifiedMs: 1 };
    disk.set(other.path, "q:1");
    const s = await loaded();
    await s.load(other);
    s.update(PATH, () => "a:1");
    s.update(other.path, () => "b:1");
    disk.set(other.path, "changed:1");
    const r = await s.saveAll(async (f) => f.name !== "q.txt");
    expect(r.saved.map((e) => e.file.name)).toEqual(["p.txt"]);
    expect(r.cancelled.map((e) => e.file.name)).toEqual(["q.txt"]);
    expect(disk.get(PATH)).toBe("a:1");
    expect(disk.get(other.path)).toBe("changed:1");
  });

  it("a file that can't be read has a load error", async () => {
    const s = new ProxyStore();
    await s.load({ ...FILE, path: "C:\\Makebot\\proxy\\missing.txt" });
    expect(s.get("C:\\Makebot\\proxy\\missing.txt")).toBeUndefined();
    expect(s.loadError("C:\\Makebot\\proxy\\missing.txt")).toMatch(/cannot find/);
  });

  it("notifies subscribers on changes", async () => {
    const s = await loaded();
    const fn = vi.fn();
    s.subscribe(fn);
    s.update(PATH, () => "x:1");
    s.discard(PATH);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
