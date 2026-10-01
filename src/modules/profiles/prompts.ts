import { displayName } from "../../lib/table/fileNames";
import { confirmAction } from "../../lib/dialogs";
import type { FileEntry } from "../../lib/fs";

/** Asked before overwriting a file another program changed since it was read. */
export function confirmOverwrite(file: FileEntry): Promise<boolean> {
  return confirmAction(
    `${displayName(file.name)} was changed by another program since it was opened here.\n\nOverwrite it with your version? The other version is backed up first.`,
    "File changed on disk",
  );
}
