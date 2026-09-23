import { describe, expect, it } from "vitest";
import { PROFILE_HEADER, parseProfiles, serializeProfiles, type ProfileDoc, type ProfileRow } from "../../lib/formats/profiles";
import {
  addRow,
  bulkSet,
  deleteRows,
  duplicateRows,
  fromTemplate,
  importRows,
  moveRows,
  nameClashes,
  parseImport,
  selectedValues,
  setCell,
} from "./ops";

const H = PROFILE_HEADER;
const row = (name: string, city = "Springfield") =>
  `${name},Jane,Doe,jane@example.com,101 Main St,,${city},IL,62701,US,2175550100,4111111111111111,01,28,123`;

const R1 = row("1");
const R2 = row("2", "Chicago");
const R3 = row("3", "Peoria");
const TEXT = `${H}\r\n${R1}\r\n${R2}\r\n${R3}\r\n`;

const ids = (doc: ProfileDoc) => doc.rows.map((r) => r.id);
const names = (doc: ProfileDoc) => doc.rows.map((r) => (r.kind === "record" ? r.values[0] : `raw:${r.text}`));
const values = (doc: ProfileDoc, i: number) => (doc.rows[i] as ProfileRow).values;

describe("setCell / bulkSet", () => {
  it("changes one cell and only those bytes", () => {
    const doc = parseProfiles(TEXT);
    const out = setCell(doc, doc.rows[1].id, "city", "Rockford");
    expect(serializeProfiles(out)).toBe(TEXT.replace("Chicago", "Rockford"));
  });

  it("doesn't mutate the original doc", () => {
    const doc = parseProfiles(TEXT);
    setCell(doc, doc.rows[0].id, "city", "Rockford");
    expect(serializeProfiles(doc)).toBe(TEXT);
  });

  it("keeps untouched rows as the same objects", () => {
    const doc = parseProfiles(TEXT);
    const out = setCell(doc, doc.rows[1].id, "city", "Rockford");
    expect(out.rows[0]).toBe(doc.rows[0]);
    expect(out.rows[2]).toBe(doc.rows[2]);
  });

  it("sets one field on all selected rows", () => {
    const doc = parseProfiles(TEXT);
    const out = bulkSet(doc, [doc.rows[0].id, doc.rows[2].id], "state", "WI");
    expect(out.rows.map((r) => (r as ProfileRow).values[7])).toEqual(["WI", "IL", "WI"]);
    expect(out.rows[1]).toBe(doc.rows[1]);
  });

  it("ignores raw rows", () => {
    const doc = parseProfiles(`${H}\r\nfoo\r\n${R1}\r\n`);
    const out = bulkSet(doc, ids(doc), "city", "X");
    expect(serializeProfiles(out)).toBe(`${H}\r\nfoo\r\n${R1.replace("Springfield", "X")}\r\n`);
  });
});

describe("adding rows", () => {
  it("addRow appends an empty row named after its row number, with country US", () => {
    const out = addRow(parseProfiles(TEXT));
    expect(values(out, 3)).toEqual(["4", "", "", "", "", "", "", "", "", "US", "", "", "", "", ""]);
    expect(serializeProfiles(out)).toBe(`${TEXT}4,,,,,,,,,US,,,,,\r\n`);
  });

  it("row numbers count raw rows too", () => {
    const out = addRow(parseProfiles(`${H}\r\n${R1}\r\n\r\n`));
    expect(values(out, 2)[0]).toBe("3");
  });

  it("addRow to a 0-byte file creates the header", () => {
    const out = addRow(parseProfiles(""));
    expect(serializeProfiles(out)).toBe(`${H}\r\n1,,,,,,,,,US,,,,,\r\n`);
  });

  it("duplicateRows copies selected rows in file order to the end with new names", () => {
    const doc = parseProfiles(TEXT);
    const out = duplicateRows(doc, [doc.rows[2].id, doc.rows[0].id]);
    expect(names(out)).toEqual(["1", "2", "3", "4", "5"]);
    expect(values(out, 3).slice(1)).toEqual(values(doc, 0).slice(1));
    expect(values(out, 4).slice(1)).toEqual(values(doc, 2).slice(1));
    expect(serializeProfiles(out).startsWith(TEXT)).toBe(true);
  });

  it("duplicateRows skips raw rows", () => {
    const doc = parseProfiles(`${H}\r\nfoo\r\n${R1}\r\n`);
    expect(names(duplicateRows(doc, ids(doc)))).toEqual(["raw:foo", "1", "3"]);
  });

  it("fromTemplate adds N copies named by row number", () => {
    const doc = parseProfiles(TEXT);
    const out = fromTemplate(doc, doc.rows[1].id, 3);
    expect(names(out)).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const i of [3, 4, 5]) expect(values(out, i).slice(1)).toEqual(values(doc, 1).slice(1));
    expect(serializeProfiles(out)).toBe(`${TEXT}${row("4", "Chicago")}\r\n${row("5", "Chicago")}\r\n${row("6", "Chicago")}\r\n`);
  });

  it("fromTemplate does nothing for a bad count or a raw/missing template", () => {
    const doc = parseProfiles(`${H}\r\nfoo\r\n${R1}\r\n`);
    expect(fromTemplate(doc, doc.rows[1].id, 0)).toBe(doc);
    expect(fromTemplate(doc, doc.rows[0].id, 2)).toBe(doc);
    expect(fromTemplate(doc, -99, 2)).toBe(doc);
  });

  it("a new name can clash with an existing one (flagged by validation, not renamed)", () => {
    const doc = parseProfiles(`${H}\r\n${row("2")}\r\n`);
    expect(names(addRow(doc))).toEqual(["2", "2"]);
  });

  it("new rows get distinct ids", () => {
    const doc = parseProfiles(TEXT);
    const out = fromTemplate(doc, doc.rows[0].id, 5);
    expect(new Set(ids(out)).size).toBe(8);
  });

  it("new rows use LF in an LF file", () => {
    const doc = parseProfiles(`${H}\n${R1}\n`);
    expect(serializeProfiles(fromTemplate(doc, doc.rows[0].id, 1))).toBe(`${H}\n${R1}\n${row("2")}\n`);
  });
});

describe("deleteRows", () => {
  it("removes selected rows, including raw ones", () => {
    const doc = parseProfiles(`${H}\r\n${R1}\r\nfoo\r\n${R2}\r\n`);
    const out = deleteRows(doc, [doc.rows[1].id, doc.rows[2].id]);
    expect(serializeProfiles(out)).toBe(`${H}\r\n${R1}\r\n`);
  });

  it("doesn't rename remaining rows", () => {
    const doc = parseProfiles(TEXT);
    expect(names(deleteRows(doc, [doc.rows[0].id]))).toEqual(["2", "3"]);
  });
});

describe("moveRows", () => {
  const doc = parseProfiles(`${H}\r\n${row("a")}\r\n${row("b")}\r\n${row("c")}\r\n${row("d")}\r\n`);
  const id = (i: number) => doc.rows[i].id;

  it("moves one row up or down", () => {
    expect(names(moveRows(doc, [id(2)], -1))).toEqual(["a", "c", "b", "d"]);
    expect(names(moveRows(doc, [id(1)], 1))).toEqual(["a", "c", "b", "d"]);
  });

  it("stops at the edges", () => {
    expect(names(moveRows(doc, [id(0)], -1))).toEqual(["a", "b", "c", "d"]);
    expect(names(moveRows(doc, [id(3)], 1))).toEqual(["a", "b", "c", "d"]);
  });

  it("moves a block together", () => {
    expect(names(moveRows(doc, [id(1), id(2)], -1))).toEqual(["b", "c", "a", "d"]);
    expect(names(moveRows(doc, [id(1), id(2)], 1))).toEqual(["a", "d", "b", "c"]);
    expect(names(moveRows(doc, [id(0), id(1)], -1))).toEqual(["a", "b", "c", "d"]);
  });

  it("moves separate rows independently", () => {
    expect(names(moveRows(doc, [id(1), id(3)], -1))).toEqual(["b", "a", "d", "c"]);
  });

  it("keeps each row's bytes; only the order changes", () => {
    const out = serializeProfiles(moveRows(doc, [id(3)], -1));
    expect(out).toBe(`${H}\r\n${row("a")}\r\n${row("b")}\r\n${row("d")}\r\n${row("c")}\r\n`);
  });
});

describe("import", () => {
  it("parses 15-value lines, skipping blank lines and a header", () => {
    const res = parseImport(`${H}\r\n${R1}\r\n\r\n${R2}\n`);
    expect(res).toEqual({ ok: true, rows: [R1.split(","), R2.split(",")] });
  });

  it("rejects the whole paste if any line has the wrong number of values", () => {
    const res = parseImport(`${R1}\n1,2,3\n${R2},x\n`);
    expect(res).toEqual({
      ok: false,
      errors: ["Line 2: expected 15 values, found 3.", "Line 3: expected 15 values, found 16."],
    });
  });

  it("rejects an empty paste", () => {
    expect(parseImport("\n  \n")).toEqual({ ok: false, errors: ["Nothing to import."] });
  });

  it("adds rows at the end, keeping their names", () => {
    const doc = parseProfiles(TEXT);
    const res = parseImport(`${row("x")}\n${row("y")}`);
    if (!res.ok) throw new Error("expected ok");
    const out = importRows(doc, res.rows);
    expect(serializeProfiles(out)).toBe(`${TEXT}${row("x")}\r\n${row("y")}\r\n`);
  });

  it("an empty name gets the row number", () => {
    const doc = parseProfiles(TEXT);
    const res = parseImport(row(""));
    if (!res.ok) throw new Error("expected ok");
    expect(names(importRows(doc, res.rows))).toEqual(["1", "2", "3", "4"]);
  });
});

describe("move/copy helpers", () => {
  it("selectedValues returns copies of the selected profile rows in file order", () => {
    const doc = parseProfiles(`${H}\r\nfoo\r\n${R1}\r\n${R2}\r\n${R3}\r\n`);
    const vals = selectedValues(doc, [doc.rows[3].id, doc.rows[0].id, doc.rows[1].id]);
    expect(vals).toEqual([R1.split(","), R3.split(",")]);
    vals[0][0] = "changed";
    expect((doc.rows[1] as ProfileRow).values[0]).toBe("1");
  });

  it("nameClashes finds names already in the target or repeated", () => {
    const target = parseProfiles(TEXT);
    expect(nameClashes(target, ["4", "5"])).toEqual([]);
    expect(nameClashes(target, ["2", "4", "3"])).toEqual(["2", "3"]);
    expect(nameClashes(target, ["7", "7", "7"])).toEqual(["7"]);
    expect(nameClashes(parseProfiles(""), ["1"])).toEqual([]);
  });

  it("nameClashes is case-sensitive, like the uniqueness rule", () => {
    const target = parseProfiles(`${H}\r\n${row("a")}\r\n`);
    expect(nameClashes(target, ["A"])).toEqual([]);
  });
});
