import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { confirmAction, pickFolder } from "./lib/dialogs";
import type { BackupEntry, FileEntry, TextFile } from "./lib/fs";
import { formatDateTime } from "./lib/format";
import { getMakebotPath, setMakebotPath } from "./lib/settings";
import { guardWindowClose } from "./lib/window";

vi.mock("./lib/settings", () => ({ getMakebotPath: vi.fn(), setMakebotPath: vi.fn() }));
vi.mock("./lib/dialogs", () => ({ pickFolder: vi.fn(), confirmAction: vi.fn(), askSaveDiscardCancel: vi.fn(), showMessage: vi.fn() }));
vi.mock("./lib/window", () => ({ guardWindowClose: vi.fn() }));

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
  fireEvent.click(await screen.findByRole("button", { name: /popmart\.txt/ }));
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
    await screen.findByRole("button", { name: /popmart\.txt/ });
    expect(callsOf(calls, "list_files")).toEqual([{ dir: `${ROOT}\\account`, extension: "txt" }]);
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

    fireEvent.click(await screen.findByRole("button", { name: "Change folder" }));

    expect(await screen.findByText("D:\\Other")).toBeTruthy();
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

    fireEvent.click(await screen.findByRole("button", { name: "Change folder" }));

    expect(await screen.findByText("disk full")).toBeTruthy();
    expect(screen.getByText(ROOT)).toBeTruthy();
  });
});

describe("modules and file list", () => {
  it("lists each module's folder with its extension", async () => {
    const calls = backend();
    render(<App />);
    await screen.findByRole("button", { name: /popmart\.txt/ });
    expect(screen.getByText("2.0 KB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));

    await screen.findByRole("button", { name: /303\.csv/ });
    expect(screen.queryByRole("button", { name: /popmart\.txt/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
    expect(callsOf(calls, "list_files")).toEqual([
      { dir: `${ROOT}\\account`, extension: "txt" },
      { dir: `${ROOT}\\task`, extension: "csv" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
    expect(await screen.findByText("No .csv files.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Proxies" }));
    await waitFor(() =>
      expect(callsOf(calls, "list_files")).toContainEqual({ dir: `${ROOT}\\proxy`, extension: "txt" }),
    );
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
    await screen.findByRole("button", { name: /popmart\.txt/ });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(callsOf(calls, "list_files")).toHaveLength(2));
  });

  it("clears the selected file when switching modules", async () => {
    backend();
    render(<App />);
    await openAccountFile();
    expect(await screen.findByRole("heading", { name: "popmart.txt" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(await screen.findByText("Select a file.")).toBeTruthy();
  });
});

describe("file panel", () => {
  it("shows file info without showing the contents", async () => {
    const calls = backend();
    render(<App />);
    await openAccountFile();

    expect(await screen.findByText("CRLF")).toBeTruthy();
    expect(screen.getByText("22 B")).toBeTruthy();
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.queryByText(/secret-password/)).toBeNull();
    expect(callsOf(calls, "read_text")).toEqual([{ path: ACCOUNT_FILE.path }]);
  });

  it("shows BOM and mixed line endings", async () => {
    backend({ read_text: () => ({ text: "\uFEFFa\r\nb\n", lineEnding: "mixed", hasBom: true }) });
    render(<App />);
    await openAccountFile();
    expect(await screen.findByText("Mixed (CRLF and LF)")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("shows read errors", async () => {
    backend({
      read_text: () => {
        throw "file is not valid UTF-8; not opened to avoid corrupting it";
      },
    });
    render(<App />);
    await openAccountFile();
    expect(await screen.findByText(/Couldn't read file: file is not valid UTF-8/)).toBeTruthy();
  });
});

describe("backups", () => {
  it("lists backups newest first", async () => {
    const calls = backend();
    render(<App />);
    await openAccountFile();

    const rows = await screen.findAllByRole("row");
    // header + 2 backups
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain(formatDateTime(BACKUPS[0].createdMs));
    expect(rows[2].textContent).toContain(formatDateTime(BACKUPS[1].createdMs));
    expect(callsOf(calls, "list_backups")).toEqual([{ path: ACCOUNT_FILE.path }]);
  });

  it("says when there are no backups", async () => {
    backend({ list_backups: () => [] });
    render(<App />);
    await openAccountFile();
    expect(await screen.findByText("No backups for this file yet.")).toBeTruthy();
  });

  it("restores a backup after confirmation and refreshes everything", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    const calls = backend();
    render(<App />);
    await openAccountFile();

    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    fireEvent.click(restoreButtons[1]);

    const when = formatDateTime(BACKUPS[1].createdMs);
    expect(await screen.findByText(`Restored the backup from ${when}.`)).toBeTruthy();
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining(`popmart.txt with the backup from ${when}`), "Restore backup");
    expect(callsOf(calls, "restore_backup")).toEqual([{ path: ACCOUNT_FILE.path, id: BACKUPS[1].id }]);
    await waitFor(() => {
      expect(callsOf(calls, "list_backups")).toHaveLength(2);
      expect(callsOf(calls, "read_text")).toHaveLength(2);
      expect(callsOf(calls, "list_files")).toHaveLength(2);
    });
  });

  it("does nothing when the restore is cancelled", async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    const calls = backend();
    render(<App />);
    await openAccountFile();

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
    await openAccountFile();

    fireEvent.click((await screen.findAllByRole("button", { name: "Restore" }))[0]);

    expect(await screen.findByText("Restore failed: Access is denied. (os error 5)")).toBeTruthy();
    expect(screen.queryByText(/Restored the backup/)).toBeNull();
  });
});
