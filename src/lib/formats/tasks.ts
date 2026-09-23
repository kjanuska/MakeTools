// Task files: `task/<name>.csv` (spec: docs/modules/tasks.md).
// Unquoted CSV with a fixed header; see csvTable.ts for the byte-exact rules.
import {
  headerOf,
  newRowId,
  parseTable,
  serializeTable,
  type DataRow,
  type Row,
  type TableDoc,
  type TableFormat,
} from "./csvTable";

export const TASK_FIELDS = [
  "profileGroup",
  "profileName",
  "proxyGroup",
  "accountGroup",
  "input",
  "size",
  "color",
  "site",
  "mode",
  "cartQuantity",
  "delay",
] as const;

export type TaskField = (typeof TASK_FIELDS)[number];

export const TASK_COL = Object.fromEntries(TASK_FIELDS.map((f, i) => [f, i])) as Record<TaskField, number>;

/** Existing task files use LF, so new ones do too. */
export const TASK_FORMAT: TableFormat = { fields: TASK_FIELDS, newFileEol: "\n" };

export const TASK_HEADER = headerOf(TASK_FORMAT);

export const parseTasks = (fileText: string): TableDoc => parseTable(TASK_FORMAT, fileText);
export const serializeTasks = (doc: TableDoc): string => serializeTable(TASK_FORMAT, doc);

/** Input without leading/trailing spaces and with runs of spaces collapsed. */
export function cleanInput(value: string): string {
  return value.trim().replace(/ {2,}/g, " ");
}

/** Cleans the input of every task row. Returns the same doc if nothing changed. */
export function cleanInputs(doc: TableDoc): TableDoc {
  const col = TASK_COL.input;
  let changed = false;
  const rows = doc.rows.map((r) => {
    if (r.kind !== "record") return r;
    const cleaned = cleanInput(r.values[col]);
    if (cleaned === r.values[col]) return r;
    changed = true;
    const values = [...r.values];
    values[col] = cleaned;
    return { ...r, values };
  });
  return changed ? { ...doc, rows } : doc;
}

/** Splits one CSV line into values, honouring double quotes. */
function splitQuoted(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const quoteCount = (s: string) => s.split('"').length - 1;

/** How many following lines a broken quoted value may span. */
const MAX_JOINED_LINES = 10;

/**
 * Joins a value that was wrapped in quotes and split across lines (e.g. by
 * a spreadsheet editor) back into one task row: the quotes are dropped and
 * the line breaks become spaces. Only applies when the joined lines make
 * exactly one row with the right number of values; anything else stays as
 * unparseable lines. Returns the same doc if nothing changed.
 */
export function joinBrokenLines(doc: TableDoc): TableDoc {
  const n = TASK_FIELDS.length;
  const rows: Row[] = [];
  let changed = false;
  for (let i = 0; i < doc.rows.length; i++) {
    const first = doc.rows[i];
    if (first.kind === "raw" && quoteCount(first.text) % 2 === 1) {
      let text = first.text;
      let j = i;
      while (quoteCount(text) % 2 === 1 && j + 1 < doc.rows.length && j - i < MAX_JOINED_LINES) {
        const next = doc.rows[j + 1];
        if (next.kind !== "raw") break;
        text += "\n" + next.text;
        j++;
      }
      const values = splitQuoted(text);
      if (j > i && quoteCount(text) % 2 === 0 && values.length === n) {
        const row: DataRow = {
          kind: "record",
          id: newRowId(),
          values: values.map((v) => v.replace(/\r?\n/g, " ")),
          eol: doc.rows[j].eol,
        };
        rows.push(row);
        changed = true;
        i = j;
        continue;
      }
    }
    rows.push(first);
  }
  return changed ? { ...doc, rows } : doc;
}
