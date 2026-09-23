import { describe, expect, it } from "vitest";
import { MODULES } from "./modules";

describe("MODULES", () => {
  it("maps each module to its Makebot folder and extension", () => {
    expect(MODULES.map(({ id, folder, extension }) => [id, folder, extension])).toEqual([
      ["accounts", "account", "txt"],
      ["profiles", "profile", "csv"],
      ["proxies", "proxy", "txt"],
      ["tasks", "task", "csv"],
    ]);
  });

  it("has unique ids and folders", () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.folder)).size).toBe(MODULES.length);
  });
});
