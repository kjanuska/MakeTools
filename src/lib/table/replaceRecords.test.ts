import { describe, expect, it } from "vitest";
import { parseTasks, serializeTasks, TASK_HEADER } from "../formats/tasks";
import { isRecord, replaceRecords } from "./ops";

const H = TASK_HEADER;
const row = (input: string, profile = "1") => `25,${profile},wealth,example,${input},random,random,kith.com,preload,1,3000`;
const values = (line: string) => line.split(",");

describe("replaceRecords", () => {
  it("replacing with the same rows changes nothing", () => {
    const text = `${H}\n${row("a")}\n${row("b")}\n`;
    const doc = parseTasks(text);
    const out = replaceRecords(doc, [values(row("a")), values(row("b"))]);
    expect(serializeTasks(out)).toBe(text);
    expect(out.rows[0]).toBe(doc.rows[0]);
  });

  it("changes, adds and removes rows, keeping the header, BOM and line endings", () => {
    const doc = parseTasks(`﻿${H}\r\n${row("a")}\r\n${row("b")}\r\n`);
    const out = replaceRecords(doc, [values(row("a")), values(row("x")), values(row("y"))]);
    expect(serializeTasks(out)).toBe(`﻿${H}\r\n${row("a")}\r\n${row("x")}\r\n${row("y")}\r\n`);
    // The changed row keeps its id, so changed cells can show the old value.
    expect(out.rows[1].id).toBe(doc.rows[1].id);
    const fewer = replaceRecords(doc, [values(row("z"))]);
    expect(serializeTasks(fewer)).toBe(`﻿${H}\r\n${row("z")}\r\n`);
  });

  it("keeps a missing trailing newline", () => {
    const doc = parseTasks(`${H}\n${row("a")}`);
    expect(serializeTasks(replaceRecords(doc, [values(row("a")), values(row("b"))]))).toBe(`${H}\n${row("a")}\n${row("b")}`);
  });

  it("keeps blank and unparseable lines; new rows go where the first record was", () => {
    const doc = parseTasks(`${H}\nbroken line\n${row("a")}\n\n${row("b")}\n`);
    const out = replaceRecords(doc, [values(row("x"))]);
    expect(serializeTasks(out)).toBe(`${H}\nbroken line\n${row("x")}\n\n`);
    expect(out.rows.filter(isRecord)).toHaveLength(1);
  });

  it("fills a file with no rows yet", () => {
    expect(serializeTasks(replaceRecords(parseTasks(`${H}\n`), [values(row("a"))]))).toBe(`${H}\n${row("a")}\n`);
    expect(serializeTasks(replaceRecords(parseTasks(""), [values(row("a"))]))).toBe(`${H}\n${row("a")}\n`);
  });

  it("an empty list removes every record", () => {
    expect(serializeTasks(replaceRecords(parseTasks(`${H}\n${row("a")}\n`), []))).toBe(`${H}\n`);
  });
});
