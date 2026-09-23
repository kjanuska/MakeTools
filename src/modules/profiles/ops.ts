// Pure edit operations on a parsed profile file. Each returns a new doc and
// leaves rows it doesn't touch as the same objects, so they serialize unchanged.
// New rows always go at the end, named after their 1-based row number.
import {
  PROFILE_FIELDS,
  PROFILE_HEADER,
  newRowId,
  type ProfileDoc,
  type ProfileField,
  type ProfileRow,
  type Row,
} from "../../lib/formats/profiles";

const NAME = 0;
const COL = Object.fromEntries(PROFILE_FIELDS.map((f, i) => [f, i])) as Record<ProfileField, number>;

export const isProfile = (r: Row): r is ProfileRow => r.kind === "profile";

function newRow(values: readonly string[], rowNumber: number, keepName = false): ProfileRow {
  const v = [...values];
  if (!keepName || v[NAME] === "") v[NAME] = String(rowNumber);
  return { kind: "profile", id: newRowId(), values: v, eol: "" };
}

function appendRows(doc: ProfileDoc, sources: readonly (readonly string[])[], keepNames = false): ProfileDoc {
  const start = doc.rows.length;
  const added = sources.map((v, i) => newRow(v, start + i + 1, keepNames));
  return { ...doc, rows: [...doc.rows, ...added] };
}

/** One empty row. Country is prefilled because "US" is the only allowed value. */
export function addRow(doc: ProfileDoc): ProfileDoc {
  const values = PROFILE_FIELDS.map(() => "");
  values[COL.country] = "US";
  return appendRows(doc, [values]);
}

export function setCell(doc: ProfileDoc, id: number, field: ProfileField, value: string): ProfileDoc {
  return bulkSet(doc, [id], field, value);
}

export function bulkSet(doc: ProfileDoc, ids: readonly number[], field: ProfileField, value: string): ProfileDoc {
  const set = new Set(ids);
  const col = COL[field];
  return {
    ...doc,
    rows: doc.rows.map((r) => {
      if (!isProfile(r) || !set.has(r.id) || r.values[col] === value) return r;
      const values = [...r.values];
      values[col] = value;
      return { ...r, values };
    }),
  };
}

export function deleteRows(doc: ProfileDoc, ids: readonly number[]): ProfileDoc {
  const set = new Set(ids);
  return { ...doc, rows: doc.rows.filter((r) => !set.has(r.id)) };
}

/** Copies of the selected profile rows, in file order, added at the end. */
export function duplicateRows(doc: ProfileDoc, ids: readonly number[]): ProfileDoc {
  const set = new Set(ids);
  const sources = doc.rows.filter((r) => isProfile(r) && set.has(r.id)).map((r) => (r as ProfileRow).values);
  return appendRows(doc, sources);
}

export function fromTemplate(doc: ProfileDoc, templateId: number, count: number): ProfileDoc {
  const t = doc.rows.find((r) => r.id === templateId);
  if (!t || !isProfile(t) || count < 1) return doc;
  return appendRows(doc, Array.from({ length: count }, () => t.values));
}

/** Moves the selected rows (profile or raw) one place up or down, as a block. */
export function moveRows(doc: ProfileDoc, ids: readonly number[], dir: -1 | 1): ProfileDoc {
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
 * Parses pasted rows in the file's own format: 15 comma-separated values per
 * line. Blank lines and a copied header line are skipped. Any bad line
 * rejects the whole paste.
 */
export function parseImport(text: string): ImportResult {
  const rows: string[][] = [];
  const errors: string[] = [];
  text.split(/\r\n|\n/).forEach((line, i) => {
    if (line.trim() === "" || line === PROFILE_HEADER) return;
    const values = line.split(",");
    if (values.length !== PROFILE_FIELDS.length) {
      errors.push(`Line ${i + 1}: expected ${PROFILE_FIELDS.length} values, found ${values.length}.`);
    } else {
      rows.push(values);
    }
  });
  if (errors.length) return { ok: false, errors };
  if (rows.length === 0) return { ok: false, errors: ["Nothing to import."] };
  return { ok: true, rows };
}

/** Adds imported rows at the end. A row with an empty profileName gets its row number. */
export function importRows(doc: ProfileDoc, rows: readonly (readonly string[])[]): ProfileDoc {
  return appendRows(doc, rows, true);
}

/** Values of the selected profile rows, in file order. Raw rows are skipped. */
export function selectedValues(doc: ProfileDoc, ids: readonly number[]): string[][] {
  const set = new Set(ids);
  return doc.rows.filter((r): r is ProfileRow => isProfile(r) && set.has(r.id)).map((r) => [...r.values]);
}

/** Names that already exist in `target`, or repeat within `names`, in first-seen order. */
export function nameClashes(target: ProfileDoc, names: readonly string[]): string[] {
  const existing = new Set(target.rows.filter(isProfile).map((r) => r.values[NAME]));
  const seen = new Set<string>();
  const clashes: string[] = [];
  for (const n of names) {
    if ((existing.has(n) || seen.has(n)) && !clashes.includes(n)) clashes.push(n);
    seen.add(n);
  }
  return clashes;
}
