// Profile group files: `profile/<group>.csv` (spec: docs/modules/profiles.md).
// Comma-separated, no quoting. Every line keeps its own line ending, so an
// unedited file serializes back byte for byte.

export const PROFILE_FIELDS = [
  "profileName",
  "firstName",
  "lastName",
  "email",
  "address1",
  "address2",
  "city",
  "state",
  "zipcode",
  "country",
  "phoneNumber",
  "ccNumber",
  "ccMonth",
  "ccYear",
  "cvv",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const PROFILE_HEADER = PROFILE_FIELDS.join(",");

/** Line ending after a line; "" for a last line without one. */
export type Eol = "" | "\n" | "\r\n";

export type ProfileRow = {
  kind: "profile";
  id: number;
  values: string[];
  eol: Eol;
};

/** A blank or unparseable line. Read-only, written back unchanged. */
export type RawRow = {
  kind: "raw";
  id: number;
  text: string;
  eol: Eol;
};

export type Row = ProfileRow | RawRow;

export interface ProfileDoc {
  bom: boolean;
  /** Header line text (without BOM), or null for a 0-byte file. */
  header: string | null;
  headerEol: Eol;
  /** False when the header isn't exactly PROFILE_HEADER: the file is read-only. */
  headerOk: boolean;
  rows: Row[];
  /** Whether the last line ends with a line ending. */
  trailingNewline: boolean;
  /** Ending used for new lines: the file's most common one, CRLF if none or tied. */
  defaultEol: "\n" | "\r\n";
}

let nextId = 1;
export const newRowId = () => nextId++;

function splitLines(text: string): { text: string; eol: Eol }[] {
  const lines: { text: string; eol: Eol }[] = [];
  const re = /\r\n|\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    lines.push({ text: text.slice(start, m.index), eol: m[0] as Eol });
    start = m.index + m[0].length;
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: "" });
  return lines;
}

export function parseProfiles(fileText: string): ProfileDoc {
  const bom = fileText.startsWith("\uFEFF");
  const text = bom ? fileText.slice(1) : fileText;
  const lines = splitLines(text);

  let crlf = 0;
  let lf = 0;
  for (const l of lines) {
    if (l.eol === "\r\n") crlf++;
    else if (l.eol === "\n") lf++;
  }
  const defaultEol = lf > crlf ? "\n" : "\r\n";
  const trailingNewline = lines.length > 0 && lines[lines.length - 1].eol !== "";

  if (lines.length === 0) {
    return { bom, header: null, headerEol: "", headerOk: true, rows: [], trailingNewline, defaultEol };
  }

  const [head, ...rest] = lines;
  const rows: Row[] = rest.map((l) => {
    const values = l.text.split(",");
    return values.length === PROFILE_FIELDS.length
      ? { kind: "profile", id: newRowId(), values, eol: l.eol }
      : { kind: "raw", id: newRowId(), text: l.text, eol: l.eol };
  });

  return {
    bom,
    header: head.text,
    headerEol: head.eol,
    headerOk: head.text === PROFILE_HEADER,
    rows,
    trailingNewline,
    defaultEol,
  };
}

export function serializeProfiles(doc: ProfileDoc): string {
  let header = doc.header;
  let trailing = doc.trailingNewline;
  if (header === null) {
    // 0-byte file: stays empty until rows are added, then gets a header
    // and a trailing newline like a new file.
    if (doc.rows.length === 0) return doc.bom ? "\uFEFF" : "";
    header = PROFILE_HEADER;
    trailing = true;
  }

  const lines: { text: string; eol: Eol }[] = [
    { text: header, eol: doc.headerEol },
    ...doc.rows.map((r) => ({ text: r.kind === "profile" ? r.values.join(",") : r.text, eol: r.eol })),
  ];

  let out = doc.bom ? "\uFEFF" : "";
  lines.forEach((l, i) => {
    out += l.text;
    const last = i === lines.length - 1;
    if (!last || trailing) out += l.eol || doc.defaultEol;
  });
  return out;
}
