import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askUpdateNow, showMessage } from "../lib/dialogs";
import { currentVersion, findUpdate, type AvailableUpdate } from "../lib/updater";
import { UpdateSettings, updateStatusText } from "./UpdateSettings";
import { updatePrompt, useUpdater } from "./useUpdater";

vi.mock("../lib/updater", () => ({ currentVersion: vi.fn(), findUpdate: vi.fn() }));
vi.mock("../lib/dialogs", () => ({ askUpdateNow: vi.fn(), showMessage: vi.fn(async () => {}) }));

type Install = AvailableUpdate["install"];

function update(install = vi.fn<Install>(async () => {})): AvailableUpdate & { install: typeof install } {
  return { version: "0.1.80", notes: "- Fix A", install };
}

function Harness({ beforeInstall }: { beforeInstall: () => Promise<boolean> }) {
  const u = useUpdater(beforeInstall);
  return <UpdateSettings version={u.version} status={u.status} onCheck={u.checkNow} onInstall={u.installPending} />;
}

beforeEach(() => {
  vi.mocked(currentVersion).mockReset().mockResolvedValue("0.1.72");
  vi.mocked(findUpdate).mockReset();
  vi.mocked(askUpdateNow).mockReset();
  vi.mocked(showMessage).mockClear();
});

describe("updatePrompt", () => {
  it("names both versions and lists the notes", () => {
    expect(updatePrompt("0.1.72", update())).toBe(
      "Make Tools 0.1.80 is available. You have 0.1.72.\n\nWhat's new:\n- Fix A\n\nThe app restarts after updating.",
    );
  });

  it("leaves out what it doesn't know", () => {
    expect(updatePrompt(null, { ...update(), notes: "" })).toBe(
      "Make Tools 0.1.80 is available.\n\nThe app restarts after updating.",
    );
  });
});

describe("updateStatusText", () => {
  it("describes each state", () => {
    expect(updateStatusText({ kind: "idle" })).toBeNull();
    expect(updateStatusText({ kind: "checking" })).toBe("Checking for updates…");
    expect(updateStatusText({ kind: "latest" })).toBe("You have the latest version.");
    expect(updateStatusText({ kind: "available", version: "0.1.80" })).toBe("Version 0.1.80 is available.");
    expect(updateStatusText({ kind: "downloading", version: "0.1.80", progress: null })).toBe("Downloading 0.1.80…");
    expect(updateStatusText({ kind: "downloading", version: "0.1.80", progress: 0.456 })).toBe(
      "Downloading 0.1.80… 46%",
    );
    expect(updateStatusText({ kind: "error", message: "offline" })).toBe("Couldn't check for updates: offline");
  });
});

describe("useUpdater", () => {
  it("shows the version and says when it's the latest", async () => {
    vi.mocked(findUpdate).mockResolvedValue(null);
    render(<Harness beforeInstall={async () => true} />);
    expect(await screen.findByText("Version 0.1.72")).toBeTruthy();
    expect(await screen.findByText("You have the latest version.")).toBeTruthy();
    expect(askUpdateNow).not.toHaveBeenCalled();
  });

  it("offers an update on start and installs it on Update now", async () => {
    const u = update();
    vi.mocked(findUpdate).mockResolvedValue(u);
    vi.mocked(askUpdateNow).mockResolvedValue(true);
    const beforeInstall = vi.fn(async () => true);
    render(<Harness beforeInstall={beforeInstall} />);
    await waitFor(() => expect(u.install).toHaveBeenCalled());
    expect(askUpdateNow).toHaveBeenCalledWith(updatePrompt("0.1.72", u));
    expect(beforeInstall).toHaveBeenCalledTimes(1);
  });

  it("keeps the update for later, installable from Settings", async () => {
    const u = update();
    vi.mocked(findUpdate).mockResolvedValue(u);
    vi.mocked(askUpdateNow).mockResolvedValue(false);
    render(<Harness beforeInstall={async () => true} />);
    const button = await screen.findByRole("button", { name: "Update to 0.1.80" });
    expect(u.install).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(u.install).toHaveBeenCalled());
  });

  it("doesn't install when unsaved changes are cancelled", async () => {
    const u = update();
    vi.mocked(findUpdate).mockResolvedValue(u);
    vi.mocked(askUpdateNow).mockResolvedValue(true);
    const beforeInstall = vi.fn(async () => false);
    render(<Harness beforeInstall={beforeInstall} />);
    expect(await screen.findByRole("button", { name: "Update to 0.1.80" })).toBeTruthy();
    expect(beforeInstall).toHaveBeenCalled();
    expect(u.install).not.toHaveBeenCalled();
  });

  it("shows download progress", async () => {
    let finish!: () => void;
    const u = update(
      vi.fn<Install>((onProgress) => {
        onProgress(0.5);
        return new Promise<void>((r) => (finish = r));
      }),
    );
    vi.mocked(findUpdate).mockResolvedValue(u);
    vi.mocked(askUpdateNow).mockResolvedValue(true);
    render(<Harness beforeInstall={async () => true} />);
    expect(await screen.findByText("Downloading 0.1.80… 50%")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
    finish();
  });

  it("reports a failed install and keeps the update available", async () => {
    const u = update(vi.fn<Install>(async () => Promise.reject(new Error("bad signature"))));
    vi.mocked(findUpdate).mockResolvedValue(u);
    vi.mocked(askUpdateNow).mockResolvedValue(true);
    render(<Harness beforeInstall={async () => true} />);
    await waitFor(() => expect(showMessage).toHaveBeenCalled());
    expect(vi.mocked(showMessage).mock.calls[0][0]).toContain("bad signature");
    expect(await screen.findByRole("button", { name: "Update to 0.1.80" })).toBeTruthy();
  });

  it("stays quiet when the startup check fails, but reports a manual one", async () => {
    vi.mocked(findUpdate).mockRejectedValue(new Error("offline"));
    render(<Harness beforeInstall={async () => true} />);
    await waitFor(() => expect(findUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Checking for updates…")).toBeNull());
    expect(screen.queryByText(/Couldn't check/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Couldn't check for updates: Error: offline")).toBeTruthy();
  });

  it("still checks when the version can't be read", async () => {
    vi.mocked(currentVersion).mockRejectedValue(new Error("no"));
    vi.mocked(findUpdate).mockResolvedValue(null);
    render(<Harness beforeInstall={async () => true} />);
    expect(await screen.findByText("You have the latest version.")).toBeTruthy();
    expect(screen.getByText("Version unknown")).toBeTruthy();
  });
});
