import { describe, expect, it } from "vitest";
import { joinPath } from "./paths";

describe("joinPath", () => {
  it("joins with a single backslash", () => {
    expect(joinPath("C:\\Makebot", "task")).toBe("C:\\Makebot\\task");
  });

  it("collapses separators at the join", () => {
    expect(joinPath("C:\\Makebot\\", "task")).toBe("C:\\Makebot\\task");
    expect(joinPath("C:\\Makebot/", "/task")).toBe("C:\\Makebot\\task");
    expect(joinPath("C:\\Makebot\\\\", "\\\\task")).toBe("C:\\Makebot\\task");
  });

  it("handles a drive root", () => {
    expect(joinPath("C:\\", "task")).toBe("C:\\task");
  });

  it("keeps a UNC prefix and inner separators", () => {
    expect(joinPath("\\\\server\\share\\Makebot", "task")).toBe("\\\\server\\share\\Makebot\\task");
  });

  it("keeps trailing separator of the last part", () => {
    expect(joinPath("C:\\a", "b\\")).toBe("C:\\a\\b\\");
  });

  it("skips empty parts", () => {
    expect(joinPath("C:\\a", "", "b")).toBe("C:\\a\\b");
    expect(joinPath("C:\\a", "")).toBe("C:\\a");
  });

  it("keeps spaces and non-ASCII names", () => {
    expect(joinPath("C:\\My Files\\Mäkebot", "task")).toBe("C:\\My Files\\Mäkebot\\task");
  });
});
