/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILE_HEADER, parseProfiles, serializeProfiles, type ProfileRow } from "./profiles";

const FIXTURES = path.join(__dirname, "fixtures", "profiles");
const fixtureNames = fs.readdirSync(FIXTURES);
const readFixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name));

const H = PROFILE_HEADER;
const ROW1 = "1,Jane,Doe,jane1@example.com,101 Main St,,Springfield,IL,62701,US,2175550100,4111111111111111,01,28,123";
const ROW2 = "2,John,Roe,john2@example.com,102 Main St,Apt 2,Springfield,IL,62701,US,2175550101,371449635398431,12,30,1234";

const roundTrip = (text: string) => serializeProfiles(parseProfiles(text));
const profileRows = (text: string) => parseProfiles(text).rows.filter((r): r is ProfileRow => r.kind === "profile");

describe("byte-exact round trip", () => {
  it.each(fixtureNames)("fixture %s", (name) => {
    const bytes = readFixture(name);
    const out = Buffer.from(roundTrip(bytes.toString("utf8")), "utf8");
    expect(out.equals(bytes)).toBe(true);
  });

  it.each([
    ["CRLF", `${H}\r\n${ROW1}\r\n${ROW2}\r\n`],
    ["LF", `${H}\n${ROW1}\n${ROW2}\n`],
    ["no trailing newline", `${H}\r\n${ROW1}\r\n${ROW2}`],
    ["mixed endings", `${H}\n${ROW1}\r\n${ROW2}\n`],
    ["BOM", `\uFEFF${H}\r\n${ROW1}\r\n`],
    ["0-byte", ""],
    ["BOM only", "\uFEFF"],
    ["header only", `${H}\r\n`],
    ["header only, no newline", H],
    ["blank lines", `${H}\r\n\r\n${ROW1}\r\n\r\n\r\n`],
    ["unparseable lines", `${H}\r\nfoo\r\n${ROW1},extra\r\n,,\r\n`],
    ["whitespace line", `${H}\r\n   \r\n\t\r\n`],
    ["lone CR inside a line", `${H}\r\n${ROW1}\r${ROW2}\r\n`],
    ["trailing lone CR", `${H}\r\n${ROW1}\r`],
    ["quotes kept as data", `${H}\r\n${ROW1.replace("Jane", '"Jane"')}\r\n`],
    ["non-ASCII", `${H}\r\n${ROW1.replace("Springfield", "Zürich 東京 🙂")}\r\n`],
    ["bad header", `name,first\r\na,b\r\n`],
  ])("%s", (_, text) => {
    expect(roundTrip(text)).toBe(text);
  });
});

describe("parsing", () => {
  it("reads rows with 15 values as profiles", () => {
    const doc = parseProfiles(`${H}\r\n${ROW1}\r\n${ROW2}\r\n`);
    expect(doc.headerOk).toBe(true);
    expect(doc.rows.map((r) => r.kind)).toEqual(["profile", "profile"]);
    expect((doc.rows[0] as ProfileRow).values).toEqual(ROW1.split(","));
    expect((doc.rows[0] as ProfileRow).values[5]).toBe("");
  });

  it("keeps blank and wrong-length lines as raw rows", () => {
    const doc = parseProfiles(`${H}\r\n\r\nfoo\r\n${ROW1},x\r\n${ROW1}\r\n`);
    expect(doc.rows.map((r) => r.kind)).toEqual(["raw", "raw", "raw", "profile"]);
  });

  it("flags a header that doesn't match exactly", () => {
    expect(parseProfiles(`${H},extra\r\n`).headerOk).toBe(false);
    expect(parseProfiles(`${H.toUpperCase()}\r\n`).headerOk).toBe(false);
    expect(parseProfiles(` ${H}\r\n`).headerOk).toBe(false);
    expect(parseProfiles(`\uFEFF${H}\r\n`).headerOk).toBe(true);
  });

  it("treats a 0-byte file as an empty group", () => {
    const doc = parseProfiles("");
    expect(doc.header).toBeNull();
    expect(doc.headerOk).toBe(true);
    expect(doc.rows).toEqual([]);
  });

  it.each([
    ["all CRLF", `${H}\r\n${ROW1}\r\n`, "\r\n"],
    ["all LF", `${H}\n${ROW1}\n`, "\n"],
    ["mostly LF", `${H}\n${ROW1}\n${ROW2}\r\n`, "\n"],
    ["tied", `${H}\n${ROW1}\r\n`, "\r\n"],
    ["no endings", H, "\r\n"],
    ["empty", "", "\r\n"],
  ])("default line ending: %s", (_, text, eol) => {
    expect(parseProfiles(text).defaultEol).toBe(eol);
  });

  it("gives every row a unique id", () => {
    const ids = [...parseProfiles(`${H}\r\n${ROW1}\r\n${ROW2}\r\n`).rows, ...parseProfiles(`${H}\r\n${ROW1}\r\n`).rows].map(
      (r) => r.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("serializing edits", () => {
  it("changing one value changes only those bytes", () => {
    const text = `${H}\r\n${ROW1}\r\n${ROW2}\r\n`;
    const doc = parseProfiles(text);
    (doc.rows[1] as ProfileRow).values[6] = "Chicago";
    expect(serializeProfiles(doc)).toBe(text.replace(`Apt 2,Springfield`, `Apt 2,Chicago`));
  });

  it("an edited row keeps its own line ending in a mixed file", () => {
    const doc = parseProfiles(`${H}\r\n${ROW1}\n${ROW2}\r\n`);
    (doc.rows[0] as ProfileRow).values[1] = "Ann";
    expect(serializeProfiles(doc)).toBe(`${H}\r\n${ROW1.replace("Jane", "Ann")}\n${ROW2}\r\n`);
  });

  it("new rows use the file's line ending and keep the trailing newline", () => {
    for (const eol of ["\r\n", "\n"] as const) {
      const doc = parseProfiles(`${H}${eol}${ROW1}${eol}`);
      doc.rows.push({ kind: "profile", id: -1, values: ROW2.split(","), eol: "" });
      expect(serializeProfiles(doc)).toBe(`${H}${eol}${ROW1}${eol}${ROW2}${eol}`);
    }
  });

  it("adding to a file without a trailing newline keeps it that way", () => {
    const doc = parseProfiles(`${H}\r\n${ROW1}`);
    doc.rows.push({ kind: "profile", id: -1, values: ROW2.split(","), eol: "" });
    expect(serializeProfiles(doc)).toBe(`${H}\r\n${ROW1}\r\n${ROW2}`);
  });

  it("adding to a header without a newline uses CRLF", () => {
    const doc = parseProfiles(H);
    doc.rows.push({ kind: "profile", id: -1, values: ROW1.split(","), eol: "" });
    expect(serializeProfiles(doc)).toBe(`${H}\r\n${ROW1}`);
  });

  it("adding to a 0-byte file writes a header, CRLF and a trailing newline", () => {
    const doc = parseProfiles("");
    doc.rows.push({ kind: "profile", id: -1, values: ROW1.split(","), eol: "" });
    expect(serializeProfiles(doc)).toBe(`${H}\r\n${ROW1}\r\n`);
  });

  it("deleting the last row keeps the trailing newline", () => {
    const doc = parseProfiles(`${H}\r\n${ROW1}\r\n${ROW2}\r\n`);
    doc.rows.pop();
    expect(serializeProfiles(doc)).toBe(`${H}\r\n${ROW1}\r\n`);
  });

  it("moving the unterminated last row gives it a line ending; the file still has no trailing newline", () => {
    const doc = parseProfiles(`${H}\r\n${ROW1}\r\n${ROW2}`);
    doc.rows.reverse();
    expect(serializeProfiles(doc)).toBe(`${H}\r\n${ROW2}\r\n${ROW1}`);
  });

  it("deleting every row leaves just the header", () => {
    const doc = parseProfiles(`${H}\r\n${ROW1}\r\n`);
    doc.rows = [];
    expect(serializeProfiles(doc)).toBe(`${H}\r\n`);
  });

  it("keeps a BOM when editing", () => {
    const doc = parseProfiles(`\uFEFF${H}\r\n${ROW1}\r\n`);
    (doc.rows[0] as ProfileRow).values[0] = "7";
    expect(serializeProfiles(doc)).toBe(`\uFEFF${H}\r\n7${ROW1.slice(1)}\r\n`);
  });

  it("raw rows are written back unchanged around edits", () => {
    const text = `${H}\r\nfoo,bar\r\n${ROW1}\r\n\r\n`;
    const doc = parseProfiles(text);
    (doc.rows[1] as ProfileRow).values[1] = "Ann";
    expect(serializeProfiles(doc)).toBe(`${H}\r\nfoo,bar\r\n${ROW1.replace("Jane", "Ann")}\r\n\r\n`);
  });
});

describe("fixtures", () => {
  it("are stored byte-exact (not converted by git)", () => {
    expect(readFixture("crlf.csv").includes(Buffer.from("\r\n"))).toBe(true);
    expect(readFixture("lf.csv").includes(Buffer.from("\r"))).toBe(false);
    expect([...readFixture("bom.csv").subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(readFixture("empty.csv").length).toBe(0);
  });

  it("parse to the expected rows", () => {
    expect(profileRows(readFixture("crlf.csv").toString("utf8"))).toHaveLength(3);
    const odd = parseProfiles(readFixture("odd-lines.csv").toString("utf8"));
    expect(odd.rows.map((r) => r.kind)).toEqual(["profile", "raw", "raw", "profile", "raw"]);
    expect(parseProfiles(readFixture("bad-header.csv").toString("utf8")).headerOk).toBe(false);
  });
});
