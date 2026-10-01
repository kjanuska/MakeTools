import { fileItem } from "../../test/fileList";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { PENDING_MS } from "./ProxyFileView";
import { askSaveDiscardCancel, confirmAction } from "../../lib/dialogs";
import { parseProxies } from "../../lib/formats/proxies";
import type { FileEntry } from "../../lib/fs";
import { getMakebotPath, getSites } from "../../lib/settings";
import { guardWindowClose } from "../../lib/window";

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
const C = "res.example.org:9000:u2:p2";

let disk: Map<string, string>;
let saves: { path: string; text: string }[];
/** While set, reads of proxy files wait for it (to see the loading state). */
let readGate: Promise<void> | null = null;

function backend(files: Record<string, string>, backups: Record<string, string> = {}) {
  disk = new Map(Object.entries(files).map(([n, t]) => [P(n), t]));
  saves = [];
  mockIPC((cmd, a) => {
    const args = a as Record<string, string>;
    switch (cmd) {
      case "list_files":
        return [...disk.keys()]
          .filter((p) => p.startsWith(args.dir + "\\") && p.endsWith("." + args.extension))
          .sort()
          .map((path): FileEntry => ({ name: path.slice(args.dir.length + 1), path, size: disk.get(path)!.length, modifiedMs: 1 }));
      case "read_text": {
        const result = () => ({ text: disk.get(args.path)!, lineEnding: "crlf", hasBom: false });
        return readGate && args.path.startsWith(P("")) ? readGate.then(result) : result();
      }
      case "save_text":
        saves.push({ path: args.path, text: args.text });
        disk.set(args.path, args.text);
        return null;
      case "list_backups":
        return Object.keys(backups).map((id) => ({ id, createdMs: 1_700_000_000_000, size: backups[id].length }));
      case "read_backup":
        return { text: backups[args.id], lineEnding: "crlf", hasBom: false };
      default:
        throw `unexpected command ${cmd}`;
    }
  });
}

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.mocked(getSites).mockResolvedValue([]);
  readGate = null;
});

const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const status = () => screen.getByRole("status").textContent ?? "";
const editor = () => screen.getByRole("textbox", { name: "Proxy list" }) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(editor(), { target: { value } });
const gutter = () => document.querySelector(".proxy-gutter")!.textContent;
const lines = (text: string) => parseProxies(text).lines;

async function open(name: string) {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
  fireEvent.click(await screen.findByRole("button", { name: fileItem(name) }));
  await screen.findByRole("heading", { name: name.replace(/\.\w+$/, "") });
  await screen.findByRole("textbox", { name: "Proxy list" });
  await settled();
}

/** Waits until the count and odd lines have caught up with the text. */
async function settled() {
  await waitFor(() => expect(screen.getByRole("status").getAttribute("aria-busy")).toBeNull());
}

async function saved(): Promise<string> {
  fireEvent.click(btn("Save"));
  await waitFor(() => expect(saves.length).toBe(1));
  return saves[0].text;
}

describe("proxy list and count", () => {
  it("shows the file in an editable box with line numbers, and counts the proxies", async () => {
    backend({ "p.txt": `${A}\r\n${B}\r\n${C}` });
    await open("p.txt");
    expect(editor().value).toBe(`${A}\n${B}\n${C}`);
    expect(gutter()).toBe("1\n2\n3");
    expect(status()).toContain("3 proxies");
    expect(status()).not.toContain("odd");
    expect(status()).not.toContain("Unsaved");
  });

  it("the count ignores blank lines and a final newline", async () => {
    backend({ "p.txt": `${A}\r\n\r\n${B}\r\n` });
    await open("p.txt");
    expect(status()).toContain("2 proxies");
    // The empty line after the final line ending is numbered, like any editor.
    expect(gutter()).toBe("1\n2\n3\n4");
  });

  it("one proxy, and localhost, is fine", async () => {
    backend({ "local.txt": "localhost" });
    await open("local.txt");
    expect(status()).toMatch(/^1 proxy\b/);
    expect(status()).not.toContain("odd");
  });

  it("an empty file shows an empty editor", async () => {
    backend({ "e.txt": "" });
    await open("e.txt");
    expect(editor().value).toBe("");
    expect(status()).toContain("0 proxies");
    expect(btn("Shuffle").disabled).toBe(true);
  });

  it("a big file loads whole and counts every line", async () => {
    const many = Array.from({ length: 10000 }, (_, i) => `h${i}.example:80:u:p`).join("\r\n");
    backend({ "big.txt": many });
    await open("big.txt");
    expect(status()).toContain("10,000 proxies");
    expect(editor().value.split("\n").length).toBe(10000);
  });

  it("lists odd lines; clicking one selects it in the editor", async () => {
    backend({ "p.txt": `${A}\r\nnot a proxy\r\n${B}\r\nh:80:u` });
    await open("p.txt");
    expect(status()).toContain("4 proxies · 2 odd lines");
    const region = screen.getByRole("region", { name: "Odd lines" });
    const items = within(region).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([expect.stringMatching(/^Line 2: .*space/), expect.stringMatching(/^Line 4: .*3 parts/)]);
    fireEvent.click(within(region).getByRole("button", { name: "Line 4" }));
    const e = editor();
    expect(e.value.slice(e.selectionStart, e.selectionEnd)).toBe("h:80:u");
    expect(document.activeElement).toBe(e);
  });

  it("lists at most 100 odd lines", async () => {
    backend({ "p.txt": Array.from({ length: 105 }, (_, i) => `bad${i}`).join("\r\n") });
    await open("p.txt");
    const items = within(screen.getByRole("region", { name: "Odd lines" })).getAllByRole("listitem");
    expect(items.length).toBe(101);
    expect(items[100].textContent).toBe("…and 5 more");
  });

  it("no odd lines, no odd-lines list", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    expect(screen.queryByRole("region", { name: "Odd lines" })).toBeNull();
  });

  it("the sidebar says Select a proxy file with none open", async () => {
    backend({ "p.txt": A });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
    expect(await screen.findByText("Select a proxy file.")).toBeTruthy();
  });
});

describe("editing the list", () => {
  it("typing makes unsaved changes; Save writes them with the file's CRLF", async () => {
    backend({ "p.txt": `${A}\r\n${B}\r\n` });
    await open("p.txt");
    type(`${A}\n${C}\n`);
    expect(status()).toContain("Unsaved changes");
    expect(saves).toEqual([]);
    expect(await saved()).toBe(`${A}\r\n${C}\r\n`);
    await waitFor(() => expect(status()).toContain("Saved"));
    expect(status()).not.toContain("Unsaved");
  });

  it("pasting at the end appends and keeps every existing byte", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    type(`${editor().value}\n${C}\nlocalhost`);
    expect(status()).toContain("4 proxies");
    expect(await saved()).toBe(`${A}\r\n${B}\r\n${C}\r\nlocalhost`);
  });

  it("pasting over everything replaces the list", async () => {
    backend({ "p.txt": `${A}\r\n${B}\r\n` });
    await open("p.txt");
    type(`${C}\n`);
    expect(status()).toContain("1 proxy");
    expect(await saved()).toBe(`${C}\r\n`);
  });

  it("keeps an LF file's LF and a BOM", async () => {
    backend({ "p.txt": `﻿${A}\n${B}\n` });
    await open("p.txt");
    expect(editor().value).toBe(`${A}\n${B}\n`);
    type(`${B}\n${A}\n${C}\n`);
    expect(await saved()).toBe(`﻿${B}\n${A}\n${C}\n`);
  });

  it("typing text back to what's on disk is no longer a change", async () => {
    backend({ "p.txt": `${A}\n${B}\r\n` });
    await open("p.txt");
    type(`${A}\n`);
    expect(status()).toContain("Unsaved changes");
    type(`${A}\n${B}\n`);
    expect(status()).not.toContain("Unsaved");
    expect(btn("Save").disabled).toBe(true);
  });

  it("odd lines update as you type; they can still be saved", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    type(`${A}\nh:99999`);
    expect(status()).toContain("2 proxies · 1 odd line");
    expect(within(screen.getByRole("region", { name: "Odd lines" })).getByText(/port must be a number/)).toBeTruthy();
    expect(await saved()).toBe(`${A}\r\nh:99999`);
  });

  it("Discard changes puts the file back in the editor", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    type("x:1");
    fireEvent.click(btn("Discard changes"));
    await waitFor(() => expect(status()).not.toContain("Unsaved"));
    expect(editor().value).toBe(`${A}\n${B}`);
    expect(saves).toEqual([]);
  });
});

describe("shuffle", () => {
  it("reorders the lines as unsaved changes; Save writes them with the same line endings", async () => {
    const text = `${A}\r\n${B}\r\n${C}\r\n`;
    backend({ "p.txt": text });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    expect(status()).toContain("Unsaved changes");
    expect(status()).toContain("Shuffled 3 proxies");
    expect(saves).toEqual([]);
    const after = lines(editor().value);
    expect(after).not.toEqual([A, B, C]);
    expect([...after].sort()).toEqual([A, B, C].sort());
    const changes = screen.getByRole("region", { name: "Unsaved changes" });
    expect(within(changes).getByRole("button", { name: "M proxy/p" })).toBeTruthy();

    const written = await saved();
    expect(lines(written)).toEqual(after);
    expect(written).toMatch(/^[^\n]+\r\n[^\n]+\r\n[^\n]+\r\n$/);
  });

  it("keeps a missing final newline", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    expect(await saved()).toBe(`${B}\r\n${A}`);
  });

  it("shuffles what's in the editor, including unsaved edits", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    type(`${A}\n${C}`);
    fireEvent.click(btn("Shuffle"));
    expect(editor().value).toBe(`${C}\n${A}`);
  });

  it("is off with fewer than 2 proxies", async () => {
    backend({ "p.txt": `${A}\r\n` });
    await open("p.txt");
    expect(btn("Shuffle").disabled).toBe(true);
  });
});

describe("saving with the rest of the app", () => {
  it("Save all saves proxy files", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    const changes = screen.getByRole("region", { name: "Unsaved changes" });
    fireEvent.click(within(changes).getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(saves.length).toBe(1));
    expect(saves[0]).toEqual({ path: P("p.txt"), text: `${B}\r\n${A}` });
    await waitFor(() => expect(within(changes).getByText("Saved 1 file.")).toBeTruthy());
  });

  it("closing with unsaved proxy changes asks; Discard drops them", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    vi.mocked(askSaveDiscardCancel).mockResolvedValue("discard");
    const closeCalls = vi.mocked(guardWindowClose).mock.calls;
    const onClose = closeCalls[closeCalls.length - 1][0];
    expect(await onClose()).toBe(true);
    expect(vi.mocked(askSaveDiscardCancel).mock.calls[0][0]).toContain("\n  p\n");
    await waitFor(() => expect(status()).not.toContain("Unsaved"));
    expect(saves).toEqual([]);
  });

  it("opening a changed proxy file from the Changes panel shows it", async () => {
    backend({ "p.txt": `${A}\r\n${B}`, "q.txt": C });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    fireEvent.click(screen.getByRole("button", { name: fileItem("q") }));
    await screen.findByRole("heading", { name: "q" });
    const changes = screen.getByRole("region", { name: "Unsaved changes" });
    fireEvent.click(within(changes).getByRole("button", { name: "M proxy/p" }));
    await screen.findByRole("heading", { name: "p" });
    expect(status()).toContain("Unsaved changes");
  });

  it("a backup is staged as unsaved changes, not written", async () => {
    backend({ "p.txt": `${A}\r\n` }, { b1: `${B}\r\n${C}\r\n` });
    await open("p.txt");
    fireEvent.click(btn("Backups ▾"));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(status()).toContain("Unsaved changes"));
    await settled();
    expect(status()).toContain("2 proxies");
    expect(saves).toEqual([]);
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves.length).toBe(1));
    expect(saves[0].text).toBe(`${B}\r\n${C}\r\n`);
  });
});

describe("big files stay responsive", () => {
  const changes = () => screen.getByRole("region", { name: "Unsaved changes" });
  const listed = () => within(changes()).queryByRole("button", { name: "M proxy/p" });

  it("shows a spinner while the file is being read", async () => {
    let release!: () => void;
    readGate = new Promise((r) => (release = r));
    backend({ "p.txt": `${A}\r\n${B}` });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
    fireEvent.click(await screen.findByRole("button", { name: fileItem("p") }));
    expect(await screen.findByText("Loading p…")).toBeTruthy();
    expect(document.querySelector(".loading .spinner")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Proxy list" })).toBeNull();
    release();
    expect(await screen.findByRole("textbox", { name: "Proxy list" })).toBeTruthy();
    expect(screen.queryByText("Loading p…")).toBeNull();
    await settled();
    expect(status()).toContain("2 proxies");
  });

  it("the count catches up with typing (busy, then the new count)", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    type(`${A}\n${B}\n${C}`);
    await settled();
    expect(status()).toContain("3 proxies");
    expect(document.querySelector(".editor-status .spinner")).toBeNull();
  });

  it("typing shows as unsaved at once but reaches the store after a pause", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    type(`${A}\n${B}`);
    expect(status()).toContain("Unsaved changes");
    expect(listed()).toBeNull();
    await waitFor(() => expect(listed()).toBeTruthy(), { timeout: PENDING_MS + 1000 });
  });

  it("leaving the editor passes the text on straight away", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    type(`${A}\n${B}`);
    fireEvent.blur(editor());
    expect(listed()).toBeTruthy();
  });

  it("Save all right after typing saves what was typed", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    // Show the Save all button (it appears once something is unsaved).
    type(`${A}\nx:1`);
    fireEvent.blur(editor());
    type(`${A}\n${B}`);
    fireEvent.click(within(changes()).getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(saves.length).toBe(1));
    expect(saves[0].text).toBe(`${A}\r\n${B}`);
  });

  it("closing right after typing asks about the file", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    type(`${A}\n${B}`);
    vi.mocked(askSaveDiscardCancel).mockResolvedValue("cancel");
    const calls = vi.mocked(guardWindowClose).mock.calls;
    expect(await calls[calls.length - 1][0]()).toBe(false);
    expect(vi.mocked(askSaveDiscardCancel).mock.calls[0][0]).toContain("\n  p\n");
  });

  it("switching files right after typing keeps what was typed", async () => {
    backend({ "p.txt": A, "q.txt": C });
    await open("p.txt");
    type(`${A}\n${B}`);
    fireEvent.click(screen.getByRole("button", { name: fileItem("q") }));
    await screen.findByRole("heading", { name: "q" });
    expect(listed()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: fileItem("p") }));
    await screen.findByRole("heading", { name: "p" });
    expect(editor().value).toBe(`${A}\n${B}`);
  });

  it("Save and Discard right after typing use what was typed", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    type(`${A}\n${B}`);
    fireEvent.click(btn("Discard changes"));
    await waitFor(() => expect(editor().value).toBe(A));
    expect(status()).not.toContain("Unsaved");
    type(`${A}\n${C}`);
    expect(await saved()).toBe(`${A}\r\n${C}`);
  });

  it("a backup restored right after typing replaces what was typed", async () => {
    backend({ "p.txt": A }, { b1: `${B}\r\n` });
    await open("p.txt");
    type(`${A}\nx:1`);
    fireEvent.click(btn("Backups ▾"));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(editor().value).toBe(`${B}\n`));
    // Typing again after the restore is kept.
    type(`${B}\n${C}`);
    expect(await saved()).toBe(`${B}\r\n${C}`);
  });
});
