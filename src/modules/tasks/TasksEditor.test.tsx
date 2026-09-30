import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { confirmAction } from "../../lib/dialogs";
import { getMakebotPath, getSites, setSites } from "../../lib/settings";
import { guardWindowClose } from "../../lib/window";
import { backend, H, ROOT, task, taskFile } from "./testing";

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

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.mocked(getSites).mockResolvedValue(["kith.com", "shop.topps.com"]);
});

const cell = (n: number, field: string) => screen.getByLabelText(`Row ${n} ${field}`) as HTMLInputElement;
const td = (n: number, field: string) => cell(n, field).closest("td")!;
const type = (n: number, field: string, value: string) => fireEvent.change(cell(n, field), { target: { value } });
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const status = () => screen.getByRole("status").textContent ?? "";
const options = (el: HTMLElement) => within(el).getAllByRole("option").map((o) => o.textContent);
const extra = (n: number, header: string) => screen.getByLabelText(`Row ${n} ${header}`);

async function openTasks() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
  await screen.findByRole("heading", { name: "Task files" });
}

async function openTaskFile(name = "t.csv") {
  await openTasks();
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}`) }));
  await screen.findByRole("heading", { name });
  // Task files open on their summary; the grid is under "Raw rows".
  fireEvent.click(screen.getByRole("tab", { name: "Raw rows" }));
  await screen.findByLabelText("Row 1 profileGroup");
  // Wait until links to the other folders are known.
  await waitFor(() => expect(options(cell(1, "profileGroup"))).toContain("25"));
}

describe("task overview", () => {
  it("lists task files with rows, tasks and status, and the totals", async () => {
    backend({
      "a.csv": taskFile([task(), task({ name: "2" })]),
      "b.csv": taskFile([task({ group: "topps" })]),
    });
    await openTasks();
    await waitFor(() =>
      expect(screen.getByText(/in total/).textContent).toBe("2 task files · 3 rows · 4 tasks (+1 unknown) in total"),
    );
    const row = (name: string) =>
      within(screen.getAllByRole("table")[0])
        .getAllByRole("row")
        .find((r) => r.querySelector("td button")?.textContent === name)!;
    const cells = (name: string) => [...row(name).querySelectorAll("td")].map((t) => t.textContent);
    expect(cells("a").slice(1, 4)).toEqual(["2", "4 tasks", "OK"]);
    expect(cells("b").slice(1, 4)).toEqual(["1", "0 tasks (+1 unknown)", "1 error"]);
    expect(row("b").className).toBe("invalid");
  });

  it("finds tasks by any field and opens the match", async () => {
    backend({ "a.csv": taskFile([task(), task({ site: "shop.topps.com", input: "cards" })]) });
    await openTasks();
    fireEvent.change(screen.getByLabelText("Find in any field"), { target: { value: "TOPPS" } });
    const matches = screen.getByRole("table", { name: "Matches" });
    const rows = within(matches)
      .getAllByRole("row")
      .slice(1)
      .map((r) => [...r.querySelectorAll("td")].map((t) => t.textContent));
    expect(rows).toEqual([["shop.topps.com", "a", "2", "site"]]);
    fireEvent.click(within(matches).getByRole("button", { name: "shop.topps.com" }));
    await screen.findByRole("heading", { name: "a.csv" });
    await waitFor(() => expect(status()).toContain("1 selected"));
  });
});

describe("automatic fixes", () => {
  it("cleans input spaces and joins broken lines silently, as unsaved changes", async () => {
    const text =
      `${H}\n${task({ input: "12345678901234 12345678901234 " })}\n` +
      `25,ALL,wealth,example,"box logo -tee\n",random,random,kith.com,preload,1,3000\n`;
    const { disk, saves } = backend({ "t.csv": text });
    await openTaskFile();
    expect(cell(1, "input").value).toBe("12345678901234 12345678901234");
    expect(cell(2, "input").value).toBe("box logo -tee");
    // Not marked per cell…
    expect(td(1, "input").className).not.toContain("changed");
    expect(cell(2, "profileGroup").closest("tr")!.className).not.toContain("new-row");
    // …but the file needs saving.
    expect(status()).toContain("Unsaved changes");
    expect(screen.getByRole("button", { name: /^t\.csv/ }).textContent).toContain("●");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(disk.get(`${ROOT}\\task\\t.csv`)).toBe(
      taskFile([task({ input: "12345678901234 12345678901234" }), task({ input: "box logo -tee" })]),
    );
  });

  it("a clean file opens without unsaved changes", async () => {
    backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    expect(status()).not.toContain("Unsaved changes");
  });
});

describe("task cells", () => {
  it("group dropdowns list the files in each folder", async () => {
    backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    expect(options(cell(1, "profileGroup"))).toEqual(["5", "25"]);
    expect(options(cell(1, "proxyGroup"))).toEqual(["us", "wealth"]);
    expect(options(cell(1, "accountGroup"))).toEqual(["example"]);
  });

  it("profileName offers ALL and the group's profiles, and is disabled without a group", async () => {
    backend({ "t.csv": taskFile([task(), task({ group: "", name: "" })]) });
    await openTaskFile();
    expect(options(cell(1, "profileName"))).toEqual(["ALL", "1", "2", "3"]);
    expect(cell(2, "profileName").disabled).toBe(true);
    type(2, "profileGroup", "5");
    expect(cell(2, "profileName").disabled).toBe(false);
    expect(cell(2, "profileName").value).toBe("ALL");
    expect(options(cell(2, "profileName"))).toEqual(["ALL", "7"]);
  });

  it("changing the group keeps ALL, and resets a name the new group doesn't have", async () => {
    backend({ "t.csv": taskFile([task({ name: "2" })]) });
    await openTaskFile();
    type(1, "profileGroup", "5");
    expect(cell(1, "profileName").value).toBe("ALL");
    expect(cell(1, "profileName").title).toBe("Was: 2");
  });

  it("flags links that don't exist", async () => {
    backend({ "t.csv": taskFile([task({ group: "topps", site: "nowhere.com", mode: "preloadturbo" }), task({ name: "9" })]) });
    await openTaskFile();
    expect(cell(1, "profileGroup").title).toBe("profileGroup isn't an existing profile group");
    expect(cell(1, "site").title).toBe("site isn't in the site list");
    expect(cell(1, "mode").title).toBe("mode has parts that aren't known modes");
    expect(cell(2, "profileName").title).toBe("profileName isn't a profile in 25");
    expect(btn("Save").disabled).toBe(true);
  });

  it("follows unsaved profile edits: new names and counts", async () => {
    backend({ "t.csv": taskFile([task()]) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
    fireEvent.click(await screen.findByRole("button", { name: /^25\.csv/ }));
    await screen.findByLabelText("Row 1 profileName");
    fireEvent.click(btn("Add row"));
    fireEvent.click(btn("Tasks"));
    fireEvent.click(await screen.findByRole("button", { name: /^t\.csv/ }));
    await screen.findByLabelText("Row 1 profileGroup");
    await waitFor(() => expect(options(cell(1, "profileName"))).toEqual(["ALL", "1", "2", "3", "4"]));
    expect(extra(1, "tasks").textContent).toBe("4");
  });

  it("'random' in size and color is marked", async () => {
    backend({ "t.csv": taskFile([task({ size: "random", color: "Black&Blue" })]) });
    await openTaskFile();
    expect(td(1, "size").className).toContain("random");
    expect(cell(1, "size").className).toContain("is-random");
    expect(td(1, "color").className).not.toContain("random");
    type(1, "size", "9&9.5&10");
    expect(td(1, "size").className).not.toContain("random");
  });

  it("cartQuantity and delay are spin buttons", async () => {
    backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    expect(cell(1, "cartQuantity").type).toBe("number");
    expect(cell(1, "cartQuantity").min).toBe("1");
    expect(cell(1, "delay").type).toBe("number");
    expect(cell(1, "delay").step).toBe("100");
    expect(cell(1, "delay").min).toBe("0");
    type(1, "cartQuantity", "0");
    expect(cell(1, "cartQuantity").title).toBe("cartQuantity must be a whole number, 1 or more\nWas: 1");
  });

  it("the input shows its parsed keywords until you click into it", async () => {
    backend({ "t.csv": taskFile([task({ input: "box logo -tee" })]) });
    await openTaskFile();
    const parsed = () => [...td(1, "input").querySelectorAll(".kw")].map((k) => k.textContent);
    expect(parsed()).toEqual(["box", "logo", "−tee"]);
    expect(cell(1, "input").className).toContain("has-display");
    expect(screen.queryByRole("columnheader", { name: "parsed" })).toBeNull();
    // Editing shows the raw text.
    fireEvent.focus(cell(1, "input"));
    expect(parsed()).toEqual([]);
    expect(cell(1, "input").className).not.toContain("has-display");
    type(1, "input", "  hoodie   -shirt  ");
    expect(parsed()).toEqual([]);
    // Leaving cleans the spaces and shows the new keywords.
    fireEvent.blur(cell(1, "input"));
    expect(cell(1, "input").value).toBe("hoodie -shirt");
    expect(parsed()).toEqual(["hoodie", "−shirt"]);
  });

  it("a single-word input shows its text", async () => {
    backend({ "t.csv": taskFile([task({ input: "AB1234-123" })]) });
    await openTaskFile();
    expect(td(1, "input").querySelector(".cell-display")).toBeNull();
    expect(cell(1, "input").className).not.toContain("has-display");
    expect(cell(1, "input").value).toBe("AB1234-123");
  });

  it("bulk edit shows the typed input as text", async () => {
    backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    const panel = screen.getByRole("region", { name: "Bulk edit" });
    fireEvent.change(within(panel).getByRole("combobox", { name: /Field/ }), { target: { value: "input" } });
    fireEvent.change(within(panel).getByLabelText("New value"), { target: { value: "box logo" } });
    expect((within(panel).getByLabelText("New value") as HTMLInputElement).value).toBe("box logo");
    expect(panel.querySelector(".cell-display")).toBeNull();
  });

  it("shows tasks per row and in total", async () => {
    backend({ "t.csv": taskFile([task(), task({ name: "2" }), task({ group: "5" }), task({ group: "gone" })]) });
    await openTaskFile();
    expect([1, 2, 3, 4].map((n) => extra(n, "tasks").textContent)).toEqual(["3", "1", "1", "?"]);
    expect(screen.getByText(/rows ·/).textContent).toContain("4 rows · 5 tasks (+1 unknown)");
  });
});

describe("mode editor", () => {
  it("adds, reorders and removes parts, keeping their order", async () => {
    const { disk } = backend({ "t.csv": taskFile([task({ mode: "preload" })]) });
    await openTaskFile();
    fireEvent.click(cell(1, "mode"));
    const editor = screen.getByRole("dialog", { name: "Edit Row 1 mode" });
    fireEvent.change(within(editor).getByLabelText("Add part"), { target: { value: "wait" } });
    fireEvent.change(within(editor).getByLabelText("Add part"), { target: { value: "stuck" } });
    const chips = () => [...cell(1, "mode").querySelectorAll(".chip")].map((c) => c.textContent);
    expect(chips()).toEqual(["preload", "wait", "stuck"]);
    fireEvent.click(within(editor).getByRole("button", { name: "Move stuck left" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Remove preload" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Done" }));
    expect(chips()).toEqual(["stuck", "wait"]);
    expect(cell(1, "mode").title).toBe("Was: preload");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(disk.get(`${ROOT}\\task\\t.csv`)).toBe(taskFile([task({ mode: "stuckwait" })])));
  });

  it("offers every part", async () => {
    backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    fireEvent.click(cell(1, "mode"));
    expect(options(screen.getByLabelText("Add part")).slice(1)).toEqual([
      "preload", "direct", "safe", "fast", "human", "wait", "pause", "login", "stuck",
      "shoppay", "lite", "store", "free", "cod", "paypal", "monitor",
    ]);
  });
});

describe("sites", () => {
  it("'Add site…' adds a site to the list and the cell", async () => {
    backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    expect(options(cell(1, "site"))).toEqual(["kith.com", "shop.topps.com", "Add site…"]);
    fireEvent.change(cell(1, "site"), { target: { value: "\u0000add" } });
    const panel = screen.getByRole("region", { name: "New site" });
    fireEvent.change(within(panel).getByRole("textbox"), { target: { value: "  new.shop  " } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add" }));
    expect(cell(1, "site").value).toBe("new.shop");
    expect(setSites).toHaveBeenLastCalledWith(["kith.com", "shop.topps.com", "new.shop"]);
    await waitFor(() => expect(cell(1, "site").title).toBe("Was: kith.com"));
  });

  it("the first time, the site list is seeded from the task files", async () => {
    vi.mocked(getSites).mockResolvedValue(null);
    backend({ "a.csv": taskFile([task({ site: "kith.com" }), task({ site: "a.com" })]), "b.csv": taskFile([task({ site: "b.com" })]) });
    await openTasks();
    await waitFor(() => expect(setSites).toHaveBeenCalledWith(["a.com", "b.com", "kith.com"]));
  });

  it("renaming a site in Settings changes and saves it in every task file", async () => {
    const { disk } = backend({
      "a.csv": taskFile([task(), task({ site: "shop.topps.com" })]),
      "b.csv": taskFile([task()]),
    });
    await openTasks();
    fireEvent.click(btn("⚙ Settings"));
    const sites = screen.getByRole("region", { name: "Sites" });
    await waitFor(() => expect(within(sites).getByText("2 tasks in 2 files")).toBeTruthy());
    fireEvent.click(within(sites).getByRole("button", { name: "Rename kith.com" }));
    fireEvent.change(within(sites).getByLabelText("New name for kith.com"), { target: { value: "eu.kith.com" } });
    fireEvent.click(within(sites).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(sites).getByText(/Renamed kith.com to eu.kith.com. Saved 2 files./)).toBeTruthy());
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("2 tasks in 2 files"), "Rename site");
    expect(disk.get(`${ROOT}\\task\\a.csv`)).toBe(taskFile([task({ site: "eu.kith.com" }), task({ site: "shop.topps.com" })]));
    expect(disk.get(`${ROOT}\\task\\b.csv`)).toBe(taskFile([task({ site: "eu.kith.com" })]));
    expect(setSites).toHaveBeenLastCalledWith(["eu.kith.com", "shop.topps.com"]);
  });

  it("a file with other unsaved changes gets the rename added to them, not saved", async () => {
    const { disk } = backend({ "a.csv": taskFile([task()]) });
    await openTaskFile("a.csv");
    type(1, "delay", "4500");
    fireEvent.click(btn("⚙ Settings"));
    const sites = screen.getByRole("region", { name: "Sites" });
    fireEvent.click(within(sites).getByRole("button", { name: "Rename kith.com" }));
    fireEvent.change(within(sites).getByLabelText("New name for kith.com"), { target: { value: "eu.kith.com" } });
    fireEvent.click(within(sites).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(sites).getByText(/Not saved yet: a.csv \(it has other unsaved changes\)/)).toBeTruthy());
    expect(disk.get(`${ROOT}\\task\\a.csv`)).toBe(taskFile([task()]));
    fireEvent.click(btn("⚙ Settings"));
    await screen.findByLabelText("Row 1 site");
    expect(cell(1, "site").value).toBe("eu.kith.com");
    expect(cell(1, "delay").value).toBe("4500");
  });

  it("cancelling the rename changes nothing", async () => {
    const { disk } = backend({ "a.csv": taskFile([task()]) });
    await openTasks();
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    fireEvent.click(btn("⚙ Settings"));
    const sites = screen.getByRole("region", { name: "Sites" });
    fireEvent.click(within(sites).getByRole("button", { name: "Rename kith.com" }));
    fireEvent.change(within(sites).getByLabelText("New name for kith.com"), { target: { value: "x.com" } });
    fireEvent.click(within(sites).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(disk.get(`${ROOT}\\task\\a.csv`)).toBe(taskFile([task()]));
    expect(setSites).not.toHaveBeenCalled();
  });

  it("removing a site that tasks use makes them show an error", async () => {
    backend({ "a.csv": taskFile([task()]) });
    await openTasks();
    fireEvent.click(btn("⚙ Settings"));
    const sites = screen.getByRole("region", { name: "Sites" });
    await waitFor(() => expect(within(sites).getByText("1 task in 1 file")).toBeTruthy());
    fireEvent.click(within(sites).getByRole("button", { name: "Remove kith.com" }));
    await waitFor(() => expect(setSites).toHaveBeenLastCalledWith(["shop.topps.com"]));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("1 task in 1 file still use it"), "Remove site");
    fireEvent.click(btn("⚙ Settings"));
    fireEvent.click(await screen.findByRole("button", { name: /^a\.csv/ }));
    await screen.findByLabelText("Row 1 site");
    await waitFor(() => expect(cell(1, "site").title).toBe("site isn't in the site list"));
  });
});

describe("editing task files", () => {
  it("saves an edit with LF line endings, changing only that value", async () => {
    const text = taskFile([task(), task({ input: "hoodie" })]);
    const { disk } = backend({ "t.csv": text });
    await openTaskFile();
    type(2, "delay", "4500");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(status()).toContain("Saved."));
    expect(disk.get(`${ROOT}\\task\\t.csv`)).toBe(text.replace(`hoodie,random,random,kith.com,preload,1,3000`, `hoodie,random,random,kith.com,preload,1,4500`));
  });

  it("templates copy the row as-is (tasks have no names)", async () => {
    const { disk } = backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    fireEvent.click(btn("From template"));
    fireEvent.click(screen.getByRole("rowheader", { name: "Row 1" }));
    const panel = screen.getByRole("region", { name: "Create from template" });
    expect(within(panel).getByText("Template: row 1")).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText("How many"), { target: { value: "2" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Create 2 rows" }));
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(disk.get(`${ROOT}\\task\\t.csv`)).toBe(taskFile([task(), task(), task()])));
  });

  it("new rows start with random size/color, 1 and 3000, and need the rest filled in", async () => {
    backend({ "t.csv": taskFile([task()]) });
    await openTaskFile();
    fireEvent.click(btn("Add row"));
    expect(["size", "color", "cartQuantity", "delay"].map((f) => cell(2, f).value)).toEqual(["random", "random", "1", "3000"]);
    await waitFor(() => expect(document.activeElement).toBe(cell(2, "profileGroup")));
    expect(btn("Save").disabled).toBe(true);
  });

  it("moves tasks to another task file", async () => {
    const { disk } = backend({ "a.csv": taskFile([task(), task({ input: "x" })]), "b.csv": taskFile([task({ input: "y" })]) });
    await openTaskFile("a.csv");
    fireEvent.click(screen.getByRole("rowheader", { name: "Row 2" }));
    fireEvent.click(btn("Move / copy to task file"));
    const panel = screen.getByRole("region", { name: "Move or copy to task file" });
    fireEvent.change(within(panel).getByRole("combobox"), { target: { value: `${ROOT}\\task\\b.csv` } });
    fireEvent.click(within(panel).getByRole("button", { name: /^Move/ }));
    expect(status()).toContain("Moved 1 task to b.csv (not saved yet).");
    const changes = screen.getByRole("region", { name: "Unsaved changes" });
    expect(within(changes).getAllByRole("button", { name: /task\// }).map((b) => b.textContent)).toEqual([
      "M task/a.csv",
      "M task/b.csv",
    ]);
    fireEvent.click(within(changes).getByRole("button", { name: "Save all" }));
    await within(changes).findByText("Saved 2 files.");
    expect(disk.get(`${ROOT}\\task\\a.csv`)).toBe(taskFile([task()]));
    expect(disk.get(`${ROOT}\\task\\b.csv`)).toBe(taskFile([task({ input: "y" }), task({ input: "x" })]));
  });

  it("creates a new task file with the header and LF", async () => {
    const { disk } = backend({});
    await openTasks();
    fireEvent.change(screen.getByRole("textbox", { name: /New task file/ }), { target: { value: "drop" } });
    fireEvent.click(btn("Create"));
    await screen.findByRole("heading", { name: "drop.csv" });
    expect(disk.get(`${ROOT}\\task\\drop.csv`)).toBe(`${H}\n`);
  });
});
