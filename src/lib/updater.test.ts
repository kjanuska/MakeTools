import { beforeEach, describe, expect, it, vi } from "vitest";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { findUpdate } from "./updater";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.1.72") }));

type Event = { event: string; data?: Record<string, number> };

function fakeUpdate(events: Event[], body?: string) {
  return {
    version: "0.1.80",
    body,
    downloadAndInstall: vi.fn(async (onEvent: (e: Event) => void) => events.forEach(onEvent)),
  };
}

beforeEach(() => {
  vi.mocked(check).mockReset();
  vi.mocked(relaunch).mockClear();
});

describe("findUpdate", () => {
  it("is null when this is the latest version", async () => {
    vi.mocked(check).mockResolvedValue(null);
    expect(await findUpdate()).toBeNull();
  });

  it("passes on the version and trimmed notes", async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate([], "  - Fix A\n") as never);
    const u = await findUpdate();
    expect(u?.version).toBe("0.1.80");
    expect(u?.notes).toBe("- Fix A");
  });

  it("has empty notes when the release has none", async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate([]) as never);
    expect((await findUpdate())?.notes).toBe("");
  });

  it("lets a failed check throw", async () => {
    vi.mocked(check).mockRejectedValue(new Error("offline"));
    await expect(findUpdate()).rejects.toThrow("offline");
  });
});

describe("install", () => {
  it("reports progress as a fraction and restarts", async () => {
    const update = fakeUpdate([
      { event: "Started", data: { contentLength: 200 } },
      { event: "Progress", data: { chunkLength: 50 } },
      { event: "Progress", data: { chunkLength: 150 } },
      { event: "Finished" },
    ]);
    vi.mocked(check).mockResolvedValue(update as never);
    const progress: (number | null)[] = [];
    await (await findUpdate())!.install((p) => progress.push(p));
    expect(progress).toEqual([0, 0.25, 1]);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("reports null progress when the size is unknown", async () => {
    vi.mocked(check).mockResolvedValue(
      fakeUpdate([{ event: "Started", data: {} }, { event: "Progress", data: { chunkLength: 10 } }]) as never,
    );
    const progress: (number | null)[] = [];
    await (await findUpdate())!.install((p) => progress.push(p));
    expect(progress).toEqual([null, null]);
  });

  it("doesn't restart when the install fails", async () => {
    const update = fakeUpdate([]);
    update.downloadAndInstall.mockRejectedValue(new Error("bad signature"));
    vi.mocked(check).mockResolvedValue(update as never);
    await expect((await findUpdate())!.install(() => {})).rejects.toThrow("bad signature");
    expect(relaunch).not.toHaveBeenCalled();
  });
});
