// A task file: its task counts (per group, input, proxy group, mode…) next to
// the builder that regenerates it, or the raw rows in the shared table editor.
import { useEffect, useMemo, useRef, useState } from "react";
import { BackupsMenu } from "../../components/table/BackupsMenu";
import { TableEditor } from "../../components/table/TableEditor";
import type { TableUI } from "../../components/table/types";
import { useFileActions } from "../../components/table/useFileActions";
import { headerOf } from "../../lib/formats/csvTable";
import type { BackupEntry, FileEntry } from "../../lib/fs";
import { useShortcutsRef, type ActionId } from "../../lib/shortcuts";
import { isRecord, replaceRecords } from "../../lib/table/ops";
import { useStoreVersion, type ConfirmOverwrite, type TableStore } from "../../lib/table/store";
import { BreakdownView } from "./BreakdownView";
import { breakdown, inferPlan, type BuildPlan } from "./build";
import type { TaskContext } from "./schema";
import { TaskBuilder } from "./TaskBuilder";

interface Props {
  file: FileEntry;
  store: TableStore<TaskContext>;
  ui: TableUI<TaskContext>;
  confirmOverwrite: ConfirmOverwrite;
  onSaved: () => void;
  files: FileEntry[];
  onBack: () => void;
  /** Open the raw rows at this row (from the overview search). */
  highlightId?: number;
}

type View = "tasks" | "raw";

/** A number per doc object, so the builder can start again when the file's rows change. */
const docIds = new WeakMap<object, number>();
let nextDocId = 1;
function docVersion(doc: object): number {
  let id = docIds.get(doc);
  if (id === undefined) docIds.set(doc, (id = nextDocId++));
  return id;
}

/** The view each file was last shown in, so coming back to a file (e.g. from Settings) keeps it. */
const lastView = new Map<string, View>();

/**
 * The last plan applied to each file, with the rows it gave. While the file
 * still has exactly those rows, the builder shows that plan as the user left
 * it: a file only holds counts, so reading it back can't always tell which
 * input had a custom split.
 */
const appliedPlans = new Map<string, { plan: BuildPlan; rows: string }>();

const VIEWS: [View, string][] = [
  ["tasks", "Tasks"],
  ["raw", "Raw rows"],
];

export function TaskFileView(props: Props) {
  const { file, store, ui, confirmOverwrite, onSaved, onBack, highlightId } = props;
  useStoreVersion(store);
  const [view, setViewState] = useState<View>(highlightId === undefined ? (lastView.get(file.path) ?? "tasks") : "raw");
  const setView = (v: View) => {
    lastView.set(file.path, v);
    setViewState(v);
  };
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [resets, setResets] = useState(0);
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
  const ctx = store.getContext();
  const records = useMemo(() => entry?.doc.rows.filter(isRecord).map((r) => r.values) ?? [], [entry?.doc]);
  const summary = useMemo(() => breakdown(records, ctx), [records, ctx]);
  const plan = useMemo(() => {
    const applied = appliedPlans.get(file.path);
    return applied && applied.rows === JSON.stringify(records) ? applied.plan : inferPlan(records, ctx);
  }, [records, ctx, file.path]);

  const tabs = (
    <div className="view-tabs" role="tablist" aria-label="View">
      {VIEWS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  if (view === "raw") {
    // The table editor registers its own shortcuts (the latest registered wins).
    handlersRef.current = {};
    return (
      <>
        {tabs}
        <TableEditor {...props} />
      </>
    );
  }

  if (!entry) {
    handlersRef.current = { back: onBack };
    const loadError = store.loadError(file.path);
    return (
      <div className="file-panel">
        <h2>{file.name}</h2>
        {loadError && <p className="error">Couldn't read file: {loadError}</p>}
      </div>
    );
  }

  const { dirty, errorCount } = entry;
  const readOnly = !entry.doc.headerOk;
  const canSave = dirty && errorCount === 0 && !saving && !readOnly;
  handlersRef.current = {
    back: onBack,
    backups: () => setBackupsOpen((o) => !o),
    ...(readOnly ? {} : { save: () => canSave && void save(), discard: () => dirty && void discard() }),
  };

  async function restoreBackup(b: BackupEntry) {
    if (await restore(b)) setBackupsOpen(false);
  }

  return (
    <div className="task-file">
      <div className="editor-head">
        <button onClick={onBack}>← All task files</button>
        <h2>{file.name}</h2>
        <span className="spacer" />
        <BackupsMenu
          file={file}
          open={backupsOpen}
          onToggle={() => setBackupsOpen((o) => !o)}
          onRestore={restoreBackup}
        />
      </div>
      {tabs}
      {error && <p className="error">{error}</p>}
      {readOnly ? (
        <p className="error">
          This file's header doesn't match the task format, so it's open read-only and can't be rebuilt. Expected:{" "}
          <code>{headerOf(ui.schema.format)}</code>
        </p>
      ) : (
        <>
          <div className="toolbar">
            <button className="primary" disabled={!canSave} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button disabled={!dirty || saving} onClick={discard}>
              Discard changes
            </button>
          </div>
          <p className="editor-status" role="status">
            {errorCount > 0 ? (
              <span className="error">
                {errorCount} {errorCount === 1 ? "error" : "errors"}: fix {errorCount === 1 ? "it" : "them"} in Raw rows
                (or rebuild) to save
              </span>
            ) : (
              <span className="muted">No errors</span>
            )}
            {dirty && <span className="unsaved"> · Unsaved changes</span>}
            {status && <span className="status"> · {status}</span>}
          </p>
        </>
      )}

      {readOnly ? (
        <BreakdownView b={summary} />
      ) : (
        <TaskBuilder
          // Starts again from the file whenever the file's rows change (apply, discard, restore) or on Reset.
          key={`${ctx.ready}:${docVersion(entry.doc)}:${resets}`}
          initial={plan}
          ctx={ctx}
          ui={ui}
          before={summary}
          onReset={() => setResets((n) => n + 1)}
          onApply={(rows, applied) => {
            appliedPlans.set(file.path, { plan: applied, rows: JSON.stringify(rows) });
            store.update(file.path, (d) => replaceRecords(d, rows));
            setStatus(`Applied: ${rows.length} ${rows.length === 1 ? "task" : "tasks"}. Save to write the file.`);
          }}
        />
      )}
    </div>
  );
}
