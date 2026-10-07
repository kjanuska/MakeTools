// A proxy file: its proxies in an editable, numbered text box, the count,
// warnings for odd lines, and Shuffle. Edits stay unsaved until Save.
//
// Kept fast for big files (10,000+ lines): typing only updates the text box;
// the count and odd lines are worked out in the background (with a spinner
// while they catch up), and the typed text is passed to the store after a
// pause in typing, or straight away before anything that needs it (save,
// shuffle, discard, a backup, leaving the editor, Save all, closing).
import { displayName } from "../../lib/table/fileNames";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { LoadingNote, LoadingPanel, useFileLoad } from "../../components/LoadingPanel";
import { BackupsMenu } from "../../components/table/BackupsMenu";
import { useFileActions } from "../../components/table/useFileActions";
import {
  countProxies,
  fromEditorText,
  oddLines,
  parseProxies,
  shuffleProxies,
  toEditorText,
} from "../../lib/formats/proxies";
import type { BackupEntry, FileEntry } from "../../lib/fs";
import { useShortcutsRef, type ActionId } from "../../lib/shortcuts";
import type { ConfirmOverwrite } from "../../lib/table/store";
import type { ProxyStore } from "./store";

interface Props {
  file: FileEntry;
  store: ProxyStore;
  confirmOverwrite: ConfirmOverwrite;
  onSaved: () => void;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const proxies = (n: number) => plural(n, "proxy", "proxies");

/** Must match the editor's line-height in App.css. */
const LINE_HEIGHT = 20;
/** How many odd lines are listed. */
const ODD_SHOWN = 100;
/** Pause in typing before the text is passed to the store. */
export const PENDING_MS = 300;

export function ProxyFileView({ file, store, confirmOverwrite, onSaved }: Props) {
  // The text box and odd lines are drawn once `ready`, so the header and toolbar show at once.
  const { entry, error: loadError, ready } = useFileLoad(store, file);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const actions = useFileActions(store, file, confirmOverwrite, onSaved);
  const { error, status, setStatus, saving } = actions;
  const handlersRef = useRef<Partial<Record<ActionId, () => void>>>({});
  useShortcutsRef(handlersRef);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);

  const storeText = useMemo(() => (entry ? toEditorText(entry.text) : null), [entry?.text]);
  const savedText = useMemo(() => (entry ? toEditorText(entry.loaded.text) : null), [entry?.loaded.text]);

  // What the text box shows. It runs ahead of the store while typing.
  const [draft, setDraft] = useState<string | null>(null);
  // The store's text as last seen or set here. Anything else means the store
  // was changed elsewhere (load, shuffle, discard, a backup), so the box shows that.
  const synced = useRef<string | null>(null);
  if (storeText !== null && storeText !== synced.current) {
    synced.current = storeText;
    setDraft(storeText);
  }

  // Typed text not yet in the store.
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const value = pending.current;
    pending.current = null;
    const e = store.get(file.path);
    if (value === null || !e) return;
    synced.current = value;
    // In the style of the file on disk, so typing it back to what's saved is no change.
    store.update(file.path, () => fromEditorText(value, e.loaded.text));
  }, [store, file.path]);

  useEffect(() => {
    const unregister = store.registerPending(flush);
    return () => {
      flush();
      unregister();
    };
  }, [store, flush]);

  const text = draft ?? "";
  // The count and odd lines lag behind typing (and the first render) instead of slowing it.
  const deferred = useDeferredValue(text, "");
  const computing = deferred !== text;
  const parsed = useMemo(() => parseProxies(deferred), [deferred]);
  const count = useMemo(() => countProxies(parsed), [parsed]);
  const odd = useMemo(() => oddLines(parsed.lines), [parsed]);
  // One number per editor line, including the empty line after a final line ending.
  const editorLines = useMemo(() => text.split("\n").length, [text]);
  const gutter = useMemo(() => Array.from({ length: editorLines }, (_, i) => i + 1).join("\n"), [editorLines]);

  if (!entry || draft === null) {
    handlersRef.current = {};
    return <LoadingPanel name={displayName(file.name)} error={loadError} />;
  }

  // Typed text the store doesn't have yet counts as a change if it differs from the saved file.
  const dirty = draft !== storeText ? draft !== savedText : entry.dirty;
  const canSave = dirty && !saving;

  function save() {
    flush();
    void actions.save();
  }

  function discard() {
    flush();
    void actions.discard();
  }

  async function restoreBackup(b: BackupEntry) {
    flush();
    if (await actions.restore(b)) setBackupsOpen(false);
  }

  handlersRef.current = {
    backups: () => setBackupsOpen((o) => !o),
    save: () => canSave && save(),
    discard: () => dirty && discard(),
  };

  function edit(value: string) {
    setDraft(value);
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, PENDING_MS);
    if (status) setStatus(null);
  }

  function shuffle() {
    flush();
    store.update(file.path, (t) => shuffleProxies(t));
    const n = countProxies(parseProxies(store.get(file.path)!.text));
    setStatus(`Shuffled ${proxies(n)}. Save to write the file.`);
  }

  /** Selects a line in the editor and scrolls to it. */
  function goToLine(line: number) {
    const el = editorRef.current;
    if (!el) return;
    const lines = text.split("\n");
    if (line > lines.length) return;
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + lines[line - 1].length);
    el.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT);
    syncGutter();
  }

  function syncGutter() {
    if (gutterRef.current && editorRef.current) gutterRef.current.scrollTop = editorRef.current.scrollTop;
  }

  return (
    <div className="proxy-file">
      <div className="editor-head">
        <h2>{displayName(file.name)}</h2>
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
        <button disabled={count < 2 && !computing} onClick={shuffle} title="Put every line in a random order">
          Shuffle
        </button>
      </div>
      <p className="editor-status" role="status" aria-busy={computing || undefined}>
        <strong className="proxy-count">{proxies(count)}</strong>
        {computing && <span className="spinner small" title="Counting…" aria-hidden="true" />}
        {odd.length > 0 && <span className="warn"> · {plural(odd.length, "odd line", "odd lines")}</span>}
        {dirty && <span className="unsaved"> · Unsaved changes</span>}
        {status && <span className="status"> · {status}</span>}
      </p>

      {!ready ? (
        <LoadingNote label={displayName(file.name)} />
      ) : (
        <div className="proxy-layout">
          <div className="proxy-editor">
            <pre className="proxy-gutter" ref={gutterRef} aria-hidden="true">
              {gutter}
            </pre>
            <textarea
              ref={editorRef}
              aria-label="Proxy list"
              value={text}
              onChange={(e) => edit(e.target.value)}
              onBlur={flush}
              onScroll={syncGutter}
              wrap="off"
              spellCheck={false}
              autoComplete="off"
              placeholder={"One proxy per line:\nhost:port:user:pass\nhost:port"}
            />
          </div>

          {odd.length > 0 && (
            <section className="proxy-odd-section" aria-label="Odd lines">
              <h3>Odd lines</h3>
              <p className="muted">Not host:port or host:port:user:pass. They're still saved as they are.</p>
              <ul className="proxy-odd">
                {odd.slice(0, ODD_SHOWN).map((o) => (
                  <li key={o.line}>
                    <button className="link" onClick={() => goToLine(o.line)}>
                      Line {o.line}
                    </button>
                    : {o.problem}
                  </li>
                ))}
                {odd.length > ODD_SHOWN && <li className="muted">…and {odd.length - ODD_SHOWN} more</li>}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
