import { act, renderHook, waitFor } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../lib/fs";
import { useDiskCounts, useTextCounter } from "./useFileCounts";

const file = (name: string, modifiedMs = 1, size = 10): FileEntry => ({ name, path: `D:/${name}`, size, modifiedMs });
const lines = (text: string) => (text === "" ? 0 : text.split("\n").length);

function disk(texts: Record<string, string | Error>) {
  const reads: string[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "read_text") throw `unexpected command ${cmd}`;
    const path = (args as { path: string }).path;
    reads.push(path);
    const t = texts[path];
    if (t instanceof Error) throw t.message;
    return { text: t, lineEnding: "lf", hasBom: false };
  });
  return reads;
}

describe("useDiskCounts", () => {
  it("counts each file as saved on disk", async () => {
    disk({ "D:/a.txt": "1\n2\n3", "D:/b.txt": "" });
    const files = [file("a.txt"), file("b.txt")];
    const { result } = renderHook(() => useDiskCounts(files, lines));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("D:/a.txt")).toBe(3);
    expect(result.current.get("D:/b.txt")).toBe(0);
  });

  it("doesn't read while disabled", async () => {
    const reads = disk({ "D:/a.txt": "1" });
    const files = [file("a.txt")];
    const { result, rerender } = renderHook(({ on }) => useDiskCounts(files, lines, on), {
      initialProps: { on: false },
    });
    await act(async () => {});
    expect(reads).toEqual([]);
    expect(result.current.size).toBe(0);
    rerender({ on: true });
    await waitFor(() => expect(result.current.get("D:/a.txt")).toBe(1));
  });

  it("reads a file again only when its size or modified time changes", async () => {
    const texts: Record<string, string> = { "D:/a.txt": "1", "D:/b.txt": "1\n2" };
    const reads = disk(texts);
    const { result, rerender } = renderHook(({ files }) => useDiskCounts(files, lines), {
      initialProps: { files: [file("a.txt"), file("b.txt")] },
    });
    await waitFor(() => expect(result.current.size).toBe(2));

    // Listed again, unchanged: nothing is read.
    rerender({ files: [file("a.txt"), file("b.txt")] });
    await act(async () => {});
    expect(reads).toEqual(["D:/a.txt", "D:/b.txt"]);

    texts["D:/a.txt"] = "1\n2\n3\n4";
    rerender({ files: [file("a.txt", 2), file("b.txt")] });
    // The old count isn't shown for the changed file while it's read.
    expect(result.current.has("D:/a.txt")).toBe(false);
    await waitFor(() => expect(result.current.get("D:/a.txt")).toBe(4));
    expect(result.current.get("D:/b.txt")).toBe(2);
    expect(reads).toEqual(["D:/a.txt", "D:/b.txt", "D:/a.txt"]);
  });

  it("leaves out files that can't be read, and drops files no longer listed", async () => {
    disk({ "D:/a.txt": "1", "D:/bad.txt": new Error("Access is denied.") });
    const { result, rerender } = renderHook(({ files }) => useDiskCounts(files, lines), {
      initialProps: { files: [file("a.txt"), file("bad.txt")] },
    });
    await waitFor(() => expect(result.current.get("D:/a.txt")).toBe(1));
    expect(result.current.has("D:/bad.txt")).toBe(false);
    rerender({ files: [file("bad.txt")] });
    expect(result.current.size).toBe(0);
  });
});

describe("useTextCounter", () => {
  it("counts text again only when it changes", () => {
    const count = vi.fn(lines);
    const { result } = renderHook(() => useTextCounter(count));
    expect(result.current("D:/a.txt", "1\n2")).toBe(2);
    expect(result.current("D:/a.txt", "1\n2")).toBe(2);
    expect(count).toHaveBeenCalledTimes(1);
    expect(result.current("D:/a.txt", "1\n2\n3")).toBe(3);
    expect(result.current("D:/b.txt", "1\n2\n3")).toBe(3);
    expect(count).toHaveBeenCalledTimes(3);
  });
});
