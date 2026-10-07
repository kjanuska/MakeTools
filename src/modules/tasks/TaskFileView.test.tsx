/// <reference types="node" />
import { fileItem } from "../../test/fileList";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
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
/** Cells of a table row: the row's heading, then its cells. */
const cells = (r: Element) => [...r.querySelectorAll("th, td")].map((t) => t.textContent);
/** Body rows of a counts table as [value, tasks, share], or [value, now, new, share] while comparing. */
const table = (name: string) => [...screen.getByRole("table", { name }).querySelectorAll("tbody tr")].map(cells);
const headers = (name: string) => cells(screen.getByRole("table", { name }).querySelector("thead tr")!);
const totalRow = (name: string) => {
  const r = screen.getByRole("table", { name }).querySelector("tfoot tr");
  return r ? cells(r) : null;
};

/** Opens a task file on its Tasks view, with the links to other folders loaded. */
async function openFile(name: string) {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
  await screen.findByRole("heading", { name: "Task files" });
  fireEvent.click(await screen.findByRole("button", { name: fileItem(name) }));
  await screen.findByRole("heading", { name: name.replace(/\.\w+$/, "") });
  tab("Tasks");
  // ALL rows count once the profile groups are known.
  await waitFor(() => expect(screen.getByRole("table", { name: "Profile Groups" })).toBeTruthy());
  await waitFor(() => expect((screen.getByLabelText("Profile Group") as HTMLSelectElement).value).not.toBe(""));
}

describe("task counts", () => {
  it("opens on the Tasks view: tasks per group, profile, input, proxy group and mode", async () => {
    backend({ "s.csv": taskFile([task(), task({ name: "2", proxy: "us", input: "other", mode: "direct" })]) });
    await openFile("s.csv");
    await waitFor(() => expect(document.querySelector(".breakdown-total")!.textContent).toBe("4 tasks"));
    expect(table("Profile Groups")).toEqual([["25", "4", "100%"]]);
    // Nothing to compare: one Tasks column, labelled, with a total row when there's more than one value.
    expect(headers("Proxy Groups")).toEqual(["Proxy Group", "Tasks", "Share"]);
    expect(headers("Profiles in 25")).toEqual(["Profile", "Tasks", "Share"]);
    expect(totalRow("Proxy Groups")).toEqual(["Total", "4", "100%"]);
    expect(totalRow("Profile Groups")).toBeNull();
    expect(screen.queryByText(/Now: the file as it is/)).toBeNull();
    expect(table("Profiles in 25")).toEqual([
      ["1", "1", "25%"],
      ["2", "2", "50%"],
      ["3", "1", "25%"],
    ]);
    expect(table("Inputs")).toEqual([
      ["box logo -tee", "3", "75%"],
      ["other", "1", "25%"],
    ]);
    expect(table("Proxy Groups")).toEqual([
      ["wealth", "3", "75%"],
      ["us", "1", "25%"],
    ]);
    expect(table("Modes")).toEqual([
      ["preload", "3", "75%"],
      ["direct", "1", "25%"],
    ]);
    expect(status()).toContain("No errors");
    // Builder and counts are one view, and the counts have no bars.
    expect(screen.queryByRole("tab", { name: "Builder" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply to file" })).toBeTruthy();
    expect(document.querySelector(".bar")).toBeNull();
  });

  it("flags rows whose count isn't known", async () => {
    backend({ "s.csv": taskFile([task(), task({ group: "gone" })]) });
    await openFile("s.csv");
    await waitFor(() => expect(screen.getByText(/1 row in the file not counted/)).toBeTruthy());
  });

  it("the grid is under Raw rows, and the view is remembered per file", async () => {
    backend({ "raw.csv": taskFile([task()]) });
    await openFile("raw.csv");
    tab("Raw rows");
    expect(await screen.findByLabelText("Row 1 profileGroup")).toBeTruthy();
    fireEvent.click(btn("← All task files"));
    fireEvent.click(await screen.findByRole("button", { name: fileItem("raw") }));
    expect(await screen.findByLabelText("Row 1 profileGroup")).toBeTruthy();
  });

  it("a file with the wrong header is read-only and can't be rebuilt", async () => {
    backend({ "bad.csv": "a,b,c\n1,2,3\n" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
    fireEvent.click(await screen.findByRole("button", { name: fileItem("bad") }));
    await screen.findByRole("heading", { name: "bad" });
    tab("Tasks");
    expect(screen.getByText(/open read-only and can't be rebuilt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply to file" })).toBeNull();
  });
});

describe("task builder", () => {
  it("starts from the file's counts", async () => {
    backend({ "b.csv": taskFile([task(), task({ name: "2", input: "other", proxy: "us" })]) });
    await openFile("b.csv");
    expect((screen.getByLabelText("Profile Group") as HTMLSelectElement).value).toBe("25");
    expect(field("Total tasks for 25").value).toBe("4");
    expect(field("Input 1").value).toBe("box logo -tee");
    expect(field("Input 1 %").value).toBe("75");
    expect(field("Input 2").value).toBe("other");
    expect(field("Input 2 %").value).toBe("25");
    fireEvent.click(btn("Tasks per profile…"));
    expect(field("25 / 2 tasks").value).toBe("2");
    // The result preview matches the file.
    expect(table("Proxy Groups")).toEqual([
      ["wealth", "3", "75%"],
      ["us", "1", "25%"],
    ]);
  });

  it("builds a whole file: review, apply as an unsaved change, then save", async () => {
    const { disk, saves } = backend({ "b.csv": taskFile([task()]) });
    await openFile("b.csv");
    set("Total tasks for 25", "6");
    // "+" adds a row; one value at 100% counts as evenly distributed, so the two get 50% each.
    fireEvent.click(btn("Add Proxy Group (all inputs)"));
    set("Proxy Group (all inputs) 2", "us");
    expect(field("Proxy Group (all inputs) 1 %").value).toBe("50");
    expect(field("Proxy Group (all inputs) 2 %").value).toBe("50");
    expect(field("Proxy Group (all inputs) 2 %").disabled).toBe(true);
    set("Input 1", "  box   logo ");
    // The counts show how the file would change.
    expect(headers("Proxy Groups")).toEqual(["Proxy Group", "Now", "New", "Share"]);
    expect(table("Proxy Groups")).toEqual([
      ["wealth", "3", "3", "50%"],
      ["us", "0", "3", "50%"],
    ]);
    expect(totalRow("Proxy Groups")).toEqual(["Total", "3", "6", "100%"]);
    // Only counts that change are marked.
    const marked = [...screen.getByRole("table", { name: "Proxy Groups" }).querySelectorAll(".changed-num")];
    expect(marked.map((c) => c.textContent)).toEqual(["3"]);
    expect(marked[0].closest("tr")!.querySelector("th")!.textContent).toBe("us");
    expect(table("Profiles in 25")).toEqual([
      ["1", "1", "2", "33.3%"],
      ["2", "1", "2", "33.3%"],
      ["3", "1", "2", "33.3%"],
    ]);
    expect(screen.getByText("Now: the file as it is. New: what Apply would give.")).toBeTruthy();
    expect(screen.getByText(/Replaces every task row with 6 generated rows/)).toBeTruthy();
    fireEvent.click(btn("Apply to file"));
    await waitFor(() => expect(status()).toContain("Applied: 6 tasks. Save to write the file."));
    expect(status()).toContain("Unsaved changes");
    expect(saves()).toHaveLength(0);
    // The applied file is now what the counts compare against.
    expect(btn("Apply to file").disabled).toBe(true);
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

  it("problems block applying, with a list of what to fix", async () => {
    backend({ "b.csv": taskFile([task()]) });
    await openFile("b.csv");
    // Untick "Distribute evenly" to type %s.
    fireEvent.click(screen.getByLabelText("Distribute Input evenly"));
    fireEvent.click(btn("Add Input"));
    set("Input 2", "second");
    set("Input 2 %", "40");
    expect(btn("Apply to file").disabled).toBe(true);
    const problems = within(screen.getByRole("list", { name: "Problems" }));
    expect(problems.getByText("Input %s must add up to 100.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Distribute Input evenly"));
    expect(field("Input 1 %").value).toBe("50");
    expect(field("Input 2 %").value).toBe("50");
    expect(screen.queryByRole("list", { name: "Problems" })?.textContent).toBeUndefined();
    expect(btn("Apply to file").disabled).toBe(false);
  });

  it("an input can override a split for itself", async () => {
    const { disk, saves } = backend({ "b.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("b.csv");
    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[1]);
    fireEvent.click(screen.getByLabelText("Custom Site split"));
    set("Site for input 2 1", "shop.topps.com");
    fireEvent.click(btn("Done"));
    fireEvent.click(btn("Apply to file"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(disk.get(`${ROOT}\\task\\b.csv`)).toBe(
      taskFile([task({ name: "1" }), task({ name: "1", input: "cards", site: "shop.topps.com" })]),
    );
  });
});

describe("task builder: field editors", () => {
  it("mode: adds, reorders and removes parts, keeping their order", async () => {
    const { disk, saves } = backend({ "b.csv": taskFile([task({ name: "1", mode: "preload" })]) });
    await openFile("b.csv");
    const label = "Mode (all inputs) 1";
    fireEvent.click(screen.getByLabelText(label));
    const editor = screen.getByRole("dialog", { name: `Edit ${label}` });
    fireEvent.change(within(editor).getByLabelText("Add part"), { target: { value: "wait" } });
    fireEvent.change(within(editor).getByLabelText("Add part"), { target: { value: "stuck" } });
    const chips = () => [...screen.getByLabelText(label).querySelectorAll(".chip")].map((c) => c.textContent);
    expect(chips()).toEqual(["preload", "wait", "stuck"]);
    fireEvent.click(within(editor).getByRole("button", { name: "Move stuck left" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Remove preload" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Done" }));
    expect(chips()).toEqual(["stuck", "wait"]);
    fireEvent.click(btn("Apply to file"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(disk.get(`${ROOT}\\task\\b.csv`)).toBe(taskFile([task({ name: "1", mode: "stuckwait" })]));
  });

  it("mode offers every part", async () => {
    backend({ "b.csv": taskFile([task()]) });
    await openFile("b.csv");
    fireEvent.click(screen.getByLabelText("Mode (all inputs) 1"));
    const options = within(screen.getByLabelText("Add part")).getAllByRole("option").map((o) => o.textContent);
    expect(options.slice(1)).toEqual([
      "preload", "direct", "safe", "fast", "human", "wait", "pause", "login", "stuck",
      "shoppay", "lite", "store", "free", "cod", "paypal", "monitor",
    ]);
  });

  it("cart quantity and delay are spin buttons; size and color are text", async () => {
    backend({ "b.csv": taskFile([task()]) });
    await openFile("b.csv");
    const qty = field("Cart Quantity (all inputs) 1");
    expect([qty.type, qty.min, qty.step]).toEqual(["number", "1", "1"]);
    const delay = field("Delay (ms) (all inputs) 1");
    expect([delay.type, delay.min, delay.step]).toEqual(["number", "0", "100"]);
    expect(field("Size (all inputs) 1").type).toBe("text");
    expect(field("Color (all inputs) 1").type).toBe("text");
  });
});

describe("task builder: starting again", () => {
  it("nothing to apply until the build differs; Reset goes back to the file", async () => {
    backend({ "r.csv": taskFile([task()]) });
    await openFile("r.csv");
    expect(btn("Apply to file").disabled).toBe(true);
    expect(btn("Reset to file").disabled).toBe(true);
    set("Total tasks for 25", "9");
    expect(btn("Apply to file").disabled).toBe(false);
    expect(table("Profile Groups")).toEqual([["25", "3", "9", "100%"]]);
    fireEvent.click(btn("Reset to file"));
    expect(field("Total tasks for 25").value).toBe("3");
    expect(table("Profile Groups")).toEqual([["25", "3", "100%"]]);
  });

  it("discarding an applied build shows the file's counts again", async () => {
    backend({ "d.csv": taskFile([task()]) });
    await openFile("d.csv");
    set("Total tasks for 25", "9");
    fireEvent.click(btn("Apply to file"));
    await waitFor(() => expect(status()).toContain("Unsaved changes"));
    fireEvent.click(btn("Discard changes"));
    await waitFor(() => expect(status()).not.toContain("Unsaved changes"));
    expect(field("Total tasks for 25").value).toBe("3");
  });
});

describe("task builder: lists", () => {
  it("distributing evenly keeps %s equal when rows are added and removed", async () => {
    backend({ "e.csv": taskFile([task()]) });
    await openFile("e.csv");
    const even = screen.getByLabelText("Distribute Mode (all inputs) evenly") as HTMLInputElement;
    expect(even.checked).toBe(true);
    fireEvent.click(btn("Add Mode (all inputs)"));
    fireEvent.click(btn("Add Mode (all inputs)"));
    expect([1, 2, 3].map((i) => field(`Mode (all inputs) ${i} %`).value)).toEqual(["33.33", "33.33", "33.33"]);
    expect(screen.getAllByText("Total 100%").length).toBeGreaterThan(0);
    fireEvent.click(btn("Remove Mode (all inputs) 3"));
    expect([1, 2].map((i) => field(`Mode (all inputs) ${i} %`).value)).toEqual(["50", "50"]);
    // Unticked: the %s stay and can be typed.
    fireEvent.click(even);
    expect(field("Mode (all inputs) 1 %").disabled).toBe(false);
    set("Mode (all inputs) 1 %", "75");
    expect(screen.getByText("Total 125% (must be 100%)")).toBeTruthy();
  });

  it("unticking Distribute evenly puts back the %s from before it was ticked", async () => {
    backend({ "u.csv": taskFile([task(), task(), task({ proxy: "us" })]) });
    await openFile("u.csv");
    const pct = (i: number) => field(`Proxy Group (all inputs) ${i} %`).value;
    const even = () => screen.getByLabelText("Distribute Proxy Group (all inputs) evenly");
    expect([pct(1), pct(2)]).toEqual(["66.67", "33.33"]);
    fireEvent.click(even());
    expect([pct(1), pct(2)]).toEqual(["50", "50"]);
    fireEvent.click(even());
    expect([pct(1), pct(2)]).toEqual(["66.67", "33.33"]);
    // Back to exactly the file's split: nothing to apply.
    expect(btn("Apply to file").disabled).toBe(true);
  });

  it("rows added while ticked keep their even share; removed rows drop out", async () => {
    backend({ "u.csv": taskFile([task(), task(), task({ proxy: "us" })]) });
    await openFile("u.csv");
    const pct = (i: number) => field(`Proxy Group (all inputs) ${i} %`).value;
    const even = () => screen.getByLabelText("Distribute Proxy Group (all inputs) evenly");
    fireEvent.click(even());
    fireEvent.click(btn("Add Proxy Group (all inputs)"));
    expect([1, 2, 3].map(pct)).toEqual(["33.33", "33.33", "33.33"]);
    fireEvent.click(btn("Remove Proxy Group (all inputs) 1"));
    expect([1, 2].map(pct)).toEqual(["50", "50"]);
    fireEvent.click(even());
    // The "us" row gets its 33.33 back; the added row keeps its 50.
    expect([1, 2].map(pct)).toEqual(["33.33", "50"]);
    expect(screen.getByText("Total 83.33% (must be 100%)")).toBeTruthy();
  });

  it("an uneven split from the file starts unticked", async () => {
    backend({ "u.csv": taskFile([task(), task(), task({ proxy: "us" })]) });
    await openFile("u.csv");
    expect((screen.getByLabelText("Distribute Proxy Group (all inputs) evenly") as HTMLInputElement).checked).toBe(false);
    expect(field("Proxy Group (all inputs) 1 %").value).toBe("66.67");
  });

  it("uses readable field names (the file keeps its column names: see the save test)", async () => {
    backend({ "n.csv": taskFile([task()]) });
    await openFile("n.csv");
    const builder = within(document.querySelector<HTMLElement>(".task-builder")!);
    for (const name of ["Proxy Group", "Mode", "Site", "Size", "Color", "Account Group", "Cart Quantity", "Delay (ms)"]) {
      expect(builder.getByRole("heading", { name })).toBeTruthy();
    }
    expect(builder.queryByRole("heading", { name: "proxyGroup" })).toBeNull();
  });
});

describe("task builder: after applying", () => {
  it("keeps showing an input's custom split after Apply and Save", async () => {
    const { saves } = backend({ "c.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("c.csv");
    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[1]);
    fireEvent.click(screen.getByLabelText("Custom Site split"));
    set("Site for input 2 1", "shop.topps.com");
    fireEvent.click(btn("Done"));
    fireEvent.click(btn("Apply to file"));
    await waitFor(() => expect(status()).toContain("Applied"));
    /** The custom-split button of the input row with this text. */
    const customOf = (input: string) => {
      const row = screen.getAllByLabelText(/^Input \d+$/).find((el) => (el as HTMLInputElement).value === input)!;
      return row.closest(".split-row")!.querySelector("button[aria-haspopup]")!.textContent;
    };
    expect(customOf("cards")).toBe("Custom: Site");
    expect(customOf("box logo -tee")).toBe("Custom splits…");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(customOf("cards")).toBe("Custom: Site");
    expect((screen.getByLabelText("Proxy Group (all inputs) 1") as HTMLSelectElement).value).toBe("wealth");
    expect((screen.getByLabelText("Site (all inputs) 1") as HTMLSelectElement).value).toBe("kith.com");
  });

  it("keeps a custom split that happens to match the defaults", async () => {
    backend({ "m.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("m.csv");
    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[0]);
    fireEvent.click(screen.getByLabelText("Custom Mode split"));
    fireEvent.click(btn("Done"));
    set("Total tasks for 25", "4");
    fireEvent.click(btn("Apply to file"));
    await waitFor(() => expect(status()).toContain("Applied"));
    expect(screen.getByRole("button", { name: "Custom: Mode" })).toBeTruthy();
  });

  it("after discarding, the builder reads the file again", async () => {
    backend({ "x.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("x.csv");
    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[0]);
    fireEvent.click(screen.getByLabelText("Custom Mode split"));
    fireEvent.click(btn("Done"));
    set("Total tasks for 25", "4");
    fireEvent.click(btn("Apply to file"));
    await waitFor(() => expect(status()).toContain("Unsaved changes"));
    fireEvent.click(btn("Discard changes"));
    await waitFor(() => expect(status()).not.toContain("Unsaved changes"));
    expect(screen.queryByRole("button", { name: "Custom: Mode" })).toBeNull();
    expect(field("Total tasks for 25").value).toBe("2");
  });
});

describe("task builder: an input's splits dialog", () => {
  const dialog = () => screen.getByRole("dialog");

  it("opens as a dialog laid out like the splits for every input", async () => {
    backend({ "d.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("d.csv");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[1]);
    expect(screen.getByRole("dialog", { name: 'Splits for "cards"' })).toBeTruthy();
    const d = within(dialog());
    // A card per field, with the same names and hints as step 3.
    for (const name of ["Proxy Group", "Mode", "Site", "Size", "Color", "Account Group", "Cart Quantity", "Delay (ms)"]) {
      expect(d.getByRole("heading", { name })).toBeTruthy();
    }
    expect(d.getByText("Which proxy list the tasks use")).toBeTruthy();
    // Not custom: shows the split every input uses, read-only.
    const used = d.getByRole("table", { name: "Site (all inputs), used by input 2" });
    expect(within(used).getAllByRole("row").map((r) => r.textContent)).toEqual(["kith.com100%"]);
    expect(d.queryByLabelText("Site for input 2 1")).toBeNull();
    // Custom: the same editor as step 3, starting from the default.
    fireEvent.click(d.getByLabelText("Custom Site split"));
    expect((d.getByLabelText("Site for input 2 1") as HTMLSelectElement).value).toBe("kith.com");
    expect(d.getByRole("button", { name: "Add Site for input 2" })).toBeTruthy();
    expect(d.getByLabelText("Distribute Site for input 2 evenly")).toBeTruthy();
  });

  it("edits apply as they're made; Done closes and keeps them", async () => {
    backend({ "d.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("d.csv");
    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[1]);
    fireEvent.click(screen.getByLabelText("Custom Site split"));
    set("Site for input 2 1", "shop.topps.com");
    // The counts beside the builder already show it.
    expect(table("Sites")).toEqual([
      ["kith.com", "2", "1", "50%"],
      ["shop.topps.com", "0", "1", "50%"],
    ]);
    fireEvent.click(btn("Done"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn("Custom: Site")).toBeTruthy();
  });

  it("Cancel and Escape put back what was there when it opened", async () => {
    backend({ "d.csv": taskFile([task({ name: "1" }), task({ name: "1", input: "cards" })]) });
    await openFile("d.csv");
    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[1]);
    fireEvent.click(screen.getByLabelText("Custom Site split"));
    set("Site for input 2 1", "shop.topps.com");
    fireEvent.click(btn("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Custom splits…" })).toHaveLength(2);
    expect(btn("Apply to file").disabled).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Custom splits…" })[0]);
    fireEvent.click(screen.getByLabelText("Custom Mode split"));
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Custom splits…" })).toHaveLength(2);
  });

  it("app shortcuts don't act behind it (Ctrl+S doesn't save)", async () => {
    const { saves } = backend({ "d.csv": taskFile([task()]) });
    await openFile("d.csv");
    set("Total tasks for 25", "6");
    fireEvent.click(btn("Apply to file"));
    await waitFor(() => expect(status()).toContain("Unsaved changes"));
    fireEvent.click(btn("Custom splits…"));
    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(saves()).toHaveLength(0);
    // Closed, the shortcut works again.
    fireEvent.click(btn("Done"));
    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saves()).toHaveLength(1));
  });

  it("unticking a custom split goes back to the default", async () => {
    // 3 tasks per input (ALL in group 25), so the file clearly has a custom site for "cards".
    backend({ "d.csv": taskFile([task(), task({ input: "cards", site: "shop.topps.com" })]) });
    await openFile("d.csv");
    fireEvent.click(btn("Custom: Site"));
    const box = screen.getByLabelText("Custom Site split") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(within(dialog()).getByRole("table", { name: "Site (all inputs), used by input 2" })).toBeTruthy();
    fireEvent.click(btn("Done"));
    expect(screen.getAllByRole("button", { name: "Custom splits…" })).toHaveLength(2);
  });
});

describe("task file header", () => {
  it("sits flush with the top of the scrolling area (no padding for content to show through)", async () => {
    backend({ "h.csv": taskFile([task()]) });
    await openFile("h.csv");
    // tasks.css takes .main's padding away when a task file is its direct child, and
    // the sticky header sticks at top 0 across the full width.
    expect(document.querySelector("main.main > .task-file > .task-head")).toBeTruthy();
    const css = fs.readFileSync(path.join(__dirname, "tasks.css"), "utf8");
    expect(css).toMatch(/\.main:has\(> \.task-file\) \{\s*padding: 0;/);
    expect(css).toMatch(/\.task-head \{[^}]*position: sticky;[^}]*top: 0;[^}]*margin: 0 -20px/);
    expect(css).toMatch(/\.task-file \{\s*padding: 0 20px/);
  });

  it("holds Apply to file and Reset to file next to Save, in the sticky header", async () => {
    backend({ "h.csv": taskFile([task()]) });
    await openFile("h.csv");
    const head = document.querySelector(".task-head")!;
    const bar = within(screen.getByRole("toolbar", { name: "Task file actions" }));
    expect(head.contains(screen.getByRole("toolbar", { name: "Task file actions" }))).toBe(true);
    expect(bar.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Apply to file",
      "Reset to file",
      "Save",
      "Discard changes",
    ]);
    // The file name and tabs are in the header too; the builder isn't.
    expect(within(head as HTMLElement).getByRole("heading", { name: "h" })).toBeTruthy();
    expect(within(head as HTMLElement).getByRole("tab", { name: "Tasks" })).toBeTruthy();
    expect(head.contains(screen.getByLabelText("Total tasks for 25"))).toBe(false);
    // Only one set of builder buttons.
    expect(screen.getAllByRole("button", { name: "Apply to file" })).toHaveLength(1);

    set("Total tasks for 25", "6");
    expect(bar.getByText(/Replaces every task row with 6 generated rows/)).toBeTruthy();
    fireEvent.click(bar.getByRole("button", { name: "Apply to file" }));
    await waitFor(() => expect(status()).toContain("Unsaved changes"));
    expect(bar.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows how many problems there are, with a link to the list", async () => {
    backend({ "h.csv": taskFile([task()]) });
    await openFile("h.csv");
    fireEvent.click(screen.getByLabelText("Distribute Input evenly"));
    set("Input 1 %", "40");
    const bar = within(screen.getByRole("toolbar", { name: "Task file actions" }));
    const link = bar.getByRole("button", { name: "1 problem to fix" });
    const list = screen.getByRole("list", { name: "Problems" });
    const scrolled = vi.fn();
    list.scrollIntoView = scrolled;
    fireEvent.click(link);
    expect(scrolled).toHaveBeenCalled();
    expect(document.querySelector(".task-head")!.contains(list)).toBe(false);
    // First thing in the builder, above the profile groups, not at the bottom.
    const builder = document.querySelector(".task-builder")!;
    expect(builder.firstElementChild).toBe(list);
    expect(list.compareDocumentPosition(screen.getByRole("button", { name: "Apply to file" }))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });
});
