import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { accountsOf } from "../../lib/formats/accounts";
import type { FileEntry } from "../../lib/fs";
import { AccountStore } from "./store";

const FILE: FileEntry = { name: "popmart.txt", path: "C:\\Makebot\\account\\popmart.txt", size: 1, modifiedMs: 1 };
const TEXT = "a.one@gmail.com:Pass1\r\nb.two@gmail.com:Pass2:1.2.3.4:8080\r\n";

let disk: Map<string, string>;
let reads: number;

beforeEach(() => {
  disk = new Map([[FILE.path, TEXT]]);
  reads = 0;
  mockIPC((cmd, a) => {
    const { path } = a as { path: string };
    if (cmd !== "read_text") throw `unexpected command ${cmd}`;
    reads++;
    if (!disk.has(path)) throw "not found";
    return { text: disk.get(path)!, lineEnding: "crlf", hasBom: false };
  });
});

describe("AccountStore", () => {
  it("reads and parses a file, and tells subscribers", async () => {
    const store = new AccountStore();
    let heard = 0;
    store.subscribe(() => heard++);
    expect(store.get(FILE.path)).toBeUndefined();
    await store.load(FILE);
    const e = store.get(FILE.path)!;
    expect(e.text).toBe(TEXT);
    expect(e.file).toBe(FILE);
    expect(e.dirty).toBe(false);
    expect(accountsOf(e.doc).map((a) => a.email)).toEqual(["a.one@gmail.com", "b.two@gmail.com"]);
    expect(heard).toBe(1);
    expect(store.getVersion()).toBe(1);
  });

  it("a file unchanged on disk keeps its parsed copy, and nothing re-renders", async () => {
    const store = new AccountStore();
    await store.load(FILE);
    const first = store.get(FILE.path);
    await store.load(FILE);
    expect(reads).toBe(2);
    expect(store.get(FILE.path)).toBe(first);
    expect(store.getVersion()).toBe(1);
  });

  it("a file changed on disk (an import) is read again", async () => {
    const store = new AccountStore();
    await store.load(FILE);
    disk.set(FILE.path, TEXT + "c.three@yahoo.com:Pass3\r\n");
    await store.load(FILE);
    expect(accountsOf(store.get(FILE.path)!.doc)).toHaveLength(3);
    expect(store.getVersion()).toBe(2);
  });

  it("a read error is kept, and the file isn't held", async () => {
    const store = new AccountStore();
    await store.load(FILE);
    disk.delete(FILE.path);
    await store.load(FILE);
    expect(store.get(FILE.path)).toBeUndefined();
    expect(store.loadError(FILE.path)).toBe("not found");
    disk.set(FILE.path, TEXT);
    await store.load(FILE);
    expect(store.get(FILE.path)?.text).toBe(TEXT);
    expect(store.loadError(FILE.path)).toBeUndefined();
  });

  it("forget drops a file (after a rename or delete)", async () => {
    const store = new AccountStore();
    await store.load(FILE);
    store.forget(FILE.path);
    expect(store.get(FILE.path)).toBeUndefined();
  });
});
