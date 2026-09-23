import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { confirmAction } from "../../lib/dialogs";
import { LINE_ENDING_LABELS } from "../../lib/format";
import { PROFILE_FIELDS, type ProfileField, type ProfileRow, type Row } from "../../lib/formats/profiles";
import type { FileEntry } from "../../lib/fs";
import { optionsOf } from "../../lib/rules/engine";
import { PROFILE_RULES } from "../../lib/rules/profiles";
import { BackupsPanel } from "../../shell/BackupsPanel";
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
}

type Panel = "template" | "import" | null;

type RowErrors = Partial<Record<ProfileField, string>>;

const MAX_LISTED_ERRORS = 50;

/** Row selection: clicked ids plus the anchor for shift-click ranges. */
interface Selection {
  ids: Set<number>;
  anchor: number | null;
}

const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

export function ProfilesEditor({ file, store, onSaved }: Props) {
  useStoreVersion(store);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [backupsVersion, setBackupsVersion] = useState(0);
  const gridRef = useRef<HTMLTableElement>(null);

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
      setBackupsVersion((v) => v + 1);
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

  return (
    <div className="profiles-editor">
      <div className="editor-head">
        <h2>{file.name}</h2>
        <span className="muted">
          {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}
          {rawCount > 0 && ` · ${rawCount} unparseable ${rawCount === 1 ? "line" : "lines"} (kept unchanged)`}
          {" · "}
          {LINE_ENDING_LABELS[loaded.lineEnding]}
          {loaded.hasBom && " · BOM"}
        </span>
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
            <button className="primary" disabled={!dirty || errorCount > 0 || saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button disabled={!dirty || saving} onClick={discard}>
              Discard changes
            </button>
            <span className="toolbar-sep" />
            <button onClick={() => edit(addRow)}>Add row</button>
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

      <BackupsPanel
        key={backupsVersion}
        file={file}
        restoreDisabledReason={dirty ? "Save or discard your changes before restoring a backup." : undefined}
        onRestored={() => {
          void store.load(file, true);
          onSaved();
        }}
      />
    </div>
  );
}

interface GridRowProps {
  row: Row;
  index: number;
  errors: RowErrors | undefined;
  selected: boolean;
  readOnly: boolean;
  onCell: (id: number, field: ProfileField, value: string) => void;
  onRowHead: (id: number, e: MouseEvent) => void;
  onCellKey: (e: KeyboardEvent<HTMLElement>, rowIndex: number, col: number) => void;
}

const sameErrors = (a: RowErrors | undefined, b: RowErrors | undefined) =>
  a === b || JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

const GridRow = memo(
  function GridRow({ row, index, errors, selected, readOnly, onCell, onRowHead, onCellKey }: GridRowProps) {
    const number = index + 1;
    return (
      <tr className={selected ? "selected" : undefined} aria-selected={selected}>
        <th
          scope="row"
          className="row-head"
          aria-label={`Row ${number}`}
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
            return (
              <td key={f} className={`cell-td cell-${f}${error ? " invalid" : ""}`}>
                <Cell
                  field={f}
                  value={row.values[col]}
                  error={error}
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
  label: string;
  disabled?: boolean;
  dataRow?: number;
  dataCol?: number;
  className?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

function Cell({ field, value, error, label, disabled, dataRow, dataCol, className, onChange, onKeyDown }: CellProps) {
  const options = optionsOf(PROFILE_RULES[field]);
  const common = {
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    title: error ? `${field} ${error}` : undefined,
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
        <input className="count" value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value)} />
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
