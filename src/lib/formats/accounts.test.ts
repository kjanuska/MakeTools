import { describe, expect, it } from "vitest";
import { accountsOf, appendLines, hasProxy, oddLines, parseAccounts, planImport } from "./accounts";

describe("parseAccounts", () => {
  it("reads the three line shapes", () => {
    const doc = parseAccounts(
      "a@x.com:pw1\r\nb@x.com:pw2:1.2.3.4:8080\r\nc@x.com:pw3:5.6.7.8:3128:user:pass\r\n",
    );
    expect(accountsOf(doc)).toEqual([
      { email: "a@x.com", password: "pw1" },
      { email: "b@x.com", password: "pw2", proxyHost: "1.2.3.4", proxyPort: "8080" },
      { email: "c@x.com", password: "pw3", proxyHost: "5.6.7.8", proxyPort: "3128", proxyUser: "user", proxyPass: "pass" },
    ]);
    expect(accountsOf(doc).map(hasProxy)).toEqual([false, true, true]);
    expect(doc.eol).toBe("\r\n");
    expect(doc.trailingNewline).toBe(true);
    expect(doc.bom).toBe(false);
  });

  it("keeps passwords with symbols as they are", () => {
    const [a] = accountsOf(parseAccounts("a.b@x.com:ab.?c!@#$%^&*()_+\n"));
    expect(a.password).toBe("ab.?c!@#$%^&*()_+");
  });

  it("keeps non-ASCII text", () => {
    const [a] = accountsOf(parseAccounts("jösé@x.com:pässwörd€\n"));
    expect(a).toEqual({ email: "jösé@x.com", password: "pässwörd€" });
  });

  it("numbers lines and marks blank and odd lines as raw", () => {
    const doc = parseAccounts("a@x.com:pw\n\nnot an account\na@x.com:pw:host\nb@x.com:pw\n");
    expect(doc.lines.map((l) => [l.kind, l.line])).toEqual([
      ["account", 1],
      ["raw", 2],
      ["raw", 3],
      ["raw", 4],
      ["account", 5],
    ]);
    expect(oddLines(doc).map((l) => l.line)).toEqual([3, 4]);
  });

  it("only checks the number of parts, not the values", () => {
    const lines = ["a@x.com:", ":", "ax.com:pw", "a b:pw:h:0", "a@x.com:pw:h:70000", "a@x.com:pw::80a", ":::::"];
    const doc = parseAccounts(lines.join("\n"));
    expect(oddLines(doc)).toEqual([]);
    expect(accountsOf(doc)[3]).toEqual({ email: "a b", password: "pw", proxyHost: "h", proxyPort: "0" });
    expect(accountsOf(doc)[6]).toEqual({ email: "", password: "", proxyHost: "", proxyPort: "", proxyUser: "", proxyPass: "" });
  });

  it("treats lines with 1, 3, 5 or 7+ parts as odd lines", () => {
    const doc = parseAccounts(["justtext", "a:b:c", "a:b:c:d:e", "a:b:c:d:e:f:g"].join("\n"));
    expect(accountsOf(doc)).toEqual([]);
    expect(oddLines(doc)).toHaveLength(4);
  });

  it("handles an empty file, a BOM, LF and a missing trailing newline", () => {
    expect(parseAccounts("")).toEqual({ bom: false, lines: [], eol: "\r\n", trailingNewline: false });
    const doc = parseAccounts("\uFEFFa@x.com:pw\nb@x.com:pw");
    expect(doc.bom).toBe(true);
    expect(doc.eol).toBe("\n");
    expect(doc.trailingNewline).toBe(false);
    expect(accountsOf(doc).map((a) => a.email)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("uses the most common line ending, CRLF on a tie", () => {
    expect(parseAccounts("a@x.com:p\nb@x.com:p\nc@x.com:p\r\n").eol).toBe("\n");
    expect(parseAccounts("a@x.com:p\nb@x.com:p\r\n").eol).toBe("\r\n");
  });
});

describe("planImport", () => {
  it("adds lines exactly as pasted, in order, skipping blank ones", () => {
    const plan = planImport("  a@x.com:pw  \r\n\r\n   \nb@x.com:pw:1.2.3.4:80:u:p\r\n");
    expect(plan.add.map((a) => [a.line, a.text])).toEqual([
      [1, "  a@x.com:pw  "],
      [4, "b@x.com:pw:1.2.3.4:80:u:p"],
    ]);
    expect(plan.invalid).toEqual([]);
  });

  it("keeps repeated emails and any values: no deduplication or value checks", () => {
    const plan = planImport("a@x.com:1\nA@X.com:2\na@x.com:1\nnot-an-email:\nx:y:host:port");
    expect(plan.add.map((a) => a.text)).toEqual(["a@x.com:1", "A@X.com:2", "a@x.com:1", "not-an-email:", "x:y:host:port"]);
    expect(plan.invalid).toEqual([]);
  });

  it("lists lines without 2, 4 or 6 parts, with a reason", () => {
    const plan = planImport("justtext\na@x.com:pw:host\nok@x.com:pw\na:b:c:d:e\na:b:c:d:e:f:g");
    expect(plan.add.map((a) => a.line)).toEqual([3]);
    const reason = (n: number) => `Expected email:password, optionally followed by :host:port and :user:pass (found ${n} ${n === 1 ? "part" : "parts"}).`;
    expect(plan.invalid.map((i) => [i.line, i.text, i.reason])).toEqual([
      [1, "justtext", reason(1)],
      [2, "a@x.com:pw:host", reason(3)],
      [4, "a:b:c:d:e", reason(5)],
      [5, "a:b:c:d:e:f:g", reason(7)],
    ]);
  });

  it("ignores a BOM at the start of a pasted file", () => {
    expect(planImport("﻿a@x.com:pw\n").add.map((a) => a.text)).toEqual(["a@x.com:pw"]);
  });
});

describe("appendLines", () => {
  const add = ["n@x.com:pw", "m@x.com:pw:1.2.3.4:80"];

  it("returns the text unchanged when there's nothing to add", () => {
    for (const t of ["", "\uFEFF", "a@x.com:p", "a@x.com:p\r\n", "odd\n\n"]) expect(appendLines(t, [])).toBe(t);
  });

  it("appends with the file's CRLF endings", () => {
    expect(appendLines("a@x.com:p\r\n", add)).toBe("a@x.com:p\r\nn@x.com:pw\r\nm@x.com:pw:1.2.3.4:80\r\n");
  });

  it("appends with the file's LF endings", () => {
    expect(appendLines("a@x.com:p\n", add)).toBe("a@x.com:p\nn@x.com:pw\nm@x.com:pw:1.2.3.4:80\n");
  });

  it("adds the missing final line ending first", () => {
    expect(appendLines("a@x.com:p\r\nb@x.com:p", ["n@x.com:pw"])).toBe("a@x.com:p\r\nb@x.com:p\r\nn@x.com:pw\r\n");
    expect(appendLines("a@x.com:p", ["n@x.com:pw"])).toBe("a@x.com:p\r\nn@x.com:pw\r\n");
  });

  it("starts an empty file with CRLF", () => {
    expect(appendLines("", ["n@x.com:pw"])).toBe("n@x.com:pw\r\n");
    expect(appendLines("\uFEFF", ["n@x.com:pw"])).toBe("\uFEFFn@x.com:pw\r\n");
  });

  it("keeps every existing byte: BOM, blank lines, odd lines and mixed endings", () => {
    const before = "\uFEFFa@x.com:p\n\r\nodd line\r\n\nb@x.com:p\r\n";
    const out = appendLines(before, ["n@x.com:pw"]);
    expect(out.startsWith(before)).toBe(true);
    expect(out.slice(before.length)).toBe("n@x.com:pw\r\n");
  });

  it("round-trips: the appended accounts parse back", () => {
    const out = appendLines("a@x.com:p\r\n", add);
    expect(accountsOf(parseAccounts(out)).map((a) => a.email)).toEqual(["a@x.com", "n@x.com", "m@x.com"]);
  });
});
