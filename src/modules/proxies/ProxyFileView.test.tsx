import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
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
      case "read_text":
        return { text: disk.get(args.path)!, lineEnding: "crlf", hasBom: false };
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
});

const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const status = () => screen.getByRole("status").textContent ?? "";
const shown = () =>
  within(screen.getByRole("list", { name: "Proxy lines" }))
    .queryAllByRole("listitem")
    .map((li) => [li.querySelector(".ln")!.textContent, li.querySelector(".txt")!.textContent]);
const paste = (text: string) => fireEvent.change(screen.getByLabelText("Pasted proxies"), { target: { value: text } });
const lines = (text: string) => parseProxies(text).lines;

async function open(name: string) {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}`) }));
  await screen.findByRole("heading", { name });
  await screen.findByRole("list", { name: "Proxy lines" });
}

describe("proxy list and count", () => {
  it("lists every line, numbered, as written, and counts the proxies", async () => {
    backend({ "p.txt": `${A}\r\n${B}\r\n${C}` });
    await open("p.txt");
    expect(shown()).toEqual([
      ["1", A],
      ["2", B],
      ["3", C],
    ]);
    expect(status()).toContain("3 proxies");
    expect(status()).not.toContain("odd");
    expect(status()).not.toContain("Unsaved");
  });

  it("the count ignores blank lines and a final newline", async () => {
    backend({ "p.txt": `${A}\r\n\r\n${B}\r\n` });
    await open("p.txt");
    expect(status()).toContain("2 proxies");
  });

  it("one proxy, and localhost, is fine", async () => {
    backend({ "local.txt": "localhost" });
    await open("local.txt");
    expect(status()).toMatch(/^1 proxy\b/);
    expect(status()).not.toContain("odd");
  });

  it("an empty file says so", async () => {
    backend({ "e.txt": "" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
    fireEvent.click(await screen.findByRole("button", { name: /^e\.txt/ }));
    expect(await screen.findByText("The file is empty.")).toBeTruthy();
    expect(status()).toContain("0 proxies");
    expect(btn("Shuffle").disabled).toBe(true);
  });

  it("a big file counts every line but only draws the visible ones", async () => {
    const many = Array.from({ length: 10000 }, (_, i) => `h${i}.example:80:u:p`).join("\r\n");
    backend({ "big.txt": many });
    await open("big.txt");
    expect(status()).toContain("10,000 proxies");
    expect(shown().length).toBeLessThan(200);
    expect(shown()[0]).toEqual(["1", "h0.example:80:u:p"]);
  });

  it("marks odd lines and can show only them", async () => {
    backend({ "p.txt": `${A}\r\nnot a proxy\r\n${B}\r\nh:80:u` });
    await open("p.txt");
    expect(status()).toContain("4 proxies · 2 odd lines");
    const rows = within(screen.getByRole("list", { name: "Proxy lines" })).getAllByRole("listitem");
    expect(rows[1].className).toContain("odd");
    expect(rows[1].getAttribute("title")).toMatch(/space/);
    expect(rows[0].className).not.toContain("odd");
    fireEvent.click(screen.getByLabelText(/Only odd lines/));
    expect(shown()).toEqual([
      ["2", "not a proxy"],
      ["4", "h:80:u"],
    ]);
  });

  it("the sidebar says Select a proxy file with none open", async () => {
    backend({ "p.txt": A });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
    expect(await screen.findByText("Select a proxy file.")).toBeTruthy();
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
    const after = shown().map((r) => r[1]);
    expect(after).not.toEqual([A, B, C]);
    expect([...after].sort()).toEqual([A, B, C].sort());
    // Listed under unsaved changes and marked in the file list.
    const changes = screen.getByRole("region", { name: "Unsaved changes" });
    expect(within(changes).getByRole("button", { name: "M proxy/p.txt" })).toBeTruthy();

    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves.length).toBe(1));
    const written = saves[0].text;
    expect(lines(written)).toEqual(after);
    expect(written).toMatch(/^[^\n]+\r\n[^\n]+\r\n[^\n]+\r\n$/);
    await waitFor(() => expect(status()).toContain("Saved"));
    expect(status()).not.toContain("Unsaved");
  });

  it("keeps a missing final newline", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves.length).toBe(1));
    expect(saves[0].text).toBe(`${B}\r\n${A}`);
  });

  it("is off with fewer than 2 proxies", async () => {
    backend({ "p.txt": `${A}\r\n` });
    await open("p.txt");
    expect(btn("Shuffle").disabled).toBe(true);
  });

  it("Discard changes goes back to the file", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    fireEvent.click(btn("Discard changes"));
    await waitFor(() => expect(status()).not.toContain("Unsaved"));
    expect(shown().map((r) => r[1])).toEqual([A, B]);
    expect(saves).toEqual([]);
  });
});

describe("paste a list", () => {
  it("Replace makes the pasted list the whole file, trimmed, blank lines dropped", async () => {
    backend({ "p.txt": `${A}\r\n${B}\r\n` });
    await open("p.txt");
    expect(btn("Replace").disabled).toBe(true);
    paste(`  ${C}  \n\n${B}\n`);
    expect(screen.getByRole("region", { name: "Paste a list" }).textContent).toContain("2 proxies");
    fireEvent.click(btn("Replace"));
    expect(shown()).toEqual([
      ["1", C],
      ["2", B],
    ]);
    expect(status()).toContain("2 proxies");
    expect(status()).toContain("Replaced the list with 2 proxies");
    expect((screen.getByLabelText("Pasted proxies") as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves.length).toBe(1));
    expect(saves[0].text).toBe(`${C}\r\n${B}\r\n`);
  });

  it("Append adds to the end and keeps every existing byte", async () => {
    backend({ "p.txt": `${A}\r\n${B}` });
    await open("p.txt");
    paste(`${C}\r\nlocalhost`);
    fireEvent.click(btn("Append"));
    expect(status()).toContain("4 proxies");
    expect(status()).toContain("Added 2 proxies to the end");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves.length).toBe(1));
    expect(saves[0].text).toBe(`${A}\r\n${B}\r\n${C}\r\nlocalhost`);
  });

  it("a paste of only blank lines can't be applied", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    paste("  \n\r\n");
    expect(btn("Replace").disabled).toBe(true);
    expect(btn("Append").disabled).toBe(true);
  });

  it("warns on odd pasted lines (by line in the box) but still applies them", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    paste(`${B}\n\nbad line\nh:99999`);
    const region = screen.getByRole("region", { name: "Paste a list" });
    expect(region.textContent).toContain("3 proxies · 2 odd lines");
    const odd = within(screen.getByRole("list", { name: "Odd pasted lines" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(odd).toEqual([expect.stringMatching(/^Line 3: .*space/), expect.stringMatching(/^Line 4: .*port/)]);
    fireEvent.click(btn("Replace"));
    expect(status()).toContain("3 proxies · 2 odd lines");
    expect(btn("Save").disabled).toBe(false);
  });

  it("lists at most 10 odd pasted lines", async () => {
    backend({ "p.txt": A });
    await open("p.txt");
    paste(Array.from({ length: 15 }, (_, i) => `bad${i}`).join("\n"));
    const items = within(screen.getByRole("list", { name: "Odd pasted lines" })).getAllByRole("listitem");
    expect(items.length).toBe(11);
    expect(items[10].textContent).toBe("…and 5 more");
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
    expect(vi.mocked(askSaveDiscardCancel).mock.calls[0][0]).toContain("p.txt");
    await waitFor(() => expect(status()).not.toContain("Unsaved"));
    expect(saves).toEqual([]);
  });

  it("opening a changed proxy file from the Changes panel shows it", async () => {
    backend({ "p.txt": `${A}\r\n${B}`, "q.txt": C });
    await open("p.txt");
    fireEvent.click(btn("Shuffle"));
    fireEvent.click(screen.getByRole("button", { name: /^q\.txt/ }));
    await screen.findByRole("heading", { name: "q.txt" });
    const changes = screen.getByRole("region", { name: "Unsaved changes" });
    fireEvent.click(within(changes).getByRole("button", { name: "M proxy/p.txt" }));
    await screen.findByRole("heading", { name: "p.txt" });
    expect(status()).toContain("Unsaved changes");
  });

  it("a backup is staged as unsaved changes, not written", async () => {
    backend({ "p.txt": `${A}\r\n` }, { b1: `${B}\r\n${C}\r\n` });
    await open("p.txt");
    fireEvent.click(btn("Backups ▾"));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(status()).toContain("Unsaved changes"));
    expect(status()).toContain("2 proxies");
    expect(saves).toEqual([]);
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves.length).toBe(1));
    expect(saves[0].text).toBe(`${B}\r\n${C}\r\n`);
  });
});
