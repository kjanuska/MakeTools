import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { confirmAction } from "../../lib/dialogs";
import { formatDateTime } from "../../lib/format";
import { LINE_ENDING_LABELS } from "../../lib/format";
import { PROFILE_FIELDS, type ProfileField, type ProfileRow, type Row } from "../../lib/formats/profiles";
import { readBackup, type BackupEntry, type FileEntry } from "../../lib/fs";
import { optionsOf } from "../../lib/rules/engine";
import { PROFILE_RULES } from "../../lib/rules/profiles";
import { useShortcutsRef, type ActionId } from "../../lib/shortcuts";
import { BackupsMenu } from "./BackupsMenu";
import {
  addRow,
  bulkSet,
  deleteRows,
  duplicateRows,
  fromTemplate,
  importRows,
  isProfile,
  moveRows,
  parseImport,
  setCell,
} from "./ops";
import { confirmOverwrite } from "./prompts";
import { useStoreVersion, type ProfileStore } from "./store";

interface Props {
  file: FileEntry;
  store: ProfileStore;
  /** Called after the file on disk changed (save or restore). */
  onSaved: () => void;
  /** Every profile group, for moving/copying rows. */
  groups: FileEntry[];
  onBack: () => void;
  /** Select and scroll to the row with this profileName once loaded. */
  highlightName?: string;
}

type Panel = "template" | "import" | "transfer" | null;

type RowErrors = Partial<Record<ProfileField, string>>;

const MAX_LISTED_ERRORS = 50;

/** Row selection: clicked ids plus the anchor for shift-click ranges. */
interface Selection {
  ids: Set<number>;
  anchor: number | null;
}

const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

export function ProfilesEditor({ file, store, onSaved, groups, onBack, highlightName }: Props) {
  useStoreVersion(store);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const highlighted = useRef(false);
  /** Row index whose first editable cell gets focus after the next render (Add row). */
  const focusRow = useRef<number | null>(null);
  const shortcutHandlers = useRef<Partial<Record<ActionId, () => void>>>({});
  useShortcutsRef(shortcutHandlers);

  const entry = store.get(file.path);
  const loadError = store.loadError(file.path);
  const doc = entry?.doc;

  useEffect(() => {
    void store.load(file);
  }, [store, file]);

  // Drop selected ids whose rows are gone (deleted, or the file was re-read).
  useEffect(() => {
    if (!doc) return;
    setSelection((s) => {
      const live = new Set(doc.rows.map((r) => r.id));
      if ([...s.ids].every((id) => live.has(id)) && (s.anchor === null || live.has(s.anchor))) return s;
      return {
        ids: new Set([...s.ids].filter((id) => live.has(id))),
        anchor: s.anchor !== null && live.has(s.anchor) ? s.anchor : null,
      };
    });
  }, [doc]);

  // Jump to the profile picked in the overview search, once.
  useEffect(() => {
    if (!doc || !highlightName || highlighted.current) return;
    highlighted.current = true;
    const i = doc.rows.findIndex((r) => isProfile(r) && r.values[0] === highlightName);
    if (i < 0) return;
    setSelection({ ids: new Set([doc.rows[i].id]), anchor: doc.rows[i].id });
    const input = gridRef.current?.querySelector<HTMLElement>(`[data-row="${i}"][data-col="0"]`);
    input?.scrollIntoView?.({ block: "center" });
    input?.focus();
  }, [doc, highlightName]);

  useEffect(() => {
    if (focusRow.current === null) return;
    const i = focusRow.current;
    focusRow.current = null;
    const input = gridRef.current?.querySelector<HTMLElement>(`[data-row="${i}"][data-col="1"]`);
    input?.scrollIntoView?.({ block: "nearest" });
    input?.focus();
  }, [doc]);

  const edit = useCallback(
    (f: Parameters<ProfileStore["update"]>[1]) => {
      setStatus(null);
      store.update(file.path, f);
    },
    [store, file.path],
  );

  const onCell = useCallback(
    (id: number, field: ProfileField, value: string) => edit((d) => setCell(d, id, field, value)),
    [edit],
  );

  const rowIds = doc?.rows.map((r) => r.id) ?? [];
  const rowIdsKey = rowIds.join(",");

  const onRowHead = useCallback(
    (id: number, e: MouseEvent) => {
      const ids = rowIdsKey.split(",").map(Number);
      setSelection((s) => {
        if (e.shiftKey && s.anchor !== null && ids.includes(s.anchor)) {
          const [a, b] = [ids.indexOf(s.anchor), ids.indexOf(id)].sort((x, y) => x - y);
          const range = ids.slice(a, b + 1);
          const base = e.ctrlKey || e.metaKey ? s.ids : new Set<number>();
          return { ids: new Set([...base, ...range]), anchor: s.anchor };
        }
        if (e.ctrlKey || e.metaKey) {
          const next = new Set(s.ids);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { ids: next, anchor: id };
        }
        if (s.ids.size === 1 && s.ids.has(id)) return EMPTY_SELECTION;
        return { ids: new Set([id]), anchor: id };
      });
    },
    [rowIdsKey],
  );

  /** Up/Down/Enter move to the same column in the next or previous row. */
  const onCellKey = useCallback((e: KeyboardEvent<HTMLElement>, rowIndex: number, col: number) => {
    const isSelect = e.currentTarget.tagName === "SELECT";
    let delta = 0;
    if (e.key === "Enter") delta = e.shiftKey ? -1 : 1;
    else if (!isSelect && e.key === "ArrowDown") delta = 1;
    else if (!isSelect && e.key === "ArrowUp") delta = -1;
    if (!delta) return;
    const target = gridRef.current?.querySelector<HTMLElement>(`[data-row="${rowIndex + delta}"][data-col="${col}"]`);
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }, []);

  if (!entry || !doc) {
    shortcutHandlers.current = { back: onBack };
    return (
      <div className="file-panel">
        <h2>{file.name}</h2>
        {loadError && <p className="error">Couldn't read file: {loadError}</p>}
      </div>
    );
  }

  const { dirty, errors, errorCount, loaded } = entry;
  const profiles = doc.rows.filter(isProfile);
  const selectedIds = doc.rows.filter((r) => selection.ids.has(r.id)).map((r) => r.id);
  const selectedProfiles = profiles.filter((r) => selection.ids.has(r.id));
  const rawCount = doc.rows.length - profiles.length;
  const allSelected = doc.rows.length > 0 && selectedIds.length === doc.rows.length;
  const readOnly = !doc.headerOk;

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);
    const r = await store.save(file.path, confirmOverwrite);
    setSaving(false);
    if (r.ok) {
      onSaved();
      if (r.verified) setStatus("Saved. The previous version was backed up.");
      else setError("Saved, but the file on disk doesn't match what was written. Check it before using it.");
    } else if (r.reason === "error") {
      setError(`Save failed: ${r.error}`);
    }
  }

  async function discard() {
    const ok = await confirmAction(`Discard all unsaved changes to ${file.name}?`, "Discard changes");
    if (!ok) return;
    store.discard(file.path);
    setStatus(null);
  }

  async function restore(b: BackupEntry) {
    const when = formatDateTime(b.createdMs);
    setError(null);
    if (dirty) {
      const ok = await confirmAction(
        `Replace your unsaved changes to ${file.name} with the backup from ${when}?`,
        "Restore backup",
      );
      if (!ok) return;
    }
    try {
      const backup = await readBackup(file.path, b.id);
      const r = store.stage(file.path, backup.text);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setBackupsOpen(false);
      setSelection(EMPTY_SELECTION);
      setStatus(`Loaded the backup from ${when}. Save to keep it, or Discard changes to undo.`);
    } catch (e) {
      setError(`Couldn't read the backup: ${e}`);
    }
  }

  const canSave = dirty && errorCount === 0 && !saving;
  const hasSelection = selectedIds.length > 0;
  const focusIn = (selector: string) => rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  shortcutHandlers.current = readOnly
    ? { back: onBack, backups: () => setBackupsOpen((o) => !o) }
    : {
        save: () => canSave && void save(),
        discard: () => dirty && void discard(),
        selectAll: () => setSelection({ ids: new Set(rowIds), anchor: rowIds[0] ?? null }),
        clearSelection: () => setSelection(EMPTY_SELECTION),
        addRow: () => {
          focusRow.current = doc.rows.length;
          edit(addRow);
        },
        duplicate: () => selectedProfiles.length > 0 && edit((d) => duplicateRows(d, selectedIds)),
        deleteRows: () => hasSelection && edit((d) => deleteRows(d, selectedIds)),
        moveUp: () => hasSelection && edit((d) => moveRows(d, selectedIds, -1)),
        moveDown: () => hasSelection && edit((d) => moveRows(d, selectedIds, 1)),
        bulkEdit: () => focusIn('[aria-label="New value"]'),
        template: () => setPanel("template"),
        paste: () => setPanel("import"),
        transfer: () => setPanel("transfer"),
        backups: () => setBackupsOpen((o) => !o),
        back: onBack,
      };

  return (
    <div className="profiles-editor" ref={rootRef}>
      <div className="editor-head">
        <button onClick={onBack}>← All groups</button>
        <h2>{file.name}</h2>
        <span className="muted">
          {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}
          {rawCount > 0 && ` · ${rawCount} unparseable ${rawCount === 1 ? "line" : "lines"} (kept unchanged)`}
          {" · "}
          {LINE_ENDING_LABELS[loaded.lineEnding]}
          {loaded.hasBom && " · BOM"}
        </span>
        <span className="spacer" />
        <BackupsMenu file={file} open={backupsOpen} onToggle={() => setBackupsOpen((o) => !o)} onRestore={restore} />
      </div>

      {error && <p className="error">{error}</p>}
      {readOnly ? (
        <p className="error">
          This file's header doesn't match the profile format, so it's open read-only. Expected:{" "}
          <code>{PROFILE_FIELDS.join(",")}</code>
        </p>
      ) : (
        <>
          <div className="toolbar" role="toolbar" aria-label="Profile actions">
            <button className="primary" disabled={!canSave} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button disabled={!dirty || saving} onClick={discard}>
              Discard changes
            </button>
            <span className="toolbar-sep" />
            <button onClick={shortcutHandlers.current.addRow}>Add row</button>
            <button disabled={selectedProfiles.length === 0} onClick={() => edit((d) => duplicateRows(d, selectedIds))}>
              Duplicate
            </button>
            <button disabled={selectedIds.length === 0} onClick={() => edit((d) => deleteRows(d, selectedIds))}>
              Delete
            </button>
            <button disabled={selectedIds.length === 0} onClick={() => edit((d) => moveRows(d, selectedIds, -1))}>
              Move up
            </button>
            <button disabled={selectedIds.length === 0} onClick={() => edit((d) => moveRows(d, selectedIds, 1))}>
              Move down
            </button>
            <span className="toolbar-sep" />
            {(
              [
                ["template", "From template"],
                ["import", "Paste rows"],
                ["transfer", "Move / copy to group"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={panel === id} onClick={() => setPanel(panel === id ? null : id)}>
                {label}
              </button>
            ))}
          </div>

          <p className="editor-status" role="status">
            {selectedIds.length > 0 && <span>{selectedIds.length} selected · </span>}
            {errorCount > 0 ? (
              <span className="error">
                {errorCount} {errorCount === 1 ? "error" : "errors"}: fix {errorCount === 1 ? "it" : "them"} to save
              </span>
            ) : (
              <span className="muted">No errors</span>
            )}
            {dirty && <span className="unsaved"> · Unsaved changes</span>}
            {status && <span className="status"> · {status}</span>}
          </p>

          <BulkEditPanel
            count={selectedProfiles.length}
            onApply={(field, value) => edit((d) => bulkSet(d, selectedIds, field, value))}
          />
          {panel === "template" && (
            <TemplatePanel
              template={selectedProfiles.length === 1 ? selectedProfiles[0] : null}
              templateNumber={selectedProfiles.length === 1 ? doc.rows.indexOf(selectedProfiles[0]) + 1 : 0}
              onCreate={(n) => {
                const t = selectedProfiles[0];
                edit((d) => fromTemplate(d, t.id, n));
                setStatus(`Added ${n} ${n === 1 ? "row" : "rows"} from the template.`);
              }}
            />
          )}
          {panel === "import" && (
            <ImportPanel
              onImport={(rows) => {
                edit((d) => importRows(d, rows));
                setStatus(`Added ${rows.length} pasted ${rows.length === 1 ? "row" : "rows"}.`);
              }}
            />
          )}
          {panel === "transfer" && (
            <TransferPanel
              count={selectedProfiles.length}
              groups={groups.filter((g) => g.path !== file.path && store.get(g.path)?.doc.headerOk)}
              onTransfer={(target, mode) => {
                const r = store.transfer(file.path, target.path, selectedIds, mode);
                if (!r.ok) return r.error;
                setStatus(
                  `${mode === "copy" ? "Copied" : "Moved"} ${r.count} ${r.count === 1 ? "profile" : "profiles"} to ${target.name} (not saved yet).`,
                );
                return null;
              }}
            />
          )}
        </>
      )}

      <div className="grid-wrap">
        <table className="grid" ref={gridRef}>
          <thead>
            <tr>
              <th
                className="row-head corner"
                title="Select all rows"
                aria-label="Select all rows"
                aria-selected={allSelected}
                onClick={() =>
                  !readOnly &&
                  setSelection(allSelected ? EMPTY_SELECTION : { ids: new Set(rowIds), anchor: rowIds[0] ?? null })
                }
              >
                #
              </th>
              {PROFILE_FIELDS.map((f) => (
                <th key={f}>
                  {f}
                  {!PROFILE_RULES[f].required && <span className="muted"> (optional)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.rows.map((r, i) => (
              <GridRow
                key={r.id}
                row={r}
                index={i}
                errors={errors.get(r.id)}
                original={entry.original.get(r.id)}
                selected={selection.ids.has(r.id)}
                readOnly={readOnly}
                onCell={onCell}
                onRowHead={onRowHead}
                onCellKey={onCellKey}
              />
            ))}
          </tbody>
        </table>
        {doc.rows.length === 0 && <p className="muted">This group is empty.</p>}
      </div>

      {!readOnly && errorCount > 0 && <ErrorList rows={doc.rows} errors={errors} />}
    </div>
  );
}

interface GridRowProps {
  row: Row;
  index: number;
  errors: RowErrors | undefined;
  /** Saved values of this row; undefined for a new row. */
  original: readonly string[] | undefined;
  selected: boolean;
  readOnly: boolean;
  onCell: (id: number, field: ProfileField, value: string) => void;
  onRowHead: (id: number, e: MouseEvent) => void;
  onCellKey: (e: KeyboardEvent<HTMLElement>, rowIndex: number, col: number) => void;
}

const sameErrors = (a: RowErrors | undefined, b: RowErrors | undefined) =>
  a === b || JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

const GridRow = memo(
  function GridRow({ row, index, errors, original, selected, readOnly, onCell, onRowHead, onCellKey }: GridRowProps) {
    const number = index + 1;
    const isNew = row.kind === "record" && !original;
    const classes = [selected && "selected", isNew && "new-row"].filter(Boolean).join(" ");
    return (
      <tr className={classes || undefined} aria-selected={selected}>
        <th
          scope="row"
          className="row-head"
          aria-label={`Row ${number}`}
          title={isNew ? "New row (not saved yet)" : undefined}
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault(); // don't select text on shift-click
          }}
          onClick={(e) => !readOnly && onRowHead(row.id, e)}
        >
          {number}
        </th>
        {row.kind === "raw" ? (
          <td colSpan={PROFILE_FIELDS.length} className="raw-row" title="Kept unchanged when saving">
            {row.text === "" ? "(blank line)" : row.text}
            <span className="muted"> · unparseable ({row.text.split(",").length} values), kept unchanged</span>
          </td>
        ) : (
          PROFILE_FIELDS.map((f, col) => {
            const error = errors?.[f];
            const was = original && original[col] !== row.values[col] ? original[col] : undefined;
            return (
              <td
                key={f}
                className={`cell-td cell-${f}${error ? " invalid" : ""}${was !== undefined ? " changed" : ""}`}
              >
                <Cell
                  field={f}
                  value={row.values[col]}
                  error={error}
                  was={was}
                  label={`Row ${number} ${f}`}
                  disabled={readOnly}
                  dataRow={index}
                  dataCol={col}
                  onChange={(v) => onCell(row.id, f, v)}
                  onKeyDown={(e) => onCellKey(e, index, col)}
                />
              </td>
            );
          })
        )}
      </tr>
    );
  },
  (a, b) =>
    a.row === b.row &&
    a.index === b.index &&
    a.original === b.original &&
    a.selected === b.selected &&
    a.readOnly === b.readOnly &&
    a.onCell === b.onCell &&
    a.onRowHead === b.onRowHead &&
    a.onCellKey === b.onCellKey &&
    sameErrors(a.errors, b.errors),
);

interface CellProps {
  field: ProfileField;
  value: string;
  error?: string;
  /** Saved value, when this cell was changed. */
  was?: string;
  label: string;
  disabled?: boolean;
  dataRow?: number;
  dataCol?: number;
  className?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

function Cell({ field, value, error, was, label, disabled, dataRow, dataCol, className, onChange, onKeyDown }: CellProps) {
  const options = optionsOf(PROFILE_RULES[field]);
  const tips = [error && `${field} ${error}`, was !== undefined && `Was: ${was === "" ? "(empty)" : was}`].filter(Boolean);
  const common = {
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    title: tips.length ? tips.join("\n") : undefined,
    className: className ?? "cell",
    disabled,
    "data-row": dataRow,
    "data-col": dataCol,
    onKeyDown,
  };
  if (options) {
    return (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        {!options.includes(value) && <option value={value}>{value === "" ? "" : `${value} (current)`}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return <input {...common} value={value} spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} />;
}

function ErrorList({ rows, errors }: { rows: Row[]; errors: Map<number, RowErrors> }) {
  const items: string[] = [];
  rows.forEach((r, i) => {
    const e = errors.get(r.id);
    if (!e) return;
    for (const f of PROFILE_FIELDS) if (e[f]) items.push(`Row ${i + 1}: ${f} ${e[f]}`);
  });
  return (
    <section className="error-list" aria-label="Errors">
      <h3>Errors</h3>
      <ul>
        {items.slice(0, MAX_LISTED_ERRORS).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {items.length > MAX_LISTED_ERRORS && <p className="muted">…and {items.length - MAX_LISTED_ERRORS} more.</p>}
    </section>
  );
}

function BulkEditPanel({ count, onApply }: { count: number; onApply: (field: ProfileField, value: string) => void }) {
  const [field, setField] = useState<ProfileField>("address1");
  const [value, setValue] = useState("");
  return (
    <section className="action-panel" aria-label="Bulk edit">
      <strong>Bulk edit</strong>
      <label>
        Field{" "}
        <select
          value={field}
          onChange={(e) => {
            setField(e.target.value as ProfileField);
            setValue("");
          }}
        >
          {PROFILE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        New value <Cell field={field} value={value} label="New value" className="panel-input" onChange={setValue} />
      </label>
      <button disabled={count === 0} onClick={() => onApply(field, value)}>
        Set on {count} selected {count === 1 ? "row" : "rows"}
      </button>
      {count === 0 && <span className="muted">Select rows by clicking their numbers (Shift for a range, Ctrl to add).</span>}
    </section>
  );
}

function TemplatePanel({
  template,
  templateNumber,
  onCreate,
}: {
  template: ProfileRow | null;
  templateNumber: number;
  onCreate: (count: number) => void;
}) {
  const [count, setCount] = useState("1");
  const n = Number(count);
  const valid = /^\d+$/.test(count) && n >= 1 && n <= 1000;
  return (
    <section className="action-panel" aria-label="Create from template">
      {template ? (
        <span>
          Template: row {templateNumber} ({template.values[0] || "no name"})
        </span>
      ) : (
        <span className="muted">Select exactly one profile row to use as the template.</span>
      )}
      <label>
        How many{" "}
        <input autoFocus className="count" value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value)} />
      </label>
      <button disabled={!template || !valid} onClick={() => onCreate(n)}>
        Create {valid ? n : ""} {n === 1 ? "row" : "rows"}
      </button>
      <span className="muted">New rows go at the end, named after their row number.</span>
    </section>
  );
}

function ImportPanel({ onImport }: { onImport: (rows: string[][]) => void }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <section className="action-panel import" aria-label="Paste rows">
      <textarea
        autoFocus
        aria-label="Rows to paste"
        placeholder="One profile per line, 15 comma-separated values (same as the file). A header line is skipped."
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <div>
        <button
          disabled={text.trim() === ""}
          onClick={() => {
            const res = parseImport(text);
            if (!res.ok) {
              setErrors(res.errors);
              return;
            }
            setErrors([]);
            setText("");
            onImport(res.rows);
          }}
        >
          Add rows
        </button>
        {errors.length > 0 && (
          <ul className="error">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TransferPanel({
  count,
  groups,
  onTransfer,
}: {
  count: number;
  groups: FileEntry[];
  /** Returns an error message, or null on success. */
  onTransfer: (target: FileEntry, mode: "copy" | "move") => string | null;
}) {
  const [targetPath, setTargetPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const target = groups.find((g) => g.path === targetPath);
  const go = (mode: "copy" | "move") => target && setError(onTransfer(target, mode));
  const rows = `${count} selected ${count === 1 ? "profile" : "profiles"}`;
  return (
    <section className="action-panel" aria-label="Move or copy to group">
      <label>
        To group{" "}
        <select autoFocus value={targetPath} onChange={(e) => setTargetPath(e.target.value)}>
          <option value="">Choose…</option>
          {groups.map((g) => (
            <option key={g.path} value={g.path}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <button disabled={!target || count === 0} onClick={() => go("copy")}>
        Copy {rows}
      </button>
      <button disabled={!target || count === 0} onClick={() => go("move")}>
        Move {rows}
      </button>
      <span className="muted">Names are kept. Both groups need saving afterwards.</span>
      {error && <span className="error">{error}</span>}
    </section>
  );
}
