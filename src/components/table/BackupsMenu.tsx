import { useEffect, useState } from "react";
import { formatDateTime, formatSize } from "../../lib/format";
import { listBackups, type BackupEntry, type FileEntry } from "../../lib/fs";

interface Props {
  file: FileEntry;
  open: boolean;
  onToggle: () => void;
  /** Stage this backup as unsaved changes. */
  onRestore: (backup: BackupEntry) => void;
}

/** "Backups" button with a dropdown of this file's backups. */
export function BackupsMenu({ file, open, onToggle, onRestore }: Props) {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-list every time it opens, so saves made since then show up.
  useEffect(() => {
    if (!open) return;
    setBackups(null);
    setError(null);
    listBackups(file.path)
      .then(setBackups)
      .catch((e) => setError(String(e)));
  }, [open, file.path]);

  return (
    <div className="backups-menu">
      <button aria-expanded={open} aria-haspopup="true" onClick={onToggle}>
        Backups ▾
      </button>
      {open && (
        <div className="backups-dropdown" role="dialog" aria-label="Backups">
          <p className="muted">
            A backup is made on every save and kept for 7 days. Restoring loads it as unsaved changes. Nothing is written
            until you save.
          </p>
          {error && <p className="error">{error}</p>}
          {!backups && !error && <p className="muted">Loading…</p>}
          {backups?.length === 0 && <p className="muted">No backups for this file yet.</p>}
          {backups && backups.length > 0 && (
            <table>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td>{formatDateTime(b.createdMs)}</td>
                    <td className="muted">{formatSize(b.size)}</td>
                    <td>
                      <button onClick={() => onRestore(b)}>Restore</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
