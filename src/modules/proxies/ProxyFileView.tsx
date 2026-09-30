// A proxy file: its proxies (numbered, as written) and count, a box to paste a
// new list (replace or append), and Shuffle. Edits stay unsaved until Save.
import { useEffect, useMemo, useRef, useState } from "react";
import { BackupsMenu } from "../../components/table/BackupsMenu";
import { useFileActions } from "../../components/table/useFileActions";
import {
  appendProxies,
  cleanPasted,
  countProxies,
  oddLines,
  parseProxies,
  replaceProxies,
  shuffleProxies,
} from "../../lib/formats/proxies";
import type { BackupEntry, FileEntry } from "../../lib/fs";
import { useShortcutsRef, type ActionId } from "../../lib/shortcuts";
import { useStoreVersion, type ConfirmOverwrite } from "../../lib/table/store";
import type { ProxyStore } from "./store";

interface Props {
  file: FileEntry;
  store: ProxyStore;
  confirmOverwrite: ConfirmOverwrite;
  onSaved: () => void;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const proxies = (n: number) => plural(n, "proxy", "proxies");

/** How many odd lines are listed under the paste box. */
const ODD_SHOWN = 10;

export function ProxyFileView({ file, store, confirmOverwrite, onSaved }: Props) {
  useStoreVersion(store);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [onlyOdd, setOnlyOdd] = useState(false);
  const { error, status, setStatus, saving, save, discard, restore } = useFileActions(
    store,
    file,
    confirmOverwrite,
    onSaved,
  );
  const handlersRef = useRef<Partial<Record<ActionId, () => void>>>({});
  useShortcutsRef(handlersRef);

  useEffect(() => {
    void store.load(file);
  }, [store, file]);

  const entry = store.get(file.path);
  const text = entry?.text ?? "";
  const parsed = useMemo(() => parseProxies(text), [text]);
  const count = useMemo(() => countProxies(parsed), [parsed]);
  const odd = useMemo(() => oddLines(parsed.lines), [parsed]);
  const rows = useMemo(() => {
    const problems = new Map(odd.map((o) => [o.line, o.problem]));
    const all = parsed.lines.map((t, i) => ({ line: i + 1, text: t, problem: problems.get(i + 1) }));
    return onlyOdd ? all.filter((r) => r.problem) : all;
  }, [parsed, odd, onlyOdd]);

  const pastedLines = useMemo(() => cleanPasted(pasted), [pasted]);
  // Line numbers as in the paste box, so odd lines are easy to find there.
  const pastedOdd = useMemo(() => oddLines(pasted.split(/\r?\n/).map((l) => l.trim())), [pasted]);

  if (!entry) {
    handlersRef.current = {};
    const loadError = store.loadError(file.path);
    return (
      <div className="file-panel">
        <h2>{file.name}</h2>
        {loadError && <p className="error">Couldn't read file: {loadError}</p>}
      </div>
    );
  }

  const { dirty } = entry;
  const canSave = dirty && !saving;
  handlersRef.current = {
    backups: () => setBackupsOpen((o) => !o),
    save: () => canSave && void save(),
    discard: () => dirty && void discard(),
  };

  async function restoreBackup(b: BackupEntry) {
    if (await restore(b)) setBackupsOpen(false);
  }

  function shuffle() {
    store.update(file.path, (t) => shuffleProxies(t));
    setStatus(`Shuffled ${proxies(count)}. Save to write the file.`);
  }

  function applyPaste(mode: "replace" | "append") {
    const lines = pastedLines;
    if (lines.length === 0) return;
    store.update(file.path, (t) => (mode === "replace" ? replaceProxies(t, lines) : appendProxies(t, lines)));
    setPasted("");
    setStatus(
      mode === "replace"
        ? `Replaced the list with ${proxies(lines.length)}. Save to write the file.`
        : `Added ${proxies(lines.length)} to the end. Save to write the file.`,
    );
  }

  return (
    <div className="proxy-file">
      <div className="editor-head">
        <h2>{file.name}</h2>
        <span className="spacer" />
        <BackupsMenu
          file={file}
          open={backupsOpen}
          onToggle={() => setBackupsOpen((o) => !o)}
          onRestore={restoreBackup}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="toolbar">
        <button className="primary" disabled={!canSave} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button disabled={!dirty || saving} onClick={discard}>
          Discard changes
        </button>
        <span className="toolbar-sep" />
        <button disabled={count < 2} onClick={shuffle} title="Put every line in a random order">
          Shuffle
        </button>
      </div>
      <p className="editor-status" role="status">
        <strong className="proxy-count">{proxies(count)}</strong>
        {odd.length > 0 && <span className="warn"> · {plural(odd.length, "odd line", "odd lines")}</span>}
        {dirty && <span className="unsaved"> · Unsaved changes</span>}
        {status && <span className="status"> · {status}</span>}
      </p>

      <div className="proxy-layout">
        <section className="proxy-list-section" aria-label="Proxies">
          {odd.length > 0 && (
            <label className="proxy-filter">
              <input type="checkbox" checked={onlyOdd} onChange={(e) => setOnlyOdd(e.target.checked)} /> Only odd
              lines
            </label>
          )}
          {parsed.lines.length === 0 ? <p className="muted">The file is empty.</p> : <ProxyList rows={rows} />}
        </section>

        <section className="proxy-paste" aria-label="Paste a list">
          <h3>Paste a list</h3>
          <textarea
            aria-label="Pasted proxies"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"host:port:user:pass\nhost:port"}
            spellCheck={false}
          />
          <p className="muted">
            {proxies(pastedLines.length)}
            {pastedOdd.length > 0 && <span className="warn"> · {plural(pastedOdd.length, "odd line", "odd lines")}</span>}
            . Spaces around lines and blank lines are removed.
          </p>
          {pastedOdd.length > 0 && (
            <ul className="proxy-odd" aria-label="Odd pasted lines">
              {pastedOdd.slice(0, ODD_SHOWN).map((o) => (
                <li key={o.line}>
                  Line {o.line}: {o.problem}
                </li>
              ))}
              {pastedOdd.length > ODD_SHOWN && <li className="muted">…and {pastedOdd.length - ODD_SHOWN} more</li>}
            </ul>
          )}
          <div className="toolbar">
            <button
              disabled={pastedLines.length === 0}
              onClick={() => applyPaste("replace")}
              title="The pasted list becomes the whole file"
            >
              Replace
            </button>
            <button
              disabled={pastedLines.length === 0}
              onClick={() => applyPaste("append")}
              title="Add the pasted lines to the end of the file"
            >
              Append
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

interface Row {
  line: number;
  text: string;
  problem?: string;
}

const ROW_HEIGHT = 22;
/** Rows drawn above and below the visible ones. */
const OVERSCAN = 20;
/** Rows drawn when the list's height isn't known (e.g. before layout). */
const FALLBACK_ROWS = 60;

/** The lines, numbered. Only the visible ones are drawn, so 10,000+ lines stay fast. */
function ProxyList({ rows }: { rows: Row[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const height = ref.current?.clientHeight ?? 0;
  const visible = height > 0 ? Math.ceil(height / ROW_HEIGHT) : FALLBACK_ROWS;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, start + visible + 2 * OVERSCAN);

  return (
    <div className="proxy-list" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div role="list" aria-label="Proxy lines" style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
        {rows.slice(start, end).map((r, i) => (
          <div
            role="listitem"
            key={r.line}
            className={r.problem ? "proxy-row odd" : "proxy-row"}
            style={{ top: (start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
            title={r.problem}
          >
            <span className="ln">{r.line}</span>
            <span className="txt">{r.text}</span>
            {r.problem && <span className="why">{r.problem}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
