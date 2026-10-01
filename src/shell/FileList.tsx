import { useState } from "react";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import type { FileEntry } from "../lib/fs";
import type { FileCount } from "./useFileCounts";

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
  /** Right-click menu for a file (none if not given). */
  menuFor?: (file: FileEntry) => { items: MenuItem[]; note?: string };
  /** A file being renamed in place. */
  renaming?: Renaming | null;
  /** How many records (profiles, tasks, proxies, accounts) a file has; blank while unknown. */
  count?: (file: FileEntry) => FileCount | undefined;
}

export interface Renaming {
  path: string;
  /** New name, without the extension. */
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export interface FileMarker {
  /** Unsaved changes. */
  modified?: boolean;
  /** Validation errors. */
  invalid?: boolean;
}

export function FileList(props: Props) {
  const { dir, extension, files, error, selectedPath, onSelect, onRefresh, marker, menuFor, renaming, count } = props;
  const [menu, setMenu] = useState<{ file: FileEntry; x: number; y: number } | null>(null);
  const menuContent = menu && menuFor?.(menu.file);

  function openMenu(e: React.MouseEvent<HTMLButtonElement>, file: FileEntry) {
    if (!menuFor) return;
    e.preventDefault();
    let { clientX: x, clientY: y } = e;
    // From the keyboard (menu key, Shift+F10): at the file instead of the pointer.
    if (x === 0 && y === 0) {
      const r = e.currentTarget.getBoundingClientRect();
      x = r.left + 16;
      y = r.bottom;
    }
    setMenu({ file, x, y });
  }

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
            const c = count?.(f);
            const notes = [m?.modified && "unsaved changes", m?.invalid && "has errors"].filter(Boolean).join(", ");
            return (
              <li key={f.path}>
                {renaming?.path === f.path ? (
                  <RenameBox renaming={renaming} extension={extension} />
                ) : (
                <button
                  className={`file-item${m?.invalid ? " invalid" : ""}`}
                  aria-current={f.path === selectedPath ? "true" : undefined}
                  aria-description={notes || undefined}
                  title={notes || undefined}
                  onClick={() => onSelect(f)}
                  onContextMenu={(e) => openMenu(e, f)}
                >
                  <span>
                    {f.name}
                    {m?.modified && <span className="modified-dot"> ●</span>}
                  </span>
                  {c && (
                    <span className="muted file-count" title={c.title}>
                      {c.value}
                    </span>
                  )}
                </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {menu && menuContent && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.file.name}
          items={menuContent.items}
          note={menuContent.note}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

/** The file name as a text box: Enter renames, Escape or clicking away cancels. */
function RenameBox({ renaming, extension }: { renaming: Renaming; extension: string }) {
  const { value, error, onChange, onSubmit, onCancel } = renaming;
  return (
    <div className="file-rename">
      <div className="file-rename-row">
        <input
          aria-label="New name"
          value={value}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={onCancel}
          aria-invalid={error ? true : undefined}
          spellCheck={false}
        />
        <span className="muted">.{extension}</span>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
