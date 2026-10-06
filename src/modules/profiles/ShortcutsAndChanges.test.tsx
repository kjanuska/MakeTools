import { fileItem } from "../../test/fileList";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { confirmAction } from "../../lib/dialogs";
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import type { FileEntry } from "../../lib/fs";
import { getMakebotPath, getShortcutOverrides, setShortcutOverrides } from "../../lib/settings";
import { guardWindowClose } from "../../lib/window";

vi.mock("../../lib/settings", () => ({
  getMakebotPath: vi.fn(),
  setMakebotPath: vi.fn(),
  getShortcutOverrides: vi.fn(async () => ({})),
  setShortcutOverrides: vi.fn(async () => {}),
  getSites: vi.fn(async () => ["kith.com"]),
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
const DIR = `${ROOT}\\profile`;
const H = PROFILE_HEADER;

const row = (name: string, o: { city?: string; zip?: string } = {}) =>
  `${name},Jane,Doe,jane${name}@example.com,101 Main St,,${o.city ?? "Springfield"},IL,${o.zip ?? "62701"},US,2175550100,4111111111111111,01,28,123`;
const GOOD = `${H}\r\n${row("1")}\r\n${row("2", { city: "Chicago" })}\r\n${row("3", { city: "Peoria" })}\r\n`;

const BACKUPS = [
  { id: "001790000500000", createdMs: 1_790_000_500_000, size: 300 },
  { id: "001790000000000", createdMs: 1_790_000_000_000, size: 200 },
];

type Args = Record<string, unknown>;

function backend(files: Record<string, string>, backups: Record<string, string> = {}) {
  const disk = new Map(Object.entries(files).map(([n, t]) => [`${DIR}\\${n}`, t]));
  const calls: { cmd: string; args: Args }[] = [];
  const handlers: Record<string, (a: Args) => unknown> = {
    list_files: ({ dir }) =>
      dir === DIR
        ? [...disk.keys()].map(
            (path): FileEntry => ({ name: path.slice(DIR.length + 1), path, size: disk.get(path)!.length, modifiedMs: 1 }),
          )
        : [],
    read_text: ({ path }) => ({ text: disk.get(path as string)!, lineEnding: "crlf", hasBom: false }),
    save_text: ({ path, text }) => {
      disk.set(path as string, text as string);
      return null;
    },
    list_backups: () => BACKUPS,
    read_backup: ({ id }) => ({ text: backups[id as string], lineEnding: "crlf", hasBom: false }),
  };
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: args as Args });
    const h = handlers[cmd];
    if (!h) throw `unexpected command ${cmd}`;
    return h(args as Args);
  });
  const callsOf = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);
  return { disk, callsOf };
}

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
  vi.mocked(confirmAction).mockResolvedValue(true);
});

async function open(name = "g.csv") {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
  fireEvent.click(await screen.findByRole("button", { name: fileItem(name) }));
  await screen.findByRole("heading", { name: name.replace(/\.\w+$/, "") });
  await screen.findByLabelText("Row 1 profileName");
}

const cell = (n: number, field: string) => screen.getByLabelText(`Row ${n} ${field}`) as HTMLInputElement;
const td = (n: number, field: string) => cell(n, field).parentElement!;
const type = (n: number, field: string, value: string) => fireEvent.change(cell(n, field), { target: { value } });
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const clickRow = (n: number, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) =>
  fireEvent.click(screen.getByRole("rowheader", { name: `Row ${n}` }), mods);
const selectedRows = () =>
  screen
    .getAllByRole("row")
    .filter((r) => r.getAttribute("aria-selected") === "true")
    .map((r) => within(r).getByRole("rowheader").textContent);
const status = () => screen.getByRole("status").textContent ?? "";
const press = (key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ...mods });

describe("changed cells", () => {
  it("marks an edited cell and shows its previous value on hover", async () => {
    backend({ "g.csv": GOOD });
    await open();
    expect(td(2, "city").className).not.toContain("changed");
    type(2, "city", "Rockford");
    expect(td(2, "city").className).toContain("changed");
    expect(cell(2, "city").title).toBe("Was: Chicago");
    expect(td(2, "zipcode").className).not.toContain("changed");
    type(2, "city", "Chicago");
    expect(td(2, "city").className).not.toContain("changed");
    expect(cell(2, "city").title).toBe("");
  });

  it("an empty previous value shows as (empty); errors come first", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(1, "address2", "Apt 1");
    expect(cell(1, "address2").title).toBe("Was: (empty)");
    type(1, "zipcode", "1");
    expect(cell(1, "zipcode").title).toBe("zipcode must be exactly 5 digits\nWas: 62701");
  });

  it("marks new rows, not their cells", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(btn("Add row"));
    const tr = cell(4, "profileName").closest("tr")!;
    expect(tr.className).toContain("new-row");
    expect(screen.getByRole("rowheader", { name: "Row 4" }).title).toBe("New row (not saved yet)");
    expect(td(4, "profileName").className).not.toContain("changed");
    expect(cell(1, "profileName").closest("tr")!.className).not.toContain("new-row");
  });

  it("marks clear after saving or discarding", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(status()).toContain("Saved."));
    expect(td(1, "city").className).not.toContain("changed");
    type(1, "city", "Chicago");
    fireEvent.click(btn("Discard changes"));
    await waitFor(() => expect(td(1, "city").className).not.toContain("changed"));
    expect(cell(1, "city").value).toBe("Rockford");
  });

  it("marks survive switching to another file and back", async () => {
    backend({ "g.csv": GOOD, "h.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(screen.getByRole("button", { name: fileItem("h") }));
    await screen.findByRole("heading", { name: "h" });
    fireEvent.click(screen.getByRole("button", { name: fileItem("g") }));
    await screen.findByRole("heading", { name: "g" });
    expect(td(1, "city").className).toContain("changed");
  });
});

describe("row header clicks", () => {
  it("clicking the only selected row deselects it", async () => {
    backend({ "g.csv": GOOD });
    await open();
    clickRow(2);
    expect(selectedRows()).toEqual(["2"]);
    clickRow(2);
    expect(selectedRows()).toEqual([]);
  });

  it("with several selected, a plain click selects just that row", async () => {
    backend({ "g.csv": GOOD });
    await open();
    clickRow(1);
    clickRow(3, { shiftKey: true });
    clickRow(2);
    expect(selectedRows()).toEqual(["2"]);
  });
});

describe("keyboard shortcuts in a group", () => {
  it("Ctrl+A selects all rows when not editing a cell", async () => {
    backend({ "g.csv": GOOD });
    await open();
    press("a", { ctrlKey: true });
    expect(selectedRows()).toEqual(["1", "2", "3"]);
    press("Escape");
    expect(selectedRows()).toEqual([]);
    press("a", { ctrlKey: true }, screen.getByRole("rowheader", { name: "Row 2" }));
    expect(selectedRows()).toEqual(["1", "2", "3"]);
  });

  it("Ctrl+A in a cell being edited is left to the cell (selects its text)", async () => {
    backend({ "g.csv": GOOD });
    await open();
    expect(press("a", { ctrlKey: true }, cell(2, "city"))).toBe(true); // not prevented
    expect(selectedRows()).toEqual([]);
  });

  it("Ctrl+A in a text box outside the grid is left to the text box", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(btn("Paste rows"));
    const e = press("a", { ctrlKey: true }, screen.getByLabelText("Rows to paste"));
    expect(e).toBe(true); // not prevented
    expect(selectedRows()).toEqual([]);
  });

  it("Ctrl+S saves the file, only when allowed", async () => {
    const { disk, callsOf } = backend({ "g.csv": GOOD });
    await open();
    press("s", { ctrlKey: true });
    expect(callsOf("save_text")).toEqual([]);
    type(1, "zipcode", "1");
    press("s", { ctrlKey: true }, cell(1, "zipcode"));
    expect(callsOf("save_text")).toEqual([]);
    type(1, "zipcode", "62702");
    press("s", { ctrlKey: true }, cell(1, "zipcode"));
    await waitFor(() => expect(status()).toContain("Saved."));
    expect(disk.get(`${DIR}\\g.csv`)).toBe(GOOD.replace("62701", "62702"));
  });

  it("Ctrl+N adds a row and puts the cursor in it", async () => {
    backend({ "g.csv": GOOD });
    await open();
    press("n", { ctrlKey: true });
    expect(cell(4, "profileName").value).toBe("4");
    await waitFor(() => expect(document.activeElement).toBe(cell(4, "firstName")));
  });

  it("Ctrl+D, Alt+ArrowUp/Down and Ctrl+Delete act on the selection", async () => {
    backend({ "g.csv": GOOD });
    await open();
    clickRow(3);
    press("ArrowUp", { altKey: true });
    expect(cell(2, "profileName").value).toBe("3");
    press("ArrowDown", { altKey: true });
    expect(cell(3, "profileName").value).toBe("3");
    press("d", { ctrlKey: true });
    expect(cell(4, "city").value).toBe("Peoria");
    clickRow(4);
    press("Delete", { ctrlKey: true });
    expect(screen.queryByLabelText("Row 4 profileName")).toBeNull();
  });

  it("Ctrl+B goes to the bulk edit value; Ctrl+T, Ctrl+Shift+V and Ctrl+M open their panels", async () => {
    backend({ "g.csv": GOOD });
    await open();
    press("b", { ctrlKey: true });
    expect(document.activeElement).toBe(within(screen.getByRole("region", { name: "Bulk edit" })).getByLabelText("New value"));
    press("t", { ctrlKey: true });
    expect(screen.getByRole("region", { name: "Create from template" })).toBeTruthy();
    press("V", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Rows to paste"));
    press("m", { ctrlKey: true });
    expect(screen.getByRole("region", { name: "Move or copy to group" })).toBeTruthy();
  });

  it("Alt+ArrowLeft goes back to all groups; Ctrl+F opens the search", async () => {
    backend({ "g.csv": GOOD });
    await open();
    press("ArrowLeft", { altKey: true });
    await screen.findByRole("heading", { name: "Profile groups" });
    fireEvent.click(screen.getByRole("button", { name: fileItem("g") }));
    await screen.findByRole("heading", { name: "g" });
    press("f", { ctrlKey: true });
    await screen.findByRole("heading", { name: "Profile groups" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Find by profileName")));
  });

  it("Ctrl+Shift+S saves all changed files", async () => {
    const { callsOf } = backend({ "g.csv": GOOD, "h.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    press("S", { ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(callsOf("save_text")).toHaveLength(1));
  });

  it("F5 refreshes the file list; page reloads are always blocked", async () => {
    const { callsOf } = backend({ "g.csv": GOOD });
    await open();
    const before = callsOf("list_files").length;
    expect(press("F5")).toBe(false);
    // One listing per module folder.
    await waitFor(() => expect(callsOf("list_files").length).toBe(before + 4));
    expect(press("r", { ctrlKey: true })).toBe(false);
  });
});

describe("settings page", () => {
  it("opens from the Settings tab or Ctrl+, and holds the Makebot folder", async () => {
    backend({ "g.csv": GOOD });
    await open();
    press(",", { ctrlKey: true });
    const folder = screen.getByRole("region", { name: "Makebot folder" });
    expect(within(folder).getByText(ROOT)).toBeTruthy();
    expect(within(folder).getByRole("button", { name: "Change folder…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "← Back" })).toBeNull();
    fireEvent.click(btn("Profiles"));
    expect(screen.queryByRole("region", { name: "Makebot folder" })).toBeNull();
    fireEvent.click(btn("Settings"));
    expect(screen.getByRole("region", { name: "Keyboard shortcuts" })).toBeTruthy();
  });

  it("lists every action with its shortcut", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(btn("Settings"));
    expect(btn("Shortcut for Save file").textContent).toBe("Ctrl+S");
    expect(btn("Shortcut for Select all rows").textContent).toBe("Ctrl+A");
    expect(btn("Shortcut for Discard changes to file").textContent).toBe("None");
  });

  it("records a new shortcut, saves it, and uses it", async () => {
    const { callsOf } = backend({ "g.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(btn("Settings"));
    const key = btn("Shortcut for Save file");
    fireEvent.click(key);
    expect(key.textContent).toBe("Press keys…");
    // While recording, other shortcuts don't fire.
    fireEvent.keyDown(key, { key: "s", ctrlKey: true, altKey: true });
    expect(key.textContent).toBe("Ctrl+Alt+S");
    expect(setShortcutOverrides).toHaveBeenLastCalledWith({ save: "Ctrl+Alt+S" });
    expect(callsOf("save_text")).toEqual([]);

    // Back to the module: the edited file is still open.
    fireEvent.click(btn("Profiles"));
    press("s", { ctrlKey: true });
    expect(callsOf("save_text")).toEqual([]);
    press("s", { ctrlKey: true, altKey: true });
    await waitFor(() => expect(callsOf("save_text")).toHaveLength(1));
  });

  it("taking another action's shortcut removes it from that action", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(btn("Settings"));
    fireEvent.click(btn("Shortcut for Save file"));
    fireEvent.keyDown(btn("Shortcut for Save file"), { key: "d", ctrlKey: true });
    expect(btn("Shortcut for Save file").textContent).toBe("Ctrl+D");
    expect(btn("Shortcut for Duplicate selected rows").textContent).toBe("None");
    expect(screen.getByText('Ctrl+D was removed from "Duplicate selected rows".')).toBeTruthy();
    expect(setShortcutOverrides).toHaveBeenLastCalledWith({ save: "Ctrl+D", duplicate: null });
  });

  it("rejects plain keys, and Escape cancels recording", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(btn("Settings"));
    const key = btn("Shortcut for Add row");
    fireEvent.click(key);
    fireEvent.keyDown(key, { key: "q" });
    expect(screen.getByText(/^Q: Use Ctrl or Alt/)).toBeTruthy();
    expect(key.textContent).toBe("Press keys…");
    fireEvent.keyDown(key, { key: "Escape" });
    expect(key.textContent).toBe("Ctrl+N");
    expect(setShortcutOverrides).not.toHaveBeenCalled();
  });

  it("removes, resets one, and resets all", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(btn("Settings"));
    fireEvent.click(btn("Remove shortcut for Add row"));
    expect(btn("Shortcut for Add row").textContent).toBe("None");
    expect(setShortcutOverrides).toHaveBeenLastCalledWith({ addRow: null });
    fireEvent.click(btn("Reset shortcut for Add row"));
    expect(btn("Shortcut for Add row").textContent).toBe("Ctrl+N");
    fireEvent.click(btn("Remove shortcut for Save file"));
    fireEvent.click(btn("Reset all to defaults"));
    expect(btn("Shortcut for Save file").textContent).toBe("Ctrl+S");
    expect(setShortcutOverrides).toHaveBeenLastCalledWith({});
  });

  it("uses saved shortcuts from the start", async () => {
    vi.mocked(getShortcutOverrides).mockResolvedValueOnce({ selectAll: "Alt+A" });
    backend({ "g.csv": GOOD });
    await open();
    press("a", { ctrlKey: true });
    expect(selectedRows()).toEqual([]);
    press("a", { altKey: true });
    expect(selectedRows()).toEqual(["1", "2", "3"]);
  });
});

describe("backups dropdown", () => {
  it("is hidden until the Backups button is clicked (or Ctrl+H)", async () => {
    backend({ "g.csv": GOOD });
    await open();
    expect(screen.queryByRole("dialog", { name: "Backups" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Backups" })).toBeNull();
    fireEvent.click(btn("Backups ▾"));
    const menu = screen.getByRole("dialog", { name: "Backups" });
    expect(await within(menu).findAllByRole("button", { name: "Restore" })).toHaveLength(2);
    press("h", { ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Backups" })).toBeNull();
    press("h", { ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Backups" })).toBeTruthy();
  });

  it("restoring stages the backup as unsaved changes; nothing is written until Save", async () => {
    const backupText = `${H}\r\n${row("1", { city: "Old Town" })}\r\n${row("2", { city: "Chicago" })}\r\n`;
    const { disk, callsOf } = backend({ "g.csv": GOOD }, { [BACKUPS[1].id]: backupText });
    await open();
    fireEvent.click(btn("Backups ▾"));
    const restores = await within(screen.getByRole("dialog", { name: "Backups" })).findAllByRole("button", { name: "Restore" });
    fireEvent.click(restores[1]);

    await waitFor(() => expect(cell(1, "city").value).toBe("Old Town"));
    expect(callsOf("read_backup")).toEqual([{ path: `${DIR}\\g.csv`, id: BACKUPS[1].id }]);
    expect(callsOf("save_text")).toEqual([]);
    expect(callsOf("restore_backup")).toEqual([]);
    expect(disk.get(`${DIR}\\g.csv`)).toBe(GOOD);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(status()).toContain("Unsaved changes");
    expect(status()).toContain("Loaded the backup from");
    expect(td(1, "city").className).toContain("changed");
    expect(cell(1, "city").title).toBe("Was: Springfield");
    expect(screen.queryByLabelText("Row 3 profileName")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Backups" })).toBeNull();

    fireEvent.click(btn("Save"));
    await waitFor(() => expect(callsOf("save_text")).toEqual([{ path: `${DIR}\\g.csv`, text: backupText }]));
  });

  it("asks before replacing unsaved changes, and does nothing if cancelled", async () => {
    const { callsOf } = backend({ "g.csv": GOOD }, { [BACKUPS[0].id]: `${H}\r\n` });
    await open();
    type(1, "city", "Rockford");
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    fireEvent.click(btn("Backups ▾"));
    fireEvent.click((await within(screen.getByRole("dialog", { name: "Backups" })).findAllByRole("button", { name: "Restore" }))[0]);
    await waitFor(() =>
      expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("Replace your unsaved changes to g with"), "Restore backup"),
    );
    expect(callsOf("read_backup")).toEqual([]);
    expect(cell(1, "city").value).toBe("Rockford");
  });

  it("Discard changes undoes a staged restore", async () => {
    backend({ "g.csv": GOOD }, { [BACKUPS[0].id]: `${H}\r\n` });
    await open();
    fireEvent.click(btn("Backups ▾"));
    fireEvent.click((await within(screen.getByRole("dialog", { name: "Backups" })).findAllByRole("button", { name: "Restore" }))[0]);
    await waitFor(() => expect(screen.queryByLabelText("Row 1 profileName")).toBeNull());
    fireEvent.click(btn("Discard changes"));
    await screen.findByLabelText("Row 3 profileName");
  });

  it("refuses a backup without the profile header", async () => {
    backend({ "g.csv": GOOD }, { [BACKUPS[0].id]: "a,b\r\n" });
    await open();
    fireEvent.click(btn("Backups ▾"));
    fireEvent.click((await within(screen.getByRole("dialog", { name: "Backups" })).findAllByRole("button", { name: "Restore" }))[0]);
    expect(await screen.findByText(/doesn't have the profile header/)).toBeTruthy();
    expect(status()).not.toContain("Unsaved changes");
  });
});
