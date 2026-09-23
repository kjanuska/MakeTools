import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { confirmAction } from "../../lib/dialogs";
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import type { FileEntry } from "../../lib/fs";
import { getMakebotPath } from "../../lib/settings";
import { guardWindowClose } from "../../lib/window";

vi.mock("../../lib/settings", () => ({
  getMakebotPath: vi.fn(),
  setMakebotPath: vi.fn(),
  getShortcutOverrides: vi.fn(async () => ({})),
  setShortcutOverrides: vi.fn(async () => {}),
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
const p = (name: string) => `${DIR}\\${name}`;

const row = (name: string, o: { zip?: string; first?: string } = {}) =>
  `${name},${o.first ?? "Jane"},Doe,jane${name}@example.com,101 Main St,,Springfield,IL,${o.zip ?? "62701"},US,2175550100,4111111111111111,01,28,123`;

const file = (rows: string[]) => `${H}\r\n${rows.map((r) => `${r}\r\n`).join("")}`;

type Args = Record<string, unknown>;
type Call = { cmd: string; args: Args };

function backend(files: Record<string, string>, overrides: Record<string, (a: Args) => unknown> = {}) {
  const disk = new Map(Object.entries(files).map(([n, t]) => [p(n), t]));
  const calls: Call[] = [];
  const exists = (path: string) => [...disk.keys()].some((k) => k.toLowerCase() === path.toLowerCase());
  const handlers: Record<string, (a: Args) => unknown> = {
    list_files: ({ dir }) =>
      dir === DIR
        ? [...disk.keys()]
            .sort()
            .map((path): FileEntry => ({ name: path.slice(DIR.length + 1), path, size: disk.get(path)!.length, modifiedMs: 1 }))
        : [],
    read_text: ({ path }) => {
      if (!disk.has(path as string)) throw "The system cannot find the file specified. (os error 2)";
      return { text: disk.get(path as string), lineEnding: "crlf", hasBom: false };
    },
    save_text: ({ path, text }) => {
      disk.set(path as string, text as string);
      return null;
    },
    create_file: ({ path, text }) => {
      if (exists(path as string)) throw "The file exists. (os error 80)";
      disk.set(path as string, text as string);
      return null;
    },
    rename_file: ({ from, to }) => {
      disk.set(to as string, disk.get(from as string)!);
      disk.delete(from as string);
      return null;
    },
    delete_file: ({ path }) => {
      disk.delete(path as string);
      return null;
    },
    list_backups: () => [],
    ...overrides,
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

const FILES = {
  "25.csv": file([row("1"), row("2"), row("3")]),
  "5.csv": file([row("1"), row("12", { zip: "ZIP" })]),
  "empty.csv": "",
  "weird.csv": "a,b\r\n",
};

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
  vi.mocked(confirmAction).mockResolvedValue(true);
});

async function openOverview() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
  await screen.findByRole("heading", { name: "Profile groups" });
  await waitFor(() => expect(groupRow("25").textContent).toContain("3"));
}

const table = () => screen.getAllByRole("table")[0];
const groupRow = (name: string) =>
  within(table())
    .getAllByRole("row")
    .find((r) => r.querySelector("td button")?.textContent === name)!;
const groupNames = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td button")!.textContent);
const cell = (n: number, field: string) => screen.getByLabelText(`Row ${n} ${field}`) as HTMLInputElement;
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("groups overview", () => {
  it("lists every group with its count, status and the total", async () => {
    backend(FILES);
    await openOverview();
    expect(screen.getByText(/in total/).textContent).toBe("4 groups · 5 profiles in total");
    expect(groupNames()).toEqual(["25", "5", "empty", "weird"]);
    const cells = (name: string) => [...groupRow(name).querySelectorAll("td")].map((td) => td.textContent);
    expect(cells("25").slice(1, 3)).toEqual(["3", "OK"]);
    expect(cells("5").slice(1, 3)).toEqual(["2", "1 error"]);
    expect(cells("empty").slice(1, 3)).toEqual(["0", "OK"]);
    expect(cells("weird").slice(2, 3)).toEqual(["Wrong header (read-only)"]);
    expect(groupRow("5").className).toBe("invalid");
    expect(groupRow("weird").className).toBe("invalid");
    expect(groupRow("25").className).toBe("");
  });

  it("opens a group, and goes back with the button or the Profiles tab", async () => {
    backend(FILES);
    await openOverview();
    fireEvent.click(within(groupRow("25")).getByRole("button", { name: "25" }));
    await screen.findByRole("heading", { name: "25.csv" });
    fireEvent.click(btn("← All groups"));
    await screen.findByRole("heading", { name: "Profile groups" });
    fireEvent.click(screen.getByRole("button", { name: /^25\.csv/ }));
    await screen.findByRole("heading", { name: "25.csv" });
    fireEvent.click(btn("Profiles"));
    await screen.findByRole("heading", { name: "Profile groups" });
  });

  it("counts include unsaved edits, and a changed group can't be renamed, copied or deleted", async () => {
    backend(FILES);
    await openOverview();
    fireEvent.click(within(groupRow("25")).getByRole("button", { name: "25" }));
    await screen.findByLabelText("Row 1 profileName");
    fireEvent.click(btn("Add row"));
    fireEvent.click(btn("← All groups"));
    await screen.findByRole("heading", { name: "Profile groups" });
    expect(screen.getByText(/in total/).textContent).toBe("4 groups · 6 profiles in total");
    expect(groupRow("25").textContent).toContain("Unsaved changes");
    for (const action of ["Rename 25", "Copy 25", "Delete 25"]) {
      expect(btn(action).disabled).toBe(true);
      expect(btn(action).title).toBe("Save or discard its changes first.");
    }
    expect(btn("Rename 5").disabled).toBe(false);
  });
});

describe("creating groups", () => {
  it("creates an empty group (header + CRLF) and opens it", async () => {
    const { disk, callsOf } = backend(FILES);
    await openOverview();
    fireEvent.change(screen.getByRole("textbox", { name: /New group/ }), { target: { value: "40" } });
    fireEvent.click(btn("Create"));
    await screen.findByRole("heading", { name: "40.csv" });
    expect(callsOf("create_file")).toEqual([{ path: p("40.csv"), text: `${H}\r\n` }]);
    expect(disk.get(p("40.csv"))).toBe(`${H}\r\n`);
    expect(screen.getByText("This group is empty.")).toBeTruthy();
    await screen.findByRole("button", { name: /^40\.csv/ });
  });

  it("validates the name before creating", async () => {
    const { callsOf } = backend(FILES);
    await openOverview();
    const input = screen.getByRole("textbox", { name: /New group/ });
    for (const [name, msg] of [
      ["25", 'A group named "25" already exists.'],
      ["EMPTY", 'A group named "empty" already exists.'],
      ["a,b", 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
      [" x", "The name can't start or end with a space."],
      ["con", '"con" is reserved by Windows.'],
    ]) {
      fireEvent.change(input, { target: { value: name } });
      expect(within(screen.getByRole("region", { name: "New group" })).getByText(msg)).toBeTruthy();
      expect(btn("Create").disabled).toBe(true);
    }
    expect(callsOf("create_file")).toEqual([]);
  });

  it("shows errors from the file system", async () => {
    backend(FILES, {
      create_file: () => {
        throw "Access is denied. (os error 5)";
      },
    });
    await openOverview();
    fireEvent.change(screen.getByRole("textbox", { name: /New group/ }), { target: { value: "40" } });
    fireEvent.click(btn("Create"));
    expect(await screen.findByText("Created group 40 failed: Access is denied. (os error 5)")).toBeTruthy();
  });
});

describe("renaming, copying and deleting groups", () => {
  it("renames after confirming, warning about tasks", async () => {
    const { disk, callsOf } = backend(FILES);
    await openOverview();
    fireEvent.click(btn("Rename 25"));
    const panel = screen.getByRole("region", { name: "Rename group" });
    const input = within(panel).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("25");
    expect(within(panel).getByText("That's already its name.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "5" } });
    expect(within(panel).getByText('A group named "5" already exists.')).toBeTruthy();
    fireEvent.change(input, { target: { value: "26" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Rename" }));
    await screen.findByText("Renamed 25 to 26.");
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('Tasks that refer to "25" are not updated'), "Rename group");
    expect(callsOf("rename_file")).toEqual([{ from: p("25.csv"), to: p("26.csv") }]);
    expect(disk.has(p("26.csv"))).toBe(true);
    await waitFor(() => expect(groupNames()).toEqual(["26", "5", "empty", "weird"]));
    await waitFor(() => expect(groupRow("26").textContent).toContain("3"));
  });

  it("does nothing when the rename is cancelled", async () => {
    const { callsOf } = backend(FILES);
    await openOverview();
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    fireEvent.click(btn("Rename 25"));
    const panel = screen.getByRole("region", { name: "Rename group" });
    fireEvent.change(within(panel).getByRole("textbox"), { target: { value: "26" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(callsOf("rename_file")).toEqual([]);
  });

  it("copies a group byte for byte under a suggested name", async () => {
    const { disk, callsOf } = backend(FILES);
    await openOverview();
    fireEvent.click(btn("Copy 5"));
    const panel = screen.getByRole("region", { name: "Copy group" });
    expect((within(panel).getByRole("textbox") as HTMLInputElement).value).toBe("5 copy");
    fireEvent.click(within(panel).getByRole("button", { name: "Copy" }));
    await screen.findByText("Copied 5 to 5 copy.");
    expect(callsOf("create_file")).toEqual([{ path: p("5 copy.csv"), text: FILES["5.csv"] }]);
    expect(disk.get(p("5 copy.csv"))).toBe(FILES["5.csv"]);
    await waitFor(() => expect(groupNames()).toContain("5 copy"));
  });

  it("deletes after confirming, saying how many profiles it has", async () => {
    const { disk, callsOf } = backend(FILES);
    await openOverview();
    fireEvent.click(btn("Delete 25"));
    await screen.findByText("Deleted group 25.");
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("Delete group 25 (3 profiles)?"), "Delete group");
    expect(callsOf("delete_file")).toEqual([{ path: p("25.csv") }]);
    expect(disk.has(p("25.csv"))).toBe(false);
    await waitFor(() => expect(groupNames()).toEqual(["5", "empty", "weird"]));
    expect(screen.getByText(/in total/).textContent).toBe("3 groups · 2 profiles in total");
  });

  it("does nothing when the delete is cancelled", async () => {
    const { callsOf } = backend(FILES);
    await openOverview();
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    fireEvent.click(btn("Delete 25"));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(callsOf("delete_file")).toEqual([]);
  });
});

describe("finding profiles", () => {
  it("finds profileNames containing the text, across groups", async () => {
    backend(FILES);
    await openOverview();
    fireEvent.change(screen.getByLabelText("Find by profileName"), { target: { value: "2" } });
    const matches = screen.getByRole("table", { name: "Matches" });
    const rows = within(matches)
      .getAllByRole("row")
      .slice(1)
      .map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([
      ["2", "25", "2", "Jane Doe"],
      ["12", "5", "2", "Jane Doe"],
    ]);
    expect(screen.getByText("2 matches")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find by profileName"), { target: { value: "zzz" } });
    expect(screen.getByText("No profiles match.")).toBeTruthy();
  });

  it("opening a match selects that row in its group", async () => {
    backend(FILES);
    await openOverview();
    fireEvent.change(screen.getByLabelText("Find by profileName"), { target: { value: "12" } });
    fireEvent.click(within(screen.getByRole("table", { name: "Matches" })).getByRole("button", { name: "12" }));
    await screen.findByRole("heading", { name: "5.csv" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("1 selected"));
    const selected = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-selected") === "true");
    expect(selected.map((r) => within(r).getByRole("rowheader").textContent)).toEqual(["2"]);
    expect(document.activeElement).toBe(cell(2, "profileName"));
  });
});

describe("moving and copying profiles between groups", () => {
  async function openGroup(name: string) {
    fireEvent.click(within(groupRow(name)).getByRole("button", { name }));
    await screen.findByRole("heading", { name: `${name}.csv` });
    await screen.findByLabelText("Row 1 profileName");
  }

  function transfer(target: string, mode: "Copy" | "Move") {
    fireEvent.click(btn("Move / copy to group"));
    const panel = screen.getByRole("region", { name: "Move or copy to group" });
    fireEvent.change(within(panel).getByRole("combobox"), { target: { value: p(target) } });
    fireEvent.click(within(panel).getByRole("button", { name: new RegExp(`^${mode}`) }));
    return panel;
  }

  it("moves selected profiles; both groups become unsaved and save exactly", async () => {
    const { disk } = backend(FILES);
    await openOverview();
    await openGroup("25");
    fireEvent.click(screen.getByRole("rowheader", { name: "Row 2" }));
    fireEvent.click(screen.getByRole("rowheader", { name: "Row 3" }), { shiftKey: true });
    transfer("empty.csv", "Move");
    expect(screen.getByRole("status").textContent).toContain("Moved 2 profiles to empty.csv (not saved yet).");
    expect(cell(1, "profileName").value).toBe("1");
    expect(screen.queryByLabelText("Row 2 profileName")).toBeNull();

    const changes = screen.getByRole("region", { name: "Unsaved changes" });
    fireEvent.click(within(changes).getByRole("button", { name: "Save all" }));
    await within(changes).findByText("Saved 2 files.");
    expect(disk.get(p("25.csv"))).toBe(file([row("1")]));
    expect(disk.get(p("empty.csv"))).toBe(file([row("2"), row("3")]));
  });

  it("copy leaves the source unchanged", async () => {
    backend(FILES);
    await openOverview();
    await openGroup("25");
    fireEvent.click(screen.getByRole("rowheader", { name: "Row 3" }));
    transfer("empty.csv", "Copy");
    expect(screen.getByRole("status").textContent).toContain("Copied 1 profile to empty.csv");
    const changes = within(screen.getByRole("region", { name: "Unsaved changes" }));
    expect(changes.getAllByRole("button", { name: /profile\// }).map((b) => b.textContent)).toEqual(["M profile/empty.csv"]);
  });

  it("refuses when a name already exists in the target", async () => {
    backend(FILES);
    await openOverview();
    await openGroup("25");
    fireEvent.click(screen.getByRole("rowheader", { name: "Row 1" }));
    const panel = transfer("5.csv", "Move");
    expect(within(panel).getByText("5.csv already has profiles named: 1. Rename them first.")).toBeTruthy();
    expect(cell(1, "profileName").value).toBe("1");
    expect(within(screen.getByRole("region", { name: "Unsaved changes" })).getByText("None")).toBeTruthy();
  });

  it("offers only other, editable groups as targets", async () => {
    backend(FILES);
    await openOverview();
    await openGroup("25");
    fireEvent.click(btn("Move / copy to group"));
    const panel = screen.getByRole("region", { name: "Move or copy to group" });
    const options = within(panel)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Choose…", "5.csv", "empty.csv"]);
    expect((within(panel).getByRole("button", { name: /^Copy/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
