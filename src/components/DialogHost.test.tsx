import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askSaveDiscardCancel, askUpdateNow, confirmAction, showMessage } from "../lib/dialogs";
import { currentDialog, closeDialog } from "../lib/dialogStore";
import { DialogHost } from "./DialogHost";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

function setup() {
  const onAppKey = vi.fn();
  window.addEventListener("keydown", onAppKey);
  render(
    <>
      <button>outside</button>
      <DialogHost />
    </>,
  );
  return { onAppKey, cleanup: () => window.removeEventListener("keydown", onAppKey) };
}

/** Starts a prompt and lets React draw it. Wrapped so awaiting this doesn't wait for the answer. */
async function start<T>(prompt: () => Promise<T>): Promise<{ answer: Promise<T> }> {
  let answer!: Promise<T>;
  await act(async () => {
    answer = prompt();
  });
  return { answer };
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...init });
  });

afterEach(() => {
  // Don't let a test's unanswered dialog leak into the next one.
  let d;
  while ((d = currentDialog())) closeDialog(d.id, d.spec.cancelValue);
});

describe("DialogHost", () => {
  it("shows nothing without a dialog", () => {
    setup();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirmAction: title, text and Yes / No, Yes focused; Yes resolves true", async () => {
    setup();
    const outside = button("outside");
    outside.focus();
    const { answer: p } = await start(() => confirmAction("Delete a.txt?\n\nIt is backed up first.", "Delete file"));
    const dlg = screen.getByRole("alertdialog", { name: "Delete file" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText(/It is backed up first\./).textContent).toBe("Delete a.txt?\n\nIt is backed up first.");
    expect(screen.getAllByRole("button").filter((b) => dlg.contains(b)).map((b) => b.textContent)).toEqual(["Yes", "No"]);
    expect(document.activeElement).toBe(button("Yes"));
    await act(async () => fireEvent.click(button("Yes")));
    await expect(p).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Focus goes back where it was.
    expect(document.activeElement).toBe(outside);
  });

  it("confirmAction: No and Escape resolve false", async () => {
    setup();
    let { answer: p } = await start(() => confirmAction("Sure?", "T"));
    await act(async () => fireEvent.click(button("No")));
    await expect(p).resolves.toBe(false);
    ({ answer: p } = await start(() => confirmAction("Sure?", "T")));
    await key("Escape");
    await expect(p).resolves.toBe(false);
  });

  it("askSaveDiscardCancel maps each button, and Escape to cancel", async () => {
    setup();
    for (const [label, value] of [
      ["Save all", "save"],
      ["Discard", "discard"],
      ["Cancel", "cancel"],
    ] as const) {
      const { answer: p } = await start(() => askSaveDiscardCancel("Unsaved changes", "Close"));
      await act(async () => fireEvent.click(button(label)));
      await expect(p).resolves.toBe(value);
    }
    const { answer: p } = await start(() => askSaveDiscardCancel("Unsaved changes", "Close"));
    expect(document.activeElement).toBe(button("Save all"));
    await key("Escape");
    await expect(p).resolves.toBe("cancel");
  });

  it("askUpdateNow is an info dialog with Update now / Later", async () => {
    setup();
    const { answer: p } = await start(() => askUpdateNow("Version 0.1.5 is out."));
    screen.getByRole("dialog", { name: "Update available" });
    await act(async () => fireEvent.click(button("Later")));
    await expect(p).resolves.toBe(false);
    const { answer: q } = await start(() => askUpdateNow("Version 0.1.5 is out."));
    await act(async () => fireEvent.click(button("Update now")));
    await expect(q).resolves.toBe(true);
  });

  it("showMessage has one OK button", async () => {
    setup();
    const { answer: p } = await start(() => showMessage("Rename failed: denied", "Rename"));
    const dlg = screen.getByRole("alertdialog", { name: "Rename" });
    expect(dlg.className).toContain("dialog-error");
    expect(document.activeElement).toBe(button("OK"));
    await act(async () => fireEvent.click(button("OK")));
    await expect(p).resolves.toBeUndefined();
  });

  it("dialogs queue: the second shows after the first is answered", async () => {
    setup();
    const { answer: a } = await start(() => confirmAction("first", "First"));
    const { answer: b } = await start(() => showMessage("second", "Second"));
    expect(screen.getByRole("alertdialog").getAttribute("aria-labelledby")).toBeTruthy();
    screen.getByRole("alertdialog", { name: "First" });
    await act(async () => fireEvent.click(button("Yes")));
    await expect(a).resolves.toBe(true);
    screen.getByRole("alertdialog", { name: "Second" });
    await act(async () => fireEvent.click(button("OK")));
    await expect(b).resolves.toBeUndefined();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keys don't reach the app while open; Tab and arrows stay inside", async () => {
    const { onAppKey, cleanup } = setup();
    await start(() => askSaveDiscardCancel("x", "Close"));
    await key("s", { ctrlKey: true });
    await key("F5");
    expect(onAppKey).not.toHaveBeenCalled();

    await key("Tab");
    expect(document.activeElement).toBe(button("Discard"));
    await key("Tab");
    expect(document.activeElement).toBe(button("Cancel"));
    await key("Tab");
    expect(document.activeElement).toBe(button("Save all"));
    await key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(button("Cancel"));
    await key("ArrowLeft");
    expect(document.activeElement).toBe(button("Discard"));
    await key("ArrowRight");
    expect(document.activeElement).toBe(button("Cancel"));
    await key("ArrowRight");
    expect(document.activeElement).toBe(button("Cancel"));
    expect(onAppKey).not.toHaveBeenCalled();
    cleanup();
  });

  it("app keys work again once it closes", async () => {
    const { onAppKey, cleanup } = setup();
    await start(() => showMessage("x", "T"));
    await act(async () => fireEvent.click(button("OK")));
    await key("s", { ctrlKey: true });
    expect(onAppKey).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
