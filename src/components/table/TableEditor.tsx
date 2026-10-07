import { displayName } from "../../lib/table/fileNames";
import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { headerOf, type DataRow, type Row } from "../../lib/formats/csvTable";
import type { BackupEntry, FileEntry } from "../../lib/fs";
import { useShortcutsRef, type ActionId } from "../../lib/shortcuts";
import {
  addRow,
  deleteRows,
  duplicateRows,
  fromTemplate,
  importRows,
  isRecord,
  moveRows,
  parseImport,
  updateRows,
  type ImportResult,
} from "../../lib/table/ops";
import type { ConfirmOverwrite, TableStore } from "../../lib/table/store";
import { LoadingNote, LoadingPanel, useFileLoad } from "../LoadingPanel";
import { BackupsMenu } from "./BackupsMenu";
import { useFileActions } from "./useFileActions";
import { Cell } from "./cells";
import { VirtualBody, type VirtualHandle } from "./VirtualBody";
import type { CellType, TableUI } from "./types";

interface Props<Ctx> {
  file: FileEntry;
  store: TableStore<Ctx>;
  ui: TableUI<Ctx>;
  confirmOverwrite: ConfirmOverwrite;
  /** Called after the file on disk changed (save). */
  onSaved: () => void;
  /** Every file in the folder, for moving/copying rows. */
  files: FileEntry[];
  onBack: () => void;
  /** Select and scroll to this row once loaded. */
  highlightId?: number;
}

type Panel = "template" | "import" | "transfer" | null;

type RowErrors = Partial<Record<string, string>>;

const MAX_LISTED_ERRORS = 50;

/** Row selection: clicked ids plus the anchor for shift-click ranges. */
interface Selection {
  ids: Set<number>;
  anchor: number | null;
}

const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

/** Where an "Add…" dropdown entry was picked: a row's cell, or the bulk edit value. */
type AddTarget = { col: number; rowId: number | null };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TableEditor<Ctx>({ file, store, ui, confirmOverwrite, onSaved, files, onBack, highlightId }: Props<Ctx>) {
  // The rows are drawn once `ready`, so opening a big file shows its toolbar at once.
  const { entry, error: loadError, ready } = useFileLoad(store, file);
  const { schema } = ui;
  const { fields } = schema.format;
  const { item, items, file: fileLabel, files: filesLabel } = schema.labels;
  const ctx = store.getContext();
  const listPrefix = useId();
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [panel, setPanel] = useState<Panel>(null);
  const { error, status, setStatus, saving, save, discard, restore: stageBackup } = useFileActions(
    store,
    file,
    confirmOverwrite,
    onSaved,
  );
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [focus, setFocus] = useState<{ rowId: number; col: number } | null>(null);
  const [adding, setAdding] = useState<AddTarget | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  /** The grid's body, which draws only the rows in view in a big file. */
  const body = useRef<VirtualHandle>(null);
  const highlighted = useRef(false);
  /** Row index whose first editable cell gets focus after the next render (Add row). */
  const focusRow = useRef<number | null>(null);
  const shortcutHandlers = useRef<Partial<Record<ActionId, () => void>>>({});
  useShortcutsRef(shortcutHandlers);
  const doc = entry?.doc;
  const rowCount = useRef(0);
  rowCount.current = doc?.rows.length ?? 0;
  // The suggestion lists cover every row, so they catch up after typing instead of slowing it.
  const suggestRecords = useDeferredValue(useMemo(() => doc?.rows.filter(isRecord) ?? [], [doc]));

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

  // Jump to the row picked in the overview search, once.
  useEffect(() => {
    if (!doc || !ready || highlightId === undefined || highlighted.current) return;
    highlighted.current = true;
    const i = doc.rows.findIndex((r) => r.id === highlightId);
    if (i < 0) return;
    setSelection({ ids: new Set([highlightId]), anchor: highlightId });
    body.current?.reveal(i, () => {
      const input = gridRef.current?.querySelector<HTMLElement>(`[data-row="${i}"][data-col="0"]`);
      input?.scrollIntoView?.({ block: "center" });
      input?.focus();
    });
  }, [doc, ready, highlightId]);

  useEffect(() => {
    if (focusRow.current === null) return;
    const i = focusRow.current;
    focusRow.current = null;
    body.current?.reveal(i, () => {
      const input = gridRef.current?.querySelector<HTMLElement>(`[data-row="${i}"][data-col="${ui.firstEditCol}"]`);
      input?.scrollIntoView?.({ block: "nearest" });
      input?.focus();
    });
  }, [doc, ui.firstEditCol]);

  const edit = useCallback(
    (f: Parameters<TableStore<Ctx>["update"]>[1]) => {
      setStatus(null);
      store.update(file.path, f);
    },
    [store, file.path],
  );

  /** Sets one cell (or the same cell on many rows), letting the module adjust related cells. */
  const setCells = useCallback(
    (ids: readonly number[], col: number, value: string) =>
      edit((d) =>
        updateRows(d, ids, (values) => {
          if (ui.applyEdit) return ui.applyEdit(values, col, value, store.getContext());
          if (values[col] === value) return values;
          const next = [...values];
          next[col] = value;
          return next;
        }),
      ),
    [edit, ui, store],
  );

  const onCell = useCallback((id: number, col: number, value: string) => setCells([id], col, value), [setCells]);

  const onCellFocus = useCallback((rowId: number, col: number) => setFocus({ rowId, col }), []);

  const onCellBlur = useCallback(
    (rowId: number, col: number, value: string) => {
      setFocus((f) => (f && f.rowId === rowId && f.col === col ? null : f));
      const cleaned = ui.cleanOnBlur?.(col, value);
      if (cleaned !== undefined && cleaned !== value) setCells([rowId], col, cleaned);
    },
    [ui, setCells],
  );

  const onRequestAdd = useCallback((rowId: number, col: number) => setAdding({ rowId, col }), []);

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
    const el = e.currentTarget as HTMLInputElement;
    // Dropdowns and spin buttons use Up/Down themselves.
    const ownsArrows = el.tagName === "SELECT" || el.type === "number";
    let delta = 0;
    if (e.key === "Enter") delta = e.shiftKey ? -1 : 1;
    else if (!ownsArrows && e.key === "ArrowDown") delta = 1;
    else if (!ownsArrows && e.key === "ArrowUp") delta = -1;
    if (!delta) return;
    const next = rowIndex + delta;
    const find = () => gridRef.current?.querySelector<HTMLElement>(`[data-row="${next}"][data-col="${col}"]`);
    const target = find();
    if (target) {
      e.preventDefault();
      target.focus();
    } else if (next >= 0 && next < rowCount.current) {
      // A row of a big file that isn't drawn yet.
      e.preventDefault();
      body.current?.reveal(next, () => find()?.focus());
    }
  }, []);

  if (!entry || !doc) {
    shortcutHandlers.current = { back: onBack };
    return (
      <LoadingPanel
        name={displayName(file.name)}
        error={loadError}
        back={{ label: `← All ${filesLabel}`, onClick: onBack }}
      />
    );
  }

  const { dirty, errors, errorCount, loaded } = entry;
  const records = doc.rows.filter(isRecord);
  const selectedIds = doc.rows.filter((r) => selection.ids.has(r.id)).map((r) => r.id);
  const selectedRecords = records.filter((r) => selection.ids.has(r.id));
  const rawCount = doc.rows.length - records.length;
  const allSelected = doc.rows.length > 0 && selectedIds.length === doc.rows.length;
  const readOnly = !doc.headerOk;
  const nameCol = schema.nameCol;

  async function restore(b: BackupEntry) {
    if (!(await stageBackup(b))) return;
    setBackupsOpen(false);
    setSelection(EMPTY_SELECTION);
  }

  function finishAdd(value: string) {
    if (!adding) return;
    const type = ui.cell(adding.col);
    if (type.kind === "select" && type.add) type.add.onAdd(value);
    if (adding.rowId === null) setBulkValue(value);
    else setCells([adding.rowId], adding.col, value);
    setAdding(null);
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
          edit((d) => addRow(schema, d));
        },
        duplicate: () => selectedRecords.length > 0 && edit((d) => duplicateRows(schema, d, selectedIds)),
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

  const addType = adding ? ui.cell(adding.col) : null;
  const extras = ui.extraColumns ?? [];

  return (
    <div className="table-editor" ref={rootRef}>
      <div className="editor-head">
        <button onClick={onBack}>← All {filesLabel}</button>
        <h2>{displayName(file.name)}</h2>
        <span className="muted">
          {ui.summary(records, ctx)}
          {rawCount > 0 && ` · ${rawCount} unparseable ${rawCount === 1 ? "line" : "lines"} (kept unchanged)`}
          {loaded.hasBom && " · BOM"}
        </span>
        <span className="spacer" />
        <BackupsMenu file={file} open={backupsOpen} onToggle={() => setBackupsOpen((o) => !o)} onRestore={restore} />
      </div>

      {error && <p className="error">{error}</p>}
      {readOnly ? (
        <p className="error">
          This file's header doesn't match the {item} format, so it's open read-only. Expected:{" "}
          <code>{headerOf(schema.format)}</code>
        </p>
      ) : (
        <>
          <div className="toolbar" role="toolbar" aria-label={`${cap(item)} actions`}>
            <button className="primary" disabled={!canSave} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button disabled={!dirty || saving} onClick={discard}>
              Discard changes
            </button>
            <span className="toolbar-sep" />
            <button onClick={shortcutHandlers.current.addRow}>Add row</button>
            <button disabled={selectedRecords.length === 0} onClick={shortcutHandlers.current.duplicate}>
              Duplicate
            </button>
            <button disabled={!hasSelection} onClick={shortcutHandlers.current.deleteRows}>
              Delete
            </button>
            <button disabled={!hasSelection} onClick={shortcutHandlers.current.moveUp}>
              Move up
            </button>
            <button disabled={!hasSelection} onClick={shortcutHandlers.current.moveDown}>
              Move down
            </button>
            <span className="toolbar-sep" />
            {(
              [
                ["template", "From template"],
                ["import", "Paste rows"],
                ["transfer", `Move / copy to ${fileLabel}`],
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
          {ready && errorCount > 0 && <ErrorList fields={fields} rows={doc.rows} errors={errors} />}

          {adding && addType?.kind === "select" && addType.add && (
            <AddOptionPanel prompt={addType.add.prompt} onAdd={finishAdd} onCancel={() => setAdding(null)} />
          )}

          <SuggestionLists ui={ui} records={suggestRecords} prefix={listPrefix} />
          <BulkEditPanel
            ui={ui}
            ctx={ctx}
            listPrefix={listPrefix}
            count={selectedRecords.length}
            sampleValues={selectedRecords[0]?.values ?? fields.map(() => "")}
            value={bulkValue}
            onValue={setBulkValue}
            onRequestAdd={(col) => setAdding({ col, rowId: null })}
            onApply={(col, value) => setCells(selectedIds, col, value)}
          />
          {panel === "template" && (
            <TemplatePanel
              item={item}
              template={selectedRecords.length === 1 ? selectedRecords[0] : null}
              templateNumber={selectedRecords.length === 1 ? doc.rows.indexOf(selectedRecords[0]) + 1 : 0}
              nameCol={nameCol}
              onCreate={(n) => {
                const t = selectedRecords[0];
                edit((d) => fromTemplate(schema, d, t.id, n));
                setStatus(`Added ${n} ${n === 1 ? "row" : "rows"} from the template.`);
              }}
            />
          )}
          {panel === "import" && (
            <ImportPanel
              placeholder={`One ${item} per line, ${fields.length} comma-separated values (same as the file). A header line is skipped.`}
              parse={(text) => parseImport(schema, text)}
              onImport={(rows) => {
                edit((d) => importRows(schema, d, rows));
                setStatus(`Added ${rows.length} pasted ${rows.length === 1 ? "row" : "rows"}.`);
              }}
            />
          )}
          {panel === "transfer" && (
            <TransferPanel
              count={selectedRecords.length}
              labels={schema.labels}
              keepsNames={nameCol !== null}
              targets={files.filter((g) => g.path !== file.path && store.get(g.path)?.doc.headerOk)}
              onTransfer={(target, mode) => {
                const r = store.transfer(file.path, target.path, selectedIds, mode);
                if (!r.ok) return r.error;
                setStatus(
                  `${mode === "copy" ? "Copied" : "Moved"} ${r.count} ${r.count === 1 ? item : items} to ${displayName(target.name)} (not saved yet).`,
                );
                return null;
              }}
            />
          )}
        </>
      )}

      {!ready ? (
        <LoadingNote label={displayName(file.name)} />
      ) : (
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
                {fields.map((f, col) => [
                  <th key={f}>
                    {f}
                    {ui.optional(col) && <span className="muted"> (optional)</span>}
                  </th>,
                  ...extras.filter((x) => x.after === col).map((x) => <th key={`x-${x.header}`}>{x.header}</th>),
                ])}
              </tr>
            </thead>
            <VirtualBody
              items={doc.rows}
              colSpan={1 + fields.length + extras.length}
              handle={body}
              renderRow={(r, i) => (
                <GridRow
                  key={r.id}
                  ui={ui}
                  ctx={ctx}
                  listPrefix={listPrefix}
                  row={r}
                  index={i}
                  errors={errors.get(r.id)}
                  original={entry.original.get(r.id)}
                  selected={selection.ids.has(r.id)}
                  readOnly={readOnly}
                  focusCol={focus?.rowId === r.id ? focus.col : null}
                  onCell={onCell}
                  onRowHead={onRowHead}
                  onCellKey={onCellKey}
                  onCellFocus={onCellFocus}
                  onCellBlur={onCellBlur}
                  onRequestAdd={onRequestAdd}
                />
              )}
            />
          </table>
          {doc.rows.length === 0 && <p className="muted">This {fileLabel} is empty.</p>}
        </div>
      )}
    </div>
  );
}

interface GridRowProps<Ctx> {
  ui: TableUI<Ctx>;
  ctx: Ctx;
  /** Prefix of the suggestion <datalist> ids (see SuggestionLists). */
  listPrefix: string;
  row: Row;
  index: number;
  errors: RowErrors | undefined;
  /** Saved values of this row; undefined for a new row. */
  original: readonly string[] | undefined;
  selected: boolean;
  readOnly: boolean;
  /** Column being edited in this row, if any. */
  focusCol: number | null;
  onCell: (id: number, col: number, value: string) => void;
  onRowHead: (id: number, e: MouseEvent) => void;
  onCellKey: (e: KeyboardEvent<HTMLElement>, rowIndex: number, col: number) => void;
  onCellFocus: (id: number, col: number) => void;
  onCellBlur: (id: number, col: number, value: string) => void;
  onRequestAdd: (id: number, col: number) => void;
}

const sameErrors = (a: RowErrors | undefined, b: RowErrors | undefined) =>
  a === b || JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

function GridRowImpl<Ctx>(props: GridRowProps<Ctx>) {
  const { ui, ctx, listPrefix, row, index, errors, original, selected, readOnly, focusCol } = props;
  const { onCell, onRowHead, onCellKey, onCellFocus, onCellBlur, onRequestAdd } = props;
  const fields = ui.schema.format.fields;
  const extras = ui.extraColumns ?? [];
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
        <td colSpan={fields.length + extras.length} className="raw-row" title="Kept unchanged when saving">
          {row.text === "" ? "(blank line)" : row.text}
          <span className="muted"> · unparseable ({row.text.split(",").length} values), kept unchanged</span>
        </td>
      ) : (
        fields.map((f, col) => {
          const error = errors?.[f];
          const was = original && original[col] !== row.values[col] ? original[col] : undefined;
          const type = ui.cell(col, row.values);
          const random = type.kind === "text" && type.random && row.values[col] === "random";
          return [
            <td
              key={f}
              className={`cell-td cell-${f}${error ? " invalid" : ""}${was !== undefined ? " changed" : ""}${random ? " random" : ""}`}
            >
              <Cell
                type={type}
                field={f}
                value={row.values[col]}
                values={row.values}
                ctx={ctx}
                error={error}
                was={was}
                label={`Row ${number} ${f}`}
                focused={focusCol === col}
                disabled={readOnly}
                dataRow={index}
                dataCol={col}
                onChange={(v) => onCell(row.id, col, v)}
                onKeyDown={(e) => onCellKey(e, index, col)}
                onFocus={() => onCellFocus(row.id, col)}
                onBlur={() => onCellBlur(row.id, col, row.values[col])}
                onRequestAdd={() => onRequestAdd(row.id, col)}
                listId={`${listPrefix}-${col}`}
              />
            </td>,
            ...extras
              .filter((x) => x.after === col)
              .map((x) => (
                <td key={`x-${x.header}`} className={`extra-td ${x.className ?? ""}`} aria-label={`Row ${number} ${x.header}`}>
                  {x.render(row.values, ctx)}
                </td>
              )),
          ];
        })
      )}
    </tr>
  );
}

const GridRow = memo(
  GridRowImpl,
  (a, b) =>
    a.row === b.row &&
    a.ctx === b.ctx &&
    a.listPrefix === b.listPrefix &&
    a.index === b.index &&
    a.original === b.original &&
    a.selected === b.selected &&
    a.readOnly === b.readOnly &&
    a.focusCol === b.focusCol &&
    a.onCell === b.onCell &&
    a.onRowHead === b.onRowHead &&
    a.onCellKey === b.onCellKey &&
    a.onCellBlur === b.onCellBlur &&
    sameErrors(a.errors, b.errors),
) as typeof GridRowImpl;

function ErrorList({ fields, rows, errors }: { fields: readonly string[]; rows: Row[]; errors: Map<number, RowErrors> }) {
  const list: string[] = [];
  rows.forEach((r, i) => {
    const e = errors.get(r.id);
    if (!e) return;
    for (const f of fields) if (e[f]) list.push(`Row ${i + 1}: ${f} ${e[f]}`);
  });
  return (
    <section className="error-list" aria-label="Errors">
      <ul>
        {list.slice(0, MAX_LISTED_ERRORS).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {list.length > MAX_LISTED_ERRORS && <p className="muted">…and {list.length - MAX_LISTED_ERRORS} more.</p>}
    </section>
  );
}

function AddOptionPanel({ prompt, onAdd, onCancel }: { prompt: string; onAdd: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const v = value.trim();
  const bad = /[,"\r\n]/.test(v);
  return (
    <section className="action-panel" aria-label={prompt}>
      <label>
        {prompt}{" "}
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && v && !bad) onAdd(v);
            if (e.key === "Escape") onCancel();
          }}
        />
      </label>
      <button disabled={!v || bad} onClick={() => onAdd(v)}>
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
      {bad && <span className="error">Can't contain a comma, quote or line break.</span>}
    </section>
  );
}

function BulkEditPanel<Ctx>({
  ui,
  ctx,
  listPrefix,
  count,
  sampleValues,
  value,
  onValue,
  onRequestAdd,
  onApply,
}: {
  ui: TableUI<Ctx>;
  ctx: Ctx;
  listPrefix: string;
  count: number;
  /** A selected row's values, for dropdowns whose options depend on the row. */
  sampleValues: readonly string[];
  value: string;
  onValue: (v: string) => void;
  onRequestAdd: (col: number) => void;
  onApply: (col: number, value: string) => void;
}) {
  const fields = ui.schema.format.fields;
  const [col, setCol] = useState(ui.bulkDefaultCol);
  const type: CellType<Ctx> = ui.cell(col, sampleValues);
  // Dependent dropdowns stay usable here even if the sample row disables them.
  // The typed value is shown as-is, not as a display view.
  const panelType: CellType<Ctx> =
    type.kind === "select" ? { ...type, disabled: undefined } : type.kind === "text" ? { ...type, display: undefined } : type;
  return (
    <section className="action-panel" aria-label="Bulk edit">
      <strong>Bulk edit</strong>
      <label>
        Field{" "}
        <select
          value={fields[col]}
          onChange={(e) => {
            setCol(fields.indexOf(e.target.value));
            onValue("");
          }}
        >
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        New value{" "}
        <Cell
          type={panelType}
          field={fields[col]}
          value={value}
          values={sampleValues}
          ctx={ctx}
          label="New value"
          className="panel-input"
          onChange={onValue}
          onRequestAdd={() => onRequestAdd(col)}
          listId={`${listPrefix}-${col}`}
        />
      </label>
      <button disabled={count === 0} onClick={() => onApply(col, value)}>
        Set on {count} selected {count === 1 ? "row" : "rows"}
      </button>
      {count === 0 && <span className="muted">Select rows by clicking their numbers (Shift for a range, Ctrl to add).</span>}
    </section>
  );
}

/** One <datalist> per `suggest` text column: its base values, then the others used in the file. */
function SuggestionListsImpl<Ctx>({ ui, records, prefix }: { ui: TableUI<Ctx>; records: readonly DataRow[]; prefix: string }) {
  return (
    <>
      {ui.schema.format.fields.map((_, col) => {
        const type = ui.cell(col);
        if (type.kind !== "text" || !type.suggest) return null;
        const values = new Set(type.suggest.base);
        for (const r of records) if (r.values[col] !== "") values.add(r.values[col]);
        return (
          <datalist key={col} id={`${prefix}-${col}`}>
            {[...values].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        );
      })}
    </>
  );
}

const SuggestionLists = memo(SuggestionListsImpl) as typeof SuggestionListsImpl;

function TemplatePanel({
  item,
  template,
  templateNumber,
  nameCol,
  onCreate,
}: {
  item: string;
  template: DataRow | null;
  templateNumber: number;
  nameCol: number | null;
  onCreate: (count: number) => void;
}) {
  const [count, setCount] = useState("1");
  const n = Number(count);
  const valid = /^\d+$/.test(count) && n >= 1 && n <= 1000;
  return (
    <section className="action-panel" aria-label="Create from template">
      {template ? (
        <span>
          Template: row {templateNumber}
          {nameCol !== null && ` (${template.values[nameCol] || "no name"})`}
        </span>
      ) : (
        <span className="muted">Select exactly one {item} row to use as the template.</span>
      )}
      <label>
        How many{" "}
        <input autoFocus className="count" value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value)} />
      </label>
      <button disabled={!template || !valid} onClick={() => onCreate(n)}>
        Create {valid ? n : ""} {n === 1 ? "row" : "rows"}
      </button>
      <span className="muted">
        {nameCol !== null ? "New rows go at the end, named after their row number." : "New rows go at the end."}
      </span>
    </section>
  );
}

function ImportPanel({
  placeholder,
  parse,
  onImport,
}: {
  placeholder: string;
  parse: (text: string) => ImportResult;
  onImport: (rows: string[][]) => void;
}) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <section className="action-panel import" aria-label="Paste rows">
      <textarea
        autoFocus
        aria-label="Rows to paste"
        placeholder={placeholder}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <div>
        <button
          disabled={text.trim() === ""}
          onClick={() => {
            const res = parse(text);
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
  labels,
  keepsNames,
  targets,
  onTransfer,
}: {
  count: number;
  labels: { item: string; items: string; file: string; files: string };
  keepsNames: boolean;
  targets: FileEntry[];
  /** Returns an error message, or null on success. */
  onTransfer: (target: FileEntry, mode: "copy" | "move") => string | null;
}) {
  const [targetPath, setTargetPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((g) => g.path === targetPath);
  const go = (mode: "copy" | "move") => target && setError(onTransfer(target, mode));
  const rows = `${count} selected ${count === 1 ? labels.item : labels.items}`;
  return (
    <section className="action-panel" aria-label={`Move or copy to ${labels.file}`}>
      <label>
        To {labels.file}{" "}
        <select autoFocus value={targetPath} onChange={(e) => setTargetPath(e.target.value)}>
          <option value="">Choose…</option>
          {targets.map((g) => (
            <option key={g.path} value={g.path}>
              {displayName(g.name)}
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
      <span className="muted">
        {keepsNames && "Names are kept. "}Both {labels.files} need saving afterwards.
      </span>
      {error && <span className="error">{error}</span>}
    </section>
  );
}

