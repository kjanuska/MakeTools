import { describe, expect, it } from "vitest";
import { parseTasks, serializeTasks, TASK_COL as C, TASK_FIELDS, TASK_HEADER, type TaskField } from "../../lib/formats/tasks";
import { isRecord } from "../../lib/table/ops";
import { TASK_SCHEMA, type TaskContext } from "./schema";
import {
  allocate,
  apportion,
  breakdown,
  emptyPlan,
  evenCounts,
  expandTasks,
  generateRows,
  inferPlan,
  interleave,
  planErrors,
  planTotal,
  SPLIT_FIELDS,
  type BuildPlan,
  type Split,
  type SplitField,
} from "./build";

const five = ["p1", "p2", "p3", "p4", "p5"];
const CTX: TaskContext = {
  ready: true,
  profileGroups: new Map([
    ["solo", ["main"]],
    ["five", five],
    ["three", ["a", "b", "c"]],
  ]),
  proxyGroups: new Set(["resi1", "resi2", "isp"]),
  accountGroups: new Set(["acc"]),
  sites: ["kith.com", "shop.topps.com"],
};

const one = (value: string): Split => [{ value, percent: 100 }];

function basePlan(): BuildPlan {
  return {
    groups: [],
    defaults: {
      proxyGroup: one("resi1"),
      mode: one("preloadwait"),
      site: one("kith.com"),
      size: one("random"),
      color: one("random"),
      accountGroup: one("acc"),
      cartQuantity: one("1"),
      delay: one("3000"),
    },
    inputs: [{ input: "box logo", percent: 100, overrides: {} }],
  };
}

/** The user's example: 250 tasks over 5 profiles, 50/25/25 inputs × 50/50 proxies × 75/25 modes. */
function userPlan(counts = [50, 50, 50, 50, 50]): BuildPlan {
  const p = basePlan();
  p.groups = [{ profileGroup: "five", counts: five.map((profileName, i) => ({ profileName, count: counts[i] })) }];
  p.defaults.proxyGroup = [
    { value: "resi1", percent: 50 },
    { value: "resi2", percent: 50 },
  ];
  p.defaults.mode = [
    { value: "preload", percent: 75 },
    { value: "direct", percent: 25 },
  ];
  p.inputs = [
    { input: "keyword1", percent: 50, overrides: {} },
    { input: "keyword2", percent: 25, overrides: {} },
    { input: "keyword3", percent: 25, overrides: {} },
  ];
  return p;
}

const count = (rows: string[][], pred: (r: string[]) => boolean) => rows.filter(pred).length;
const is = (field: TaskField, value: string) => (r: string[]) => r[C[field]] === value;
const and = (...ps: ((r: string[]) => boolean)[]) => (r: string[]) => ps.every((p) => p(r));

describe("apportion", () => {
  it("always adds up to the total", () => {
    expect(apportion(50, [33, 33, 34])).toEqual([17, 16, 17]);
    expect(apportion(50, [33.33, 33.33, 33.34])).toEqual([17, 16, 17]);
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    for (let total = 0; total < 60; total++) {
      for (const w of [[1], [1, 2], [33, 33, 34], [75, 25], [0.1, 99.9], [10, 0, 90]]) {
        const out = apportion(total, w);
        expect(out.reduce((a, b) => a + b, 0)).toBe(total);
        const sum = w.reduce((a, b) => a + b, 0);
        out.forEach((c, i) => expect(Math.abs(c - (total * w[i]) / sum)).toBeLessThan(1));
      }
    }
  });

  it("gives nothing to zero weights and handles floating point sums", () => {
    expect(apportion(7, [0, 1, 0])).toEqual([0, 7, 0]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
    expect(apportion(3, [(1 * 100) / 3, (2 * 100) / 3])).toEqual([1, 2]);
    expect(apportion(1000, [(123 * 100) / 1000, (877 * 100) / 1000])).toEqual([123, 877]);
  });

  it("evenCounts spreads the extra over the first profiles", () => {
    expect(evenCounts(250, 5)).toEqual([50, 50, 50, 50, 50]);
    expect(evenCounts(7, 3)).toEqual([3, 2, 2]);
    expect(evenCounts(0, 2)).toEqual([0, 0]);
  });
});

describe("allocate", () => {
  it("keeps both margins exact and cells close to proportional", () => {
    const cases: [number[], number[]][] = [
      [[50, 50, 50, 50, 50], [125, 63, 62]],
      [[1, 1, 1, 1, 1], [3, 2]],
      [[80, 20, 7], [53, 54]],
      [[0, 10], [5, 5]],
    ];
    for (const [rows, cols] of cases) {
      const t = allocate(rows, cols);
      const total = rows.reduce((a, b) => a + b, 0);
      t.forEach((r, i) => expect(r.reduce((a, b) => a + b, 0)).toBe(rows[i]));
      cols.forEach((c, j) => expect(t.reduce((a, r) => a + r[j], 0)).toBe(c));
      t.forEach((r, i) => r.forEach((cell, j) => expect(Math.abs(cell - (rows[i] * cols[j]) / total)).toBeLessThan(2)));
    }
  });
});

describe("interleave", () => {
  it("repeats each index its count and spreads them out", () => {
    expect(interleave([2, 1])).toEqual([0, 1, 0]);
    expect(interleave([1, 1, 1])).toEqual([0, 1, 2]);
    expect(interleave([0, 2])).toEqual([1, 1]);
    const seq = interleave([6, 3, 1]);
    expect(seq.filter((i) => i === 0)).toHaveLength(6);
    expect(seq.filter((i) => i === 2)).toHaveLength(1);
    expect(seq.slice(0, 2)).toEqual([0, 1]);
  });
});

describe("generateRows", () => {
  it("1k tasks with one profile", () => {
    const p = basePlan();
    p.groups = [{ profileGroup: "solo", counts: [{ profileName: "main", count: 1000 }] }];
    const rows = generateRows(p);
    expect(rows).toHaveLength(1000);
    for (const r of rows) {
      expect(r).toHaveLength(TASK_FIELDS.length);
      expect(r[C.profileGroup]).toBe("solo");
      expect(r[C.profileName]).toBe("main");
      expect(r[C.input]).toBe("box logo");
      expect(r[C.site]).toBe("kith.com");
      expect(r[C.cartQuantity]).toBe("1");
    }
    expect(planErrors(p, CTX)).toEqual([]);
  });

  it("the user's example: exact totals per profile, input, proxy group and mode", () => {
    const rows = generateRows(userPlan());
    expect(rows).toHaveLength(250);
    for (const name of five) expect(count(rows, is("profileName", name))).toBe(50);
    expect(count(rows, is("input", "keyword1"))).toBe(125);
    expect(count(rows, is("input", "keyword2"))).toBe(63);
    expect(count(rows, is("input", "keyword3"))).toBe(62);
    expect(count(rows, is("proxyGroup", "resi1"))).toBe(125);
    expect(count(rows, is("mode", "preload"))).toBeGreaterThanOrEqual(187);
    expect(count(rows, is("mode", "preload"))).toBeLessThanOrEqual(188);
  });

  it("every profile gets the same input mix, and every input the same proxy and mode mix", () => {
    const rows = generateRows(userPlan());
    for (const name of five) {
      const own = rows.filter(is("profileName", name));
      expect(Math.abs(count(own, is("input", "keyword1")) - 25)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(own, is("input", "keyword2")) - 12.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(own, is("proxyGroup", "resi1")) - 25)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(own, is("mode", "preload")) - 37.5)).toBeLessThanOrEqual(1);
    }
    // Within an input, each field's counts are its split of the input's tasks, exactly.
    const k1 = rows.filter(is("input", "keyword1"));
    expect(count(k1, is("proxyGroup", "resi1"))).toBe(63);
    expect(count(k1, is("mode", "preload"))).toBe(94);
    // Proxy × mode are independent: each proxy group gets 75/25.
    expect(Math.abs(count(k1, and(is("proxyGroup", "resi1"), is("mode", "preload"))) - 125 * 0.5 * 0.75)).toBeLessThanOrEqual(1);
    expect(Math.abs(count(k1, and(is("proxyGroup", "resi2"), is("mode", "preload"))) - 125 * 0.5 * 0.75)).toBeLessThanOrEqual(1);
  });

  it("small counts: the marginals of each field stay exact", () => {
    const p = basePlan();
    p.groups = [{ profileGroup: "solo", counts: [{ profileName: "main", count: 5 }] }];
    p.defaults.proxyGroup = [
      { value: "resi1", percent: 50 },
      { value: "resi2", percent: 50 },
    ];
    p.defaults.mode = [
      { value: "preload", percent: 50 },
      { value: "direct", percent: 50 },
    ];
    p.defaults.size = [
      { value: "9", percent: 50 },
      { value: "10", percent: 50 },
    ];
    const rows = generateRows(p);
    expect(count(rows, is("proxyGroup", "resi1"))).toBe(3);
    expect(count(rows, is("mode", "preload"))).toBe(3);
    expect(count(rows, is("size", "9"))).toBe(3);
  });

  it("uneven profile counts and several groups", () => {
    const p = userPlan([100, 60, 40, 30, 20]);
    p.groups.push({ profileGroup: "three", counts: evenCounts(10, 3).map((count, i) => ({ profileName: "abc"[i], count })) });
    const rows = generateRows(p);
    expect(planTotal(p)).toBe(260);
    expect(rows).toHaveLength(260);
    expect([100, 60, 40, 30, 20].map((n, i) => count(rows, is("profileName", five[i])) - n)).toEqual([0, 0, 0, 0, 0]);
    expect(count(rows, is("profileGroup", "three"))).toBe(10);
    expect(count(rows, is("profileName", "a"))).toBe(4);
    expect(count(rows, is("input", "keyword1"))).toBe(130);
  });

  it("profiles with 0 tasks and inputs with 0% get no rows", () => {
    const p = userPlan([10, 0, 0, 0, 0]);
    p.inputs[2].percent = 0;
    p.inputs[1].percent = 50;
    const rows = generateRows(p);
    expect(rows).toHaveLength(10);
    expect(count(rows, is("profileName", "p2"))).toBe(0);
    expect(count(rows, is("input", "keyword3"))).toBe(0);
  });

  it("per-input overrides replace the default for that input only", () => {
    const p = userPlan();
    p.inputs[1].overrides = { proxyGroup: one("isp"), size: [{ value: "9", percent: 40 }, { value: "10", percent: 60 }] };
    const rows = generateRows(p);
    const k2 = rows.filter(is("input", "keyword2"));
    expect(k2.every(is("proxyGroup", "isp"))).toBe(true);
    expect(count(k2, is("size", "9"))).toBe(25);
    expect(count(k2, is("size", "10"))).toBe(38);
    const others = rows.filter((r) => r[C.input] !== "keyword2");
    expect(others.some(is("proxyGroup", "isp"))).toBe(false);
    expect(others.every(is("size", "random"))).toBe(true);
  });

  it("interleaves profiles and inputs through the file", () => {
    const rows = generateRows(userPlan());
    expect(rows.slice(0, 5).map((r) => r[C.profileName])).toEqual(five);
    // No long runs of one profile or one input.
    const longestRun = (field: TaskField) => {
      let best = 0;
      let run = 0;
      rows.forEach((r, i) => {
        run = i > 0 && rows[i - 1][C[field]] === r[C[field]] ? run + 1 : 1;
        best = Math.max(best, run);
      });
      return best;
    };
    expect(longestRun("profileName")).toBe(1);
    // Each profile alternates its inputs, so a run is at most one round of profiles per input repeat.
    expect(longestRun("input")).toBeLessThanOrEqual(10);
  });

  it("is deterministic and cleans the input's spaces", () => {
    const p = userPlan();
    p.inputs[0].input = "  box   logo ";
    const a = generateRows(p);
    expect(generateRows(p)).toEqual(a);
    expect(a.some(is("input", "box logo"))).toBe(true);
  });

  it("generated rows pass the task validation", () => {
    const doc = parseTasks(`${TASK_HEADER}\n${generateRows(userPlan()).map((r) => r.join(",")).join("\n")}\n`);
    const rows = doc.rows.filter(isRecord);
    expect(rows).toHaveLength(250);
    expect(TASK_SCHEMA.validate(rows, CTX).size).toBe(0);
    expect(serializeTasks(doc).endsWith("\n")).toBe(true);
  });
});

describe("expandTasks and breakdown", () => {
  const row = (o: Partial<Record<TaskField, string>>) => {
    const v: Record<TaskField, string> = {
      profileGroup: "three",
      profileName: "ALL",
      proxyGroup: "resi1",
      accountGroup: "acc",
      input: "kw",
      size: "random",
      color: "random",
      site: "kith.com",
      mode: "preload",
      cartQuantity: "1",
      delay: "3000",
      ...o,
    };
    return TASK_FIELDS.map((f) => v[f]);
  };

  it("expands ALL into one task per profile and counts unknown rows", () => {
    const { tasks, unknownRows } = expandTasks(
      [row({}), row({ profileName: "b" }), row({ profileGroup: "gone" }), row({ profileName: "" })],
      CTX,
    );
    expect(tasks.map((t) => t[C.profileName])).toEqual(["a", "b", "c", "b"]);
    expect(unknownRows).toBe(2);
  });

  it("counts tasks per field value and per profile", () => {
    const b = breakdown([row({}), row({ profileName: "c", proxyGroup: "isp", input: "other" }), row({ profileGroup: "gone" })], CTX);
    expect(b.total).toBe(4);
    expect(b.unknownRows).toBe(1);
    expect(b.by.proxyGroup).toEqual([
      { value: "resi1", count: 3 },
      { value: "isp", count: 1 },
    ]);
    expect(b.by.input).toEqual([
      { value: "kw", count: 3 },
      { value: "other", count: 1 },
    ]);
    expect(b.profiles.get("three")).toEqual([
      { value: "a", count: 1 },
      { value: "b", count: 1 },
      { value: "c", count: 2 },
    ]);
  });
});

/** A plan's counts, independent of the order values are listed in. */
function signature(plan: BuildPlan) {
  const rows = generateRows(plan);
  const b = breakdown(rows, CTX);
  const perInput = plan.inputs.map((i) => {
    const own = rows.filter(is("input", i.input));
    return [i.input, SPLIT_FIELDS.map((f) => breakdown(own, CTX).by[f].map((c) => `${c.value}=${c.count}`).sort())];
  });
  return {
    profiles: [...b.profiles].map(([g, list]) => [g, list.map((c) => `${c.value}=${c.count}`).sort()]).sort(),
    inputs: perInput.sort(),
  };
}

describe("inferPlan", () => {
  it("reads back a generated plan: same counts per profile, input and value", () => {
    for (const plan of [userPlan(), userPlan([100, 60, 40, 30, 20])]) {
      plan.inputs[1].overrides = { mode: [{ value: "preloadwait", percent: 100 }] };
      const inferred = inferPlan(generateRows(plan), CTX);
      expect(planErrors(inferred, CTX)).toEqual([]);
      expect(signature(inferred)).toEqual(signature(plan));
      expect(Object.keys(inferred.inputs.find((i) => i.input === "keyword2")!.overrides)).toEqual(["mode"]);
      expect(inferred.inputs.find((i) => i.input === "keyword1")!.overrides).toEqual({});
    }
  });

  it("on a tie, the later input gets the custom split and earlier ones keep the default", () => {
    const p = basePlan();
    p.groups = [{ profileGroup: "solo", counts: [{ profileName: "main", count: 10 }] }];
    p.inputs = [
      { input: "keyword1", percent: 50, overrides: {} },
      { input: "keyword2", percent: 50, overrides: { site: one("shop.topps.com") } },
    ];
    const inferred = inferPlan(generateRows(p), CTX);
    expect(inferred.defaults.site).toEqual(one("kith.com"));
    expect(inferred.inputs.map((i) => i.overrides)).toEqual([{}, { site: one("shop.topps.com") }]);
  });

  it("regenerating an inferred plan gives the same rows", () => {
    const rows = generateRows(userPlan());
    expect(generateRows(inferPlan(rows, CTX))).toEqual(rows);
  });

  it("lists every profile of a group (0 for unused) and expands ALL rows", () => {
    const rows = [
      TASK_FIELDS.map((f) => ({ profileGroup: "three", profileName: "ALL" } as Record<string, string>)[f] ?? "x"),
      TASK_FIELDS.map((f) => ({ profileGroup: "five", profileName: "p2" } as Record<string, string>)[f] ?? "x"),
    ];
    const plan = inferPlan(rows, CTX);
    expect(plan.groups).toEqual([
      { profileGroup: "three", counts: [{ profileName: "a", count: 1 }, { profileName: "b", count: 1 }, { profileName: "c", count: 1 }] },
      { profileGroup: "five", counts: five.map((profileName) => ({ profileName, count: profileName === "p2" ? 1 : 0 })) },
    ]);
    expect(planTotal(plan)).toBe(4);
  });

  it("an empty file gives an empty plan", () => {
    expect(inferPlan([], CTX)).toEqual(emptyPlan());
  });
});

describe("planErrors", () => {
  const errs = (edit: (p: BuildPlan) => void) => {
    const p = userPlan();
    edit(p);
    return planErrors(p, CTX);
  };

  it("accepts a good plan", () => {
    expect(planErrors(userPlan(), CTX)).toEqual([]);
  });

  it("needs groups, tasks and inputs", () => {
    expect(planErrors(emptyPlan(), CTX)).toEqual(expect.arrayContaining(["Add a profile group.", "Add an input."]));
    expect(errs((p) => p.groups[0].counts.forEach((c) => (c.count = 0)))).toContain(
      "There are no tasks: set how many tasks the profiles run.",
    );
    expect(errs((p) => (p.groups[0].counts[0].count = 1.5))).toContain("five / p1: tasks must be a whole number, 0 or more.");
    expect(errs((p) => (p.groups[0].profileGroup = "gone"))).toContain('Profile group "gone" doesn\'t exist.');
    expect(errs((p) => p.groups.push(p.groups[0]))).toContain('Profile group "five" is listed twice.');
    expect(errs((p) => (p.groups[0].counts[0].profileName = "zz"))).toContain("five / zz isn't a profile in five.");
  });

  it("%s must add up to 100", () => {
    expect(errs((p) => (p.inputs[0].percent = 40))).toContain("Input %s must add up to 100.");
    expect(errs((p) => (p.defaults.mode[0].percent = 70))).toContain("All inputs: Mode %s must add up to 100.");
    expect(
      errs((p) => (p.inputs[0].overrides.site = [{ value: "kith.com", percent: 99 }])),
    ).toContain('Input "keyword1": Site %s must add up to 100.');
    expect(
      errs((p) => {
        p.inputs = [1, 2, 3].map((n) => ({ input: `k${n}`, percent: 100 / 3, overrides: {} }));
      }),
    ).toEqual([]);
  });

  it("checks values like the grid does", () => {
    const setDefault = (f: SplitField, value: string) => errs((p) => (p.defaults[f] = one(value)));
    expect(setDefault("proxyGroup", "nope")).toContain('All inputs: Proxy Group "nope" isn\'t an existing proxy group.');
    expect(setDefault("accountGroup", "nope")).toContain('All inputs: Account Group "nope" isn\'t an existing account group.');
    expect(setDefault("site", "nope.com")).toContain('All inputs: Site "nope.com" isn\'t in the site list.');
    expect(setDefault("mode", "preloadxyz")).toContain('All inputs: Mode "preloadxyz" has parts that aren\'t known modes.');
    expect(setDefault("cartQuantity", "0")).toContain('All inputs: Cart Quantity "0" must be a whole number, 1 or more.');
    expect(setDefault("size", "9,10")).toContain('All inputs: Size "9,10" can\'t contain a comma.');
    expect(setDefault("color", "")).toContain('All inputs: Color "" is required.');
    expect(errs((p) => (p.defaults.size = [one("9")[0], one("9")[0]]))).toContain('All inputs: Size "9" is listed twice.');
    expect(errs((p) => (p.inputs[0].input = "a,b"))).toContain('Input "a,b" can\'t contain a comma.');
    expect(errs((p) => (p.inputs[1].input = " keyword1 "))).toContain('Input "keyword1" is listed twice.');
  });
});
