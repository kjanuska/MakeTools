import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { pickTextFile } from "../../lib/dialogs";
import type { FileEntry } from "../../lib/fs";
import { getMakebotPath } from "../../lib/settings";
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
  pickTextFile: vi.fn(),
  confirmAction: vi.fn(),
  askSaveDiscardCancel: vi.fn(),
  showMessage: vi.fn(),
}));
vi.mock("../../lib/window", () => ({ guardWindowClose: vi.fn() }));

const ROOT = "C:\\Makebot";
const ACC = `${ROOT}\\account`;

const POPMART = [
  "a.one@gmail.com:Pass.?1",
  "b.two@gmail.com:Pass2!@:1.2.3.4:8080",
  "c.three@yahoo.com:Pass3:5.6.7.8:3128:puser:ppass",
].join("\r\n") + "\r\n";

function backend(files: Record<string, string>, opts: { failSave?: boolean } = {}) {
  const disk = new Map(Object.entries(files));
  const calls: { cmd: string; args: Record<string, string> }[] = [];
  mockIPC((cmd, a) => {
    const args = a as Record<string, string>;
    calls.push({ cmd, args });
    switch (cmd) {
      case "list_files":
        return [...disk.keys()]
          .filter((p) => p.startsWith(args.dir + "\\") && p.endsWith("." + args.extension))
          .sort()
          .map((path): FileEntry => ({ name: path.slice(args.dir.length + 1), path, size: disk.get(path)!.length, modifiedMs: 1 }));
      case "read_text":
        if (!disk.has(args.path)) throw "not found";
        return { text: disk.get(args.path)!, lineEnding: "crlf", hasBom: false };
      case "save_text":
        if (opts.failSave) throw "Access is denied. (os error 5)";
        disk.set(args.path, args.text);
        return null;
      case "create_file":
        if (disk.has(args.path)) throw "The file exists. (os error 80)";
        disk.set(args.path, args.text);
        return null;
      case "list_backups":
        return [];
      default:
        throw `unexpected command ${cmd}`;
    }
  });
  const saves = () => calls.filter((c) => c.cmd === "save_text").map((c) => c.args);
  return { disk, calls, saves };
}

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
});

const groupsTable = () => screen.getByRole("table", { name: "Account groups" });
const accountRows = () =>
  within(screen.getByRole("table", { name: "Accounts" }))
    .getAllByRole("row")
    .slice(1)
    .map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));

async function openGroup(name: string) {
  render(<App />);
  await screen.findByRole("heading", { name: "Account groups" });
  fireEvent.click(await within(groupsTable()).findByRole("button", { name }));
  await screen.findByRole("heading", { name });
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
}

function paste(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Import accounts…" }));
  fireEvent.change(screen.getByLabelText("Accounts to import"), { target: { value: text } });
}

describe("account groups overview", () => {
  it("lists each group with its counts and totals", async () => {
    backend({
      [`${ACC}\\popmart.txt`]: POPMART,
      [`${ACC}\\raffle.txt`]: "",
      [`${ACC}\\odd.txt`]: "x@gmail.com:p\r\nbroken line\r\n",
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Account groups" });
    await waitFor(() => expect(within(groupsTable()).queryByText("Loading…")).toBeNull());
    const rows = within(groupsTable())
      .getAllByRole("row")
      .slice(1)
      .map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([
      ["odd", "1", "0", "gmail.com (1)", "1 unrecognized line"],
      ["popmart", "3", "2", "gmail.com (2)", "OK"],
      ["raffle", "0", "0", "", "OK"],
    ]);
    const cards = screen.getAllByText(/^(groups|accounts|with a proxy)$/).map((l) => `${l.previousSibling?.textContent} ${l.textContent}`);
    expect(cards).toEqual(["3 groups", "4 accounts", "2 with a proxy"]);
  });

  it("creates an empty group and opens it", async () => {
    const { disk } = backend({ [`${ACC}\\popmart.txt`]: POPMART });
    render(<App />);
    await screen.findByRole("heading", { name: "Account groups" });
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "popmart" } });
    expect(screen.getByText('A group named "popmart" already exists.')).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "bad:name" } });
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "nike" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("heading", { name: "nike" })).toBeTruthy();
    expect(disk.get(`${ACC}\\nike.txt`)).toBe("");
    expect(await screen.findByText(/No accounts in this group yet/)).toBeTruthy();
  });
});

describe("account group page", () => {
  it("shows every account with its password and proxy in plain text", async () => {
    backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    expect(accountRows()).toEqual([
      ["1", "a.one@gmail.com", "Pass.?1", "—", "—", "—"],
      ["2", "b.two@gmail.com", "Pass2!@", "1.2.3.4:8080", "—", "—"],
      ["3", "c.three@yahoo.com", "Pass3", "5.6.7.8:3128", "puser", "ppass"],
    ]);
    expect(within(screen.getByRole("list", { name: "Email domains" })).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
      "gmail.com2",
      "yahoo.com1",
    ]);
  });

  it("leaves out the proxy login columns when no account has one", async () => {
    backend({ [`${ACC}\\g.txt`]: "a@x.com:p\r\nb@x.com:p:1.1.1.1:80\r\n" });
    await openGroup("g");
    const headers = within(screen.getByRole("table", { name: "Accounts" })).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Line", "Email", "Password", "Proxy"]);
  });

  it("lists lines that aren't accounts, with their line numbers", async () => {
    backend({ [`${ACC}\\g.txt`]: "a@x.com:p\r\n\r\nnot-an-account\r\nb@x.com:p\r\n" });
    await openGroup("g");
    expect(screen.getByText("1 line isn't in the account format")).toBeTruthy();
    expect(screen.getByText("not-an-account").closest("li")!.textContent).toBe("Line 3: not-an-account");
    expect(accountRows().map((r) => r[0])).toEqual(["1", "4"]);
  });

  const emails = () => accountRows().map((r) => r[1]);
  const card = (name: RegExp) => screen.getByRole("button", { name });
  const WITH = /^\d+with a proxy$/;
  const WITHOUT = /^\d+without a proxy$/;
  const domain = (d: string) => within(screen.getByRole("list", { name: "Email domains" })).getByRole("button", { name: new RegExp(`^${d}\\d+$`) });

  it("searches by email, proxy host and proxy user", async () => {
    backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "GMAIL" } });
    expect(emails()).toEqual(["a.one@gmail.com", "b.two@gmail.com"]);
    expect(screen.getByText("2 of 3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "5.6.7" } });
    expect(emails()).toEqual(["c.three@yahoo.com"]);
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "puser" } });
    expect(emails()).toEqual(["c.three@yahoo.com"]);
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "nobody" } });
    expect(screen.getByText("No accounts match.")).toBeTruthy();
  });

  it("filters by proxy from the summary cards, which toggle", async () => {
    backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    expect(screen.queryByRole("group", { name: "Proxy filter" })).toBeNull();
    fireEvent.click(card(WITH));
    expect(card(WITH).getAttribute("aria-pressed")).toBe("true");
    expect(emails()).toEqual(["b.two@gmail.com", "c.three@yahoo.com"]);
    // The other proxy card replaces it.
    fireEvent.click(card(WITHOUT));
    expect(card(WITH).getAttribute("aria-pressed")).toBe("false");
    expect(emails()).toEqual(["a.one@gmail.com"]);
    // Clicking again turns it off.
    fireEvent.click(card(WITHOUT));
    expect(card(WITHOUT).getAttribute("aria-pressed")).toBe("false");
    expect(emails()).toHaveLength(3);
  });

  it("filters by email domain, several at once, combined with the proxy filter and search", async () => {
    backend({ [`${ACC}\\popmart.txt`]: `${POPMART}d@outlook.com:p\r\nnoat:p\r\n` });
    await openGroup("popmart");
    fireEvent.click(domain("gmail.com"));
    expect(emails()).toEqual(["a.one@gmail.com", "b.two@gmail.com"]);
    fireEvent.click(domain("outlook.com"));
    expect(emails()).toEqual(["a.one@gmail.com", "b.two@gmail.com", "d@outlook.com"]);
    fireEvent.click(card(WITH));
    expect(emails()).toEqual(["b.two@gmail.com"]);
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "a.one" } });
    expect(screen.getByText("No accounts match.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "" } });
    fireEvent.click(domain("gmail.com"));
    fireEvent.click(domain("outlook.com"));
    expect(emails()).toEqual(["b.two@gmail.com", "c.three@yahoo.com"]);
    fireEvent.click(card(WITH));
    // Emails without an @ get their own entry.
    fireEvent.click(domain("\\(no domain\\)"));
    expect(emails()).toEqual(["noat"]);
  });

  it("clears every filter at once", async () => {
    backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    fireEvent.click(card(WITH));
    fireEvent.click(domain("gmail.com"));
    expect(emails()).toEqual(["b.two@gmail.com"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(emails()).toHaveLength(3);
    expect(domain("gmail.com").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("shows the top 6 domains, and all of them on request", async () => {
    // Domains a.com to h.com with 9 down to 2 accounts.
    const text = ["a", "b", "c", "d", "e", "f", "g", "h"]
      .flatMap((d, i) => Array.from({ length: 9 - i }, (_, k) => `u${k}@${d}.com:p\r\n`))
      .join("");
    backend({ [`${ACC}\\g.txt`]: text });
    await openGroup("g");
    const listed = () =>
      within(screen.getByRole("list", { name: "Email domains" }))
        .getAllByRole("button")
        .map((b) => b.textContent);
    expect(listed()).toEqual(["a.com9", "b.com8", "c.com7", "d.com6", "e.com5", "f.com4", "+2 more domains"]);
    fireEvent.click(screen.getByRole("button", { name: "+2 more domains" }));
    fireEvent.click(domain("h.com"));
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    // A selected domain stays listed so it can be turned off.
    expect(listed()).toEqual(["a.com9", "b.com8", "c.com7", "d.com6", "e.com5", "f.com4", "h.com2", "+1 more domain"]);
    expect(emails()).toHaveLength(2);
  });

  it("goes back to the overview", async () => {
    backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    fireEvent.click(screen.getByRole("button", { name: "← All account groups" }));
    expect(await screen.findByRole("heading", { name: "Account groups" })).toBeTruthy();
  });
});

describe("importing accounts", () => {
  it("previews the lines to add and the ones not in the format, without deduplicating", async () => {
    backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    paste("new1@gmail.com:pw\na.one@gmail.com:Pass.?1\nnew1@gmail.com:pw\nbroken\nnot-an-email:pw:host:port\n\nnew3@x.com:pw:9.9.9.9:80:u:p");
    expect(screen.getByRole("status").textContent).toBe("5 accounts to add · 1 line not in the format, skipped");
    expect(screen.getByText("broken").closest("li")!.textContent).toContain("Line 4");
    expect(screen.getByRole("button", { name: "Add 5 accounts" })).toBeTruthy();
  });

  it("appends the new accounts with the file's line endings, keeping every existing byte", async () => {
    const { disk, saves } = backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    paste("new1@gmail.com:pw\nbroken\nnew2@x.com:pw:9.9.9.9:80:u:p\n");
    fireEvent.click(screen.getByRole("button", { name: "Add 2 accounts" }));

    expect(await screen.findByText("Added 2 accounts to popmart. Skipped 1. The previous version was backed up.")).toBeTruthy();
    expect(saves()).toEqual([
      { path: `${ACC}\\popmart.txt`, text: `${POPMART}new1@gmail.com:pw\r\nnew2@x.com:pw:9.9.9.9:80:u:p\r\n` },
    ]);
    expect(disk.get(`${ACC}\\popmart.txt`)!.startsWith(POPMART)).toBe(true);
    await waitFor(() => expect(accountRows()).toHaveLength(5));
    const rows = within(screen.getByRole("table", { name: "Accounts" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.classList.contains("new-account"))).toEqual([false, false, false, true, true]);
    // The panel closes after a successful import.
    expect(screen.queryByLabelText("Accounts to import")).toBeNull();
  });

  it("adds a missing final line ending and keeps LF files LF", async () => {
    const { saves } = backend({ [`${ACC}\\g.txt`]: "a@x.com:p\nb@x.com:p" });
    await openGroup("g");
    paste("c@x.com:p");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 account" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].text).toBe("a@x.com:p\nb@x.com:p\nc@x.com:p\n");
  });

  it("fills an empty group", async () => {
    const { saves } = backend({ [`${ACC}\\raffle.txt`]: "" });
    await openGroup("raffle");
    paste("a@x.com:p\r\nb@x.com:p\r\n");
    fireEvent.click(screen.getByRole("button", { name: "Add 2 accounts" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].text).toBe("a@x.com:p\r\nb@x.com:p\r\n");
  });

  it("appends to the file as it is on disk at the time of the import", async () => {
    const { disk, saves } = backend({ [`${ACC}\\g.txt`]: "a@x.com:p\r\n" });
    await openGroup("g");
    paste("b@x.com:p\nc@x.com:p");
    // Changed outside the app after it was opened.
    disk.set(`${ACC}\\g.txt`, "a@x.com:p\r\nb@x.com:p\r\n");
    fireEvent.click(screen.getByRole("button", { name: "Add 2 accounts" }));
    expect(await screen.findByText("Added 2 accounts to g. The previous version was backed up.")).toBeTruthy();
    expect(saves()[0].text).toBe("a@x.com:p\r\nb@x.com:p\r\nb@x.com:p\r\nc@x.com:p\r\n");
  });

  it("can't add when no line is in the format", async () => {
    const { saves } = backend({ [`${ACC}\\popmart.txt`]: POPMART });
    await openGroup("popmart");
    paste("broken\na:b:c");
    const add = screen.getByRole("button", { name: "Add 0 accounts" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(saves()).toEqual([]);
  });

  it("loads the lines from a text file", async () => {
    vi.mocked(pickTextFile).mockResolvedValue("D:\\new.txt");
    backend({ [`${ACC}\\g.txt`]: "a@x.com:p\r\n", "D:\\new.txt": "b@x.com:p\r\nc@x.com:p\r\n" });
    await openGroup("g");
    paste("z@x.com:p");
    fireEvent.click(screen.getByRole("button", { name: "Load from file…" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Accounts to import") as HTMLTextAreaElement).value.replace(/\r\n/g, "\n")).toBe("z@x.com:p\nb@x.com:p\nc@x.com:p\n"),
    );
    expect(screen.getByRole("status").textContent).toBe("3 accounts to add");
  });

  it("does nothing when the file picker is cancelled", async () => {
    vi.mocked(pickTextFile).mockResolvedValue(null);
    backend({ [`${ACC}\\g.txt`]: "a@x.com:p\r\n" });
    await openGroup("g");
    paste("z@x.com:p");
    fireEvent.click(screen.getByRole("button", { name: "Load from file…" }));
    await waitFor(() => expect(pickTextFile).toHaveBeenCalled());
    expect((screen.getByLabelText("Accounts to import") as HTMLTextAreaElement).value).toBe("z@x.com:p");
  });

  it("shows a failed save and keeps the pasted text", async () => {
    backend({ [`${ACC}\\g.txt`]: "a@x.com:p\r\n" }, { failSave: true });
    await openGroup("g");
    paste("b@x.com:p");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 account" }));
    expect(await screen.findByText("Import failed: Access is denied. (os error 5)")).toBeTruthy();
    expect((screen.getByLabelText("Accounts to import") as HTMLTextAreaElement).value).toBe("b@x.com:p");
  });
});

describe("big account groups (only the rows in view are drawn)", { timeout: 15000 }, () => {
  const BIG = 1000;
  const bigGroup = () =>
    Array.from({ length: BIG }, (_, i) => `user${i + 1}@gmail.com:pw${i + 1}:10.0.0.${i % 250}:8080\r\n`).join("");

  it("draws only the first rows, with the counts of all of them", async () => {
    backend({ [`${ACC}\\big.txt`]: bigGroup() });
    await openGroup("big");
    const rows = accountRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(BIG);
    expect(rows[0]).toEqual(["1", "user1@gmail.com", "pw1", "10.0.0.0:8080"]);
    expect(screen.getByText(`${BIG} accounts`)).toBeTruthy();
  });

  it("search finds an account that isn't drawn yet", async () => {
    backend({ [`${ACC}\\big.txt`]: bigGroup() });
    await openGroup("big");
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "user987@" } });
    expect(accountRows()).toEqual([["987", "user987@gmail.com", "pw987", "10.0.0.236:8080"]]);
  });

  it("sizes the columns for every row, so they don't change width while scrolling", async () => {
    backend({ [`${ACC}\\big.txt`]: `${bigGroup()}a-much-longer-address-at-the-end@example.com:p\r\n` });
    await openGroup("big");
    const cols = [...screen.getByRole("table", { name: "Accounts" }).querySelectorAll("col")].map((c) => c.style.width);
    expect(cols[1]).toBe(`calc(${"a-much-longer-address-at-the-end@example.com".length}ch + 28px)`);
  });

  it("stripes rows by their place in the list, not by what's drawn", async () => {
    backend({ [`${ACC}\\big.txt`]: bigGroup() });
    await openGroup("big");
    const trs = within(screen.getByRole("table", { name: "Accounts" })).getAllByRole("row").slice(1, 5);
    expect(trs.map((tr) => tr.classList.contains("stripe"))).toEqual([false, true, false, true]);
  });
});
