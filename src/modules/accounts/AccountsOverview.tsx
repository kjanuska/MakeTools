// All account groups (`account/*.txt`) with their counts, and creating a new one.
import { useEffect, useState } from "react";
import { parseAccounts } from "../../lib/formats/accounts";
import { createFile, readText, type FileEntry } from "../../lib/fs";
import { joinPath } from "../../lib/paths";
import { fileNameFor, groupNameError, groupNameOf } from "../../lib/table/fileNames";
import { accountStats, plural, type AccountStats } from "./stats";
import "./accounts.css";

const EXT = ".txt";

interface Props {
  /** The folder's files, or null while the list is loading. */
  files: FileEntry[] | null;
  dir: string;
  onOpen: (file: FileEntry) => void;
  /** Called after a file was created. */
  onFilesChanged: () => void;
}

type Loaded = { stats: AccountStats } | { error: string };

export function AccountsOverview({ files, dir, onOpen, onFilesChanged }: Props) {
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map());
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!files) return;
    let cancelled = false;
    for (const f of files) {
      readText(f.path)
        .then(({ text }): Loaded => ({ stats: accountStats(parseAccounts(text)) }))
        .catch((e): Loaded => ({ error: String(e) }))
        .then((r) => {
          if (!cancelled) setLoaded((m) => new Map(m).set(f.path, r));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [files]);

  if (!files) return <p className="muted">Loading account groups…</p>;

  const names = files.map((f) => f.name);
  const nameError = newName === "" ? null : groupNameError(newName, names, undefined, EXT);
  const all = files.map((f) => loaded.get(f.path));
  const total = all.reduce((n, l) => n + (l && "stats" in l ? l.stats.accounts : 0), 0);
  const withProxy = all.reduce((n, l) => n + (l && "stats" in l ? l.stats.withProxy : 0), 0);

  async function create() {
    const name = newName;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const path = joinPath(dir, fileNameFor(name, EXT));
      await createFile(path, "");
      setNewName("");
      setMessage(`Created account group ${name}.`);
      onFilesChanged();
      onOpen({ name: fileNameFor(name, EXT), path, size: 0, modifiedMs: Date.now() });
    } catch (e) {
      setError(`Create failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="groups-overview accounts-view">
      <h2>Account groups</h2>
      <div className="accounts-cards">
        <div className="accounts-card">
          <span className="accounts-card-value">{files.length}</span>
          <span className="muted">{files.length === 1 ? "group" : "groups"}</span>
        </div>
        <div className="accounts-card">
          <span className="accounts-card-value">{total}</span>
          <span className="muted">{total === 1 ? "account" : "accounts"}</span>
        </div>
        <div className="accounts-card">
          <span className="accounts-card-value">{withProxy}</span>
          <span className="muted">with a proxy</span>
        </div>
      </div>
      {message && <p className="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="action-panel" aria-label="New account group">
        <label>
          New account group <input value={newName} placeholder="Name" onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button disabled={busy || newName === "" || nameError !== null} onClick={create}>
          Create
        </button>
        {nameError && <span className="error">{nameError}</span>}
      </section>

      <table className="overview-table" aria-label="Account groups">
        <thead>
          <tr>
            <th>Group</th>
            <th className="num">Accounts</th>
            <th className="num">With proxy</th>
            <th>Main domain</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const l = loaded.get(f.path);
            const s = l && "stats" in l ? l.stats : null;
            const bad = !!l && ("error" in l || l.stats.odd > 0);
            const status = !l
              ? "Loading…"
              : "error" in l
                ? "Couldn't read"
                : l.stats.odd > 0
                  ? `${plural(l.stats.odd, "unrecognized line")}`
                  : "OK";
            const top = s?.domains[0];
            return (
              <tr key={f.path} className={bad ? "invalid" : undefined}>
                <td>
                  <button className="link" onClick={() => onOpen(f)}>
                    {groupNameOf(f.name, EXT)}
                  </button>
                </td>
                <td className="num">{s?.accounts ?? ""}</td>
                <td className="num">{s?.withProxy ?? ""}</td>
                <td className="muted">{top ? `${top.domain || "(no domain)"} (${top.count})` : ""}</td>
                <td className={bad ? "error" : "muted"}>{status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {files.length === 0 && <p className="muted">No account groups yet.</p>}
    </div>
  );
}
