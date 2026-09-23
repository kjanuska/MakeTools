import { describe, expect, it } from "vitest";
import type { DataRow } from "./csvTable";
import { TASK_HEADER, cleanInput, cleanInputs, joinBrokenLines, parseTasks, serializeTasks } from "./tasks";

const H = TASK_HEADER;
const row = (input = "box logo -tee", o: { site?: string; mode?: string } = {}) =>
  `25,ALL,wealth,example,${input},random,random,${o.site ?? "kith.com"},${o.mode ?? "preload"},1,3000`;

const roundTrip = (t: string) => serializeTasks(parseTasks(t));
const values = (doc: ReturnType<typeof parseTasks>, i: number) => (doc.rows[i] as DataRow).values;

describe("task files: byte-exact round trip", () => {
  it.each([
    ["LF", `${H}\n${row()}\n${row("abc")}\n`],
    ["CRLF", `${H}\r\n${row()}\r\n`],
    ["no trailing newline", `${H}\n${row()}`],
    ["mixed", `${H}\n${row()}\r\n${row()}\n`],
    ["BOM", `\uFEFF${H}\n${row()}\n`],
    ["0-byte", ""],
    ["header only", `${H}\n`],
    ["trailing spaces in input", `${H}\n${row("12345678901234 12345678901234 ")}\n`],
    ["quoted broken lines", `${H}\n25,ALL,wealth,example,"a b\n",random,random,kith.com,preload,1,3000\n`],
    ["wrong field count", `${H}\n1,2,3\n`],
    ["bad header", `profileGroup,profileName\n1,2\n`],
  ])("%s", (_, text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("new rows use LF when the file has no line endings yet", () => {
    for (const text of ["", H]) {
      const doc = parseTasks(text);
      expect(doc.defaultEol).toBe("\n");
      doc.rows.push({ kind: "record", id: -1, values: row().split(","), eol: "" });
      expect(serializeTasks(doc)).toBe(text === "" ? `${H}\n${row()}\n` : `${H}\n${row()}`);
    }
  });

  it("reads 11 values per row", () => {
    const doc = parseTasks(`${H}\n${row()}\n`);
    expect(doc.headerOk).toBe(true);
    expect(values(doc, 0)).toEqual(row().split(","));
  });
});

describe("input cleanup", () => {
  it.each([
    ["box logo", "box logo"],
    ["box logo ", "box logo"],
    ["  box   logo  -tee ", "box logo -tee"],
    ["12345678901234 12345678901234 ", "12345678901234 12345678901234"],
    ["A1234-123", "A1234-123"],
    ["   ", ""],
  ])("%j -> %j", (input, out) => {
    expect(cleanInput(input)).toBe(out);
  });

  it("cleanInputs only touches the input column of changed rows", () => {
    const doc = parseTasks(`${H}\n${row("a  b ")}\n${row("ok")}\nbroken\n`);
    const out = cleanInputs(doc);
    expect(values(out, 0)[4]).toBe("a b");
    expect(out.rows[1]).toBe(doc.rows[1]);
    expect(out.rows[2]).toBe(doc.rows[2]);
    expect(serializeTasks(out)).toBe(`${H}\n${row("a b")}\n${row("ok")}\nbroken\n`);
  });

  it("returns the same doc when nothing needs cleaning", () => {
    const doc = parseTasks(`${H}\n${row()}\n`);
    expect(cleanInputs(doc)).toBe(doc);
  });
});

describe("joining a quoted value split across lines", () => {
  const broken = `25,ALL,wealth,example,"box logo -tee -shirt\n",random,random,kith.com,preload,1,3000`;

  it("joins it into one row without quotes or the line break", () => {
    const doc = parseTasks(`${H}\n${row("x")}\n${broken}\n${row("y")}\n`);
    expect(doc.rows.map((r) => r.kind)).toEqual(["record", "raw", "raw", "record"]);
    const out = joinBrokenLines(doc);
    expect(out.rows.map((r) => r.kind)).toEqual(["record", "record", "record"]);
    expect(values(out, 1)[4]).toBe("box logo -tee -shirt ");
    expect(serializeTasks(cleanInputs(out))).toBe(`${H}\n${row("x")}\n${row("box logo -tee -shirt")}\n${row("y")}\n`);
  });

  it("keeps the rows around it as the same objects", () => {
    const doc = parseTasks(`${H}\n${row("x")}\n${broken}\n`);
    const out = joinBrokenLines(doc);
    expect(out.rows[0]).toBe(doc.rows[0]);
  });

  it("handles CRLF files and a value split over three lines", () => {
    const three = `25,ALL,wealth,example,"a\r\nb\r\nc",random,random,kith.com,preload,1,3000`;
    const out = cleanInputs(joinBrokenLines(parseTasks(`${H}\r\n${three}\r\n`)));
    expect(serializeTasks(out)).toBe(`${H}\r\n${row("a b c")}\r\n`);
  });

  it("a quoted value on a single line is already one row, so nothing is joined", () => {
    const doc = parseTasks(`${H}\n25,ALL,wealth,example,"a b",random,random,kith.com,preload,1,3000\n`);
    // One line, 11 values: it parses as a normal row (the quotes are an error in validation).
    expect(doc.rows[0].kind).toBe("record");
    expect(joinBrokenLines(doc)).toBe(doc);
  });

  it("leaves lines alone when joining doesn't give exactly one row", () => {
    const cases = [
      `${H}\n25,ALL,"a\nb,c,d\n`, // too few values
      `${H}\n25,ALL,wealth,example,"a b\n`, // never closed
      `${H}\n25,ALL,wealth,example,"a\n",random,random,kith.com,preload,1,3000,extra\n`, // too many
    ];
    for (const text of cases) {
      const doc = parseTasks(text);
      expect(joinBrokenLines(doc)).toBe(doc);
    }
  });

  it("returns the same doc when there's nothing to join", () => {
    const doc = parseTasks(`${H}\n${row()}\nbroken,line\n`);
    expect(joinBrokenLines(doc)).toBe(doc);
  });
});
