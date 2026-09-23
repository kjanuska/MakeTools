import { useEffect, useState } from "react";
import { formatSize } from "../lib/format";
import { listFiles, type FileEntry } from "../lib/fs";

interface Props {
  dir: string;
  extension: string;
  selectedPath: string | null;
  onSelect: (file: FileEntry) => void;
  /** Bump to reload the list. */
  version: number;
  /** Called with the files each time the list loads. */
  onLoaded?: (files: FileEntry[]) => void;
  /** Per-file state shown in the list. */
  marker?: (file: FileEntry) => FileMarker | undefined;
}

export interface FileMarker {
  /** Unsaved changes. */
  modified?: boolean;
  /** Validation errors. */
  invalid?: boolean;
}

export function FileList({ dir, extension, selectedPath, onSelect, version, onLoaded, marker }: Props) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listFiles(dir, extension)
      .then((f) => {
        if (cancelled) return;
        setFiles(f);
        onLoaded?.(f);
      })
      .catch((e) => {
        if (cancelled) return;
        setFiles(null);
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // onLoaded is deliberately not a dependency: it shouldn't trigger reloads.
  }, [dir, extension, version, reloads]);

  return (
    <section className="file-list" aria-label="Files">
      <div className="file-list-head">
        <span className="muted" title={dir}>
          *.{extension}
        </span>
        <button onClick={() => setReloads((r) => r + 1)}>Refresh</button>
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
