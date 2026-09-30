import { describe, expect, it } from "vitest";
import { copyName, fileNameFor, groupNameError, groupNameOf } from "./groupNames";

const EXISTING = ["25.csv", "30_sp.csv", "Dark.csv"];

describe("group names", () => {
  it("maps between group and file names", () => {
    expect(groupNameOf("25.csv")).toBe("25");
    expect(groupNameOf("A.CSV")).toBe("A");
    expect(fileNameFor("35_dark_allport")).toBe("35_dark_allport.csv");
  });

  it("accepts ordinary names", () => {
    for (const ok of ["26", "30_sp_2", "dark allport", "a.b", "Ünïcode"]) {
      expect(groupNameError(ok, EXISTING), ok).toBeNull();
    }
  });

  it.each([
    ["", "Enter a name."],
    [" 26", "The name can't start or end with a space."],
    ["26 ", "The name can't start or end with a space."],
    ["a,b", 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
    ['a"b', 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
    ["a/b", 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
    ["a\\b", 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
    ["a:b", 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
    ["a*", 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
    ["a\tb", 'The name can\'t contain , < > : " / \\ | ? * or control characters.'],
    ["group.", "The name can't end with a dot."],
    ["CON", '"CON" is reserved by Windows.'],
    ["nul", '"nul" is reserved by Windows.'],
    ["com1.x", '"com1.x" is reserved by Windows.'],
  ])("rejects %j", (name, msg) => {
    expect(groupNameError(name, EXISTING)).toBe(msg);
  });

  it("rejects an existing name in any case", () => {
    expect(groupNameError("25", EXISTING)).toBe('A group named "25" already exists.');
    expect(groupNameError("dark", EXISTING)).toBe('A group named "Dark" already exists.');
    expect(groupNameError("30_SP", EXISTING)).toBe('A group named "30_sp" already exists.');
  });

  it("allows a rename that only changes case, but not to the same name", () => {
    expect(groupNameError("dark", EXISTING, "Dark.csv")).toBeNull();
    expect(groupNameError("Dark", EXISTING, "Dark.csv")).toBe("That's already its name.");
    expect(groupNameError("25", EXISTING, "Dark.csv")).toBe('A group named "25" already exists.');
  });

  it("suggests a free copy name", () => {
    expect(copyName("25", EXISTING)).toBe("25 copy");
    expect(copyName("25", [...EXISTING, "25 copy.csv", "25 Copy 2.csv"])).toBe("25 copy 3");
  });

  it("suggests a free copy name for another extension (.txt for proxies)", () => {
    const txt = ["wealth.txt", "wealth copy.txt", "wealth copy 2.csv"];
    expect(copyName("wealth", txt, ".txt")).toBe("wealth copy 2");
    // A .csv file with the name doesn't clash with a .txt one, and vice versa.
    expect(copyName("wealth", txt)).toBe("wealth copy");
  });
});
