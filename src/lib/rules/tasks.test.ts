import { describe, expect, it } from "vitest";
import { MODE_PARTS, splitMode } from "./tasks";

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
