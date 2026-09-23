import { describe, expect, it } from "vitest";
import { MODE_PARTS, parseInput, splitMode } from "./tasks";

describe("modes", () => {
  it("has every part from the guide plus paypal and monitor", () => {
    expect(MODE_PARTS).toEqual([
      "preload", "direct", "safe", "fast", "human",
      "wait", "pause", "login", "stuck", "shoppay", "lite", "store", "free",
      "cod", "paypal", "monitor",
    ]);
  });

  it.each([
    ["preload", ["preload"]],
    ["preloadstuck", ["preload", "stuck"]],
    ["preloadwait", ["preload", "wait"]],
    ["directwait", ["direct", "wait"]],
    ["preloadwaitstuck", ["preload", "wait", "stuck"]],
    ["preloadstuckwait", ["preload", "stuck", "wait"]],
    ["preloadwaitlitestuck", ["preload", "wait", "lite", "stuck"]],
    ["preloadlite", ["preload", "lite"]],
    ["directstuck", ["direct", "stuck"]],
    ["preloadstore", ["preload", "store"]],
    ["login", ["login"]],
    ["paypal", ["paypal"]],
    ["monitor", ["monitor"]],
    ["shoppay", ["shoppay"]],
    ["", []],
  ])("splits %j", (mode, parts) => {
    expect(splitMode(mode)).toEqual(parts);
  });

  it.each(["preloadx", "Preload", "pre", "preload wait", "waiting"])("rejects %j", (mode) => {
    expect(splitMode(mode)).toBeNull();
  });
});

describe("input parsing", () => {
  it("splits words into positive and negative keywords", () => {
    expect(parseInput("box logo hoodie -shirt -tee")).toEqual({
      positive: ["box", "logo", "hoodie"],
      negative: ["shirt", "tee"],
    });
  });

  it("treats variant IDs and codes as plain words, never changing case", () => {
    expect(parseInput("11111111111111 22222222222222")).toEqual({
      positive: ["11111111111111", "22222222222222"],
      negative: [],
    });
    expect(parseInput("AB1234-123 Box")).toEqual({ positive: ["AB1234-123", "Box"], negative: [] });
  });

  it("a lone dash isn't a negative keyword", () => {
    expect(parseInput("a - b")).toEqual({ positive: ["a", "-", "b"], negative: [] });
  });

  it("returns null for a single word or empty input", () => {
    expect(parseInput("A1234-123")).toBeNull();
    expect(parseInput("")).toBeNull();
  });
});
