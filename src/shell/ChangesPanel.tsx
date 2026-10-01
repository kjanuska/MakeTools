import { displayName } from "../lib/table/fileNames";

export interface ChangedFile {
  path: string;
  name: string;
  /** Folder it lives in, e.g. "profile". */
  folder: string;
  invalid: boolean;
}

interface Props {
  files: ChangedFile[];
  onOpen: (path: string) => void;
  onSaveAll: () => void;
  busy: boolean;
  message: string | null;
}

/** Files with unsaved changes, like `git status`. */
export function ChangesPanel({ files, onOpen, onSaveAll, busy, message }: Props) {
  return (
    <section className="changes" aria-label="Unsaved changes">
      <h3>Unsaved changes{files.length > 0 && ` (${files.length})`}</h3>
      {files.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <>
          <ul>
            {files.map((f) => (
              <li key={f.path}>
                <button
                  className={`change-item${f.invalid ? " invalid" : ""}`}
                  title={f.invalid ? `${f.path} (has errors)` : f.path}
                  onClick={() => onOpen(f.path)}
                >
                  <span className="change-mark">M</span> {f.folder}/{displayName(f.name)}
                </button>
              </li>
            ))}
          </ul>
          <button disabled={busy} onClick={onSaveAll}>
            {busy ? "Saving…" : "Save all"}
          </button>
        </>
      )}
      {message && <p className="changes-message">{message}</p>}
    </section>
  );
}
