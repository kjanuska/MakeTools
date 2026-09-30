import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { confirmAction } from "../../lib/dialogs";
import { TASK_COL as C } from "../../lib/formats/tasks";
import { getMakebotPath, getSites } from "../../lib/settings";
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

const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const status = () => screen.getByRole("status").textContent ?? "";
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const set = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
/** Rows of a breakdown table as [value, count, share]. */
const table = (name: string) =>
  within(screen.getByRole("table", { name }))
    .getAllByRole("row")
    .map((r) => [r.querySelector("th")!.textContent, ...[...r.querySelectorAll("td.num")].map((t) => t.textContent)]);

/** Opens a task file on its summary, with the links to other folders loaded. */
async function openFile(name: string) {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
  await screen.findByRole("heading", { name: "Task files" });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}`) }));
  await screen.findByRole("heading", { name });
  tab("Summary");
  // ALL rows count once the profile groups are known.
  await waitFor(() => expect(screen.getByRole("table", { name: "Profile groups" })).toBeTruthy());
}

describe("task file summary", () => {
  it("opens on the summary: tasks per group, profile, input, proxy group and mode", async () => {
    backend({ "s.csv": taskFile([task(), task({ name: "2", proxy: "us", input: "other", mode: "direct" })]) });
    await openFile("s.csv");
    await waitFor(() => expect(document.querySelector(".breakdown-total")!.textContent).toBe("4 tasks"));
    expect(table("Profile groups")).toEqual([["25", "4", "100%"]]);
    expect(table("Profiles in 25")).toEqual([
      ["1", "1", "25%"],
      ["2", "2", "50%"],
      ["3", "1", "25%"],
    ]);
    expect(table("Inputs")).toEqual([
      ["box logo -tee", "3", "75%"],
      ["other", "1", "25%"],
    ]);
    expect(table("Proxy groups")).toEqual([
      ["wealth", "3", "75%"],
      ["us", "1", "25%"],
    ]);
    expect(table("Modes")).toEqual([
      ["preload", "3", "75%"],
      ["direct", "1", "25%"],
    ]);
    expect(status()).toContain("No errors");
  });

  it("flags rows whose count isn't known", async () => {
    backend({ "s.csv": taskFile([task(), task({ group: "gone" })]) });
    await openFile("s.csv");
    await waitFor(() => expect(screen.getByText(/1 row not counted/)).toBeTruthy());
  });

  it("the grid is under Raw rows, and the view is remembered per file", async () => {
    backend({ "raw.csv": taskFile([task()]) });
    await openFile("raw.csv");
    tab("Raw rows");
    expect(await screen.findByLabelText("Row 1 profileGroup")).toBeTruthy();
    fireEvent.click(btn("← All task files"));
    fireEvent.click(await screen.findByRole("button", { name: /^raw\.csv/ }));
    expect(await screen.findByLabelText("Row 1 profileGroup")).toBeTruthy();
  });

  it("a file with the wrong header is read-only and can't be rebuilt", async () => {
    backend({ "bad.csv": "a,b,c\n1,2,3\n" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
    fireEvent.click(await screen.findByRole("button", { name: /^bad\.csv/ }));
    await screen.findByRole("heading", { name: "bad.csv" });
    tab("Builder");
    expect(screen.getByText(/open read-only and can't be rebuilt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review…" })).toBeNull();
  });
});

describe("task builder", () => {
  it("starts from the file's counts", async () => {
    backend({ "b.csv": taskFile([task(), task({ name: "2", input: "other", proxy: "us" })]) });
    await openFile("b.csv");
    tab("Builder");
    expect((screen.getByLabelText("Profile group") as HTMLSelectElement).value).toBe("25");
    expect(field("Profile group 25 tasks").value).toBe("4");
    expect(field("Input 1").value).toBe("box logo -tee");
    expect(field("Input 1 %").value).toBe("75");
    expect(field("Input 2").value).toBe("other");
    expect(field("Input 2 %").value).toBe("25");
    fireEvent.click(btn("Per profile…"));
    expect(field("25 / 2 tasks").value).toBe("2");
    // The result preview matches the file.
    expect(table("Proxy groups")).toEqual([
      ["wealth", "3", "75%"],
      ["us", "1", "25%"],
    ]);
  });

  it("builds a whole file: review, apply as an unsaved change, then save", async () => {
    const { disk, saves } = backend({ "b.csv": taskFile([task()]) });
    await openFile("b.csv");
    tab("Builder");
    set("Profile group 25 tasks", "6");
    fireEvent.click(within(screen.getByRole("group", { name: "Default proxyGroup" })).getByRole("button", { name: "Add value" }));
    set("Default proxyGroup value 2", "us");
    set("Default proxyGroup value 1 %", "50");
    set("Default proxyGroup value 2 %", "50");
    set("Input 1", "  box   logo ");
    expect(table("Proxy groups")).toEqual([
      ["wealth", "3", "50%"],
      ["us", "3", "50%"],
    ]);

    fireEvent.click(btn("Review…"));
    expect(screen.getByText(/replaces every task row in the file with 6 generated rows/)).toBeTruthy();
    // Before → after.
    expect(table("Proxy groups")).toEqual([
      ["wealth", "3", "50%"],
      ["us", "0 → 3", "50%"],
    ]);
    fireEvent.click(btn("Apply"));
    await waitFor(() => expect(status()).toContain("Applied: 6 tasks. Save to write the file."));
    expect(status()).toContain("Unsaved changes");
    expect(saves()).toHaveLength(0);
    expect(table("Profiles in 25")).toEqual([
      ["1", "2", "33.3%"],
      ["2", "2", "33.3%"],
      ["3", "2", "33.3%"],
    ]);

    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves()).toHaveLength(1));
    const text = disk.get(`${ROOT}\\task\\b.csv`)!;
    const lines = text.split("\n");
    expect(lines[0]).toBe(H);
    expect(text.endsWith("\n")).toBe(true);
    const rows = lines.slice(1, -1).map((l) => l.split(","));
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r[C.profileName])).toEqual(["1", "2", "3", "1", "2", "3"]);
    expect(rows.filter((r) => r[C.proxyGroup] === "us")).toHaveLength(3);
    expect(rows.every((r) => r[C.input] === "box logo" && r[C.site] === "kith.com" && r[C.delay] === "3000")).toBe(true);
  });

  it("problems block the review, with a list of what to fix", async () => {
    backend({ "b.csv": taskFile([task()]) });
    await openFile("b.csv");
    tab("Builder");
    fireEvent.click(btn("Add input"));
    set("Input 2", "second");
    set("Input 2 %", "40");
    expect(btn("Review…").disabled).toBe(true);
    const problems = within(screen.getByRole("list", { name: "Problems" }));
    expect(problems.getByText("Input %s must add up to 100.")).toBeTruthy();
    fireEvent.click(within(screen.getByText("Add input").parentElement!).getByRole("button", { name: "Even %" }));
    expect(field("Input 1 %").value).toBe("50");
    expect(screen.queryByRole("list", { name: "Problems" })?.textContent).toBeUndefined();
    expect(btn("Review…").disabled).toBe(false);
  });

  it("an input can override a split for itself", async () => {
    const { disk, saves } = backend({ "b.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("b.csv");
    tab("Builder");
    fireEvent.click(screen.getAllByRole("button", { name: "Own splits…" })[1]);
    fireEvent.click(screen.getByLabelText("Own site split"));
    set("Input 2 site value 1", "shop.topps.com");
    fireEvent.click(btn("Review…"));
    fireEvent.click(btn("Apply"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(disk.get(`${ROOT}\\task\\b.csv`)).toBe(
      taskFile([task({ name: "1" }), task({ name: "1", input: "cards", site: "shop.topps.com" })]),
    );
  });
});
