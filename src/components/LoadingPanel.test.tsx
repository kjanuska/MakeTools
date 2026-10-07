import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { PROFILE_HEADER } from "../lib/formats/profiles";
import { TASK_HEADER } from "../lib/formats/tasks";
import type { FileEntry } from "../lib/fs";
import { getMakebotPath } from "../lib/settings";
import { guardWindowClose } from "../lib/window";
import { fileItem } from "../test/fileList";
import {
  AfterFirstPaint,
  LoadingNote,
  LoadingPanel,
  SPINNER_DELAY_MS,
  useFileLoad,
  useFirstPaintDone,
  type FileSource,
} from "./LoadingPanel";

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

const $ = (selector: string) => document.querySelector(selector);
const spinner = () => $(".loading .spinner");
const busy = () => $('[aria-busy="true"]');
const heading = () => $("main h2")?.textContent;
const nav = (name: string) => screen.getByRole("button", { name });

/**
 * What each commit (each frame React draws) showed, checked while React is
 * committing it, so frames replaced right after are still seen.
 */
let frames: Record<string, boolean>[] = [];
let checks: Record<string, () => boolean> = {};

async function start() {
  render(
    <Profiler
      id="app"
      onRender={() => frames.push(Object.fromEntries(Object.entries(checks).map(([k, f]) => [k, f()])))}
    >
      <App />
    </Profiler>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
  await screen.findByRole("heading", { name: "Profile groups" });
  // The start-up scans are done once the file list shows the group's count.
  await waitFor(() => expect($(".file-count")).toBeTruthy());
}

/** Clicks and returns the frames drawn until things settle. */
async function framesOf(el: Element, watch: Record<string, () => boolean>) {
  checks = watch;
  frames = [];
  act(() => {
    fireEvent.click(el);
  });
  await act(() => new Promise((r) => setTimeout(r, 50)));
  checks = {};
  return frames;
}

async function openIn(module: string, file: string) {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: module }));
  fireEvent.click(await screen.findByRole("button", { name: fileItem(file) }));
}

describe("a click draws the new page's frame first; the slow part comes right after", () => {
  it("opening a profile group: header and toolbar, then the rows", async () => {
    backend();
    await start();
    const f = await framesOf(screen.getByRole("button", { name: fileItem("g.csv") }), {
      toolbar: () => !!$(".table-editor .toolbar"),
      back: () => !!screen.queryByRole("button", { name: "← All groups" }),
      rows: () => !!$(".grid tbody tr"),
    });
    expect(f[0]).toEqual({ toolbar: true, back: true, rows: false });
    expect(f[f.length - 1]).toEqual({ toolbar: true, back: true, rows: true });
  });

  it("back to the groups: the editor goes at once, then the overview", async () => {
    backend();
    await start();
    fireEvent.click(screen.getByRole("button", { name: fileItem("g.csv") }));
    const back = await screen.findByRole("button", { name: "← All groups" });
    const f = await framesOf(back, {
      editor: () => !!$(".table-editor"),
      overview: () => heading() === "Profile groups",
    });
    expect(f[0]).toEqual({ editor: false, overview: false });
    expect(f[f.length - 1]).toEqual({ editor: false, overview: true });
  });

  it("switching to Tasks: the sidebar and file list, then the overview", async () => {
    backend();
    await start();
    const f = await framesOf(nav("Tasks"), {
      current: () => $('nav [aria-current="page"]')?.textContent === "Tasks",
      fileList: () => !!screen.queryByRole("button", { name: fileItem("t.csv") }),
      overview: () => heading() === "Task files",
    });
    expect(f[0]).toEqual({ current: true, fileList: true, overview: false });
    expect(f[f.length - 1]).toEqual({ current: true, fileList: true, overview: true });
  });

  it("switching to Accounts: the sidebar, then the overview", async () => {
    backend();
    await start();
    const f = await framesOf(nav("Accounts"), {
      current: () => $('nav [aria-current="page"]')?.textContent === "Accounts",
      overview: () => heading() === "Account groups",
    });
    expect(f[0]).toEqual({ current: true, overview: false });
    expect(f[f.length - 1]).toEqual({ current: true, overview: true });
  });

  it("opening a task file: header, tabs and Save, then the counts and builder", async () => {
    backend();
    await start();
    fireEvent.click(nav("Tasks"));
    const file = await screen.findByRole("button", { name: fileItem("t.csv") });
    const f = await framesOf(file, {
      head: () => !!screen.queryByRole("tab", { name: "Tasks" }) && !!screen.queryByRole("button", { name: "Save" }),
      counts: () => !!screen.queryByRole("table", { name: "Profile Groups" }),
    });
    expect(f[0]).toEqual({ head: true, counts: false });
    expect(f[f.length - 1]).toEqual({ head: true, counts: true });
  });

  it("the Raw rows tab: toolbar, then the rows", async () => {
    backend();
    await start();
    fireEvent.click(nav("Tasks"));
    fireEvent.click(await screen.findByRole("button", { name: fileItem("t.csv") }));
    const raw = await screen.findByRole("tab", { name: "Raw rows" });
    const f = await framesOf(raw, {
      toolbar: () => !!$(".table-editor .toolbar"),
      rows: () => !!$(".grid tbody tr"),
    });
    expect(f[0]).toEqual({ toolbar: true, rows: false });
    expect(f[f.length - 1]).toEqual({ toolbar: true, rows: true });
  });

  it("opening an account group: header and Import, then the accounts", async () => {
    backend();
    await start();
    fireEvent.click(nav("Accounts"));
    const file = await screen.findByRole("button", { name: fileItem("a.txt") });
    const f = await framesOf(file, {
      head: () => !!screen.queryByRole("button", { name: "Import accounts…" }),
      table: () => !!screen.queryByRole("table", { name: "Accounts" }),
    });
    expect(f[0]).toEqual({ head: true, table: false });
    expect(f[f.length - 1]).toEqual({ head: true, table: true });
  });

  it("opening a proxy file: header and Save, then the list", async () => {
    backend();
    await start();
    fireEvent.click(nav("Proxies"));
    const file = await screen.findByRole("button", { name: fileItem("p.txt") });
    // Read once, so this checks the frame-then-body step, not the read.
    fireEvent.click(file);
    await screen.findByRole("textbox", { name: "Proxy list" });
    fireEvent.click(nav("Proxies"));
    const again = await screen.findByRole("button", { name: fileItem("p.txt") });
    const f = await framesOf(again, {
      head: () => heading() === "p" && !!screen.queryByRole("button", { name: "Shuffle" }),
      list: () => !!screen.queryByRole("textbox", { name: "Proxy list" }),
    });
    expect(f[0]).toEqual({ head: true, list: false });
    expect(f[f.length - 1]).toEqual({ head: true, list: true });
  });

  it("reopening an account group: it's kept in memory, so the header and Import show at once, then the accounts", async () => {
    backend();
    await start();
    fireEvent.click(nav("Accounts"));
    fireEvent.click(await screen.findByRole("button", { name: fileItem("a.txt") }));
    await screen.findByRole("table", { name: "Accounts" });
    fireEvent.click(screen.getByRole("button", { name: "← All account groups" }));
    const again = await screen.findByRole("button", { name: fileItem("a.txt") });
    const f = await framesOf(again, {
      head: () => !!screen.queryByRole("button", { name: "Import accounts…" }),
      table: () => !!screen.queryByRole("table", { name: "Accounts" }),
    });
    expect(f[0]).toEqual({ head: true, table: false });
    expect(f[f.length - 1]).toEqual({ head: true, table: true });
  });

  it("the loader is in the first frame the click draws, until the rows are in", async () => {
    backend();
    await start();
    const f = await framesOf(screen.getByRole("button", { name: fileItem("g.csv") }), {
      loader: () => !!busy() && !!spinner() && !!screen.queryByText("Loading g…"),
      rows: () => !!$(".grid tbody tr"),
    });
    expect(f[0]).toEqual({ loader: true, rows: false });
    expect(f[f.length - 1]).toEqual({ loader: false, rows: true });
  });

  it("every module's file view shows the loader first", async () => {
    backend();
    await start();
    for (const [module, file] of [
      ["Tasks", "t.csv"],
      ["Proxies", "p.txt"],
      ["Accounts", "a.txt"],
    ]) {
      fireEvent.click(nav(module));
      const item = await screen.findByRole("button", { name: fileItem(file) });
      const f = await framesOf(item, { loader: () => !!spinner() });
      expect(f[0], module).toEqual({ loader: true });
      expect(f[f.length - 1], module).toEqual({ loader: false });
    }
  });
});

describe("a file that takes a while to read: its heading at once, a spinner after the delay", () => {
  it("profiles", async () => {
    const release = holdReads("profile");
    backend();
    await openIn("Profiles", "g.csv");
    expect(screen.getByRole("heading", { name: "g" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← All groups" })).toBeTruthy();
    expect(await screen.findByText("Loading g…")).toBeTruthy();
    expect(spinner()).toBeTruthy();
    release();
    expect(await screen.findByLabelText("Row 1 profileName")).toBeTruthy();
    expect(screen.queryByText("Loading g…")).toBeNull();
    expect(busy()).toBeNull();
  });

  it("tasks", async () => {
    const release = holdReads("task");
    backend();
    await openIn("Tasks", "t.csv");
    expect(screen.getByRole("button", { name: "← All task files" })).toBeTruthy();
    expect(await screen.findByText("Loading t…")).toBeTruthy();
    release();
    // Each file reopens on its last view, and an earlier test left this one on Raw rows.
    fireEvent.click(await screen.findByRole("tab", { name: "Tasks" }));
    expect(await screen.findByRole("table", { name: "Profile Groups" })).toBeTruthy();
    expect(screen.queryByText("Loading t…")).toBeNull();
    expect(busy()).toBeNull();
  });

  it("accounts", async () => {
    const release = holdReads("account");
    backend();
    await openIn("Accounts", "a.txt");
    expect(screen.getByRole("button", { name: "Import accounts…" })).toBeTruthy();
    expect(await screen.findByText("Loading a…")).toBeTruthy();
    release();
    expect(await screen.findByRole("table", { name: "Accounts" })).toBeTruthy();
    expect(screen.queryByText("Loading a…")).toBeNull();
    expect(busy()).toBeNull();
  });

  it("proxies", async () => {
    const release = holdReads("proxy");
    backend();
    await openIn("Proxies", "p.txt");
    expect(await screen.findByText("Loading p…")).toBeTruthy();
    release();
    expect(await screen.findByRole("textbox", { name: "Proxy list" })).toBeTruthy();
    expect(busy()).toBeNull();
  });

  it("an account group that can't be read shows the error under its header, not a spinner", async () => {
    backend((p) => {
      if (p.endsWith("a.txt")) throw "Access is denied. (os error 5)";
      return FILES[p];
    });
    await openIn("Accounts", "a.txt");
    expect(await screen.findByText("Couldn't read file: Access is denied. (os error 5)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import accounts…" })).toBeTruthy();
    expect(spinner()).toBeNull();
    expect(busy()).toBeNull();
  });

  it("a proxy file that can't be read shows the error, not a spinner", async () => {
    backend((p) => {
      if (p.endsWith("p.txt")) throw "Access is denied. (os error 5)";
      return FILES[p];
    });
    await openIn("Proxies", "p.txt");
    expect(await screen.findByText("Couldn't read file: Access is denied. (os error 5)")).toBeTruthy();
    expect(spinner()).toBeNull();
    expect(busy()).toBeNull();
  });

  it("a file that can't be read shows the error, not a spinner", async () => {
    backend((p) => {
      if (p.endsWith("g.csv")) throw "Access is denied. (os error 5)";
      return FILES[p];
    });
    await openIn("Profiles", "g.csv");
    expect(await screen.findByText("Couldn't read file: Access is denied. (os error 5)")).toBeTruthy();
    expect(spinner()).toBeNull();
    expect(busy()).toBeNull();
  });
});

describe("LoadingNote and LoadingPanel", () => {
  it("the note has the spinner and label from its first frame, faded in by CSS after the delay (150 ms)", () => {
    render(<LoadingNote label="g" />);
    expect(busy()).toBeTruthy();
    expect(screen.getByText("Loading g…")).toBeTruthy();
    expect(spinner()?.className).toBe("spinner large");
    // A CSS animation, not a timer, so it still shows while the app is busy drawing.
    expect((busy() as HTMLElement).style.getPropertyValue("--loading-delay")).toBe(`${SPINNER_DELAY_MS}ms`);
  });

  it("the note sets no timers", () => {
    vi.useFakeTimers();
    try {
      render(<LoadingNote label="g" />);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the panel shows the heading, back button and loader at once", () => {
    const onBack = vi.fn();
    render(<LoadingPanel name="g" back={{ label: "← All groups", onClick: onBack }} />);
    expect(screen.getByRole("heading", { name: "g" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← All groups" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(spinner()).toBeTruthy();
  });

  it("a read error shows at once, and never the spinner", () => {
    render(<LoadingPanel name="g" error="not found" />);
    expect(screen.getByText("Couldn't read file: not found")).toBeTruthy();
    expect(busy()).toBeNull();
    expect(spinner()).toBeNull();
  });
});

/** Animation frames wait until paint() runs them, as the browser runs them just before it paints. */
let frameQueue: (FrameRequestCallback | null)[] = [];

function holdFrames() {
  frameQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frameQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => (frameQueue[id - 1] = null));
}

/** The browser paints: the waiting frames run, then whatever they scheduled for just after. */
async function paint() {
  await act(async () => {
    const queued = frameQueue;
    frameQueue = [];
    for (const cb of queued) cb?.(0);
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Lets timers and promises run without a paint. */
const tick = () => act(() => new Promise((r) => setTimeout(r, 20)));

describe("useFirstPaintDone and AfterFirstPaint: the slow part waits until the loader is on screen", () => {
  beforeEach(holdFrames);
  afterEach(() => vi.unstubAllGlobals());

  it("is false until the first frame is painted, then true", async () => {
    const seen: boolean[] = [];
    function Probe() {
      const done = useFirstPaintDone();
      seen.push(done);
      return <p>{done ? "drawn" : "loading"}</p>;
    }
    render(<Probe />);
    await tick();
    expect(seen.every((d) => !d)).toBe(true);
    await paint();
    expect(seen[seen.length - 1]).toBe(true);
    expect(screen.getByText("drawn")).toBeTruthy();
  });

  it("draws its children only after the loader was painted", async () => {
    render(
      <AfterFirstPaint label="x">
        <p>slow part</p>
      </AfterFirstPaint>,
    );
    await tick();
    expect(screen.queryByText("slow part")).toBeNull();
    expect(screen.getByText("Loading x…")).toBeTruthy();
    await paint();
    expect(screen.getByText("slow part")).toBeTruthy();
    expect(screen.queryByText("Loading x…")).toBeNull();
  });

  it("a page closed before the paint leaves nothing waiting", async () => {
    const { unmount } = render(
      <AfterFirstPaint label="x">
        <p>slow part</p>
      </AfterFirstPaint>,
    );
    unmount();
    expect(frameQueue.every((cb) => cb === null)).toBe(true);
  });
});

describe("useFileLoad: the one way a view opens its file", () => {
  beforeEach(holdFrames);
  afterEach(() => vi.unstubAllGlobals());

  /** A store whose reads finish when the test says so. */
  class FakeSource implements FileSource<string> {
    entries = new Map<string, string>();
    errors = new Map<string, string>();
    loads: string[] = [];
    pending = new Map<string, (r: { text?: string; error?: string }) => void>();
    private listeners = new Set<() => void>();
    private version = 0;
    subscribe = (fn: () => void) => {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    };
    getVersion = () => this.version;
    load(file: FileEntry): Promise<void> {
      this.loads.push(file.path);
      return new Promise((done) =>
        this.pending.set(file.path, ({ text, error }) => {
          if (text !== undefined) this.entries.set(file.path, text);
          if (error !== undefined) this.errors.set(file.path, error);
          this.version++;
          for (const fn of this.listeners) fn();
          done();
        }),
      );
    }
    get(path: string) {
      return this.entries.get(path);
    }
    loadError(path: string) {
      return this.errors.get(path);
    }
  }

  const fileA: FileEntry = { name: "a.txt", path: "C:\\x\\a.txt", size: 1, modifiedMs: 1 };
  const fileB: FileEntry = { name: "b.txt", path: "C:\\x\\b.txt", size: 1, modifiedMs: 1 };

  function renderProbe(source: FakeSource, file: FileEntry) {
    const seen: { entry: string | undefined; error: string | undefined; ready: boolean }[] = [];
    function Probe({ file }: { file: FileEntry }) {
      const r = useFileLoad(source, file);
      seen.push(r);
      return <p>{r.ready ? `body ${r.entry}` : r.error ? `error ${r.error}` : "frame"}</p>;
    }
    const view = render(<Probe file={file} />);
    return { seen, rerender: (f: FileEntry) => view.rerender(<Probe file={f} />) };
  }

  it("starts the read; nothing to draw until it's in", () => {
    const source = new FakeSource();
    const { seen } = renderProbe(source, fileA);
    expect(source.loads).toEqual([fileA.path]);
    expect(seen.every((s) => s.entry === undefined && !s.ready && s.error === undefined)).toBe(true);
    expect(screen.getByText("frame")).toBeTruthy();
  });

  it("once read: the frame with the entry first, then ready once that's painted", async () => {
    const source = new FakeSource();
    const { seen } = renderProbe(source, fileA);
    seen.length = 0;
    await act(async () => source.pending.get(fileA.path)!({ text: "A" }));
    await tick();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.entry === "A" && !s.ready)).toBe(true);
    await paint();
    expect(seen[seen.length - 1]).toEqual({ entry: "A", error: undefined, ready: true });
    expect(screen.getByText("body A")).toBeTruthy();
  });

  it("a file already in memory still draws the frame first", async () => {
    const source = new FakeSource();
    source.entries.set(fileA.path, "A");
    const { seen } = renderProbe(source, fileA);
    expect(seen[0]).toEqual({ entry: "A", error: undefined, ready: false });
    await paint();
    expect(seen[seen.length - 1].ready).toBe(true);
    // It's still re-read, in case it changed on disk.
    expect(source.loads).toEqual([fileA.path]);
  });

  it("a read error is passed on, and it's never ready", async () => {
    const source = new FakeSource();
    const { seen } = renderProbe(source, fileA);
    await act(async () => source.pending.get(fileA.path)!({ error: "denied" }));
    await paint();
    expect(seen[seen.length - 1]).toEqual({ entry: undefined, error: "denied", ready: false });
    expect(screen.getByText("error denied")).toBeTruthy();
  });

  it("an error is hidden while the store still holds the file", async () => {
    const source = new FakeSource();
    source.entries.set(fileA.path, "A");
    source.errors.set(fileA.path, "denied");
    const { seen } = renderProbe(source, fileA);
    await paint();
    expect(seen[seen.length - 1]).toEqual({ entry: "A", error: undefined, ready: true });
  });

  it("another file: read that one, and not ready until it's in and painted", async () => {
    const source = new FakeSource();
    source.entries.set(fileA.path, "A");
    const { seen, rerender } = renderProbe(source, fileA);
    await paint();
    seen.length = 0;
    rerender(fileB);
    expect(source.loads).toEqual([fileA.path, fileB.path]);
    expect(seen.every((s) => !s.ready)).toBe(true);
    await act(async () => source.pending.get(fileB.path)!({ text: "B" }));
    expect(seen[seen.length - 1]).toEqual({ entry: "B", error: undefined, ready: false });
    await paint();
    expect(seen[seen.length - 1]).toEqual({ entry: "B", error: undefined, ready: true });
  });

  it("switching between two files already in memory: not ready again until the new one is painted", async () => {
    const source = new FakeSource();
    source.entries.set(fileA.path, "A");
    source.entries.set(fileB.path, "B");
    const { seen, rerender } = renderProbe(source, fileA);
    await paint();
    seen.length = 0;
    rerender(fileB);
    expect(seen[0]).toEqual({ entry: "B", error: undefined, ready: false });
    await paint();
    expect(seen[seen.length - 1]).toEqual({ entry: "B", error: undefined, ready: true });
  });

  it("stops listening when the view closes", () => {
    const source = new FakeSource();
    const view = render(<Unmountable source={source} />);
    view.unmount();
    expect(() => source.pending.get(fileA.path)!({ text: "A" })).not.toThrow();
  });

  function Unmountable({ source }: { source: FakeSource }) {
    useFileLoad(source, fileA);
    return null;
  }
});
