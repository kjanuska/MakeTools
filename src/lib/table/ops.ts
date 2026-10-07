// Pure edit operations on a parsed table file. Each returns a new doc and
// leaves rows it doesn't touch as the same objects, so they serialize unchanged.
// New rows always go at the end; if rows have names, a new row is named after
// its 1-based row number.
import { headerOf, newRowId, type DataRow, type Row, type TableDoc } from "../formats/csvTable";
import type { TableSchema } from "./schema";

export const isRecord = (r: Row): r is DataRow => r.kind === "record";

function newRow(schema: TableSchema<never>, values: readonly string[], rowNumber: number, keepName: boolean): DataRow {
  const v = [...values];
  const col = schema.nameCol;
  if (col !== null && (!keepName || v[col] === "")) v[col] = String(rowNumber);
  return { kind: "record", id: newRowId(), values: v, eol: "" };
}

function appendRows(
  schema: TableSchema<never>,
  doc: TableDoc,
  sources: readonly (readonly string[])[],
  keepNames = false,
): TableDoc {
  const start = doc.rows.length;
  const added = sources.map((v, i) => newRow(schema, v, start + i + 1, keepNames));
  return { ...doc, rows: [...doc.rows, ...added] };
}

export function addRow(schema: TableSchema<never>, doc: TableDoc): TableDoc {
  return appendRows(schema, doc, [schema.newRow()]);
}

export function bulkSet(doc: TableDoc, ids: readonly number[], col: number, value: string): TableDoc {
  return updateRows(doc, ids, (values) => {
    if (values[col] === value) return values;
    const next = [...values];
    next[col] = value;
    return next;
  });
}

/** Replaces the values of the given rows; rows the function returns unchanged stay the same objects. */
export function updateRows(doc: TableDoc, ids: readonly number[], fn: (values: string[]) => string[]): TableDoc {
  const set = new Set(ids);
  let changed = false;
  const rows = doc.rows.map((r) => {
    if (!isRecord(r) || !set.has(r.id)) return r;
    const values = fn(r.values);
    if (values === r.values) return r;
    changed = true;
    return { ...r, values };
  });
  return changed ? { ...doc, rows } : doc;
}

export function deleteRows(doc: TableDoc, ids: readonly number[]): TableDoc {
  const set = new Set(ids);
  return { ...doc, rows: doc.rows.filter((r) => !set.has(r.id)) };
}

/** Copies of the selected rows, in file order, added at the end. */
export function duplicateRows(schema: TableSchema<never>, doc: TableDoc, ids: readonly number[]): TableDoc {
  return appendRows(schema, doc, selectedValues(doc, ids));
}

export function fromTemplate(schema: TableSchema<never>, doc: TableDoc, templateId: number, count: number): TableDoc {
  const t = doc.rows.find((r) => r.id === templateId);
  if (!t || !isRecord(t) || count < 1) return doc;
  return appendRows(schema, doc, Array.from({ length: count }, () => t.values));
}

/** Moves the selected rows (records or raw) one place up or down, as a block. */
export function moveRows(doc: TableDoc, ids: readonly number[], dir: -1 | 1): TableDoc {
  const set = new Set(ids);
  const rows = [...doc.rows];
  const order = dir === -1 ? rows.map((_, i) => i) : rows.map((_, i) => rows.length - 1 - i);
  for (const i of order) {
    const j = i + dir;
    if (!set.has(rows[i].id) || j < 0 || j >= rows.length || set.has(rows[j].id)) continue;
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return { ...doc, rows };
}

export type ImportResult = { ok: true; rows: string[][] } | { ok: false; errors: string[] };

/**
 * Parses pasted rows in the file's own format. Blank lines and a copied
 * header line are skipped. Any bad line rejects the whole paste.
 */
export function parseImport(schema: TableSchema<never>, text: string): ImportResult {
  const n = schema.format.fields.length;
  const header = headerOf(schema.format);
  const rows: string[][] = [];
  const errors: string[] = [];
  text.split(/\r\n|\n/).forEach((line, i) => {
    if (line.trim() === "" || line === header) return;
    const values = line.split(",");
    if (values.length !== n) errors.push(`Line ${i + 1}: expected ${n} values, found ${values.length}.`);
    else rows.push(values);
  });
  if (errors.length) return { ok: false, errors };
  if (rows.length === 0) return { ok: false, errors: ["Nothing to import."] };
  return { ok: true, rows };
}

/** Adds rows at the end, keeping their names; an empty name gets the row number. */
export function importRows(schema: TableSchema<never>, doc: TableDoc, rows: readonly (readonly string[])[]): TableDoc {
  return appendRows(schema, doc, rows, true);
}

/** Values of the selected records, in file order. Raw rows are skipped. */
export function selectedValues(doc: TableDoc, ids: readonly number[]): string[][] {
  const set = new Set(ids);
  return doc.rows.filter((r): r is DataRow => isRecord(r) && set.has(r.id)).map((r) => [...r.values]);
}

/**
 * Replaces every record with `rows` (e.g. a generated task file). Blank and
 * unparseable lines are kept, and the new records go where the first record
 * was. The i-th new record takes over the i-th old record's id and line
 * ending, so an unchanged row stays the same object and changed cells show
 * what they were.
 */
export function replaceRecords(doc: TableDoc, rows: readonly (readonly string[])[]): TableDoc {
  const old = doc.rows.filter(isRecord);
  const records: DataRow[] = rows.map((values, i) => {
    const prev = old[i];
    if (!prev) return { kind: "record", id: newRowId(), values: [...values], eol: "" };
    if (prev.values.length === values.length && prev.values.every((v, j) => v === values[j])) return prev;
    return { ...prev, values: [...values] };
  });
  const first = doc.rows.findIndex(isRecord);
  const kept = doc.rows.filter((r) => !isRecord(r));
  const at = first < 0 ? kept.length : first;
  return { ...doc, rows: [...kept.slice(0, at), ...records, ...kept.slice(at)] };
}
