import { open } from "@tauri-apps/plugin-dialog";
import { showDialog } from "./dialogStore";

// File and folder pickers stay native (they need the OS file browser); every
// other prompt is an in-app dialog drawn by components/DialogHost.

/** Folder picker. Returns null if cancelled. */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Choose the Makebot folder",
  });
  return typeof result === "string" ? result : null;
}

/** Text file picker. Returns null if cancelled. */
export async function pickTextFile(title: string): Promise<string | null> {
  const result = await open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: "Text files", extensions: ["txt"] }],
  });
  return typeof result === "string" ? result : null;
}

/** Yes / No. True for Yes; Escape counts as No. */
export function confirmAction(text: string, title: string): Promise<boolean> {
  return showDialog({
    title,
    text,
    kind: "warning",
    buttons: [
      { label: "Yes", value: true, primary: true },
      { label: "No", value: false },
    ],
    cancelValue: false,
  });
}

/** "Update now" / "Later". True for Update now. */
export function askUpdateNow(text: string): Promise<boolean> {
  return showDialog({
    title: "Update available",
    text,
    kind: "info",
    buttons: [
      { label: "Update now", value: true, primary: true },
      { label: "Later", value: false },
    ],
    cancelValue: false,
  });
}

export type SaveChoice = "save" | "discard" | "cancel";

/** Asks Save all / Discard / Cancel. Escape counts as Cancel. */
export function askSaveDiscardCancel(text: string, title: string): Promise<SaveChoice> {
  return showDialog<SaveChoice>({
    title,
    text,
    kind: "warning",
    buttons: [
      { label: "Save all", value: "save", primary: true },
      { label: "Discard", value: "discard" },
      { label: "Cancel", value: "cancel" },
    ],
    cancelValue: "cancel",
  });
}

export async function showMessage(text: string, title: string): Promise<void> {
  await showDialog({ title, text, kind: "error", buttons: [{ label: "OK", value: undefined, primary: true }], cancelValue: undefined });
}
