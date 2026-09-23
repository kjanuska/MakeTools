import { useState } from "react";
import { confirmAction } from "../../lib/dialogs";
import type { FileEntry } from "../../lib/fs";
import { copyName, groupNameError, groupNameOf } from "./groupNames";
import { NEW_GROUP_TEXT, copyGroup, createGroup, deleteGroup, renameGroup } from "./groups";
import { isProfile } from "./ops";
import { useStoreVersion, type DocEntry, type ProfileStore } from "./store";

interface Props {
  /** The profile folder's files, or null while the list is loading. */
  files: FileEntry[] | null;
  dir: string;
  store: ProfileStore;
  onOpen: (file: FileEntry, highlightName?: string) => void;
  /** Called after files were created, renamed, copied or deleted. */
  onFilesChanged: () => void;
}

type Action = { kind: "rename" | "copy"; file: FileEntry; name: string };

const MAX_RESULTS = 200;

function statusOf(entry: DocEntry | undefined, loadError: string | undefined): { text: string; bad: boolean } {
  if (loadError) return { text: "Couldn't read", bad: true };
  if (!entry) return { text: "Loading…", bad: false };
  const parts: string[] = [];
  if (!entry.doc.headerOk) parts.push("Wrong header (read-only)");
  else if (entry.errorCount > 0) parts.push(`${entry.errorCount} ${entry.errorCount === 1 ? "error" : "errors"}`);
  if (entry.dirty) parts.push("Unsaved changes");
  return { text: parts.length ? parts.join(" · ") : "OK", bad: !entry.doc.headerOk || entry.errorCount > 0 };
}

const profileCount = (e: DocEntry | undefined) => (e ? e.doc.rows.filter(isProfile).length : 0);

export function GroupsOverview({ files, dir, store, onOpen, onFilesChanged }: Props) {
  useStoreVersion(store);
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!files) return <p className="muted">Loading groups…</p>;

  const names = files.map((f) => f.name);
  const total = files.reduce((n, f) => n + profileCount(store.get(f.path)), 0);
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
    await run(`Created group ${name}.`, () => createGroup(dir, name), (path) => {
      setNewName("");
      if (path) onOpen({ name: `${name}.csv`, path, size: NEW_GROUP_TEXT.length, modifiedMs: Date.now() });
    });
  }

  async function submitAction() {
    if (!action || actionError) return;
    const { kind, file, name } = action;
    const from = groupNameOf(file.name);
    if (kind === "rename") {
      const ok = await confirmAction(
        `Rename group ${from} to ${name}?\n\nTasks that refer to "${from}" are not updated automatically. The file is backed up first.`,
        "Rename group",
      );
      if (!ok) return;
      await run(`Renamed ${from} to ${name}.`, () => renameGroup(store, file, dir, name), () => setAction(null));
    } else {
      await run(`Copied ${from} to ${name}.`, () => copyGroup(file, dir, name), () => setAction(null));
    }
  }

  async function remove(file: FileEntry) {
    const name = groupNameOf(file.name);
    const n = profileCount(store.get(file.path));
    const ok = await confirmAction(
      `Delete group ${name} (${n} ${n === 1 ? "profile" : "profiles"})?\n\nA backup is kept for 7 days. To get it back, create a group with the same name and restore it from Backups.`,
      "Delete group",
    );
    if (!ok) return;
    await run(`Deleted group ${name}.`, () => deleteGroup(store, file));
  }

  const q = query.trim().toLowerCase();
  const results: { file: FileEntry; row: number; values: string[] }[] = [];
  if (q) {
    for (const f of files) {
      const e = store.get(f.path);
      e?.doc.rows.forEach((r, i) => {
        if (isProfile(r) && r.values[0].toLowerCase().includes(q)) results.push({ file: f, row: i + 1, values: r.values });
      });
    }
  }

  return (
    <div className="groups-overview">
      <h2>Profile groups</h2>
      <p className="overview-total">
        <strong>{files.length}</strong> {files.length === 1 ? "group" : "groups"} · <strong>{total}</strong>{" "}
        {total === 1 ? "profile" : "profiles"} in total
      </p>
      {message && <p className="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="action-panel" aria-label="New group">
        <label>
          New group{" "}
          <input value={newName} placeholder="Name" onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button disabled={busy || newName === "" || newNameError !== null} onClick={create}>
          Create
        </button>
        {newNameError && <span className="error">{newNameError}</span>}
      </section>

      {action && (
        <section className="action-panel" aria-label={action.kind === "rename" ? "Rename group" : "Copy group"}>
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
            <th>Group</th>
            <th>Profiles</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const e = store.get(f.path);
            const s = statusOf(e, store.loadError(f.path));
            const locked = e?.dirty ? "Save or discard its changes first." : undefined;
            const group = groupNameOf(f.name);
            return (
              <tr key={f.path} className={s.bad ? "invalid" : undefined}>
                <td>
                  <button className="link" onClick={() => onOpen(f)}>
                    {group}
                  </button>
                </td>
                <td className="num">{e ? profileCount(e) : ""}</td>
                <td className={s.bad ? "error" : e?.dirty ? "unsaved" : "muted"}>{s.text}</td>
                <td className="row-actions">
                  <button
                    disabled={busy || !!locked}
                    title={locked}
                    aria-label={`Rename ${group}`}
                    onClick={() => setAction({ kind: "rename", file: f, name: group })}
                  >
                    Rename
                  </button>
                  <button
                    disabled={busy || !!locked}
                    title={locked}
                    aria-label={`Copy ${group}`}
                    onClick={() => setAction({ kind: "copy", file: f, name: copyName(group, names) })}
                  >
                    Copy
                  </button>
                  <button disabled={busy || !!locked} title={locked} aria-label={`Delete ${group}`} onClick={() => remove(f)}>
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {files.length === 0 && <p className="muted">No profile groups yet.</p>}

      <section className="find" aria-label="Find profiles">
        <h3>Find a profile</h3>
        <input
          aria-label="Find by profileName"
          placeholder="profileName contains…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <p className="muted">
            {results.length === 0
              ? "No profiles match."
              : `${results.length} ${results.length === 1 ? "match" : "matches"}${results.length > MAX_RESULTS ? `, showing the first ${MAX_RESULTS}` : ""}`}
          </p>
        )}
        {results.length > 0 && (
          <table className="overview-table" aria-label="Matches">
            <thead>
              <tr>
                <th>profileName</th>
                <th>Group</th>
                <th>Row</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, MAX_RESULTS).map((r) => (
                <tr key={`${r.file.path}|${r.row}`}>
                  <td>
                    <button className="link" onClick={() => onOpen(r.file, r.values[0])}>
                      {r.values[0]}
                    </button>
                  </td>
                  <td>{groupNameOf(r.file.name)}</td>
                  <td className="num">{r.row}</td>
                  <td>
                    {r.values[1]} {r.values[2]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
