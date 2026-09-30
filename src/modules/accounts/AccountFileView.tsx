// One account group: its accounts as a table, with counts, search and import.
// Importing appends lines through save_text (backup first); nothing else is written.
import { useCallback, useEffect, useState } from "react";
import { accountsOf, appendLines, hasProxy, oddLines, parseAccounts, planImport, type AccountsDoc } from "../../lib/formats/accounts";
import { readText, saveText, type FileEntry } from "../../lib/fs";
import { groupNameOf } from "../../lib/table/fileNames";
import { BackupsPanel } from "../../shell/BackupsPanel";
import { ImportPanel } from "./ImportPanel";
import { accountStats, plural } from "./stats";
import "./accounts.css";

interface Props {
  file: FileEntry;
  onBack: () => void;
  /** Called after the file on disk changed. */
  onChanged: () => void;
}

type ProxyFilter = "all" | "with" | "without";

const TOP_DOMAINS = 6;

export function AccountFileView({ file, onBack, onChanged }: Props) {
  const [doc, setDoc] = useState<AccountsDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [proxyFilter, setProxyFilter] = useState<ProxyFilter>("all");
  // Lines from here on were just imported, and are marked.
  const [newFrom, setNewFrom] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { text } = await readText(file.path);
      setDoc(parseAccounts(text));
    } catch (e) {
      setDoc(null);
      setLoadError(String(e));
    }
  }, [file.path]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = groupNameOf(file.name, ".txt");

  async function importAccounts(pasted: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Plan against the file as it is on disk now, so nothing is lost or duplicated.
      const { text } = await readText(file.path);
      const current = parseAccounts(text);
      const plan = planImport(pasted, accountsOf(current).map((a) => a.email));
      if (plan.add.length === 0) {
        setError("Nothing to add: every account is already in the file or invalid.");
        return false;
      }
      await saveText(file.path, appendLines(text, plan.add.map((a) => a.text)));
      const skipped = plan.duplicates.length + plan.invalid.length;
      setMessage(
        `Added ${plural(plan.add.length, "account")} to ${name}.${skipped ? ` Skipped ${skipped}.` : ""} The previous version was backed up.`,
      );
      setNewFrom(current.lines.length + 1);
      setImporting(false);
      await load();
      onChanged();
      return true;
    } catch (e) {
      setError(`Import failed: ${e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <div className="editor-head">
      <button onClick={onBack}>← All account groups</button>
      <h2>{file.name}</h2>
      <span className="spacer" />
      <button className="primary" aria-pressed={importing} onClick={() => setImporting((o) => !o)}>
        Import accounts…
      </button>
    </div>
  );

  if (loadError) {
    return (
      <div className="accounts-view">
        {head}
        <p className="error">Couldn't read file: {loadError}</p>
      </div>
    );
  }
  if (!doc) return <p className="muted">Loading…</p>;

  const stats = accountStats(doc);
  const q = query.trim().toLowerCase();
  const shown = doc.lines.flatMap((l) => {
    if (l.kind !== "account") return [];
    const a = l.account;
    if (proxyFilter === "with" && !hasProxy(a)) return [];
    if (proxyFilter === "without" && hasProxy(a)) return [];
    if (q && ![a.email, a.proxyHost ?? "", a.proxyUser ?? ""].some((v) => v.toLowerCase().includes(q))) return [];
    return [l];
  });
  const odd = oddLines(doc);
  const anyAuth = accountsOf(doc).some((a) => a.proxyUser !== undefined);

  return (
    <div className="accounts-view">
      {head}
      {message && <p className="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="accounts-cards" aria-label="Summary">
        <div className="accounts-card">
          <span className="accounts-card-value">{stats.accounts}</span>
          <span className="muted">{stats.accounts === 1 ? "account" : "accounts"}</span>
        </div>
        <div className="accounts-card">
          <span className="accounts-card-value">{stats.withProxy}</span>
          <span className="muted">with a proxy</span>
        </div>
        <div className="accounts-card">
          <span className="accounts-card-value">{stats.accounts - stats.withProxy}</span>
          <span className="muted">without a proxy</span>
        </div>
        {stats.domains.length > 0 && (
          <div className="accounts-card accounts-domains">
            <span className="muted">Email domains</span>
            <ul aria-label="Email domains">
              {stats.domains.slice(0, TOP_DOMAINS).map((d) => (
                <li key={d.domain}>
                  <span>{d.domain}</span>
                  <span className="num">{d.count}</span>
                </li>
              ))}
              {stats.domains.length > TOP_DOMAINS && (
                <li className="muted">+{plural(stats.domains.length - TOP_DOMAINS, "more domain")}</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {importing && (
        <ImportPanel
          existingEmails={accountsOf(doc).map((a) => a.email)}
          busy={busy}
          onImport={importAccounts}
          onClose={() => setImporting(false)}
        />
      )}

      {odd.length > 0 && (
        <details className="accounts-issues error-box">
          <summary className="error">
            {plural(odd.length, "line")} {odd.length === 1 ? "isn't" : "aren't"} in the account format
          </summary>
          <p className="muted">They're left in the file exactly as they are.</p>
          <ul>
            {odd.map((l) => (
              <li key={l.line}>
                Line {l.line}: <code>{l.kind === "raw" ? l.text : ""}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      {stats.accounts === 0 ? (
        <p className="muted accounts-empty">No accounts in this group yet. Use Import accounts… to add some.</p>
      ) : (
        <>
          <div className="toolbar accounts-toolbar">
            <input
              type="search"
              aria-label="Search accounts"
              placeholder="Search email, proxy host or user"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="view-tabs" role="group" aria-label="Proxy filter">
              {(
                [
                  ["all", "All"],
                  ["with", "With proxy"],
                  ["without", "Without proxy"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} aria-pressed={proxyFilter === id} onClick={() => setProxyFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <span className="muted">
              {shown.length === stats.accounts ? plural(stats.accounts, "account") : `${shown.length} of ${stats.accounts}`}
            </span>
          </div>
          <div className="accounts-table-wrap">
            <table className="accounts-table" aria-label="Accounts">
              <thead>
                <tr>
                  <th className="num">Line</th>
                  <th>Email</th>
                  <th>Password</th>
                  <th>Proxy</th>
                  {anyAuth && <th>Proxy user</th>}
                  {anyAuth && <th>Proxy password</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const a = l.account;
                  return (
                    <tr key={l.line} className={newFrom !== null && l.line >= newFrom ? "new-account" : undefined}>
                      <td className="num muted">{l.line}</td>
                      <td className="copyable">{a.email}</td>
                      <td className="copyable mono">{a.password}</td>
                      <td className="copyable mono">
                        {hasProxy(a) ? `${a.proxyHost}:${a.proxyPort}` : <span className="muted">—</span>}
                      </td>
                      {anyAuth && <td className="copyable mono">{a.proxyUser ?? <span className="muted">—</span>}</td>}
                      {anyAuth && <td className="copyable mono">{a.proxyPass ?? <span className="muted">—</span>}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && <p className="muted">No accounts match.</p>}
          </div>
        </>
      )}

      <BackupsPanel
        file={file}
        onRestored={() => {
          setNewFrom(null);
          void load();
          onChanged();
        }}
      />
    </div>
  );
}
