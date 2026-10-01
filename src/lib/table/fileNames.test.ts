import { describe, expect, it } from "vitest";
import { displayName } from "./fileNames";

describe("displayName", () => {
  it("drops the extension", () => {
    expect(displayName("25.csv")).toBe("25");
    expect(displayName("main.txt")).toBe("main");
  });
  it("drops only the last extension", () => {
    expect(displayName("eu.v2.csv")).toBe("eu.v2");
  });
  it("leaves names without one alone", () => {
    expect(displayName("notes")).toBe("notes");
    expect(displayName(".hidden")).toBe(".hidden");
  });
});
