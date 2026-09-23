import { formatSize } from "../lib/format";
import type { FileEntry } from "../lib/fs";

interface Props {
  dir: string;
  extension: string;
  /** Null while loading or if the folder couldn't be listed. */
  files: FileEntry[] | null;
  error: string | null;
  selectedPath: string | null;
  onSelect: (file: FileEntry) => void;
  onRefresh: () => void;
  /** Per-file state shown in the list. */
  marker?: (file: FileEntry) => FileMarker | undefined;
}

export interface FileMarker {
  /** Unsaved changes. */
  modified?: boolean;
  /** Validation errors. */
  invalid?: boolean;
}

export function FileList({ dir, extension, files, error, selectedPath, onSelect, onRefresh, marker }: Props) {
  return (
    <section className="file-list" aria-label="Files">
      <div className="file-list-head">
        <span className="muted" title={dir}>
          *.{extension}
        </span>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      {error && (
        <p className="error">
          Couldn't list {dir}: {error}
        </p>
      )}
      {files && files.length === 0 && <p className="muted">No .{extension} files.</p>}
      {files && files.length > 0 && (
        <ul>
          {files.map((f) => {
            const m = marker?.(f);
            const notes = [m?.modified && "unsaved changes", m?.invalid && "has errors"].filter(Boolean).join(", ");
            return (
              <li key={f.path}>
                <button
                  className={`file-item${m?.invalid ? " invalid" : ""}`}
                  aria-current={f.path === selectedPath ? "true" : undefined}
                  aria-description={notes || undefined}
                  title={notes || undefined}
                  onClick={() => onSelect(f)}
                >
                  <span>
                    {f.name}
                    {m?.modified && <span className="modified-dot"> ●</span>}
                  </span>
                  <span className="muted">{formatSize(f.size)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
