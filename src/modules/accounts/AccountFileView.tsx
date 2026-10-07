// One account group: its accounts as a table, with counts, search and import.
// Importing appends lines through save_text and restoring goes through
// restore_backup; both back up the current file first. Nothing else is written.
import { useState } from "react";
import { accountsOf, appendLines, hasProxy, oddLines, parseAccounts, planImport } from "../../lib/formats/accounts";
import { LoadingNote, useFileLoad } from "../../components/LoadingPanel";
import { BackupsMenu } from "../../components/table/BackupsMenu";
import { confirmAction } from "../../lib/dialogs";
import { formatDateTime } from "../../lib/format";
import { readText, restoreBackup, saveText, type BackupEntry, type FileEntry } from "../../lib/fs";
import { useShortcuts } from "../../lib/shortcuts";
import { displayName, groupNameOf } from "../../lib/table/fileNames";
import { ImportPanel } from "./ImportPanel";
import type { AccountStore } from "./store";
import { accountStats, domainOf, plural } from "./stats";
import "./accounts.css";

interface Props {
  file: FileEntry;
  store: AccountStore;
  onBack: () => void;
  /** Called after the file on disk changed. */
  onChanged: () => void;
}

type ProxyFilter = "with" | "without" | null;

const TOP_DOMAINS = 6;

const domainLabel = (d: string) => d || "(no domain)";

export function AccountFileView({ file, store, onBack, onChanged }: Props) {
  // The accounts are drawn once `ready`, so the header shows at once and a big group fills in after.
  const { entry, error: loadError, ready } = useFileLoad(store, file);
  const doc = ready ? entry!.doc : null;
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Filters set by clicking the summary cards; each one toggles.
  const [proxyFilter, setProxyFilter] = useState<ProxyFilter>(null);
  const [domainFilter, setDomainFilter] = useState<ReadonlySet<string>>(new Set());
  const [allDomains, setAllDomains] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  useShortcuts({ backups: () => setBackupsOpen((o) => !o) });
  // Lines from here on were just imported, and are marked.
  const [newFrom, setNewFrom] = useState<number | null>(null);

  const name = groupNameOf(file.name, ".txt");

  async function importAccounts(pasted: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Append to the file as it is on disk now, so nothing changed since is lost.
      const { text } = await readText(file.path);
      const current = parseAccounts(text);
      const plan = planImport(pasted);
      if (plan.add.length === 0) {
        setError("Nothing to add: no line is in the account format.");
        return false;
      }
      await saveText(file.path, appendLines(text, plan.add.map((a) => a.text)));
      const skipped = plan.invalid.length;
      setMessage(
        `Added ${plural(plan.add.length, "account")} to ${name}.${skipped ? ` Skipped ${skipped}.` : ""} The previous version was backed up.`,
      );
      setNewFrom(current.lines.length + 1);
      setImporting(false);
      await store.load(file);
      onChanged();
      return true;
    } catch (e) {
      setError(`Import failed: ${e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Accounts have no unsaved state, so a restore is written right away (the
  // current version is backed up first, so it can be undone the same way).
  async function restore(b: BackupEntry) {
    const when = formatDateTime(b.createdMs);
    const ok = await confirmAction(
      `Replace ${displayName(file.name)} with the backup from ${when}?\n\nThe current version is backed up first, so this can be undone.`,
      "Restore backup",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await restoreBackup(file.path, b.id);
      setMessage(`Restored the backup from ${when}.`);
      setBackupsOpen(false);
      setNewFrom(null);
      await store.load(file);
      onChanged();
    } catch (e) {
      setError(`Restore failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <div className="editor-head">
      <button onClick={onBack}>← All account groups</button>
      <h2>{displayName(file.name)}</h2>
      <span className="spacer" />
      <BackupsMenu
        file={file}
        open={backupsOpen}
        onToggle={() => setBackupsOpen((o) => !o)}
        onRestore={(b) => void restore(b)}
        note="A backup is made on every import and restore, and kept for 7 days. Restoring replaces the file right away; the current version is backed up first, so it can be undone."
      />
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
  if (!doc) {
    return (
      <div className="accounts-view">
        {head}
        <LoadingNote label={displayName(file.name)} />
      </div>
    );
  }

  const stats = accountStats(doc);
  const q = query.trim().toLowerCase();
  const shown = doc.lines.flatMap((l) => {
    if (l.kind !== "account") return [];
    const a = l.account;
    if (proxyFilter === "with" && !hasProxy(a)) return [];
    if (proxyFilter === "without" && hasProxy(a)) return [];
    if (domainFilter.size > 0 && !domainFilter.has(domainOf(a.email))) return [];
    if (q &&![a.email, a.proxyHost ?? "", a.proxyUser ?? ""].some((v) => v.toLowerCase().includes(q))) return [];
    return [l];
  });
  const odd = oddLines(doc);
  const anyAuth = accountsOf(doc).some((a) => a.proxyUser !== undefined);
  const filtered = proxyFilter !== null || domainFilter.size > 0;
  const toggleProxy = (f: "with" | "without") => setProxyFilter((cur) => (cur === f ? null : f));
  const toggleDomain = (d: string) =>
    setDomainFilter((cur) => {
      const next = new Set(cur);
      if (!next.delete(d)) next.add(d);
      return next;
    });
  // The top domains, plus any selected ones so a filter never hides its own toggle.
  const listedDomains = allDomains
    ? stats.domains
    : stats.domains.filter((d, i) => i < TOP_DOMAINS || domainFilter.has(d.domain));
  const hiddenDomains = stats.domains.length - listedDomains.length;

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
        <button
          className="accounts-card selectable"
          aria-pressed={proxyFilter === "with"}
          title="Show only accounts with a proxy (click again to clear)"
          onClick={() => toggleProxy("with")}
        >
          <span className="accounts-card-value">{stats.withProxy}</span>
          <span className="muted">with a proxy</span>
        </button>
        <button
          className="accounts-card selectable"
          aria-pressed={proxyFilter === "without"}
          title="Show only accounts without a proxy (click again to clear)"
          onClick={() => toggleProxy("without")}
        >
          <span className="accounts-card-value">{stats.accounts - stats.withProxy}</span>
          <span className="muted">without a proxy</span>
        </button>
        {stats.domains.length > 0 && (
          <div className="accounts-card accounts-domains">
            <span className="muted">Email domains</span>
            <ul aria-label="Email domains">
              {listedDomains.map((d) => (
                <li key={d.domain}>
                  <button
                    className="domain-toggle"
                    aria-pressed={domainFilter.has(d.domain)}
                    title={`Show only ${domainLabel(d.domain)} accounts (click again to clear)`}
                    onClick={() => toggleDomain(d.domain)}
                  >
                    <span>{domainLabel(d.domain)}</span>
                    <span className="num">{d.count}</span>
                  </button>
                </li>
              ))}
              {(hiddenDomains > 0 || allDomains) && stats.domains.length > TOP_DOMAINS && (
                <li>
                  <button className="link" onClick={() => setAllDomains((a) => !a)}>
                    {allDomains ? "Show fewer" : `+${plural(hiddenDomains, "more domain")}`}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {importing && (
        <ImportPanel
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
            <span className="muted">
              {shown.length === stats.accounts ? plural(stats.accounts, "account") : `${shown.length} of ${stats.accounts}`}
            </span>
            {filtered && (
              <button
                className="link"
                onClick={() => {
                  setProxyFilter(null);
                  setDomainFilter(new Set());
                }}
              >
                Clear filters
              </button>
            )}
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
    </div>
  );
}
