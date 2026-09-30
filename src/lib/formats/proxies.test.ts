import { describe, expect, it } from "vitest";
import {
  countProxies,
  fromEditorText,
  oddLines,
  parseProxies,
  proxyProblem,
  serializeProxies,
  shuffleProxies,
  toEditorText,
} from "./proxies";

const A = "proxy.example.net:8000:user1:pa55";
const B = "10.0.0.2:3128";
const C = "res.example.org:9000:u-2:p@ss";
const D = "localhost";

/** A random source that plays back fixed values. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("parseProxies", () => {
  it.each([
    ["CRLF, no final newline", `${A}\r\n${B}`, "\r\n", false, [A, B]],
    ["CRLF, final newline", `${A}\r\n${B}\r\n`, "\r\n", true, [A, B]],
    ["LF only", `${A}\n${B}\n`, "\n", true, [A, B]],
    ["mixed: CRLF wins", `${A}\n${B}\r\n${C}\n`, "\r\n", true, [A, B, C]],
    ["one line", D, "\r\n", false, [D]],
    ["empty", "", "\r\n", false, []],
    ["blank lines", `${A}\r\n\r\n  \r\n${B}`, "\r\n", false, [A, "", "  ", B]],
  ])("%s", (_, text, eol, trailing, lines) => {
    const p = parseProxies(text);
    expect(p.eol).toBe(eol);
    expect(p.trailingNewline).toBe(trailing);
    expect(p.lines).toEqual(lines);
    expect(p.bom).toBe(false);
  });

  it("keeps a BOM out of the first line", () => {
    const p = parseProxies(`﻿${A}\r\n`);
    expect(p.bom).toBe(true);
    expect(p.lines).toEqual([A]);
  });

  it.each([
    ["CRLF", `${A}\r\n${B}\r\n`],
    ["CRLF, no final newline", `${A}\r\n${B}`],
    ["LF", `${A}\n${B}\n`],
    ["BOM", `﻿${A}\r\n${B}`],
    ["BOM only", "﻿"],
    ["empty", ""],
    ["non-ASCII", `hôst-ü.example:80:usér:pässwörd✓\r\n${B}`],
    ["odd lines", `not a proxy\r\n${A}\r\n::\r\n`],
  ])("serializes a single-ending file back byte for byte: %s", (_, text) => {
    expect(serializeProxies(parseProxies(text))).toBe(text);
  });
});

describe("countProxies", () => {
  it("counts non-blank lines", () => {
    expect(countProxies(parseProxies(`${A}\r\n${B}\r\n${C}\r\n`))).toBe(3);
    expect(countProxies(parseProxies(`${A}\r\n${B}`))).toBe(2);
    expect(countProxies(parseProxies(`${A}\r\n\r\n \t\r\n${B}\r\n`))).toBe(2);
    expect(countProxies(parseProxies(""))).toBe(0);
    expect(countProxies(parseProxies(D))).toBe(1);
  });

  it("counts odd lines too (every non-blank line is a proxy line)", () => {
    expect(countProxies(parseProxies(`garbage\r\n${A}`))).toBe(2);
  });
});

describe("proxyProblem", () => {
  it.each([A, B, C, D, "1.2.3.4:1", "h:65535", "h:80:u:p", "hôst.example:80:usér:pässwörd"])("accepts %s", (line) =>
    expect(proxyProblem(line)).toBeNull(),
  );

  it.each([
    ["host only", "example.com", /found 1 part\b/],
    ["3 parts", "h:80:user", /found 3 parts/],
    ["5 parts", "h:80:u:p:x", /found 5 parts/],
    ["empty host", ":80", /host is empty/],
    ["port 0", "h:0", /port/],
    ["port too big", "h:65536", /port/],
    ["port not a number", "h:8o", /port/],
    ["empty port", "h:", /port/],
    ["empty user", "h:80::p", /user and password/],
    ["empty password", "h:80:u:", /user and password/],
    ["space inside", "h:80:u:p q", /space/],
    ["surrounding space", " h:80", /space/],
    ["tab", "h:80\t", /space/],
    ["Localhost is case-sensitive", "Localhost", /found 1 part/],
  ])("warns on %s", (_, line, msg) => {
    expect(proxyProblem(line)).toMatch(msg);
  });
});

describe("oddLines", () => {
  it("lists non-blank lines that aren't proxies, with 1-based line numbers", () => {
    const odd = oddLines([A, "", "bad", "  ", "h:80:u", D]);
    expect(odd.map((o) => [o.line, o.text])).toEqual([
      [3, "bad"],
      [5, "h:80:u"],
    ]);
  });
});

describe("toEditorText", () => {
  it("shows the file with \\n line endings and no BOM", () => {
    expect(toEditorText(`${A}\r\n${B}\r\n`)).toBe(`${A}\n${B}\n`);
    expect(toEditorText(`${A}\n${B}`)).toBe(`${A}\n${B}`);
    expect(toEditorText(`﻿${A}\r\n`)).toBe(`${A}\n`);
    expect(toEditorText("")).toBe("");
  });
});

describe("fromEditorText", () => {
  it.each([
    ["CRLF", `${A}\r\n${B}\r\n`],
    ["CRLF, no final newline", `${A}\r\n${B}`],
    ["LF", `${A}\n${B}\n`],
    ["mixed endings", `${A}\n${B}\r\n${C}`],
    ["BOM", `﻿${A}\r\n`],
    ["BOM only", "﻿"],
    ["empty", ""],
    ["blank and odd lines", `bad line\r\n\r\n  ${A}  \r\n`],
    ["non-ASCII", `hôst.example:80:usér:pässwörd\r\n`],
  ])("unchanged editor text gives the exact file back: %s", (_, text) => {
    expect(fromEditorText(toEditorText(text), text)).toBe(text);
  });

  it("an edit uses the file's CRLF on every line", () => {
    expect(fromEditorText(`${A}\n${C}\n`, `${A}\r\n${B}\r\n`)).toBe(`${A}\r\n${C}\r\n`);
  });

  it("an edit in an LF-only file keeps LF", () => {
    expect(fromEditorText(`${A}\n${C}\n`, `${A}\n${B}\n`)).toBe(`${A}\n${C}\n`);
  });

  it("an edit in a mixed file uses CRLF throughout", () => {
    expect(fromEditorText(`${A}\n${B}\n${D}`, `${A}\n${B}\r\n${C}`)).toBe(`${A}\r\n${B}\r\n${D}`);
  });

  it("keeps a BOM", () => {
    expect(fromEditorText(`${B}\n`, `﻿${A}\r\n`)).toBe(`﻿${B}\r\n`);
  });

  it("keeps the text as typed: final newline or none, spaces, blank lines", () => {
    expect(fromEditorText(`${A}\n${B}`, `${A}\r\n`)).toBe(`${A}\r\n${B}`);
    expect(fromEditorText(`${A}\n\n ${B} \n`, `${A}\r\n`)).toBe(`${A}\r\n\r\n ${B} \r\n`);
  });

  it("appending at the end keeps every existing byte", () => {
    const file = `${A}\r\n${B}\r\n`;
    const out = fromEditorText(`${toEditorText(file)}${C}\n${D}\n`, file);
    expect(out.startsWith(file)).toBe(true);
    expect(out).toBe(`${file}${C}\r\n${D}\r\n`);
  });

  it("pasted text with CRLF or CR endings is converted too", () => {
    expect(fromEditorText(`${A}\r\n${B}\r${C}`, `${A}\r\n`)).toBe(`${A}\r\n${B}\r\n${C}`);
    expect(fromEditorText(`${A}\r\n${B}`, `${A}\n`)).toBe(`${A}\n${B}`);
  });

  it("clearing the editor empties the file (the BOM stays)", () => {
    expect(fromEditorText("", `${A}\r\n`)).toBe("");
    expect(fromEditorText("", `﻿${A}\r\n`)).toBe("﻿");
  });

  it("an empty or one-line file gets CRLF", () => {
    expect(fromEditorText(`${A}\n${B}`, "")).toBe(`${A}\r\n${B}`);
    expect(fromEditorText(`${D}\n${A}`, D)).toBe(`${D}\r\n${A}`);
  });
});

describe("shuffleProxies", () => {
  const lines = (t: string) => parseProxies(t).lines;

  it("keeps the same lines in a different order", () => {
    const text = `${A}\r\n${B}\r\n${C}\r\n${D}\r\n`;
    for (let i = 0; i < 50; i++) {
      const out = shuffleProxies(text);
      expect(lines(out)).not.toEqual(lines(text));
      expect([...lines(out)].sort()).toEqual([...lines(text)].sort());
      expect(out.length).toBe(text.length);
    }
  });

  it("keeps the line ending, final newline and BOM", () => {
    const out = shuffleProxies(`﻿${A}\n${B}`, seq(0));
    expect(out).toBe(`﻿${B}\n${A}`);
    expect(shuffleProxies(`${A}\r\n${B}\r\n`, seq(0))).toBe(`${B}\r\n${A}\r\n`);
  });

  it("uses the random source (Fisher–Yates)", () => {
    // i=3: j=floor(0*4)=0 → swap 3,0; i=2: j=floor(.99*3)=2 → none; i=1: j=0 → swap 1,0
    expect(lines(shuffleProxies([A, B, C, D].join("\r\n"), seq(0, 0.99, 0)))).toEqual([B, D, C, A]);
  });

  it("tries again when it lands on the same order", () => {
    // First pass with 0.99 everywhere keeps the order; then 0 swaps.
    const r = seq(0.99, 0.99, 0.99, 0, 0, 0);
    expect(lines(shuffleProxies([A, B, C, D].join("\r\n"), r))).not.toEqual([A, B, C, D]);
  });

  it("a random source that never changes the order still gives a new order", () => {
    expect(lines(shuffleProxies([A, B, C].join("\r\n"), () => 0.999))).toEqual([B, C, A]);
    // Repeating lines: moving each one place still differs.
    expect(lines(shuffleProxies([A, B, A, B].join("\r\n"), () => 0.999))).toEqual([B, A, B, A]);
  });

  it("drops blank lines", () => {
    expect(lines(shuffleProxies(`${A}\r\n\r\n${B}\r\n  \r\n`, seq(0)))).toEqual([B, A]);
  });

  it("0 or 1 lines, or all the same, can't change", () => {
    expect(shuffleProxies("")).toBe("");
    expect(shuffleProxies(`${A}\r\n`)).toBe(`${A}\r\n`);
    expect(shuffleProxies(`${A}\r\n${A}`)).toBe(`${A}\r\n${A}`);
  });

  it("handles 10,000 lines", () => {
    const many = Array.from({ length: 10000 }, (_, i) => `h${i}.example:80:u:p`);
    const out = lines(shuffleProxies(many.join("\r\n")));
    expect(out.length).toBe(10000);
    expect(new Set(out).size).toBe(10000);
    expect(out).not.toEqual(many);
  });
});
