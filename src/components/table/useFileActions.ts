// Save, discard and restore-a-backup for one file of a table store, with the
// status and error messages they show. Shared by the table editor and any
// other view of a file (e.g. the task summary).
import { useState } from "react";
import { confirmAction } from "../../lib/dialogs";
import { formatDateTime } from "../../lib/format";
import { readBackup, type BackupEntry, type FileEntry } from "../../lib/fs";
import type { ConfirmOverwrite, TableStore } from "../../lib/table/store";

export function useFileActions<Ctx>(
  store: TableStore<Ctx>,
  file: FileEntry,
  confirmOverwrite: ConfirmOverwrite,
  onSaved: () => void,
) {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);
    const r = await store.save(file.path, confirmOverwrite);
    setSaving(false);
    if (r.ok) {
      onSaved();
      if (r.verified) setStatus("Saved. The previous version was backed up.");
      else setError("Saved, but the file on disk doesn't match what was written. Check it before using it.");
    } else if (r.reason === "error") {
      setError(`Save failed: ${r.error}`);
    }
  }

  async function discard() {
    const ok = await confirmAction(`Discard all unsaved changes to ${file.name}?`, "Discard changes");
    if (!ok) return;
    store.discard(file.path);
    setStatus(null);
  }

  /** Stages a backup as unsaved changes. True if it was staged. */
  async function restore(b: BackupEntry): Promise<boolean> {
    const when = formatDateTime(b.createdMs);
    setError(null);
    if (store.get(file.path)?.dirty) {
      const ok = await confirmAction(
        `Replace your unsaved changes to ${file.name} with the backup from ${when}?`,
        "Restore backup",
      );
      if (!ok) return false;
    }
    try {
      const backup = await readBackup(file.path, b.id);
      const r = store.stage(file.path, backup.text);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setStatus(`Loaded the backup from ${when}. Save to keep it, or Discard changes to undo.`);
      return true;
    } catch (e) {
      setError(`Couldn't read the backup: ${e}`);
      return false;
    }
  }

  return { error, setError, status, setStatus, saving, save, discard, restore };
}
