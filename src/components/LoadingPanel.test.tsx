import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { PROFILE_HEADER } from "../lib/formats/profiles";
import { TASK_HEADER } from "../lib/formats/tasks";
import type { FileEntry } from "../lib/fs";
import { getMakebotPath } from "../lib/settings";
import { guardWindowClose } from "../lib/window";
import { fileItem } from "../test/fileList";
import { LoadingPanel, useFirstPaintDone } from "./LoadingPanel";

vi.mock("../lib/settings", () => ({
  getMakebotPath: vi.fn(),
  setMakebotPath: vi.fn(),
  getShortcutOverrides: vi.fn(async () => ({})),
  setShortcutOverrides: vi.fn(async () => {}),
  getSites: vi.fn(async () => ["kith.com"]),
  setSites: vi.fn(async () => {}),
}));
vi.mock("../lib/dialogs", () => ({
  pickFolder: vi.fn(),
  confirmAction: vi.fn(),
  askSaveDiscardCancel: vi.fn(),
  showMessage: vi.fn(),
}));
vi.mock("../lib/window", () => ({ guardWindowClose: vi.fn() }));

const ROOT = "C:\\Makebot";
const PROFILE = `1,Jane,Doe,jane1@example.com,101 Main St,,Springfield,IL,62701,US,2175550100,4111111111111111,01,28,123`;
const TASK = "g,ALL,p,a,box logo -tee,random,random,kith.com,preload,1,3000";

const FILES: Record<string, string> = {
  [`${ROOT}\\profile\\g.csv`]: `${PROFILE_HEADER}\r\n${PROFILE}\r\n`,
  [`${ROOT}\\task\\t.csv`]: `${TASK_HEADER}\n${TASK}\n`,
  [`${ROOT}\\proxy\\p.txt`]: "1.2.3.4:80\n",
  [`${ROOT}\\account\\a.txt`]: "a.one@gmail.com:Pass1\r\n",
};

/** Reads of files in this folder wait until released (to see the loading state). */
let gate: { folder: string; promise: Promise<void> } | null = null;

function backend(read: (path: string) => string = (p) => FILES[p]) {
  mockIPC((cmd, a) => {
    const args = a as Record<string, string>;
    switch (cmd) {
      case "list_files":
        return Object.keys(FILES)
          .filter((p) => p.startsWith(args.dir + "\\") && p.endsWith("." + args.extension))
          .map((path): FileEntry => ({ name: path.slice(args.dir.length + 1), path, size: FILES[path].length, modifiedMs: 1 }));
      case "read_text": {
        const result = () => ({ text: read(args.path), lineEnding: "lf", hasBom: false });
        return gate && args.path.startsWith(`${ROOT}\\${gate.folder}\\`) ? gate.promise.then(result) : result();
      }
      case "list_backups":
        return [];
      default:
        throw `unexpected command ${cmd}`;
    }
  });
}

/** Holds back reads in a folder; returns the function that lets them through. */
function holdReads(folder: string): () => void {
  let release!: () => void;
  gate = { folder, promise: new Promise((r) => (release = r)) };
  return release;
}

beforeEach(() => {
  vi.mocked(getMakebotPath).mockResolvedValue(ROOT);
  vi.mocked(guardWindowClose).mockResolvedValue(() => {});
  gate = null;
});

async function openIn(module: string, file: string) {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: module }));
  fireEvent.click(await screen.findByRole("button", { name: fileItem(file) }));
}

const spinner = () => document.querySelector(".file-panel .loading .spinner");

describe("opening a file shows it at once, with a spinner until it's read", () => {
  it("profiles", async () => {
    const release = holdReads("profile");
    backend();
    await openIn("Profiles", "g.csv");
    expect(await screen.findByText("Loading g…")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "g" })).toBeTruthy();
    expect(spinner()).toBeTruthy();
    release();
    expect(await screen.findByLabelText("Row 1 profileName")).toBeTruthy();
    expect(screen.queryByText("Loading g…")).toBeNull();
    expect(spinner()).toBeNull();
  });

  it("tasks (Tasks view)", async () => {
    const release = holdReads("task");
    backend();
    await openIn("Tasks", "t.csv");
    expect(await screen.findByText("Loading t…")).toBeTruthy();
    expect(spinner()).toBeTruthy();
    release();
    expect(await screen.findByRole("table", { name: "Profile Groups" })).toBeTruthy();
    expect(screen.queryByText("Loading t…")).toBeNull();
  });

  it("tasks (Raw rows)", async () => {
    backend();
    await openIn("Tasks", "t.csv");
    fireEvent.click(await screen.findByRole("tab", { name: "Raw rows" }));
    expect(await screen.findByLabelText("Row 1 profileGroup")).toBeTruthy();
    expect(screen.queryByText("Loading t…")).toBeNull();
  });

  it("accounts", async () => {
    const release = holdReads("account");
    backend();
    await openIn("Accounts", "a.txt");
    expect(await screen.findByText("Loading a…")).toBeTruthy();
    expect(spinner()).toBeTruthy();
    release();
    expect(await screen.findByRole("table", { name: "Accounts" })).toBeTruthy();
    expect(screen.queryByText("Loading a…")).toBeNull();
  });

  it("proxies", async () => {
    const release = holdReads("proxy");
    backend();
    await openIn("Proxies", "p.txt");
    expect(await screen.findByText("Loading p…")).toBeTruthy();
    expect(spinner()).toBeTruthy();
    release();
    expect(await screen.findByRole("textbox", { name: "Proxy list" })).toBeTruthy();
  });

  it("a file that can't be read shows the error, not a spinner", async () => {
    backend((p) => {
      if (p.endsWith("g.csv")) throw "Access is denied. (os error 5)";
      return FILES[p];
    });
    await openIn("Profiles", "g.csv");
    expect(await screen.findByText("Couldn't read file: Access is denied. (os error 5)")).toBeTruthy();
    expect(spinner()).toBeNull();
  });
});

describe("LoadingPanel", () => {
  it("shows the name and a spinner", () => {
    render(<LoadingPanel name="g" />);
    expect(screen.getByRole("heading", { name: "g" })).toBeTruthy();
    expect(screen.getByText("Loading g…")).toBeTruthy();
    expect(spinner()).toBeTruthy();
  });

  it("shows a read error instead of the spinner", () => {
    render(<LoadingPanel name="g" error="not found" />);
    expect(screen.getByText("Couldn't read file: not found")).toBeTruthy();
    expect(screen.queryByText("Loading g…")).toBeNull();
    expect(spinner()).toBeNull();
  });
});

describe("useFirstPaintDone", () => {
  it("is false on the first render, then true", () => {
    const seen: boolean[] = [];
    function Probe() {
      const done = useFirstPaintDone();
      seen.push(done);
      return <p>{done ? "drawn" : "loading"}</p>;
    }
    render(<Probe />);
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
    expect(screen.getByText("drawn")).toBeTruthy();
  });
});
