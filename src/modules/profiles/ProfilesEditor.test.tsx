import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { askSaveDiscardCancel, confirmAction, pickFolder, showMessage } from "../../lib/dialogs";
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import type { FileEntry } from "../../lib/fs";
import { getMakebotPath, setMakebotPath } from "../../lib/settings";
import { guardWindowClose } from "../../lib/window";

vi.mock("../../lib/settings", () => ({ getMakebotPath: vi.fn(), setMakebotPath: vi.fn() }));
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

const row = (name: string, o: { city?: string; zip?: string; state?: string } = {}) =>
  `${name},Jane,Doe,jane${name}@example.com,101 Main St,,${o.city ?? "Springfield"},${o.state ?? "IL"},${o.zip ?? "62701"},US,2175550100,4111111111111111,01,28,123`;

const GOOD = `${H}\r\n${row("1")}\r\n${row("2", { city: "Chicago" })}\r\n${row("3", { city: "Peoria" })}\r\n`;

type Args = Record<string, unknown>;

/** In-memory file system behind the Rust commands. */
function backend(files: Record<string, string>, overrides: Record<string, (a: Args) => unknown> = {}) {
  const disk = new Map(Object.entries(files).map(([n, t]) => [`${DIR}\\${n}`, t]));
  const saves: { path: string; text: string }[] = [];
  const handlers: Record<string, (a: Args) => unknown> = {
    list_files: ({ dir }) =>
      dir === DIR
        ? [...disk.keys()].map(
            (path): FileEntry => ({ name: path.slice(DIR.length + 1), path, size: disk.get(path)!.length, modifiedMs: 1 }),
          )
        : [],
    read_text: ({ path }) => {
      const text = disk.get(path as string)!;
      const crlf = text.includes("\r\n");
      const lf = /(^|[^\r])\n/.test(text);
      return { text, lineEnding: crlf && lf ? "mixed" : crlf ? "crlf" : lf ? "lf" : "none", hasBom: false };
    },
    save_text: ({ path, text }) => {
      saves.push({ path: path as string, text: text as string });
      disk.set(path as string, text as string);
      return null;
    },
    list_backups: () => [],
    ...overrides,
  };
  mockIPC((cmd, args) => {
    const h = handlers[cmd];
    if (!h) throw `unexpected command ${cmd}`;
    return h(args as Args);
  });
  return { disk, saves };
}

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(setMakebotPath).mockResolvedValue();
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.mocked(showMessage).mockResolvedValue();
});

const fileButton = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}`) });

async function openFile(name: string) {
  fireEvent.click(await waitFor(() => fileButton(name)));
  await screen.findByRole("heading", { name });
  await screen.findByLabelText("Row 1 profileName").catch(() => null);
}

async function open(name = "g.csv") {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
  await openFile(name);
}

const cell = (n: number, field: string) => screen.getByLabelText(`Row ${n} ${field}`) as HTMLInputElement;
const type = (n: number, field: string, value: string) => fireEvent.change(cell(n, field), { target: { value } });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const clickRow = (n: number, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) =>
  fireEvent.click(screen.getByRole("rowheader", { name: `Row ${n}` }), mods);
const selectedRows = () =>
  screen
    .getAllByRole("row")
    .filter((r) => r.getAttribute("aria-selected") === "true")
    .map((r) => within(r).getByRole("rowheader").textContent);
const status = () => screen.getByRole("status").textContent ?? "";
const changes = () => screen.getByRole("region", { name: "Unsaved changes" });

async function save() {
  fireEvent.click(button("Save"));
  await waitFor(() => expect(status()).toContain("Saved. The previous version was backed up."));
}

describe("profiles grid", () => {
  it("shows every profile and field", async () => {
    backend({ "g.csv": GOOD });
    await open();
    expect(screen.getByText(/3 profiles/)).toBeTruthy();
    expect(screen.getByText(/CRLF/)).toBeTruthy();
    expect(cell(2, "city").value).toBe("Chicago");
    expect(cell(3, "profileName").value).toBe("3");
    expect(status()).toContain("No errors");
    expect(button("Save").disabled).toBe(true);
  });

  it("has no checkboxes; each cell is a single input", async () => {
    backend({ "g.csv": GOOD });
    await open();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    const td = cell(1, "city").parentElement!;
    expect(td.tagName).toBe("TD");
    expect(td.children).toHaveLength(1);
  });

  it("uses dropdowns for state, country, ccMonth and ccYear", async () => {
    backend({ "g.csv": GOOD });
    await open();
    for (const f of ["state", "country", "ccMonth", "ccYear"]) expect(cell(1, f).tagName).toBe("SELECT");
    for (const f of ["profileName", "zipcode", "address1", "ccNumber"]) expect(cell(1, f).tagName).toBe("INPUT");
    expect(within(cell(1, "state")).getAllByRole("option")).toHaveLength(50);
  });

  it("keeps an out-of-list value visible in its dropdown, marked current", async () => {
    backend({ "g.csv": `${H}\r\n${row("1", { state: "Il" })}\r\n` });
    await open();
    expect(cell(1, "state").value).toBe("Il");
    expect(within(cell(1, "state")).getByRole("option", { name: "Il (current)" })).toBeTruthy();
  });

  it("says when a group is empty (header only or 0 bytes)", async () => {
    backend({ "a.csv": `${H}\r\n`, "b.csv": "" });
    await open("a.csv");
    expect(screen.getByText("This group is empty.")).toBeTruthy();
    await openFile("b.csv");
    expect(screen.getByText("This group is empty.")).toBeTruthy();
  });

  it("Enter and arrow keys move to the same column in the next/previous row", async () => {
    backend({ "g.csv": GOOD });
    await open();
    cell(1, "city").focus();
    fireEvent.keyDown(cell(1, "city"), { key: "Enter" });
    expect(document.activeElement).toBe(cell(2, "city"));
    fireEvent.keyDown(cell(2, "city"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(3, "city"));
    fireEvent.keyDown(cell(3, "city"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(3, "city"));
    fireEvent.keyDown(cell(3, "city"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell(2, "city"));
    fireEvent.keyDown(cell(2, "city"), { key: "Enter", shiftKey: true });
    expect(document.activeElement).toBe(cell(1, "city"));
  });
});

describe("row selection", () => {
  const FIVE = `${H}\r\n${[1, 2, 3, 4, 5].map((n) => row(String(n))).join("\r\n")}\r\n`;

  it("clicking a row number selects only that row", async () => {
    backend({ "g.csv": FIVE });
    await open();
    clickRow(2);
    expect(selectedRows()).toEqual(["2"]);
    clickRow(4);
    expect(selectedRows()).toEqual(["4"]);
    expect(status()).toContain("1 selected");
  });

  it("shift-click selects a range, in either direction", async () => {
    backend({ "g.csv": FIVE });
    await open();
    clickRow(2);
    clickRow(4, { shiftKey: true });
    expect(selectedRows()).toEqual(["2", "3", "4"]);
    clickRow(1, { shiftKey: true });
    expect(selectedRows()).toEqual(["1", "2"]);
  });

  it("ctrl-click adds or removes single rows", async () => {
    backend({ "g.csv": FIVE });
    await open();
    clickRow(1);
    clickRow(3, { ctrlKey: true });
    clickRow(5, { ctrlKey: true });
    expect(selectedRows()).toEqual(["1", "3", "5"]);
    clickRow(3, { ctrlKey: true });
    expect(selectedRows()).toEqual(["1", "5"]);
  });

  it("ctrl+shift-click adds a range to the selection", async () => {
    backend({ "g.csv": FIVE });
    await open();
    clickRow(1);
    clickRow(3, { ctrlKey: true });
    clickRow(5, { ctrlKey: true, shiftKey: true });
    expect(selectedRows()).toEqual(["1", "3", "4", "5"]);
  });

  it("the # header selects all rows, and again selects none", async () => {
    backend({ "g.csv": FIVE });
    await open();
    fireEvent.click(screen.getByLabelText("Select all rows"));
    expect(selectedRows()).toEqual(["1", "2", "3", "4", "5"]);
    fireEvent.click(screen.getByLabelText("Select all rows"));
    expect(selectedRows()).toEqual([]);
  });
});

describe("editing and saving", () => {
  it("saves an edited cell, changing only those bytes", async () => {
    const { saves } = backend({ "g.csv": GOOD });
    await open();
    type(2, "city", "Rockford");
    expect(status()).toContain("Unsaved changes");
    await save();
    expect(saves).toEqual([{ path: `${DIR}\\g.csv`, text: GOOD.replace("Chicago", "Rockford") }]);
    expect(status()).not.toContain("Unsaved changes");
    expect(button("Save").disabled).toBe(true);
  });

  it("editing back to the original value is not a change", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(2, "city", "Rockford");
    type(2, "city", "Chicago");
    expect(status()).not.toContain("Unsaved changes");
    expect(button("Save").disabled).toBe(true);
  });

  it("blocks saving while a cell is invalid, highlights the cell and lists the error", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(1, "zipcode", "6270");
    expect(cell(1, "zipcode").getAttribute("aria-invalid")).toBe("true");
    expect(cell(1, "zipcode").parentElement!.className).toContain("invalid");
    expect(status()).toContain("1 error: fix it to save");
    expect(within(screen.getByRole("region", { name: "Errors" })).getByText("Row 1: zipcode must be exactly 5 digits")).toBeTruthy();
    expect(button("Save").disabled).toBe(true);
    type(1, "zipcode", "62702");
    expect(button("Save").disabled).toBe(false);
  });

  it("existing invalid rows block saving too", async () => {
    backend({ "g.csv": `${H}\r\n${row("1", { zip: "ZIP" })}\r\n${row("2")}\r\n` });
    await open();
    type(2, "city", "Rockford");
    expect(status()).toContain("1 error: fix it to save");
    expect(button("Save").disabled).toBe(true);
  });

  it("flags duplicate names and ALL", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(3, "profileName", "1");
    expect(cell(1, "profileName").title).toBe("profileName is used by more than one row");
    expect(cell(3, "profileName").title).toBe("profileName is used by more than one row");
    type(3, "profileName", "ALL");
    expect(cell(3, "profileName").title).toBe('profileName can\'t be "ALL"');
    expect(cell(1, "profileName").getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps unparseable lines unchanged and doesn't block saving for them", async () => {
    const text = `${H}\r\n${row("1")}\r\nbroken,line\r\n\r\n${row("4")}\r\n`;
    const { saves } = backend({ "g.csv": text });
    await open();
    expect(screen.getByText(/2 unparseable lines \(kept unchanged\)/)).toBeTruthy();
    expect(screen.getByText("broken,line")).toBeTruthy();
    expect(screen.getByText("(blank line)")).toBeTruthy();
    type(4, "city", "Rockford");
    await save();
    expect(saves[0].text).toBe(text.replace(`${row("4")}`, row("4", { city: "Rockford" })));
  });

  it("keeps LF line endings and a missing trailing newline", async () => {
    const text = `${H}\n${row("1")}\n${row("2")}`;
    const { saves } = backend({ "g.csv": text });
    await open();
    clickRow(1);
    fireEvent.click(button("Duplicate"));
    await save();
    // A duplicate keeps every value except the name.
    expect(saves[0].text).toBe(`${text}\n3${row("1").slice(1)}`);
  });

  it("opens a file with a wrong header read-only", async () => {
    backend({ "g.csv": `name,first\r\na,b\r\n` });
    await open();
    expect(screen.getByText(/header doesn't match the profile format/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("asks before overwriting a file changed by another program", async () => {
    const { disk, saves } = backend({ "g.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    disk.set(`${DIR}\\g.csv`, GOOD + `${row("9")}\r\n`);
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    fireEvent.click(button("Save"));
    await waitFor(() =>
      expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("changed by another program"), "File changed on disk"),
    );
    expect(saves).toEqual([]);
    await waitFor(() => expect(button("Save").disabled).toBe(false));
    expect(status()).toContain("Unsaved changes");

    await save();
    expect(saves[0].text).toBe(GOOD.replace("Springfield", "Rockford"));
  });

  it("shows save errors and keeps the changes", async () => {
    backend(
      { "g.csv": GOOD },
      {
        save_text: () => {
          throw "Access is denied. (os error 5)";
        },
      },
    );
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(button("Save"));
    expect(await screen.findByText("Save failed: Access is denied. (os error 5)")).toBeTruthy();
    expect(cell(1, "city").value).toBe("Rockford");
    expect(status()).toContain("Unsaved changes");
  });

  it("warns if the file on disk doesn't match what was written", async () => {
    const { disk } = backend(
      { "g.csv": GOOD },
      {
        save_text: ({ path }) => {
          disk.set(path as string, "something else");
          return null;
        },
      },
    );
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(button("Save"));
    expect(await screen.findByText(/doesn't match what was written/)).toBeTruthy();
  });

  it("discards changes after confirmation", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(button("Discard changes"));
    await waitFor(() => expect(cell(1, "city").value).toBe("Springfield"));
    expect(status()).not.toContain("Unsaved changes");
  });
});

describe("row actions", () => {
  it("adds an empty row named after its row number", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(button("Add row"));
    expect(cell(4, "profileName").value).toBe("4");
    expect(cell(4, "country").value).toBe("US");
    expect(button("Save").disabled).toBe(true);
    // 15 fields minus profileName, country and the optional address2.
    expect(status()).toContain("12 errors");
  });

  it("deletes, moves and duplicates selected rows", async () => {
    const { saves } = backend({ "g.csv": GOOD });
    await open();
    clickRow(1);
    fireEvent.click(button("Delete"));
    expect(cell(1, "profileName").value).toBe("2");
    expect(selectedRows()).toEqual([]);
    clickRow(2);
    fireEvent.click(button("Move up"));
    expect(cell(1, "profileName").value).toBe("3");
    expect(selectedRows()).toEqual(["1"]);
    fireEvent.click(button("Duplicate"));
    // The copy is named after its row number (3), which clashes with the moved row.
    expect(cell(3, "profileName").title).toBe("profileName is used by more than one row");
    expect(button("Save").disabled).toBe(true);
    type(3, "profileName", "9");
    await save();
    const peoria = row("3", { city: "Peoria" });
    expect(saves[0].text).toBe(`${H}\r\n${peoria}\r\n${row("2", { city: "Chicago" })}\r\n9${peoria.slice(1)}\r\n`);
  });

  it("the bulk edit panel is always open and edits the selected rows", async () => {
    const { saves } = backend({ "g.csv": GOOD });
    await open();
    expect(screen.queryByRole("button", { name: "Bulk edit" })).toBeNull();
    const panel = screen.getByRole("region", { name: "Bulk edit" });
    expect(within(panel).getByRole("button", { name: /Set on 0 selected rows/ })).toHaveProperty("disabled", true);
    clickRow(1);
    clickRow(3, { shiftKey: true });
    fireEvent.change(within(panel).getByRole("combobox", { name: /Field/ }), { target: { value: "city" } });
    fireEvent.change(within(panel).getByLabelText("New value"), { target: { value: "Rockford" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Set on 3 selected rows" }));
    await save();
    expect(saves[0].text).toBe(
      `${H}\r\n${row("1", { city: "Rockford" })}\r\n${row("2", { city: "Rockford" })}\r\n${row("3", { city: "Rockford" })}\r\n`,
    );
  });

  it("bulk edit uses a dropdown for dropdown fields", async () => {
    backend({ "g.csv": GOOD });
    await open();
    const panel = screen.getByRole("region", { name: "Bulk edit" });
    fireEvent.change(within(panel).getByRole("combobox", { name: /Field/ }), { target: { value: "state" } });
    expect(within(panel).getByLabelText("New value").tagName).toBe("SELECT");
  });

  it("creates rows from a template", async () => {
    const { saves } = backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(button("From template"));
    const panel = screen.getByRole("region", { name: "Create from template" });
    expect(within(panel).getByText(/Select exactly one profile row/)).toBeTruthy();
    clickRow(2);
    expect(within(panel).getByText("Template: row 2 (2)")).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText("How many"), { target: { value: "2" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Create 2 rows" }));
    expect(status()).toContain("Added 2 rows from the template");
    await save();
    const rest = row("2", { city: "Chicago" }).slice(1);
    expect(saves[0].text).toBe(`${GOOD}4${rest}\r\n5${rest}\r\n`);
  });

  it("rejects a bad template count", async () => {
    backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(button("From template"));
    clickRow(1);
    const panel = screen.getByRole("region", { name: "Create from template" });
    for (const bad of ["0", "abc", "1001", ""]) {
      fireEvent.change(within(panel).getByLabelText("How many"), { target: { value: bad } });
      expect(within(panel).getByRole("button", { name: /^Create/ })).toHaveProperty("disabled", true);
    }
  });

  it("adds pasted rows, or lists what's wrong with them", async () => {
    const { saves } = backend({ "g.csv": GOOD });
    await open();
    fireEvent.click(button("Paste rows"));
    const panel = screen.getByRole("region", { name: "Paste rows" });
    const box = within(panel).getByLabelText("Rows to paste");

    fireEvent.change(box, { target: { value: `${row("7")}\r\nbad,row` } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add rows" }));
    expect(within(panel).getByText("Line 2: expected 15 values, found 2.")).toBeTruthy();
    expect(screen.queryByLabelText("Row 4 profileName")).toBeNull();

    fireEvent.change(box, { target: { value: `${H}\r\n${row("7")}\r\n${row("")}\r\n` } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add rows" }));
    expect(cell(4, "profileName").value).toBe("7");
    expect(cell(5, "profileName").value).toBe("5");
    await save();
    expect(saves[0].text).toBe(`${GOOD}${row("7")}\r\n5${row("")}\r\n`);
  });
});

describe("files with changes or errors", () => {
  it("highlights files with errors in the list, including ones not opened yet", async () => {
    backend({ "bad.csv": `${H}\r\n${row("1", { zip: "ZIP" })}\r\n`, "g.csv": GOOD, "hdr.csv": "a,b\r\n" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
    await waitFor(() => expect(fileButton("bad.csv").className).toContain("invalid"));
    expect(fileButton("bad.csv").getAttribute("aria-description")).toBe("has errors");
    expect(fileButton("hdr.csv").className).toContain("invalid");
    expect(fileButton("g.csv").className).not.toContain("invalid");
  });

  it("a file turns red when an edit introduces an error, and back when fixed", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(1, "zipcode", "1");
    expect(fileButton("g.csv").className).toContain("invalid");
    type(1, "zipcode", "62701");
    expect(fileButton("g.csv").className).not.toContain("invalid");
  });

  it("switching files keeps edits without asking, and marks the file as changed", async () => {
    backend({ "g.csv": GOOD, "h.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    expect(fileButton("g.csv").textContent).toContain("●");
    expect(fileButton("g.csv").getAttribute("aria-description")).toBe("unsaved changes");
    expect(fileButton("h.csv").textContent).not.toContain("●");

    await openFile("h.csv");
    expect(confirmAction).not.toHaveBeenCalled();
    expect(askSaveDiscardCancel).not.toHaveBeenCalled();
    expect(cell(1, "city").value).toBe("Springfield");

    await openFile("g.csv");
    expect(cell(1, "city").value).toBe("Rockford");
    expect(status()).toContain("Unsaved changes");
  });

  it("switching modules keeps edits without asking", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(button("Tasks"));
    expect(button("Tasks").getAttribute("aria-current")).toBe("page");
    fireEvent.click(button("Profiles"));
    await openFile("g.csv");
    expect(cell(1, "city").value).toBe("Rockford");
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("lists changed files like git status and opens them on click", async () => {
    backend({ "g.csv": GOOD, "h.csv": GOOD });
    await open();
    expect(within(changes()).getByText("None")).toBeTruthy();
    type(1, "city", "Rockford");
    await openFile("h.csv");
    type(2, "zipcode", "1");

    const items = within(changes()).getAllByRole("button", { name: /profile\// });
    expect(items.map((b) => b.textContent)).toEqual(["M profile/g.csv", "M profile/h.csv"]);
    expect(items[1].className).toContain("invalid");
    expect(within(changes()).getByRole("heading").textContent).toBe("Unsaved changes (2)");

    fireEvent.click(items[0]);
    await screen.findByRole("heading", { name: "g.csv" });
    expect(cell(1, "city").value).toBe("Rockford");
  });

  it("opens a changed file from another module", async () => {
    backend({ "g.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    fireEvent.click(button("Tasks"));
    fireEvent.click(within(changes()).getByRole("button", { name: /profile\/g\.csv/ }));
    await screen.findByRole("heading", { name: "g.csv" });
    expect(button("Profiles").getAttribute("aria-current")).toBe("page");
  });

  it("Save all saves valid files and reports ones with errors", async () => {
    const { saves } = backend({ "g.csv": GOOD, "h.csv": GOOD });
    await open();
    type(1, "city", "Rockford");
    await openFile("h.csv");
    type(1, "zipcode", "1");

    fireEvent.click(within(changes()).getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(within(changes()).getByText(/Saved 1 file\. Not saved:/)).toBeTruthy());
    expect(within(changes()).getByText(/h\.csv: has errors, fix them first/)).toBeTruthy();
    expect(saves).toEqual([{ path: `${DIR}\\g.csv`, text: GOOD.replace("Springfield", "Rockford") }]);
    expect(within(changes()).getAllByRole("button", { name: /profile\// }).map((b) => b.textContent)).toEqual([
      "M profile/h.csv",
    ]);
  });

  it("disables restoring a backup while the file has unsaved changes", async () => {
    backend({ "g.csv": GOOD }, { list_backups: () => [{ id: "001790000000000", createdMs: 1_790_000_000_000, size: 5 }] });
    await open();
    const restore = (await screen.findByRole("button", { name: "Restore" })) as HTMLButtonElement;
    expect(restore.disabled).toBe(false);
    type(1, "city", "Rockford");
    expect(restore.disabled).toBe(true);
    expect(screen.getByText("Save or discard your changes before restoring a backup.")).toBeTruthy();
  });
});

describe("closing with unsaved changes", () => {
  async function editTwoFiles(files: Record<string, string> = { "g.csv": GOOD, "h.csv": GOOD }) {
    const b = backend(files);
    await open();
    type(1, "city", "Rockford");
    await openFile("h.csv");
    type(1, "city", "Peoria");
    return b;
  }

  const shouldClose = () => vi.mocked(guardWindowClose).mock.calls[0][0]();

  it("closes without asking when nothing changed", async () => {
    backend({ "g.csv": GOOD });
    await open();
    await expect(shouldClose()).resolves.toBe(true);
    expect(askSaveDiscardCancel).not.toHaveBeenCalled();
  });

  it("lists the changed files and asks Save all / Discard / Cancel", async () => {
    await editTwoFiles();
    vi.mocked(askSaveDiscardCancel).mockResolvedValueOnce("cancel");
    await expect(shouldClose()).resolves.toBe(false);
    expect(askSaveDiscardCancel).toHaveBeenCalledWith(
      expect.stringMatching(/unsaved changes in 2 files:[\s\S]*g\.csv[\s\S]*h\.csv[\s\S]*Save them before closing\?/),
      "Unsaved changes",
    );
    expect(within(changes()).getAllByRole("button", { name: /profile\// })).toHaveLength(2);
  });

  it("Discard closes without saving", async () => {
    const { saves } = await editTwoFiles();
    vi.mocked(askSaveDiscardCancel).mockResolvedValueOnce("discard");
    await expect(shouldClose()).resolves.toBe(true);
    expect(saves).toEqual([]);
  });

  it("Save all saves every file, then closes", async () => {
    const { saves } = await editTwoFiles();
    vi.mocked(askSaveDiscardCancel).mockResolvedValueOnce("save");
    await expect(shouldClose()).resolves.toBe(true);
    expect(saves.map((s) => s.path)).toEqual([`${DIR}\\g.csv`, `${DIR}\\h.csv`]);
    expect(saves[1].text).toBe(GOOD.replace("Springfield", "Peoria"));
  });

  it("stays open and explains when a file can't be saved", async () => {
    const { saves } = await editTwoFiles();
    type(2, "zipcode", "1");
    vi.mocked(askSaveDiscardCancel).mockResolvedValueOnce("save");
    await expect(shouldClose()).resolves.toBe(false);
    expect(saves.map((s) => s.path)).toEqual([`${DIR}\\g.csv`]);
    expect(showMessage).toHaveBeenCalledWith(expect.stringContaining("h.csv: has errors"), "Not everything was saved");
  });

  it("switching folders asks the same way", async () => {
    await editTwoFiles();
    vi.mocked(pickFolder).mockResolvedValue("D:\\Other");
    vi.mocked(askSaveDiscardCancel).mockResolvedValueOnce("cancel");
    fireEvent.click(button("Change folder"));
    await waitFor(() => expect(askSaveDiscardCancel).toHaveBeenCalledWith(expect.stringContaining("before switching folders"), "Unsaved changes"));
    expect(setMakebotPath).not.toHaveBeenCalled();

    vi.mocked(askSaveDiscardCancel).mockResolvedValueOnce("discard");
    fireEvent.click(button("Change folder"));
    await waitFor(() => expect(setMakebotPath).toHaveBeenCalledWith("D:\\Other"));
    expect(within(changes()).getByText("None")).toBeTruthy();
  });
});
