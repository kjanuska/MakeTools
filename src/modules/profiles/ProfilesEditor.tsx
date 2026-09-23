import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { confirmAction } from "../../lib/dialogs";
import { LINE_ENDING_LABELS } from "../../lib/format";
import {
  PROFILE_FIELDS,
  parseProfiles,
  serializeProfiles,
  type ProfileDoc,
  type ProfileField,
  type ProfileRow,
  type Row,
} from "../../lib/formats/profiles";
import { readText, saveText, type FileEntry, type LineEnding } from "../../lib/fs";
import { countErrors, optionsOf, validateRecords } from "../../lib/rules/engine";
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

interface Props {
  file: FileEntry;
  /** Called after the file on disk changed (save or restore). */
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

interface Loaded {
  /** File contents as last read from disk. */
  text: string;
  lineEnding: LineEnding;
  hasBom: boolean;
}

type Panel = "bulk" | "template" | "import" | null;

type RowErrors = Partial<Record<ProfileField, string>>;

const MAX_LISTED_ERRORS = 50;

export function ProfilesEditor({ file, onChanged, onDirtyChange }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [doc, setDoc] = useState<ProfileDoc | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [backupsVersion, setBackupsVersion] = useState(0);

  const applyLoaded = useCallback((l: Loaded) => {
    setLoaded(l);
    setDoc(parseProfiles(l.text));
    setSelected(new Set());
  }, []);

  const load = useCallback(() => {
    setError(null);
    readText(file.path)
      .then(applyLoaded)
      .catch((e) => {
        setLoaded(null);
        setDoc(null);
        setError(`Couldn't read file: ${e}`);
      });
  }, [file.path, applyLoaded]);

  useEffect(load, [load]);

  const serialized = useMemo(() => (doc ? serializeProfiles(doc) : null), [doc]);
  const dirty = loaded !== null && serialized !== null && serialized !== loaded.text;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const profiles = useMemo(() => (doc ? doc.rows.filter(isProfile) : []), [doc]);
  const errors = useMemo(() => validateRecords(PROFILE_FIELDS, PROFILE_RULES, profiles), [profiles]);
  const errorCount = countErrors(errors);

  const edit = useCallback((f: (d: ProfileDoc) => ProfileDoc) => {
    setStatus(null);
    setDoc((d) => (d ? f(d) : d));
  }, []);

  const onCell = useCallback(
    (id: number, field: ProfileField, value: string) => edit((d) => setCell(d, id, field, value)),
    [edit],
  );

  const onToggle = useCallback((id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (error && !doc) {
    return (
      <div className="file-panel">
        <h2>{file.name}</h2>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!doc || !loaded) return null;

  const selectedIds = doc.rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const selectedProfiles = profiles.filter((r) => selected.has(r.id));
  const rawCount = doc.rows.length - profiles.length;
  const allSelected = doc.rows.length > 0 && selectedIds.length === doc.rows.length;

  async function save() {
    if (!loaded || serialized === null) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const onDisk = await readText(file.path);
      if (onDisk.text !== loaded.text) {
        const ok = await confirmAction(
          `${file.name} was changed by another program since it was opened here.\n\nOverwrite it with your version? The other version is backed up first.`,
          "File changed on disk",
        );
        if (!ok) return;
      }
      await saveText(file.path, serialized);
      const after = await readText(file.path);
      applyLoaded(after);
      setBackupsVersion((v) => v + 1);
      onChanged();
      if (after.text !== serialized) {
        setError("Saved, but the file on disk doesn't match what was written. Check it before using it.");
      } else {
        setStatus("Saved. The previous version was backed up.");
      }
    } catch (e) {
      setError(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    const ok = await confirmAction(`Discard all unsaved changes to ${file.name}?`, "Discard changes");
    if (!ok || !loaded) return;
    applyLoaded(loaded);
    setStatus(null);
  }

  const readOnly = !doc.headerOk;

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
            <button
              disabled={selectedIds.length === 0}
              onClick={() => {
                edit((d) => deleteRows(d, selectedIds));
                setSelected(new Set());
              }}
            >
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
                ["bulk", "Bulk edit"],
                ["template", "From template"],
                ["import", "Paste rows"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={panel === id} onClick={() => setPanel(panel === id ? null : id)}>
                {label}
              </button>
            ))}
          </div>

          <p className="editor-status">
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

          {panel === "bulk" && (
            <BulkEditPanel
              count={selectedProfiles.length}
              onApply={(field, value) => edit((d) => bulkSet(d, selectedIds, field, value))}
            />
          )}
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
        <table className="grid">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  disabled={readOnly || doc.rows.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(doc.rows.map((r) => r.id)))}
                />
              </th>
              <th>#</th>
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
                number={i + 1}
                errors={errors.get(r.id)}
                selected={selected.has(r.id)}
                readOnly={readOnly}
                onCell={onCell}
                onToggle={onToggle}
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
          load();
          onChanged();
        }}
      />
    </div>
  );
}

interface GridRowProps {
  row: Row;
  number: number;
  errors: RowErrors | undefined;
  selected: boolean;
  readOnly: boolean;
  onCell: (id: number, field: ProfileField, value: string) => void;
  onToggle: (id: number) => void;
}

const sameErrors = (a: RowErrors | undefined, b: RowErrors | undefined) =>
  a === b || JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

const GridRow = memo(
  function GridRow({ row, number, errors, selected, readOnly, onCell, onToggle }: GridRowProps) {
    return (
      <tr className={selected ? "selected" : undefined}>
        <td>
          <input
            type="checkbox"
            aria-label={`Select row ${number}`}
            checked={selected}
            disabled={readOnly}
            onChange={() => onToggle(row.id)}
          />
        </td>
        <td className="row-number">{number}</td>
        {row.kind === "raw" ? (
          <td colSpan={PROFILE_FIELDS.length} className="raw-row" title="Kept unchanged when saving">
            {row.text === "" ? "(blank line)" : row.text}
            <span className="muted"> · unparseable ({row.text.split(",").length} values), kept unchanged</span>
          </td>
        ) : (
          PROFILE_FIELDS.map((f, col) => (
            <td key={f}>
              <Cell
                field={f}
                value={row.values[col]}
                error={errors?.[f]}
                label={`Row ${number} ${f}`}
                disabled={readOnly}
                onChange={(v) => onCell(row.id, f, v)}
              />
            </td>
          ))
        )}
      </tr>
    );
  },
  (a, b) =>
    a.row === b.row &&
    a.number === b.number &&
    a.selected === b.selected &&
    a.readOnly === b.readOnly &&
    a.onCell === b.onCell &&
    a.onToggle === b.onToggle &&
    sameErrors(a.errors, b.errors),
);

interface CellProps {
  field: ProfileField;
  value: string;
  error?: string;
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

function Cell({ field, value, error, label, disabled, onChange }: CellProps) {
  const options = optionsOf(PROFILE_RULES[field]);
  const common = {
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    title: error ? `${field} ${error}` : undefined,
    className: `cell cell-${field}${error ? " invalid" : ""}`,
    disabled,
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
  return <input {...common} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
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
        New value <Cell field={field} value={value} label="New value" onChange={setValue} />
      </label>
      <button disabled={count === 0} onClick={() => onApply(field, value)}>
        Set on {count} selected {count === 1 ? "row" : "rows"}
      </button>
      {count === 0 && <span className="muted">Select rows first (the top checkbox selects all).</span>}
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
