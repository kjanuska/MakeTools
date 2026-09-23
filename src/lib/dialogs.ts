import { ask, open } from "@tauri-apps/plugin-dialog";

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

export function confirmAction(message: string, title: string): Promise<boolean> {
  return ask(message, { title, kind: "warning" });
}
