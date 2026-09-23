import { describe, expect, it } from "vitest";
import { PROFILE_FIELDS, type ProfileField } from "../formats/profiles";
import { countErrors, optionsOf, validateRecords, validateValue } from "./engine";
import { PROFILE_RULES, US_STATES, ccYearOptions } from "./profiles";

const VALID: Record<ProfileField, string> = {
  profileName: "1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  address1: "101 Main St",
  address2: "",
  city: "Springfield",
  state: "IL",
  zipcode: "62701",
  country: "US",
  phoneNumber: "2175550100",
  ccNumber: "4111111111111111",
  ccMonth: "01",
  ccYear: "28",
  cvv: "123",
};

const check = (field: ProfileField, value: string) => validateValue(PROFILE_RULES[field], value);

function record(id: number, overrides: Partial<Record<ProfileField, string>> = {}) {
  const v = { ...VALID, ...overrides };
  return { id, values: PROFILE_FIELDS.map((f) => v[f]) };
}

describe("profile rules", () => {
  it("accepts a valid profile", () => {
    for (const f of PROFILE_FIELDS) expect(check(f, VALID[f]), f).toBeNull();
  });

  it("requires every field except address2", () => {
    for (const f of PROFILE_FIELDS) {
      if (f === "address2") expect(check(f, "")).toBeNull();
      else expect(check(f, ""), f).toBe("is required");
    }
  });

  it.each(PROFILE_FIELDS)("%s can't hold commas, quotes, line breaks or surrounding spaces", (f) => {
    const base = VALID[f] || "x";
    expect(check(f, `${base},`)).toBe("can't contain a comma");
    expect(check(f, `"${base}`)).toBe("can't contain a quote");
    expect(check(f, `${base}\n`)).toBe("can't contain a line break");
    expect(check(f, `${base}\r`)).toBe("can't contain a line break");
    expect(check(f, ` ${base}`)).toBe("can't start or end with a space");
    expect(check(f, `${base} `)).toBe("can't start or end with a space");
    expect(check(f, `${base}\t`)).toBe("can't start or end with a space");
  });

  it("allows spaces inside values", () => {
    expect(check("address1", "101 Main St")).toBeNull();
    expect(check("city", "New York")).toBeNull();
  });

  it("reserves ALL for profileName, case-sensitively", () => {
    expect(check("profileName", "ALL")).toBe('can\'t be "ALL"');
    expect(check("profileName", "all")).toBeNull();
    expect(check("profileName", "All")).toBeNull();
    expect(check("profileName", "ALL1")).toBeNull();
  });

  it.each([
    ["jane@example.com", true],
    ["j.doe+tag@mail.example.co", true],
    ["jane@example", false],
    ["jane.example.com", false],
    ["@example.com", false],
    ["jane@@example.com", false],
    ["ja ne@example.com", false],
  ])("email %s valid=%s", (value, ok) => {
    expect(check("email", value)).toBe(ok ? null : "isn't a valid email");
  });

  it("state must be one of the 50 uppercase codes", () => {
    expect(US_STATES).toHaveLength(50);
    expect(new Set(US_STATES).size).toBe(50);
    for (const s of US_STATES) expect(check("state", s)).toBeNull();
    for (const bad of ["il", "Il", "DC", "PR", "ILL", "Illinois"]) {
      expect(check("state", bad), bad).toBe("isn't one of the allowed values");
    }
  });

  it.each([
    ["62701", true],
    ["00501", true],
    ["6270", false],
    ["627011", false],
    ["62701-1234", false],
    ["ZIP", false],
    ["６２７０１", false],
  ])("zipcode %s valid=%s", (value, ok) => {
    expect(check("zipcode", value)).toBe(ok ? null : "must be exactly 5 digits");
  });

  it("country must be US", () => {
    expect(check("country", "US")).toBeNull();
    expect(check("country", "us")).toBe("isn't one of the allowed values");
    expect(check("country", "CA")).toBe("isn't one of the allowed values");
  });

  it.each([
    ["2175550100", true],
    ["217555010", false],
    ["21755501000", false],
    ["217-555-0100", false],
    ["+12175550100", false],
  ])("phoneNumber %s valid=%s", (value, ok) => {
    expect(check("phoneNumber", value)).toBe(ok ? null : "must be exactly 10 digits");
  });

  it("ccNumber and cvv: digits only, any length", () => {
    for (const f of ["ccNumber", "cvv"] as const) {
      for (const ok of ["1", "123", "1234", "371449635398431", "4111111111111111", "1234567890123456789"]) {
        expect(check(f, ok)).toBeNull();
      }
      for (const bad of ["4111 1111", "4111-1111", "12a", "１２３"]) {
        expect(check(f, bad), bad).toBe("must be digits only");
      }
    }
  });

  it("ccMonth must be 01-12 with a leading zero", () => {
    expect(optionsOf(PROFILE_RULES.ccMonth)).toHaveLength(12);
    for (const ok of ["01", "09", "10", "12"]) expect(check("ccMonth", ok)).toBeNull();
    for (const bad of ["1", "00", "13", "001"]) expect(check("ccMonth", bad), bad).toBe("isn't one of the allowed values");
  });

  it("ccYear must be two digits; older years stay valid", () => {
    for (const ok of ["20", "26", "36", "99", "00"]) expect(check("ccYear", ok)).toBeNull();
    for (const bad of ["2027", "7", "2a"]) expect(check("ccYear", bad), bad).toBe("must be 2 digits");
  });

  it("ccYear options run from this year to +10", () => {
    expect(ccYearOptions(new Date(2026, 8, 23))).toEqual(["26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36"]);
    expect(ccYearOptions(new Date(2095, 0, 1))).toEqual(["95", "96", "97", "98", "99", "00", "01", "02", "03", "04", "05"]);
    expect(optionsOf(PROFILE_RULES.ccYear)).toEqual(ccYearOptions());
  });

  it("has dropdowns exactly for state, country, ccMonth and ccYear", () => {
    const withOptions = PROFILE_FIELDS.filter((f) => optionsOf(PROFILE_RULES[f]) !== null);
    expect(withOptions).toEqual(["state", "country", "ccMonth", "ccYear"]);
  });
});

describe("validating a whole file", () => {
  it("has no errors for valid rows", () => {
    expect(validateRecords(PROFILE_FIELDS, PROFILE_RULES, [record(1), record(2, { profileName: "2" })]).size).toBe(0);
  });

  it("flags every row that shares a profileName", () => {
    const errors = validateRecords(PROFILE_FIELDS, PROFILE_RULES, [
      record(1, { profileName: "7" }),
      record(2, { profileName: "8" }),
      record(3, { profileName: "7" }),
    ]);
    expect(errors.get(1)).toEqual({ profileName: "is used by more than one row" });
    expect(errors.get(3)).toEqual({ profileName: "is used by more than one row" });
    expect(errors.has(2)).toBe(false);
  });

  it("names differing only in case are not duplicates", () => {
    const errors = validateRecords(PROFILE_FIELDS, PROFILE_RULES, [
      record(1, { profileName: "a" }),
      record(2, { profileName: "A" }),
    ]);
    expect(errors.size).toBe(0);
  });

  it("no other field is checked for duplicates", () => {
    const errors = validateRecords(PROFILE_FIELDS, PROFILE_RULES, [record(1), record(2, { profileName: "2" })]);
    expect(errors.size).toBe(0);
  });

  it("reports one error per field and counts them", () => {
    const errors = validateRecords(PROFILE_FIELDS, PROFILE_RULES, [
      record(1, { zipcode: "ZIP", state: "Il", email: "" }),
      record(2, { profileName: "ALL" }),
    ]);
    expect(errors.get(1)).toEqual({
      zipcode: "must be exactly 5 digits",
      state: "isn't one of the allowed values",
      email: "is required",
    });
    expect(errors.get(2)).toEqual({ profileName: 'can\'t be "ALL"' });
    expect(countErrors(errors)).toBe(4);
  });

  it("an empty name is required, not a duplicate", () => {
    const errors = validateRecords(PROFILE_FIELDS, PROFILE_RULES, [
      record(1, { profileName: "" }),
      record(2, { profileName: "" }),
    ]);
    expect(errors.get(1)).toEqual({ profileName: "is required" });
    expect(errors.get(2)).toEqual({ profileName: "is required" });
  });
});
