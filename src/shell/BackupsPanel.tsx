import { displayName } from "../lib/table/fileNames";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "../lib/dialogs";
import { formatDateTime, formatSize } from "../lib/format";
import { listBackups, restoreBackup, type BackupEntry, type FileEntry } from "../lib/fs";

interface Props {
  file: FileEntry;
  onRestored: () => void;
}

export function BackupsPanel({ file, onRestored }: Props) {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listBackups(file.path)
      .then(setBackups)
      .catch((e) => setError(String(e)));
  }, [file.path]);

  useEffect(load, [load]);

  async function restore(b: BackupEntry) {
    const when = formatDateTime(b.createdMs);
    const ok = await confirmAction(
      `Replace ${displayName(file.name)} with the backup from ${when}?\n\nThe current version is backed up first, so this can be undone.`,
      "Restore backup",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await restoreBackup(file.path, b.id);
      setStatus(`Restored the backup from ${when}.`);
      load();
      onRestored();
    } catch (e) {
      setError(`Restore failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="backups" aria-label="Backups">
      <h3>Backups</h3>
      <p className="muted">
        A backup is made on every save. Backups older than 7 days are deleted automatically.
      </p>
      {status && <p className="status">{status}</p>}
      {error && <p className="error">{error}</p>}
      {backups && backups.length === 0 && <p className="muted">No backups for this file yet.</p>}
      {backups && backups.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Saved</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id}>
                <td>{formatDateTime(b.createdMs)}</td>
                <td>{formatSize(b.size)}</td>
                <td>
                  <button disabled={busy} onClick={() => restore(b)}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
