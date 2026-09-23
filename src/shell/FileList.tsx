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
}

export function FileList({ dir, extension, selectedPath, onSelect, version }: Props) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listFiles(dir, extension)
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch((e) => {
        if (cancelled) return;
        setFiles(null);
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
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
          {files.map((f) => (
            <li key={f.path}>
              <button
                className="file-item"
                aria-current={f.path === selectedPath ? "true" : undefined}
                onClick={() => onSelect(f)}
              >
                <span>{f.name}</span>
                <span className="muted">{formatSize(f.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
