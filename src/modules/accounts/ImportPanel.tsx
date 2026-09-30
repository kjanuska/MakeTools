// Paste (or load a .txt file of) accounts in the account-file format and add
// them to the end of the file. Duplicates and invalid lines are listed and skipped.
import { useState } from "react";
import { pickTextFile } from "../../lib/dialogs";
import { planImport } from "../../lib/formats/accounts";
import { readText } from "../../lib/fs";
import { plural } from "./stats";

interface Props {
  existingEmails: readonly string[];
  busy: boolean;
  /** Adds the pasted text's new accounts. Resolves true once saved. */
  onImport: (pasted: string) => Promise<boolean>;
  onClose: () => void;
}

const SHOWN = 50;

export function ImportPanel({ existingEmails, busy, onImport, onClose }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const plan = planImport(text, existingEmails);

  async function loadFile() {
    setError(null);
    try {
      const path = await pickTextFile("Import accounts from a file");
      if (!path) return;
      const file = await readText(path);
      setText((t) => (t.trim() === "" ? file.text : `${t.replace(/\s*$/, "")}\n${file.text}`));
    } catch (e) {
      setError(`Couldn't read the file: ${e}`);
    }
  }

  async function submit() {
    if (await onImport(text)) setText("");
  }

  return (
    <section className="action-panel import accounts-import" aria-label="Import accounts">
      <div className="accounts-import-head">
        <h3>Import accounts</h3>
        <button onClick={loadFile} disabled={busy}>
          Load from file…
        </button>
        <span className="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      <p className="muted">
        One account per line, same as the account files: <code>email:password</code>, optionally followed by{" "}
        <code>:host:port</code> and <code>:user:pass</code> for a proxy. New accounts are added to the end of the file.
      </p>
      <textarea
        aria-label="Accounts to import"
        rows={8}
        spellCheck={false}
        value={text}
        placeholder={"email@example.com:password\nemail@example.com:password:1.2.3.4:8080\nemail@example.com:password:1.2.3.4:8080:user:pass"}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      {text.trim() !== "" && (
        <>
          <p className="accounts-import-summary" role="status">
            <strong>{plural(plan.add.length, "new account")}</strong>
            {plan.duplicates.length > 0 && <span> · {plural(plan.duplicates.length, "duplicate")} skipped</span>}
            {plan.invalid.length > 0 && <span className="error"> · {plural(plan.invalid.length, "invalid line")} skipped</span>}
          </p>
          {plan.invalid.length > 0 && (
            <details className="accounts-issues" open>
              <summary>Invalid lines</summary>
              <ul>
                {plan.invalid.slice(0, SHOWN).map((i) => (
                  <li key={i.line}>
                    Line {i.line}: <code>{i.text}</code> — {i.reason}
                  </li>
                ))}
                {plan.invalid.length > SHOWN && <li className="muted">…and {plan.invalid.length - SHOWN} more</li>}
              </ul>
            </details>
          )}
          {plan.duplicates.length > 0 && (
            <details className="accounts-issues">
              <summary>Duplicates</summary>
              <ul>
                {plan.duplicates.slice(0, SHOWN).map((d) => (
                  <li key={d.line}>
                    Line {d.line}: {d.email} — {d.inFile ? "already in this file" : "earlier in the import"}
                  </li>
                ))}
                {plan.duplicates.length > SHOWN && <li className="muted">…and {plan.duplicates.length - SHOWN} more</li>}
              </ul>
            </details>
          )}
        </>
      )}
      <div>
        <button className="primary" disabled={busy || plan.add.length === 0} onClick={submit}>
          Add {plural(plan.add.length, "account")}
        </button>
      </div>
    </section>
  );
}
