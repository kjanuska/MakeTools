import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { createFile, deleteFile, listBackups, listFiles, readText, renameFile, restoreBackup, saveText } from "./fs";

function recordIPC(result: unknown = null) {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return result;
  });
  return calls;
}

describe("fs wrappers", () => {
  it("listFiles sends dir and extension", async () => {
    const files = [{ name: "a.csv", path: "C:\\m\\task\\a.csv", size: 3, modifiedMs: 1 }];
    const calls = recordIPC(files);
    await expect(listFiles("C:\\m\\task", "csv")).resolves.toEqual(files);
    expect(calls).toEqual([{ cmd: "list_files", args: { dir: "C:\\m\\task", extension: "csv" } }]);
  });

  it("readText sends path and returns the text untouched", async () => {
    const file = { text: "\uFEFFa,b\r\nc,d\n", lineEnding: "mixed", hasBom: true };
    const calls = recordIPC(file);
    const result = await readText("C:\\f.csv");
    expect(result.text).toBe("\uFEFFa,b\r\nc,d\n");
    expect(calls).toEqual([{ cmd: "read_text", args: { path: "C:\\f.csv" } }]);
  });

  it("saveText passes the text through byte for byte", async () => {
    const calls = recordIPC();
    const text = "\uFEFFx:y\r\n\r\n  z \t\n\"q\"";
    await saveText("C:\\f.txt", text);
    expect(calls).toEqual([{ cmd: "save_text", args: { path: "C:\\f.txt", text } }]);
    expect((calls[0].args as { text: string }).text).toBe(text);
  });

  it("listBackups sends path", async () => {
    const calls = recordIPC([]);
    await listBackups("C:\\f.txt");
    expect(calls).toEqual([{ cmd: "list_backups", args: { path: "C:\\f.txt" } }]);
  });

  it("restoreBackup sends path and id", async () => {
    const calls = recordIPC();
    await restoreBackup("C:\\f.txt", "001790000000000");
    expect(calls).toEqual([
      { cmd: "restore_backup", args: { path: "C:\\f.txt", id: "001790000000000" } },
    ]);
  });

  it("createFile sends path and exact text", async () => {
    const calls = recordIPC();
    await createFile("C:\\m\\profile\\new.csv", "a,b\r\n");
    expect(calls).toEqual([{ cmd: "create_file", args: { path: "C:\\m\\profile\\new.csv", text: "a,b\r\n" } }]);
  });

  it("renameFile sends from and to", async () => {
    const calls = recordIPC();
    await renameFile("C:\\m\\a.csv", "C:\\m\\b.csv");
    expect(calls).toEqual([{ cmd: "rename_file", args: { from: "C:\\m\\a.csv", to: "C:\\m\\b.csv" } }]);
  });

  it("deleteFile sends path", async () => {
    const calls = recordIPC();
    await deleteFile("C:\\m\\a.csv");
    expect(calls).toEqual([{ cmd: "delete_file", args: { path: "C:\\m\\a.csv" } }]);
  });

  it("propagates backend errors", async () => {
    mockIPC(() => {
      throw "file is not valid UTF-8; not opened to avoid corrupting it";
    });
    await expect(readText("C:\\bad.csv")).rejects.toBe(
      "file is not valid UTF-8; not opened to avoid corrupting it",
    );
  });
});
