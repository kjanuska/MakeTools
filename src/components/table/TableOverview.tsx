import { useEffect, useRef, useState } from "react";
import { confirmAction } from "../../lib/dialogs";
import type { FileEntry } from "../../lib/fs";
import { copyName, groupNameError, groupNameOf } from "../../lib/table/fileNames";
import { copyTableFile, createTableFile, deleteTableFile, renameTableFile } from "../../lib/table/fileOps";
import { isRecord } from "../../lib/table/ops";
import { useStoreVersion, type DocEntry, type TableStore } from "../../lib/table/store";
import type { TableUI } from "./types";

interface Props<Ctx> {
  /** The folder's files, or null while the list is loading. */
  files: FileEntry[] | null;
  dir: string;
  store: TableStore<Ctx>;
  ui: TableUI<Ctx>;
  onOpen: (file: FileEntry, highlightId?: number) => void;
  /** Called after files were created, renamed, copied or deleted. */
  onFilesChanged: () => void;
  /** Focuses the search box whenever this number changes (the Find shortcut). */
  findRequest?: number;
}

type Action = { kind: "rename" | "copy"; file: FileEntry; name: string };

const MAX_RESULTS = 200;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function statusOf(entry: DocEntry | undefined, loadError: string | undefined): { text: string; bad: boolean } {
  if (loadError) return { text: "Couldn't read", bad: true };
  if (!entry) return { text: "Loading…", bad: false };
  const parts: string[] = [];
  if (!entry.doc.headerOk) parts.push("Wrong header (read-only)");
  else if (entry.errorCount > 0) parts.push(`${entry.errorCount} ${entry.errorCount === 1 ? "error" : "errors"}`);
  if (entry.dirty) parts.push("Unsaved changes");
  return { text: parts.length ? parts.join(" · ") : "OK", bad: !entry.doc.headerOk || entry.errorCount > 0 };
}

export function TableOverview<Ctx>({ files, dir, store, ui, onOpen, onFilesChanged, findRequest = 0 }: Props<Ctx>) {
  useStoreVersion(store);
  const ctx = store.getContext();
  const { file: fileLabel } = ui.schema.labels;
  const ov = ui.overview;
  const searchRef = useRef<HTMLInputElement>(null);
  const loaded = files !== null;
  useEffect(() => {
    if (findRequest > 0) searchRef.current?.focus();
  }, [findRequest, loaded]);
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!files) return <p className="muted">Loading {ui.schema.labels.files}…</p>;

  const names = files.map((f) => f.name);
  const newNameError = newName === "" ? null : groupNameError(newName, names);
  const actionError = action ? groupNameError(action.name, names, action.kind === "rename" ? action.file.name : undefined) : null;

  async function run(label: string, fn: () => Promise<string | void>, after?: (path: string | void) => void) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(label);
      onFilesChanged();
      after?.(result);
    } catch (e) {
      setError(`${label.replace(/\.$/, "")} failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = newName;
    await run(`Created ${fileLabel} ${name}.`, () => createTableFile(dir, name, ov.newFileText), (path) => {
      setNewName("");
      if (path) onOpen({ name: `${name}.csv`, path, size: ov.newFileText.length, modifiedMs: Date.now() });
    });
  }

  async function submitAction() {
    if (!action || actionError) return;
    const { kind, file, name } = action;
    const from = groupNameOf(file.name);
    if (kind === "rename") {
      const warning = ov.renameWarning ? `${ov.renameWarning(from)} ` : "";
      const ok = await confirmAction(
        `Rename ${fileLabel} ${from} to ${name}?\n\n${warning}The file is backed up first.`,
        `Rename ${fileLabel}`,
      );
      if (!ok) return;
      await run(`Renamed ${from} to ${name}.`, () => renameTableFile(store, file, dir, name), () => setAction(null));
    } else {
      await run(`Copied ${from} to ${name}.`, () => copyTableFile(file, dir, name), () => setAction(null));
    }
  }

  async function remove(file: FileEntry) {
    const name = groupNameOf(file.name);
    const ok = await confirmAction(
      `Delete ${fileLabel} ${name} (${ov.describe(store.get(file.path), ctx)})?\n\nA backup is kept for 7 days. To get it back, create a ${fileLabel} with the same name and restore it from Backups.`,
      `Delete ${fileLabel}`,
    );
    if (!ok) return;
    await run(`Deleted ${fileLabel} ${name}.`, () => deleteTableFile(store, file));
  }

  const q = query.trim().toLowerCase();
  const results: { file: FileEntry; row: number; id: number; match: string; detail: string }[] = [];
  if (q) {
    for (const f of files) {
      store.get(f.path)?.doc.rows.forEach((r, i) => {
        if (!isRecord(r)) return;
        const m = ov.search.find(r.values, q);
        if (m) results.push({ file: f, row: i + 1, id: r.id, ...m });
      });
    }
  }

  return (
    <div className="groups-overview">
      <h2>{ov.heading}</h2>
      <p className="overview-total">{ov.totals(files.map((f) => store.get(f.path)), ctx)}</p>
      {message && <p className="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="action-panel" aria-label={`New ${fileLabel}`}>
        <label>
          New {fileLabel}{" "}
          <input value={newName} placeholder="Name" onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button disabled={busy || newName === "" || newNameError !== null} onClick={create}>
          Create
        </button>
        {newNameError && <span className="error">{newNameError}</span>}
      </section>

      {action && (
        <section className="action-panel" aria-label={`${action.kind === "rename" ? "Rename" : "Copy"} ${fileLabel}`}>
          <label>
            {action.kind === "rename" ? "Rename" : "Copy"} {groupNameOf(action.file.name)} to{" "}
            <input
              autoFocus
              value={action.name}
              onChange={(e) => setAction({ ...action, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && submitAction()}
            />
          </label>
          <button disabled={busy || actionError !== null} onClick={submitAction}>
            {action.kind === "rename" ? "Rename" : "Copy"}
          </button>
          <button onClick={() => setAction(null)}>Cancel</button>
          {actionError && <span className="error">{actionError}</span>}
        </section>
      )}

      <table className="overview-table">
        <thead>
          <tr>
            <th>{cap(fileLabel)}</th>
            {ov.stats.map((s) => (
              <th key={s.header}>{s.header}</th>
            ))}
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const e = store.get(f.path);
            const s = statusOf(e, store.loadError(f.path));
            const locked = e?.dirty ? "Save or discard its changes first." : undefined;
            const name = groupNameOf(f.name);
            return (
              <tr key={f.path} className={s.bad ? "invalid" : undefined}>
                <td>
                  <button className="link" onClick={() => onOpen(f)}>
                    {name}
                  </button>
                </td>
                {ov.stats.map((st) => (
                  <td key={st.header} className="num">
                    {e ? st.value(e, ctx) : ""}
                  </td>
                ))}
                <td className={s.bad ? "error" : e?.dirty ? "unsaved" : "muted"}>{s.text}</td>
                <td className="row-actions">
                  <button
                    disabled={busy || !!locked}
                    title={locked}
                    aria-label={`Rename ${name}`}
                    onClick={() => setAction({ kind: "rename", file: f, name })}
                  >
                    Rename
                  </button>
                  <button
                    disabled={busy || !!locked}
                    title={locked}
                    aria-label={`Copy ${name}`}
                    onClick={() => setAction({ kind: "copy", file: f, name: copyName(name, names) })}
                  >
                    Copy
                  </button>
                  <button disabled={busy || !!locked} title={locked} aria-label={`Delete ${name}`} onClick={() => remove(f)}>
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {files.length === 0 && <p className="muted">No {ov.heading.toLowerCase()} yet.</p>}

      <section className="find" aria-label={`Find ${ui.schema.labels.items}`}>
        <h3>{ov.search.title}</h3>
        <input
          ref={searchRef}
          aria-label={ov.search.label}
          placeholder={ov.search.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <p className="muted">
            {results.length === 0
              ? `No ${ui.schema.labels.items} match.`
              : `${results.length} ${results.length === 1 ? "match" : "matches"}${results.length > MAX_RESULTS ? `, showing the first ${MAX_RESULTS}` : ""}`}
          </p>
        )}
        {results.length > 0 && (
          <table className="overview-table" aria-label="Matches">
            <thead>
              <tr>
                {ov.search.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.slice(0, MAX_RESULTS).map((r) => (
                <tr key={`${r.file.path}|${r.row}`}>
                  <td>
                    <button className="link" onClick={() => onOpen(r.file, r.id)}>
                      {r.match}
                    </button>
                  </td>
                  <td>{groupNameOf(r.file.name)}</td>
                  <td className="num">{r.row}</td>
                  <td>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Number of records in a file. */
export const recordCount = (e: DocEntry | undefined) => (e ? e.doc.rows.filter(isRecord).length : 0);
