import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { confirmAction, showMessage } from "../../lib/dialogs";
import type { FileEntry } from "../../lib/fs";
import { getMakebotPath, getSites } from "../../lib/settings";
import { guardWindowClose } from "../../lib/window";
import { task, taskFile } from "../tasks/testing";

vi.mock("../../lib/settings", () => ({
  getMakebotPath: vi.fn(),
  setMakebotPath: vi.fn(),
  getShortcutOverrides: vi.fn(async () => ({})),
  setShortcutOverrides: vi.fn(async () => {}),
  getSites: vi.fn(),
  setSites: vi.fn(async () => {}),
}));
vi.mock("../../lib/dialogs", () => ({
  pickFolder: vi.fn(),
  confirmAction: vi.fn(),
  askSaveDiscardCancel: vi.fn(),
  showMessage: vi.fn(),
}));
vi.mock("../../lib/window", () => ({ guardWindowClose: vi.fn() }));

const ROOT = "C:\\Makebot";
const P = (name: string) => `${ROOT}\\proxy\\${name}`;
const A = "res.example.net:8000:user1:pa55";
const B = "10.0.0.2:3128";

let disk: Map<string, string>;
let writes: { cmd: string; args: Record<string, string> }[];

function backend(files: Record<string, string>, tasks: Record<string, string> = {}) {
  disk = new Map([
    ...Object.entries(files).map(([n, t]): [string, string] => [P(n), t]),
    ...Object.entries(tasks).map(([n, t]): [string, string] => [`${ROOT}\\task\\${n}`, t]),
  ]);
  writes = [];
  mockIPC((cmd, a) => {
    const args = a as Record<string, string>;
    switch (cmd) {
      case "list_files":
        return [...disk.keys()]
          .filter((p) => p.startsWith(args.dir + "\\") && p.endsWith("." + args.extension))
          .sort()
          .map((path): FileEntry => ({ name: path.slice(args.dir.length + 1), path, size: disk.get(path)!.length, modifiedMs: 1 }));
      case "read_text":
        if (!disk.has(args.path)) throw "The system cannot find the file specified. (os error 2)";
        return { text: disk.get(args.path)!, lineEnding: "crlf", hasBom: false };
      case "save_text":
        writes.push({ cmd, args });
        disk.set(args.path, args.text);
        return null;
      case "create_file":
        writes.push({ cmd, args });
        if (disk.has(args.path)) throw "The file exists. (os error 80)";
        disk.set(args.path, args.text);
        return null;
      case "rename_file":
        writes.push({ cmd, args });
        if (disk.has(args.to)) throw "The file exists. (os error 80)";
        disk.set(args.to, disk.get(args.from)!);
        disk.delete(args.from);
        return null;
      case "delete_file":
        writes.push({ cmd, args });
        disk.delete(args.path);
        return null;
      case "list_backups":
        return [];
      default:
        throw `unexpected command ${cmd}`;
    }
  });
}

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
  vi.mocked(confirmAction).mockReset().mockResolvedValue(true);
  vi.mocked(showMessage).mockReset();
  vi.mocked(getSites).mockResolvedValue([]);
});

const files = () => within(screen.getByRole("region", { name: "Files" }));
const fileButton = (name: string) => files().getByRole("button", { name: new RegExp(`^${name.replace(/\./g, "\\.")}`) });
const fileNames = () =>
  files()
    .queryAllByRole("button", { name: /\.txt/ })
    .map((b) => b.querySelector("span")!.firstChild!.textContent);
const menuItem = (name: string) => screen.getByRole("menuitem", { name }) as HTMLButtonElement;
const lastConfirm = () => vi.mocked(confirmAction).mock.calls[vi.mocked(confirmAction).mock.calls.length - 1][0];

async function showProxies() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
  await waitFor(() => expect(fileNames().length).toBeGreaterThan(0));
}

function rightClick(name: string) {
  fireEvent.contextMenu(fileButton(name), { clientX: 30, clientY: 40 });
  return screen.getByRole("menu", { name });
}

describe("proxy file right-click menu", () => {
  it("has Duplicate, Rename… and Delete…", async () => {
    backend({ "wealth.txt": A });
    await showProxies();
    const menu = rightClick("wealth.txt");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "Duplicate",
      "Rename…",
      "Delete…",
    ]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("only proxy files have it", async () => {
    backend({ "wealth.txt": A }, { "t.csv": taskFile([task()]) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
    const btn = await files().findByRole("button", { name: /^t\.csv/ });
    fireEvent.contextMenu(btn);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is disabled while the file has unsaved changes", async () => {
    backend({ "wealth.txt": `${A}\r\n${B}` });
    await showProxies();
    fireEvent.click(fileButton("wealth.txt"));
    await screen.findByRole("textbox", { name: "Proxy list" });
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    rightClick("wealth.txt");
    expect(screen.getByText("Save or discard its changes first.")).toBeTruthy();
    expect(["Duplicate", "Rename…", "Delete…"].map((n) => menuItem(n).disabled)).toEqual([true, true, true]);
  });
});

describe("duplicate", () => {
  it("copies the saved bytes exactly to '<name> copy.txt'", async () => {
    const text = `${A}\r\n${B}\r\n`;
    backend({ "wealth.txt": text });
    await showProxies();
    rightClick("wealth.txt");
    fireEvent.click(menuItem("Duplicate"));
    await waitFor(() => expect(fileNames()).toEqual(["wealth copy.txt", "wealth.txt"]));
    expect(disk.get(P("wealth copy.txt"))).toBe(text);
    expect(writes.map((w) => w.cmd)).toEqual(["create_file"]);
  });

  it("picks the next free name", async () => {
    backend({ "wealth.txt": A, "wealth copy.txt": B });
    await showProxies();
    rightClick("wealth.txt");
    fireEvent.click(menuItem("Duplicate"));
    await waitFor(() => expect(disk.get(P("wealth copy 2.txt"))).toBe(A));
    expect(disk.get(P("wealth copy.txt"))).toBe(B);
  });
});

describe("rename", () => {
  async function startRename(name: string) {
    rightClick(name);
    fireEvent.click(menuItem("Rename…"));
    return (await screen.findByRole("textbox", { name: "New name" })) as HTMLInputElement;
  }

  it("renames in place after confirming, warning about tasks that use it", async () => {
    backend(
      { "wealth.txt": A },
      { "a.csv": taskFile([task(), task({ proxy: "us" })]), "b.csv": taskFile([task(), task()]) },
    );
    await showProxies();
    const input = await startRename("wealth.txt");
    expect(input.value).toBe("wealth");
    fireEvent.change(input, { target: { value: "wealth-2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fileNames()).toEqual(["wealth-2.txt"]));
    expect(lastConfirm()).toContain("Rename proxy file wealth to wealth-2?");
    expect(lastConfirm()).toContain('3 tasks in 2 task files use "wealth" as the proxy group');
    expect(lastConfirm()).toContain("backed up first");
    expect(writes).toEqual([{ cmd: "rename_file", args: { from: P("wealth.txt"), to: P("wealth-2.txt") } }]);
  });

  it("no tasks using it, no task warning", async () => {
    backend({ "wealth.txt": A });
    await showProxies();
    const input = await startRename("wealth.txt");
    fireEvent.change(input, { target: { value: "w2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fileNames()).toEqual(["w2.txt"]));
    expect(lastConfirm()).not.toContain("task");
  });

  it("keeps the renamed file open", async () => {
    backend({ "wealth.txt": A });
    await showProxies();
    fireEvent.click(fileButton("wealth.txt"));
    await screen.findByRole("heading", { name: "wealth.txt" });
    const input = await startRename("wealth.txt");
    fireEvent.change(input, { target: { value: "w2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "w2.txt" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Proxy list" }) as HTMLTextAreaElement).value).toBe(A);
  });

  it("shows why a name can't be used and doesn't rename", async () => {
    backend({ "wealth.txt": A, "us.txt": B });
    await showProxies();
    const input = await startRename("wealth.txt");
    fireEvent.change(input, { target: { value: "US" } });
    expect(screen.getByText('A group named "us" already exists.')).toBeTruthy();
    fireEvent.change(input, { target: { value: "a:b" } });
    expect(screen.getByText(/can't contain/)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "New name" })).toBeTruthy();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("Escape cancels; an unchanged name does nothing", async () => {
    backend({ "wealth.txt": A });
    await showProxies();
    let input = await startRename("wealth.txt");
    fireEvent.change(input, { target: { value: "other" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New name" })).toBeNull();
    input = await startRename("wealth.txt");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "New name" })).toBeNull();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("saying no to the confirmation leaves it", async () => {
    backend({ "wealth.txt": A });
    vi.mocked(confirmAction).mockResolvedValue(false);
    await showProxies();
    const input = await startRename("wealth.txt");
    fireEvent.change(input, { target: { value: "w2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(writes).toEqual([]);
    expect(fileNames()).toEqual(["wealth.txt"]);
  });

  it("a failed rename says why", async () => {
    backend({ "wealth.txt": A });
    await showProxies();
    const input = await startRename("wealth.txt");
    fireEvent.change(input, { target: { value: "w2" } });
    disk.set(P("w2.txt"), "made elsewhere");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(showMessage).toHaveBeenCalledWith(expect.stringContaining("Rename failed"), "Rename"));
    expect(disk.get(P("wealth.txt"))).toBe(A);
  });
});

describe("delete", () => {
  it("asks with the proxy count and the tasks using it, then deletes (backed up by delete_file)", async () => {
    backend({ "wealth.txt": `${A}\r\n${B}\r\n`, "us.txt": B }, { "a.csv": taskFile([task()]) });
    await showProxies();
    rightClick("wealth.txt");
    fireEvent.click(menuItem("Delete…"));
    await waitFor(() => expect(fileNames()).toEqual(["us.txt"]));
    expect(lastConfirm()).toContain("Delete proxy file wealth (2 proxies)?");
    expect(lastConfirm()).toContain('1 task in 1 task file uses "wealth" as the proxy group');
    expect(lastConfirm()).toContain("backup is kept for 7 days");
    expect(writes).toEqual([{ cmd: "delete_file", args: { path: P("wealth.txt") } }]);
  });

  it("closes the file if it was open", async () => {
    backend({ "wealth.txt": A, "us.txt": B });
    await showProxies();
    fireEvent.click(fileButton("wealth.txt"));
    await screen.findByRole("heading", { name: "wealth.txt" });
    rightClick("wealth.txt");
    fireEvent.click(menuItem("Delete…"));
    expect(await screen.findByText("Select a proxy file.")).toBeTruthy();
  });

  it("saying no keeps it", async () => {
    backend({ "wealth.txt": A });
    vi.mocked(confirmAction).mockResolvedValue(false);
    await showProxies();
    rightClick("wealth.txt");
    fireEvent.click(menuItem("Delete…"));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(writes).toEqual([]);
    expect(fileNames()).toEqual(["wealth.txt"]);
  });
});
