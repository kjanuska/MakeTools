import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import type { FileEntry } from "../../lib/fs";
import { NEW_GROUP_TEXT, copyGroup, createGroup, deleteGroup, renameGroup } from "./groups";
import { ProfileStore } from "./store";

const DIR = "C:\\m\\profile";
const file = (name: string): FileEntry => ({ name, path: `${DIR}\\${name}`, size: 1, modifiedMs: 1 });

function record(texts: Record<string, string> = {}) {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "read_text") return { text: texts[(args as { path: string }).path], lineEnding: "crlf", hasBom: false };
    return null;
  });
  return calls;
}

async function storeWith(name: string, text: string) {
  record({ [file(name).path]: text });
  const store = new ProfileStore();
  await store.load(file(name));
  return store;
}

describe("group file operations", () => {
  it("a new group is the header with CRLF", () => {
    expect(NEW_GROUP_TEXT).toBe(`${PROFILE_HEADER}\r\n`);
  });

  it("createGroup creates <name>.csv without overwriting", async () => {
    const calls = record();
    await expect(createGroup(DIR, "40")).resolves.toBe(`${DIR}\\40.csv`);
    expect(calls).toEqual([{ cmd: "create_file", args: { path: `${DIR}\\40.csv`, text: NEW_GROUP_TEXT } }]);
  });

  it("copyGroup copies the saved bytes exactly", async () => {
    const text = `${PROFILE_HEADER}\n1,a\r\n`;
    const calls = record({ [`${DIR}\\25.csv`]: text });
    await expect(copyGroup(file("25.csv"), DIR, "25 copy")).resolves.toBe(`${DIR}\\25 copy.csv`);
    expect(calls[1]).toEqual({ cmd: "create_file", args: { path: `${DIR}\\25 copy.csv`, text } });
  });

  it("renameGroup renames and forgets the old path", async () => {
    const store = await storeWith("25.csv", `${PROFILE_HEADER}\r\n`);
    const calls = record();
    await expect(renameGroup(store, file("25.csv"), DIR, "26")).resolves.toBe(`${DIR}\\26.csv`);
    expect(calls).toEqual([{ cmd: "rename_file", args: { from: `${DIR}\\25.csv`, to: `${DIR}\\26.csv` } }]);
    expect(store.get(file("25.csv").path)).toBeUndefined();
  });

  it("deleteGroup deletes the file and forgets it", async () => {
    const store = await storeWith("25.csv", `${PROFILE_HEADER}\r\n`);
    const calls = record();
    await deleteGroup(store, file("25.csv"));
    expect(calls).toEqual([{ cmd: "delete_file", args: { path: `${DIR}\\25.csv` } }]);
    expect(store.get(file("25.csv").path)).toBeUndefined();
  });

  it("a failed rename or delete keeps the file in memory", async () => {
    const store = await storeWith("25.csv", `${PROFILE_HEADER}\r\n`);
    mockIPC(() => {
      throw "a file with that name already exists";
    });
    await expect(renameGroup(store, file("25.csv"), DIR, "26")).rejects.toBe("a file with that name already exists");
    await expect(deleteGroup(store, file("25.csv"))).rejects.toBe("a file with that name already exists");
    await expect(createGroup(DIR, "25")).rejects.toBe("a file with that name already exists");
    expect(store.get(file("25.csv").path)).toBeDefined();
  });
});
