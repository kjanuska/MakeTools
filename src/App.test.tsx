import { fileItem } from "./test/fileList";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { confirmAction, pickFolder } from "./lib/dialogs";
import type { BackupEntry, FileEntry, TextFile } from "./lib/fs";
import { formatDateTime } from "./lib/format";
import { getMakebotPath, setMakebotPath } from "./lib/settings";
import { guardWindowClose } from "./lib/window";
import { FilePanel } from "./shell/FilePanel";

vi.mock("./lib/settings", () => ({
  getMakebotPath: vi.fn(),
  setMakebotPath: vi.fn(),
  getShortcutOverrides: vi.fn(async () => ({})),
  setShortcutOverrides: vi.fn(async () => {}),
  getSites: vi.fn(async () => ["kith.com"]),
  setSites: vi.fn(async () => {}),
}));
vi.mock("./lib/dialogs", () => ({ pickFolder: vi.fn(), confirmAction: vi.fn(), askSaveDiscardCancel: vi.fn(), showMessage: vi.fn() }));
vi.mock("./lib/window", () => ({ guardWindowClose: vi.fn() }));
vi.mock("./lib/updater", () => ({ currentVersion: vi.fn(async () => "0.1.72"), findUpdate: vi.fn(async () => null) }));

const ROOT = "C:\\Makebot";

function entry(folder: string, name: string, size = 10): FileEntry {
  return { name, path: `${ROOT}\\${folder}\\${name}`, size, modifiedMs: 1 };
}

const ACCOUNT_FILE = entry("account", "popmart.txt", 2048);
const TASK_FILE = entry("task", "303.csv");
const BACKUPS: BackupEntry[] = [
  { id: "001790000500000", createdMs: 1_790_000_500_000, size: 12 },
  { id: "001790000000000", createdMs: 1_790_000_000_000, size: 11 },
];
const TEXT: TextFile = { text: "user:secret-password\r\n", lineEnding: "crlf", hasBom: false };

type Args = Record<string, unknown>;
type Handlers = Record<string, (args: Args) => unknown>;
type Call = { cmd: string; args: Args };

function backend(overrides: Handlers = {}): Call[] {
  const handlers: Handlers = {
    list_files: ({ dir }) =>
      ({ [`${ROOT}\\account`]: [ACCOUNT_FILE], [`${ROOT}\\task`]: [TASK_FILE] })[dir as string] ?? [],
    read_text: () => TEXT,
    list_backups: () => BACKUPS,
    restore_backup: () => null,
    ...overrides,
  };
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: args as Args });
    const handler = handlers[cmd];
    if (!handler) throw `unexpected command ${cmd}`;
    return handler(args as Args);
  });
  return calls;
}

const callsOf = (calls: Call[], cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(setMakebotPath).mockResolvedValue();
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
});

async function openAccountFile() {
  fireEvent.click(await screen.findByRole("button", { name: fileItem("popmart") }));
}

describe("folder selection", () => {
  it("asks for the Makebot folder when none is saved, then remembers it", async () => {
    vi.mocked(getMakebotPath).mockResolvedValue(null);
    vi.mocked(pickFolder).mockResolvedValue(ROOT);
    const calls = backend();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Choose Makebot folder" }));

    expect(await screen.findByText(ROOT)).toBeTruthy();
    expect(setMakebotPath).toHaveBeenCalledWith(ROOT);
    await screen.findByRole("button", { name: fileItem("popmart") });
    // Every module's folder is listed (tasks need the others to check their links).
    expect(callsOf(calls, "list_files")).toEqual([
      { dir: `${ROOT}\\account`, extension: "txt" },
      { dir: `${ROOT}\\profile`, extension: "csv" },
      { dir: `${ROOT}\\proxy`, extension: "txt" },
      { dir: `${ROOT}\\task`, extension: "csv" },
    ]);
  });

  it("stays on the welcome screen when the picker is cancelled", async () => {
    vi.mocked(getMakebotPath).mockResolvedValue(null);
    vi.mocked(pickFolder).mockResolvedValue(null);
    backend();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Choose Makebot folder" }));

    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    expect(setMakebotPath).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Choose Makebot folder" })).toBeTruthy();
  });

  it("shows the welcome screen if the saved setting can't be read", async () => {
    vi.mocked(getMakebotPath).mockRejectedValue(new Error("store broken"));
    backend();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Choose Makebot folder" })).toBeTruthy();
  });

  it("changes to another folder", async () => {
    vi.mocked(pickFolder).mockResolvedValue("D:\\Other");
    const calls = backend();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "⚙ Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    expect(await screen.findByText("D:\\Other", { selector: ".root-path" })).toBeTruthy();
    expect(screen.getByText("D:\\Other", { selector: ".settings .path" })).toBeTruthy();
    expect(pickFolder).toHaveBeenCalledWith(ROOT);
    expect(setMakebotPath).toHaveBeenCalledWith("D:\\Other");
    await waitFor(() =>
      expect(callsOf(calls, "list_files")).toContainEqual({ dir: "D:\\Other\\account", extension: "txt" }),
    );
  });

  it("shows an error if saving the folder fails", async () => {
    vi.mocked(pickFolder).mockResolvedValue("D:\\Other");
    vi.mocked(setMakebotPath).mockRejectedValue("disk full");
    backend();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "⚙ Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    expect(await screen.findByText("disk full")).toBeTruthy();
    expect(screen.getByText(ROOT, { selector: ".root-path" })).toBeTruthy();
  });
});

describe("modules and file list", () => {
  it("each module tab has its own decorative icon; the label stays the tab's name", async () => {
    backend();
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Modules" });
    const tabs = within(nav).getAllByRole("button");
    expect(tabs.map((t) => t.textContent)).toEqual(["Accounts", "Profiles", "Proxies", "Tasks"]);
    const icons = tabs.map((t) => t.querySelector("svg.module-icon")!);
    expect(icons.map((i) => i.getAttribute("data-icon"))).toEqual(["accounts", "profiles", "proxies", "tasks"]);
    for (const i of icons) {
      expect(i.getAttribute("aria-hidden")).toBe("true");
      expect(i.childElementCount).toBeGreaterThan(0);
    }
    // Drawn differently, not one icon repeated.
    expect(new Set(icons.map((i) => i.innerHTML)).size).toBe(4);
    for (const name of ["Accounts", "Profiles", "Proxies", "Tasks"]) {
      expect(within(nav).getByRole("button", { name })).toBeTruthy();
    }
  });

  it("lists each module's folder with its extension", async () => {
    const calls = backend();
    render(<App />);
    await screen.findByRole("button", { name: fileItem("popmart") });
    // Names are shown without their extension.
    expect(screen.getByRole("region", { name: "Files" }).textContent).not.toMatch(/\.(txt|csv)/);
    // The file's count, not its size.
    expect(screen.queryByText("2.0 KB")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));

    await screen.findByRole("button", { name: fileItem("303") });
    expect(screen.queryByRole("button", { name: fileItem("popmart") })).toBeNull();
    expect(screen.getByRole("button", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
    // All folders are listed once, up front; switching modules doesn't list again.
    expect(callsOf(calls, "list_files")).toEqual([
      { dir: `${ROOT}\\account`, extension: "txt" },
      { dir: `${ROOT}\\profile`, extension: "csv" },
      { dir: `${ROOT}\\proxy`, extension: "txt" },
      { dir: `${ROOT}\\task`, extension: "csv" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
    expect(await screen.findByText("No files.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Proxies" }));
    expect(await screen.findByText("No files.")).toBeTruthy();
    expect(callsOf(calls, "list_files")).toHaveLength(4);
  });

  it("shows an error when a module folder is missing", async () => {
    backend({
      list_files: () => {
        throw "The system cannot find the path specified. (os error 3)";
      },
    });
    render(<App />);
    expect(await screen.findByText(/Couldn't list C:\\Makebot\\account/)).toBeTruthy();
  });

  it("reloads the list on Refresh", async () => {
    const calls = backend();
    render(<App />);
    await screen.findByRole("button", { name: fileItem("popmart") });
    await waitFor(() => expect(callsOf(calls, "list_files")).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(callsOf(calls, "list_files")).toHaveLength(8));
  });

  it("clears the selected file when switching modules", async () => {
    backend();
    render(<App />);
    await openAccountFile();
    expect(await screen.findByRole("heading", { name: "popmart" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Proxies" }));
    expect(await screen.findByText("Select a proxy file.")).toBeTruthy();
  });
});

describe("file panel", () => {
  it("shows file info without showing the contents", async () => {
    const calls = backend();
    render(<FilePanel file={ACCOUNT_FILE} onChanged={() => {}} />);

    expect(await screen.findByText("22 B")).toBeTruthy();
    // Line endings are an underlying detail and are not shown.
    expect(screen.queryByText("Line endings")).toBeNull();
    expect(screen.queryByText("CRLF")).toBeNull();
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.queryByText(/secret-password/)).toBeNull();
    // The file is read once.
    expect(callsOf(calls, "read_text").filter((a) => a.path === ACCOUNT_FILE.path)).toEqual([{ path: ACCOUNT_FILE.path }]);
  });

  it("shows a BOM", async () => {
    backend({ read_text: () => ({ text: "\uFEFFa\r\nb\n", lineEnding: "mixed", hasBom: true }) });
    render(<FilePanel file={ACCOUNT_FILE} onChanged={() => {}} />);
    expect(await screen.findByText("Yes")).toBeTruthy();
    expect(screen.queryByText(/Mixed/)).toBeNull();
  });

  it("shows read errors", async () => {
    backend({
      read_text: () => {
        throw "file is not valid UTF-8; not opened to avoid corrupting it";
      },
    });
    render(<FilePanel file={ACCOUNT_FILE} onChanged={() => {}} />);
    expect(await screen.findByText(/Couldn't read file: file is not valid UTF-8/)).toBeTruthy();
  });
});

describe("backups", () => {
  /** Opens an account file and its Backups dropdown. */
  async function openBackups() {
    await openAccountFile();
    fireEvent.click(await screen.findByRole("button", { name: "Backups ▾" }));
    return screen.getByRole("dialog", { name: "Backups" });
  }

  it("lists backups newest first", async () => {
    const calls = backend();
    render(<App />);
    const menu = await openBackups();

    const rows = await within(menu).findAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(formatDateTime(BACKUPS[0].createdMs));
    expect(rows[1].textContent).toContain(formatDateTime(BACKUPS[1].createdMs));
    expect(within(menu).getByText(/Restoring replaces the file right away/)).toBeTruthy();
    expect(callsOf(calls, "list_backups")).toEqual([{ path: ACCOUNT_FILE.path }]);
  });

  it("says when there are no backups", async () => {
    backend({ list_backups: () => [] });
    render(<App />);
    await openBackups();
    expect(await screen.findByText("No backups for this file yet.")).toBeTruthy();
  });

  it("restores a backup after confirmation and refreshes everything", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    const calls = backend();
    render(<App />);
    await openBackups();

    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    const reads = () => callsOf(calls, "read_text").filter((a) => a.path === ACCOUNT_FILE.path).length;
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    const readsBefore = reads();
    fireEvent.click(restoreButtons[1]);

    const when = formatDateTime(BACKUPS[1].createdMs);
    expect(await screen.findByText(`Restored the backup from ${when}.`)).toBeTruthy();
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining(`popmart with the backup from ${when}`), "Restore backup");
    expect(callsOf(calls, "restore_backup")).toEqual([{ path: ACCOUNT_FILE.path, id: BACKUPS[1].id }]);
    await waitFor(() => {
      expect(reads()).toBeGreaterThan(readsBefore);
      expect(callsOf(calls, "list_files")).toHaveLength(8);
    });
    // The dropdown closes after a restore.
    expect(screen.queryByRole("dialog", { name: "Backups" })).toBeNull();
  });

  it("does nothing when the restore is cancelled", async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    const calls = backend();
    render(<App />);
    await openBackups();

    fireEvent.click((await screen.findAllByRole("button", { name: "Restore" }))[0]);

    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(callsOf(calls, "restore_backup")).toEqual([]);
    expect(screen.queryByText(/Restored the backup/)).toBeNull();
  });

  it("shows restore errors", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    backend({
      restore_backup: () => {
        throw "Access is denied. (os error 5)";
      },
    });
    render(<App />);
    await openBackups();

    fireEvent.click((await screen.findAllByRole("button", { name: "Restore" }))[0]);

    expect(await screen.findByText("Restore failed: Access is denied. (os error 5)")).toBeTruthy();
    expect(screen.queryByText(/Restored the backup/)).toBeNull();
  });
});

describe("file list counts", () => {
  const PROFILE_HEADER =
    "profileName,firstName,lastName,email,address1,address2,city,state,zipcode,country,phoneNumber,ccNumber,ccMonth,ccYear,cvv";
  const profileRow = (n: number) =>
    `${n},Jane,Doe,jane${n}@example.com,101 Main St,,Springfield,IL,62701,US,2175550100,4111111111111111,01,28,123`;
  const TASK_HEADER = "profileGroup,profileName,proxyGroup,accountGroup,input,size,color,site,mode,cartQuantity,delay";
  const taskRow = (group: string, name: string) => `${group},${name},p,popmart,kw,random,random,kith.com,fast,1,0`;
  const pathOf = (folder: string, name: string) => entry(folder, name).path;

  const textsFor = (): Record<string, string> => ({
    [pathOf("account", "popmart.txt")]: "a@x.com:pw\r\nnot an account\r\n\r\nb@x.com:pw:1.2.3.4:80\r\n",
    [pathOf("account", "empty.txt")]: "",
    [pathOf("profile", "g.csv")]: [PROFILE_HEADER, profileRow(1), profileRow(2), ""].join("\n"),
    [pathOf("proxy", "p.txt")]: "1.1.1.1:80\n\n2.2.2.2:80\n3.3.3.3:80:u:p\n",
    // ALL in g (2 profiles) + one named profile = 3 tasks.
    [pathOf("task", "303.csv")]: [TASK_HEADER, taskRow("g", "ALL"), taskRow("g", "1"), ""].join("\n"),
    // ALL of a group that doesn't exist: its count isn't known.
    [pathOf("task", "odd.csv")]: [TASK_HEADER, taskRow("g", "2"), taskRow("missing", "ALL"), ""].join("\n"),
  });

  function countsBackend(texts = textsFor()) {
    const files: Record<string, FileEntry[]> = {
      account: [entry("account", "popmart.txt", 2048), entry("account", "empty.txt", 0)],
      profile: [entry("profile", "g.csv")],
      proxy: [entry("proxy", "p.txt")],
      task: [entry("task", "303.csv"), entry("task", "odd.csv")],
    };
    const calls = backend({
      list_files: ({ dir }) => files[(dir as string).slice(ROOT.length + 1)] ?? [],
      read_text: ({ path }): TextFile => ({ text: texts[path as string], lineEnding: "lf", hasBom: false }),
    });
    return { calls, files, texts };
  }

  const countOf = async (name: string, value: string) => {
    const button = await screen.findByRole("button", { name: fileItem(name) });
    await waitFor(() => expect(button.querySelector(".file-count")?.textContent).toBe(value));
    return button.querySelector(".file-count")!;
  };

  it("has column headers naming each module's files and counts", async () => {
    countsBackend();
    render(<App />);
    const headers = async () => {
      const row = await waitFor(() => screen.getByRole("region", { name: "Files" }).querySelector(".file-list-columns")!);
      return [...row.querySelectorAll("span")].map((s) => s.textContent);
    };
    await screen.findByRole("button", { name: fileItem("popmart") });
    expect(await headers()).toEqual(["Account group", "Number of accounts"]);
    for (const [module, file, cols] of [
      ["Profiles", "g", ["Profile group", "Number of profiles"]],
      ["Proxies", "p", ["Proxy group", "Number of proxies"]],
      ["Tasks", "303", ["Task file", "Number of tasks"]],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: module }));
      await screen.findByRole("button", { name: fileItem(file) });
      expect(await headers()).toEqual(cols);
    }
  });

  it("has no column headers when the folder is empty", async () => {
    backend();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
    expect(await screen.findByText("No files.")).toBeTruthy();
    expect(screen.queryByText("Profile group")).toBeNull();
  });

  it("shows accounts per account file, not the size", async () => {
    countsBackend();
    render(<App />);
    expect((await countOf("popmart", "2")).getAttribute("title")).toBe("2 accounts");
    expect((await countOf("empty", "0")).getAttribute("title")).toBe("0 accounts");
    expect(screen.queryByText("2.0 KB")).toBeNull();
  });

  it("shows profiles per group", async () => {
    countsBackend();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
    expect((await countOf("g", "2")).getAttribute("title")).toBe("2 profiles");
  });

  it("shows proxies per file, not counting blank lines, read once the module is shown", async () => {
    const { calls } = countsBackend();
    render(<App />);
    await countOf("popmart", "2");
    expect(callsOf(calls, "read_text")).not.toContainEqual({ path: pathOf("proxy", "p.txt") });
    fireEvent.click(screen.getByRole("button", { name: "Proxies" }));
    expect((await countOf("p", "3")).getAttribute("title")).toBe("3 proxies");
  });

  it("shows tasks per task file, with ALL counted as the group's profiles", async () => {
    countsBackend();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
    expect((await countOf("303", "3")).getAttribute("title")).toBe("3 tasks");
    expect((await countOf("odd", "1+?")).getAttribute("title")).toBe("1 task (+1 row with an unknown count)");
  });

  it("formats large counts with separators", async () => {
    const texts = textsFor();
    texts[pathOf("proxy", "p.txt")] = Array.from({ length: 1234 }, (_, i) => `${i}.0.0.1:80`).join("\n");
    countsBackend(texts);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Proxies" }));
    expect((await countOf("p", "1,234")).getAttribute("title")).toBe("1,234 proxies");
  });

  it("counts an account file again after it changes on disk", async () => {
    const { files, texts } = countsBackend();
    render(<App />);
    await countOf("popmart", "2");
    texts[pathOf("account", "popmart.txt")] += "c@x.com:pw\r\n";
    files.account = [{ ...files.account[0], modifiedMs: 2 }, files.account[1]];
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await countOf("popmart", "3");
  });
});
