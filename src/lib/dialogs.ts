import { ask, message, open } from "@tauri-apps/plugin-dialog";

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

export function confirmAction(text: string, title: string): Promise<boolean> {
  return ask(text, { title, kind: "warning" });
}

export type SaveChoice = "save" | "discard" | "cancel";

const SAVE_LABEL = "Save all";
const DISCARD_LABEL = "Discard";
const CANCEL_LABEL = "Cancel";

/** Asks Save all / Discard / Cancel. Closing the dialog counts as Cancel. */
export async function askSaveDiscardCancel(text: string, title: string): Promise<SaveChoice> {
  const result = await message(text, {
    title,
    kind: "warning",
    buttons: { yes: SAVE_LABEL, no: DISCARD_LABEL, cancel: CANCEL_LABEL },
  });
  // Depending on the platform the result is the button kind or its label.
  if (result === "Yes" || result === SAVE_LABEL) return "save";
  if (result === "No" || result === DISCARD_LABEL) return "discard";
  return "cancel";
}

export async function showMessage(text: string, title: string): Promise<void> {
  await message(text, { title, kind: "error" });
}
