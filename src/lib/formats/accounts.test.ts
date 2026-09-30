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

  it("treats bad ports, empty passwords and emails without @ as odd lines", () => {
    const doc = parseAccounts(
      ["a@x.com:", "ax.com:pw", "a@x.com:pw:h:0", "a@x.com:pw:h:70000", "a@x.com:pw:h:80a", "a@x.com:pw::80", "a@x.com:pw:h:80::p"].join("\n"),
    );
    expect(accountsOf(doc)).toEqual([]);
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
  it("adds valid lines, trimmed, in order", () => {
    const plan = planImport("  a@x.com:pw  \r\n\r\nb@x.com:pw:1.2.3.4:80:u:p\r\n", []);
    expect(plan.add.map((a) => [a.line, a.text])).toEqual([
      [1, "a@x.com:pw"],
      [3, "b@x.com:pw:1.2.3.4:80:u:p"],
    ]);
    expect(plan.duplicates).toEqual([]);
    expect(plan.invalid).toEqual([]);
  });

  it("skips emails already in the file or earlier in the paste, ignoring case", () => {
    const plan = planImport("A@x.com:new\nb@x.com:1\nB@X.com:2\nc@x.com:3", ["a@x.com"]);
    expect(plan.add.map((a) => a.account.email)).toEqual(["b@x.com", "c@x.com"]);
    expect(plan.duplicates).toEqual([
      { line: 1, email: "A@x.com", inFile: true },
      { line: 3, email: "B@X.com", inFile: false },
    ]);
  });

  it("lists invalid lines with a reason", () => {
    const plan = planImport("justtext\na@x.com:pw:host\nax.com:pw\na@x.com:\na@x.com:pw:h:99999\na@x.com:pw:h:80:u:\na b@x.com:pw", []);
    expect(plan.add).toEqual([]);
    expect(plan.invalid.map((i) => [i.line, i.reason])).toEqual([
      [1, "Expected email:password, optionally followed by :host:port and :user:pass (found 1 part)."],
      [2, "Expected email:password, optionally followed by :host:port and :user:pass (found 3 parts)."],
      [3, "The email has no @."],
      [4, "The password is empty."],
      [5, "The proxy port must be a number from 1 to 65535."],
      [6, "The proxy user and password can't be empty."],
      [7, "The email contains a space."],
    ]);
  });

  it("ignores a BOM at the start of a pasted file", () => {
    expect(planImport("\uFEFFa@x.com:pw\n", []).add.map((a) => a.text)).toEqual(["a@x.com:pw"]);
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
