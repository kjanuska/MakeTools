import { useState } from "react";

interface Props {
  /** Null while loading. */
  sites: readonly string[] | null;
  usage: (site: string) => { rows: number; files: number };
  onAdd: (site: string) => void;
  /** Resolves to a message describing what happened. */
  onRename: (from: string, to: string) => Promise<string | null>;
  onRemove: (site: string) => Promise<void>;
}

const invalid = (s: string) => (/[,"\r\n]/.test(s) ? "Can't contain a comma, quote or line break." : null);

/** The global site list used by the task site dropdown. */
export function SitesSettings({ sites, usage, onAdd, onRename, onRemove }: Props) {
  const [newSite, setNewSite] = useState("");
  const [editing, setEditing] = useState<{ site: string; value: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!sites) return <p className="muted">Loading sites…</p>;

  const check = (value: string, except?: string) => {
    const v = value.trim();
    if (!v) return "Enter a site.";
    if (v !== except && sites.includes(v)) return "That site is already in the list.";
    return invalid(v);
  };
  const addError = newSite.trim() ? check(newSite) : null;
  const editError = editing ? check(editing.value, editing.site) : null;

  async function rename() {
    if (!editing || editError) return;
    const to = editing.value.trim();
    if (to === editing.site) return setEditing(null);
    setBusy(true);
    try {
      const msg = await onRename(editing.site, to);
      if (msg !== null) {
        setEditing(null);
        setMessage(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Sites">
      <h3>Sites</h3>
      <p className="muted">
        The sites offered in the task site dropdown. Renaming a site changes it in every task file. Removing one makes tasks
        that still use it show an error.
      </p>
      {message && <p className="status changes-message">{message}</p>}
      <div className="action-panel">
        <label>
          Add site <input aria-label="New site" value={newSite} onChange={(e) => setNewSite(e.target.value)} />
        </label>
        <button
          disabled={!newSite.trim() || !!addError}
          onClick={() => {
            onAdd(newSite.trim());
            setMessage(`Added ${newSite.trim()}.`);
            setNewSite("");
          }}
        >
          Add
        </button>
        {addError && <span className="error">{addError}</span>}
      </div>
      <table className="overview-table sites-table">
        <thead>
          <tr>
            <th>Site</th>
            <th>Used by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => {
            const u = usage(site);
            const isEditing = editing?.site === site;
            return (
              <tr key={site}>
                <td>
                  {isEditing ? (
                    <input
                      autoFocus
                      aria-label={`New name for ${site}`}
                      value={editing.value}
                      onChange={(e) => setEditing({ site, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    site
                  )}
                  {isEditing && editError && <span className="error"> {editError}</span>}
                </td>
                <td className="muted">
                  {u.rows ? `${u.rows} ${u.rows === 1 ? "task" : "tasks"} in ${u.files} ${u.files === 1 ? "file" : "files"}` : "unused"}
                </td>
                <td className="row-actions">
                  {isEditing ? (
                    <>
                      <button disabled={busy || !!editError} onClick={() => void rename()}>
                        Save
                      </button>
                      <button onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button aria-label={`Rename ${site}`} disabled={busy} onClick={() => setEditing({ site, value: site })}>
                        Rename
                      </button>
                      <button
                        aria-label={`Remove ${site}`}
                        disabled={busy}
                        onClick={async () => {
                          await onRemove(site);
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sites.length === 0 && <p className="muted">No sites yet.</p>}
    </section>
  );
}
