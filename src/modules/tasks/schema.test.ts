import { describe, expect, it } from "vitest";
import type { DataRow } from "../../lib/formats/csvTable";
import { TASK_FIELDS, type TaskField } from "../../lib/formats/tasks";
import { TASK_SCHEMA, taskCount, type TaskContext } from "./schema";

const CTX: TaskContext = {
  ready: true,
  profileGroups: new Map([
    ["25", ["1", "2", "3"]],
    ["empty", []],
  ]),
  proxyGroups: new Set(["wealth"]),
  accountGroups: new Set(["example"]),
  sites: ["kith.com", "shop.topps.com"],
};

const VALID: Record<TaskField, string> = {
  profileGroup: "25",
  profileName: "ALL",
  proxyGroup: "wealth",
  accountGroup: "example",
  input: "box logo -tee",
  size: "random",
  color: "random",
  site: "kith.com",
  mode: "preloadstuck",
  cartQuantity: "1",
  delay: "3000",
};

let nextId = 1;
const rec = (o: Partial<Record<TaskField, string>> = {}): DataRow => {
  const v = { ...VALID, ...o };
  return { kind: "record", id: nextId++, values: TASK_FIELDS.map((f) => v[f]), eol: "\n" };
};
const errorsOf = (o: Partial<Record<TaskField, string>>, ctx = CTX) => {
  const r = rec(o);
  return TASK_SCHEMA.validate([r], ctx).get(r.id) ?? {};
};

describe("task validation", () => {
  it("accepts a valid task", () => {
    expect(errorsOf({})).toEqual({});
    expect(errorsOf({ profileName: "2" })).toEqual({});
  });

  it("requires every field (profileName once a group is set)", () => {
    for (const f of TASK_FIELDS) {
      if (f === "profileName") continue;
      expect(errorsOf({ [f]: "" })[f], f).toBe("is required");
    }
    expect(errorsOf({ profileName: "" }).profileName).toBe("is required");
    expect(errorsOf({ color: "" }).color).toBe("is required");
  });

  it("groups must exist", () => {
    expect(errorsOf({ profileGroup: "topps" }).profileGroup).toBe("isn't an existing profile group");
    expect(errorsOf({ proxyGroup: "nope" }).proxyGroup).toBe("isn't an existing proxy group");
    expect(errorsOf({ accountGroup: "nope" }).accountGroup).toBe("isn't an existing account group");
  });

  it("profileName must be ALL or a profile in the group", () => {
    expect(errorsOf({ profileName: "4" }).profileName).toBe("isn't a profile in 25");
    expect(errorsOf({ profileName: "all" }).profileName).toBe("isn't a profile in 25");
    expect(errorsOf({ profileGroup: "empty", profileName: "ALL" })).toEqual({});
  });

  it("profileName can't be set without a profileGroup", () => {
    expect(errorsOf({ profileGroup: "", profileName: "1" })).toEqual({
      profileGroup: "is required",
      profileName: "is set without a profileGroup",
    });
    expect(errorsOf({ profileGroup: "", profileName: "" })).toEqual({ profileGroup: "is required" });
  });

  it("an unknown group doesn't also flag the profileName", () => {
    expect(errorsOf({ profileGroup: "topps", profileName: "1" })).toEqual({ profileGroup: "isn't an existing profile group" });
  });

  it("site must be in the site list", () => {
    expect(errorsOf({ site: "example.com" }).site).toBe("isn't in the site list");
  });

  it("mode must be made of known parts", () => {
    expect(errorsOf({ mode: "preloadwaitlitestuck" })).toEqual({});
    expect(errorsOf({ mode: "paypal" })).toEqual({});
    expect(errorsOf({ mode: "preloadturbo" }).mode).toBe("has parts that aren't known modes");
  });

  it.each([
    ["cartQuantity", "0", "must be a whole number, 1 or more"],
    ["cartQuantity", "1.5", "must be a whole number, 1 or more"],
    ["cartQuantity", "-1", "must be a whole number, 1 or more"],
    ["delay", "3000.5", "must be a whole number of milliseconds"],
    ["delay", "-1", "must be a whole number of milliseconds"],
    ["delay", "3s", "must be a whole number of milliseconds"],
  ] as const)("%s %j", (field, value, msg) => {
    expect(errorsOf({ [field]: value })[field]).toBe(msg);
  });

  it("accepts large and zero delays, and larger cart quantities", () => {
    expect(errorsOf({ delay: "0", cartQuantity: "2" })).toEqual({});
    expect(errorsOf({ delay: "1000000" })).toEqual({});
  });

  it("input may contain spaces and uppercase codes; other fields may not start/end with spaces", () => {
    expect(errorsOf({ input: "AB1234-123 " })).toEqual({});
    expect(errorsOf({ size: "random " }).size).toBe("can't start or end with a space");
    expect(errorsOf({ input: 'a "b"' }).input).toBe("can't contain a quote");
  });

  it("size and color are free strings", () => {
    expect(errorsOf({ size: "9&9.5&10", color: "Black&Blue" })).toEqual({});
    expect(errorsOf({ size: "whole" })).toEqual({});
  });

  it("skips existence checks until the context is ready", () => {
    const notReady = { ...CTX, ready: false, sites: [] };
    expect(errorsOf({ profileGroup: "topps", site: "x.com", proxyGroup: "nope" }, notReady)).toEqual({});
  });
});

describe("task counts", () => {
  it("ALL runs one task per profile in the group; a name runs one", () => {
    expect(taskCount(rec().values, CTX)).toBe(3);
    expect(taskCount(rec({ profileName: "2" }).values, CTX)).toBe(1);
    expect(taskCount(rec({ profileGroup: "empty" }).values, CTX)).toBe(0);
  });

  it("is unknown for a missing group or an empty name", () => {
    expect(taskCount(rec({ profileGroup: "topps" }).values, CTX)).toBeNull();
    expect(taskCount(rec({ profileName: "" }).values, CTX)).toBeNull();
  });
});

describe("new task rows", () => {
  it("start with the most common values", () => {
    const v = TASK_SCHEMA.newRow();
    expect(Object.fromEntries(TASK_FIELDS.map((f, i) => [f, v[i]]))).toEqual({
      profileGroup: "",
      profileName: "",
      proxyGroup: "",
      accountGroup: "",
      input: "",
      size: "random",
      color: "random",
      site: "",
      mode: "",
      cartQuantity: "1",
      delay: "3000",
    });
  });
});
