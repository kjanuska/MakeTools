import { describe, expect, it } from "vitest";
import { LINE_ENDING_LABELS, formatDateTime, formatSize, utf8Length } from "./format";

describe("formatSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(5.25 * 1024 * 1024)).toBe("5.3 MB");
  });
});

describe("formatDateTime", () => {
  it("formats local time with zero padding", () => {
    const ms = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(formatDateTime(ms)).toBe("2026-01-02 03:04:05");
  });

  it("formats two-digit fields", () => {
    const ms = new Date(2026, 11, 31, 23, 59, 58).getTime();
    expect(formatDateTime(ms)).toBe("2026-12-31 23:59:58");
  });
});

describe("utf8Length", () => {
  it("counts bytes, not characters", () => {
    expect(utf8Length("")).toBe(0);
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("ä")).toBe(2);
    expect(utf8Length("\uFEFF")).toBe(3);
    expect(utf8Length("a\r\n")).toBe(3);
  });
});

describe("LINE_ENDING_LABELS", () => {
  it("has a label for every line ending", () => {
    expect(Object.keys(LINE_ENDING_LABELS).sort()).toEqual(["crlf", "lf", "mixed", "none"]);
  });
});
