// Task builder (spec: docs/modules/tasks.md, "3b"). A build plan says how many
// tasks each profile runs, which inputs get what share, and how each input is
// split across the other fields. `generateRows` turns a plan into one task row
// per task; `inferPlan` reads a plan back from a file's rows; `breakdown`
// counts the tasks of a file by each field.
import { cleanInput, TASK_COL as C, TASK_FIELDS, type TaskField } from "../../lib/formats/tasks";
import { validateValue } from "../../lib/rules/engine";
import { ALL_PROFILES, TASK_RULES } from "../../lib/rules/tasks";
import { linkError, type TaskContext } from "./schema";

/** Fields split by % per input (with a shared default), in the order they're shown. */
export const SPLIT_FIELDS = [
  "proxyGroup",
  "mode",
  "site",
  "size",
  "color",
  "accountGroup",
  "cartQuantity",
  "delay",
] as const satisfies readonly TaskField[];

export type SplitField = (typeof SPLIT_FIELDS)[number];

/** How fields are named in the builder (the file keeps its own column names). */
export const FIELD_LABELS: Record<TaskField, string> = {
  profileGroup: "Profile Group",
  profileName: "Profile",
  proxyGroup: "Proxy Group",
  accountGroup: "Account Group",
  input: "Input",
  size: "Size",
  color: "Color",
  site: "Site",
  mode: "Mode",
  cartQuantity: "Cart Quantity",
  delay: "Delay (ms)",
};

export interface SplitPart {
  value: string;
  percent: number;
}

/** Values and their share, in %. The percents add up to 100. */
export type Split = SplitPart[];

export interface GroupPlan {
  profileGroup: string;
  /** Tasks per profile; 0 = the profile runs nothing. */
  counts: { profileName: string; count: number }[];
}

export interface InputPlan {
  input: string;
  percent: number;
  /** Splits that replace the default ones for this input. */
  overrides: Partial<Record<SplitField, Split>>;
}

export interface BuildPlan {
  groups: GroupPlan[];
  defaults: Record<SplitField, Split>;
  inputs: InputPlan[];
}

/** Percents closer to 100 than this count as 100 (floating point sums). */
const PERCENT_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Counting helpers

/**
 * Splits `total` into whole numbers proportional to `weights` (largest
 * remainder). The result always adds up to `total`; ties go to the earlier
 * weight. All-zero weights give all zeros.
 *
 * `bonus` (optional) is added to each remainder when choosing who gets the
 * extra units, e.g. to favour values a profile got too few of earlier.
 * `caps` (optional) are limits no count may go over.
 */
export function apportion(
  total: number,
  weights: readonly number[],
  bonus?: readonly number[],
  caps?: readonly number[],
): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const quotas = weights.map((w) => (total * Math.max(0, w)) / sum);
  // Round away floating point noise so e.g. 49.999999999 counts as 50.
  const counts = quotas.map((q) => Math.floor(q + 1e-9));
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = quotas
    .map((q, i) => ({ i, score: q - counts[i] + (bonus?.[i] ?? 0) }))
    .filter((x) => weights[x.i] > 0 && (!caps || counts[x.i] < caps[x.i]))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) counts[order[k].i]++;
  return counts;
}

/** `total` spread over `n` profiles as evenly as possible (earlier ones get the extra). */
export function evenCounts(total: number, n: number): number[] {
  return apportion(total, Array.from({ length: n }, () => 1));
}

/**
 * A rows × columns table of whole numbers whose row sums are `rows` and
 * column sums are `cols` (both must add up to the same total), with each
 * cell close to its proportional share. Each row takes its share of what the
 * columns still have left, so the columns come out exact.
 */
export function allocate(
  rows: readonly number[],
  cols: readonly number[],
  bonus?: (row: number) => readonly number[],
): number[][] {
  const left = [...cols];
  let remaining = left.reduce((a, b) => a + b, 0);
  return rows.map((r, i) => {
    const cells = apportion(Math.min(r, remaining), left, bonus?.(i), left);
    cells.forEach((c, j) => (left[j] -= c));
    remaining -= r;
    return cells;
  });
}

/**
 * Smooth weighted round-robin: the indexes of `counts`, each repeated its
 * count times, spread out as evenly as possible (e.g. [2,1] → 0,1,0).
 */
export function interleave(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  const current = counts.map(() => 0);
  const out: number[] = [];
  for (let step = 0; step < total; step++) {
    let best = -1;
    counts.forEach((c, i) => {
      if (c <= 0) return;
      current[i] += c;
      if (best < 0 || current[i] > current[best]) best = i;
    });
    current[best] -= total;
    out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generating

/** The split an input uses for a field: its override, else the default. */
export function effectiveSplit(plan: BuildPlan, input: InputPlan, field: SplitField): Split {
  return input.overrides[field] ?? plan.defaults[field];
}

/** Total tasks of a plan. */
export function planTotal(plan: BuildPlan): number {
  return plan.groups.reduce((a, g) => a + g.counts.reduce((b, c) => b + c.count, 0), 0);
}

/**
 * Tasks per value of one field for the inputs that share a split: the split
 * is applied to their combined tasks (so the totals are exact), then shared
 * out between them in proportion to their tasks.
 */
function sharedMarginals(inputCounts: readonly number[], split: Split): number[][] {
  const total = inputCounts.reduce((a, b) => a + b, 0);
  return allocate(
    inputCounts,
    apportion(
      total,
      split.map((p) => p.percent),
    ),
  );
}

/** Tasks per value of `field` for each input: overrides apply to their input alone, the rest share the default. */
function fieldMarginals(plan: BuildPlan, inputCounts: readonly number[], field: SplitField): number[][] {
  const shared = plan.inputs.map((_, k) => k).filter((k) => !plan.inputs[k].overrides[field]);
  const fromDefault = sharedMarginals(
    shared.map((k) => inputCounts[k]),
    plan.defaults[field],
  );
  return plan.inputs.map((input, k) => {
    const own = input.overrides[field];
    if (own) return apportion(inputCounts[k], own.map((p) => p.percent));
    return fromDefault[shared.indexOf(k)];
  });
}

/**
 * The value combinations of one input with their counts. `marginals` has the
 * tasks per value of each field; fields are crossed one at a time so each
 * value of one field gets the same mix of the next.
 */
function inputCombos(
  plan: BuildPlan,
  input: InputPlan,
  n: number,
  marginals: readonly (readonly number[])[],
): { values: string[]; count: number }[] {
  let combos: { values: string[]; count: number }[] = [{ values: [], count: n }];
  SPLIT_FIELDS.forEach((field, f) => {
    const split = effectiveSplit(plan, input, field);
    const table = allocate(
      combos.map((c) => c.count),
      marginals[f],
    );
    const next: typeof combos = [];
    combos.forEach((c, i) =>
      split.forEach((p, j) => {
        if (table[i][j] > 0) next.push({ values: [...c.values, p.value], count: table[i][j] });
      }),
    );
    combos = next;
  });
  return combos;
}

/**
 * One task row per task, interleaved: profiles take turns in proportion to
 * their counts, and each profile's tasks take turns between inputs, then
 * between each input's value combinations. The plan should be free of
 * `planErrors`.
 */
export function generateRows(plan: BuildPlan): string[][] {
  const profiles = plan.groups.flatMap((g) =>
    g.counts.filter((c) => c.count > 0).map((c) => ({ group: g.profileGroup, name: c.profileName, count: c.count })),
  );
  const total = profiles.reduce((a, p) => a + p.count, 0);
  const inputCounts = apportion(
    total,
    plan.inputs.map((i) => i.percent),
  );
  // Tasks of each profile for each input.
  const byInput = allocate(
    profiles.map((p) => p.count),
    inputCounts,
  );
  const marginals = SPLIT_FIELDS.map((f) => fieldMarginals(plan, inputCounts, f));

  // For each profile and input: the tasks' values (input first), interleaved.
  const sequences: string[][][][] = profiles.map(() => []);
  // How many tasks each profile is short of (or over) its exact share of
  // each field value, by "field index:value". Rounding extras in later inputs
  // go where a profile is short, so its totals stay close to its share.
  const carry = profiles.map(() => new Map<string, number>());
  plan.inputs.forEach((input, k) => {
    const combos = inputCombos(
      plan,
      input,
      inputCounts[k],
      marginals.map((m) => m[k]),
    );
    const keys = combos.map((c) => c.values.map((v, f) => `${f}:${v}`));
    const table = allocate(
      profiles.map((_, i) => byInput[i][k]),
      combos.map((c) => c.count),
      (i) => keys.map((ks) => ks.reduce((a, key) => a + (carry[i].get(key) ?? 0), 0)),
    );
    profiles.forEach((_, i) => {
      SPLIT_FIELDS.forEach((_, f) => {
        const split = marginals[f][k];
        effectiveSplit(plan, input, SPLIT_FIELDS[f]).forEach((p, j) => {
          const key = `${f}:${p.value}`;
          const target = inputCounts[k] ? (byInput[i][k] * split[j]) / inputCounts[k] : 0;
          const got = combos.reduce((a, c, cj) => a + (c.values[f] === p.value ? table[i][cj] : 0), 0);
          carry[i].set(key, (carry[i].get(key) ?? 0) + target - got);
        });
      });
    });
    const text = cleanInput(input.input);
    profiles.forEach((_, i) => {
      sequences[i][k] = interleave(table[i]).map((j) => [text, ...combos[j].values]);
    });
  });

  // Each profile's tasks: its inputs taking turns.
  const perProfile = profiles.map((_, i) => {
    const next = plan.inputs.map(() => 0);
    return interleave(byInput[i]).map((k) => sequences[i][k][next[k]++]);
  });
  const next = profiles.map(() => 0);
  return interleave(profiles.map((p) => p.count)).map((i) => {
    const [input, ...split] = perProfile[i][next[i]++];
    const row = TASK_FIELDS.map(() => "");
    row[C.profileGroup] = profiles[i].group;
    row[C.profileName] = profiles[i].name;
    row[C.input] = input;
    SPLIT_FIELDS.forEach((f, j) => (row[C[f]] = split[j]));
    return row;
  });
}

// ---------------------------------------------------------------------------
// Reading a file back

export interface ExpandedTasks {
  /** One entry per task, with a named profile (ALL rows expanded). */
  tasks: string[][];
  /** Rows whose task count isn't known (ALL in an unknown group, or no profileName). */
  unknownRows: number;
}

/** Every task of some rows: `ALL` becomes one task per profile in its group. */
export function expandTasks(rows: readonly (readonly string[])[], ctx: TaskContext): ExpandedTasks {
  const tasks: string[][] = [];
  let unknownRows = 0;
  for (const values of rows) {
    const name = values[C.profileName];
    if (name === "") {
      unknownRows++;
      continue;
    }
    if (name !== ALL_PROFILES) {
      tasks.push([...values]);
      continue;
    }
    const names = ctx.profileGroups.get(values[C.profileGroup]);
    if (!names) {
      unknownRows++;
      continue;
    }
    for (const n of names) {
      const t = [...values];
      t[C.profileName] = n;
      tasks.push(t);
    }
  }
  return { tasks, unknownRows };
}

/** Counts of each value, in first-seen order. */
function countValues(values: Iterable<string>): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }));
}

const toSplit = (counts: { value: string; count: number }[], n: number): Split =>
  counts.map((c) => ({ value: c.value, percent: (c.count * 100) / n }));

/** An empty plan with one empty value in each default split. */
export function emptyPlan(): BuildPlan {
  const defaults = Object.fromEntries(SPLIT_FIELDS.map((f) => [f, [{ value: "", percent: 100 }]])) as Record<
    SplitField,
    Split
  >;
  return { groups: [], defaults, inputs: [] };
}

/**
 * A plan that regenerates the file's counts: the same tasks per profile and
 * per input, and within each input the same count for each value of each
 * field. Each field's default is the mix of the inputs that share it; an
 * input whose own counts that default wouldn't give gets an override. Groups list
 * all their profiles (0 for ones without tasks), in the group's order.
 */
export function inferPlan(rows: readonly (readonly string[])[], ctx: TaskContext): BuildPlan {
  const { tasks } = expandTasks(rows, ctx);
  const n = tasks.length;
  if (n === 0) return emptyPlan();

  const groups: GroupPlan[] = [];
  for (const { value: group } of countValues(tasks.map((t) => t[C.profileGroup]))) {
    const own = tasks.filter((t) => t[C.profileGroup] === group);
    const counts = new Map(countValues(own.map((t) => t[C.profileName])).map((c) => [c.value, c.count]));
    const names = [...(ctx.profileGroups.get(group) ?? [])];
    for (const name of counts.keys()) if (!names.includes(name)) names.push(name);
    groups.push({ profileGroup: group, counts: names.map((profileName) => ({ profileName, count: counts.get(profileName) ?? 0 })) });
  }

  const inputList = countValues(tasks.map((t) => t[C.input]));
  const inputCounts = inputList.map((i) => i.count);
  const inputTasks = inputList.map(({ value }) => tasks.filter((t) => t[C.input] === value));
  const inputs: InputPlan[] = inputList.map(({ value, count }) => ({ input: value, percent: (count * 100) / n, overrides: {} }));

  const defaults = {} as Record<SplitField, Split>;
  for (const f of SPLIT_FIELDS) {
    const actual = inputTasks.map((own) => countValues(own.map((t) => t[C[f]])));
    // Inputs share the default while it gives their counts. Otherwise the
    // input furthest from it gets an override, and the default is worked out
    // again without it.
    let shared = inputList.map((_, k) => k);
    for (;;) {
      const sharedTasks = shared.flatMap((k) => inputTasks[k]);
      const pool = sharedTasks.length ? sharedTasks : tasks;
      const split = toSplit(countValues(pool.map((t) => t[C[f]])), pool.length);
      defaults[f] = split;
      if (shared.length === 0) break;
      const expected = sharedMarginals(
        shared.map((k) => inputCounts[k]),
        split,
      );
      const off = shared.map((k, s) =>
        split.reduce((a, p, j) => a + Math.abs((actual[k].find((x) => x.value === p.value)?.count ?? 0) - expected[s][j]), 0),
      );
      const worst = Math.max(...off);
      if (worst === 0) break;
      // Take out the input furthest from the default, then try again. On a
      // tie the later input goes, so earlier inputs keep the default.
      shared = shared.filter((_, s) => s !== off.lastIndexOf(worst));
    }
    inputList.forEach((_, k) => {
      if (!shared.includes(k)) inputs[k].overrides[f] = toSplit(actual[k], inputCounts[k]);
    });
  }

  return { groups, defaults, inputs };
}

// ---------------------------------------------------------------------------
// Counting a file

/** Dimensions of the breakdown, in the order they're shown. */
export const BREAKDOWN_FIELDS = ["profileGroup", "input", ...SPLIT_FIELDS] as const satisfies readonly TaskField[];
export type BreakdownField = (typeof BREAKDOWN_FIELDS)[number];

export interface Breakdown {
  total: number;
  unknownRows: number;
  /** Tasks per value of each field, in first-seen order. */
  by: Record<BreakdownField, { value: string; count: number }[]>;
  /** Tasks per profile, by profile group. */
  profiles: Map<string, { value: string; count: number }[]>;
}

export function breakdown(rows: readonly (readonly string[])[], ctx: TaskContext): Breakdown {
  const { tasks, unknownRows } = expandTasks(rows, ctx);
  const by = Object.fromEntries(
    BREAKDOWN_FIELDS.map((f) => [f, countValues(tasks.map((t) => t[C[f]]))]),
  ) as Breakdown["by"];
  const profiles = new Map(
    by.profileGroup.map(({ value }) => [
      value,
      countValues(tasks.filter((t) => t[C.profileGroup] === value).map((t) => t[C.profileName])),
    ]),
  );
  return { total: tasks.length, unknownRows, by, profiles };
}

// ---------------------------------------------------------------------------
// Checking a plan

/** Error for a split field value, like the grid shows it, or null. */
export function valueError(field: TaskField, value: string, ctx: TaskContext): string | null {
  const msg = validateValue(TASK_RULES[field], value);
  if (msg) return msg;
  const values = TASK_FIELDS.map(() => "");
  values[C[field]] = value;
  return linkError(field, values, ctx);
}

const sumsTo100 = (percents: readonly number[]) =>
  Math.abs(percents.reduce((a, b) => a + b, 0) - 100) < PERCENT_EPSILON;

function splitErrors(field: SplitField, split: Split, where: string, ctx: TaskContext): string[] {
  const errors: string[] = [];
  const name = FIELD_LABELS[field];
  if (split.length === 0) errors.push(`${where}: ${name} needs at least one value.`);
  const seen = new Set<string>();
  for (const p of split) {
    const msg = valueError(field, p.value, ctx);
    if (msg) errors.push(`${where}: ${name} "${p.value}" ${msg}.`);
    if (seen.has(p.value)) errors.push(`${where}: ${name} "${p.value}" is listed twice.`);
    seen.add(p.value);
    if (!(p.percent >= 0)) errors.push(`${where}: ${name} "${p.value}" needs a % of 0 or more.`);
  }
  if (split.length && !sumsTo100(split.map((p) => p.percent))) errors.push(`${where}: ${name} %s must add up to 100.`);
  return errors;
}

/** Everything that stops a plan from being applied. Empty = OK. */
export function planErrors(plan: BuildPlan, ctx: TaskContext): string[] {
  const errors: string[] = [];
  if (plan.groups.length === 0) errors.push("Add a profile group.");
  const groupsSeen = new Set<string>();
  for (const g of plan.groups) {
    const names = ctx.profileGroups.get(g.profileGroup);
    if (g.profileGroup === "") errors.push("Pick a profile group.");
    else if (ctx.ready && !names) errors.push(`Profile group "${g.profileGroup}" doesn't exist.`);
    if (groupsSeen.has(g.profileGroup)) errors.push(`Profile group "${g.profileGroup}" is listed twice.`);
    groupsSeen.add(g.profileGroup);
    for (const c of g.counts) {
      if (!Number.isInteger(c.count) || c.count < 0) {
        errors.push(`${g.profileGroup} / ${c.profileName}: tasks must be a whole number, 0 or more.`);
      } else if (c.count > 0 && ctx.ready && names && !names.includes(c.profileName)) {
        errors.push(`${g.profileGroup} / ${c.profileName} isn't a profile in ${g.profileGroup}.`);
      }
    }
  }
  if (plan.groups.length && planTotal(plan) === 0) errors.push("There are no tasks: set how many tasks the profiles run.");

  if (plan.inputs.length === 0) errors.push("Add an input.");
  const inputsSeen = new Set<string>();
  for (const i of plan.inputs) {
    const text = cleanInput(i.input);
    const msg = validateValue(TASK_RULES.input, text);
    if (msg) errors.push(`Input "${i.input}" ${msg}.`);
    if (inputsSeen.has(text)) errors.push(`Input "${text}" is listed twice.`);
    inputsSeen.add(text);
    if (!(i.percent >= 0)) errors.push(`Input "${i.input}" needs a % of 0 or more.`);
  }
  if (plan.inputs.length && !sumsTo100(plan.inputs.map((i) => i.percent))) errors.push("Input %s must add up to 100.");

  for (const f of SPLIT_FIELDS) errors.push(...splitErrors(f, plan.defaults[f], "All inputs", ctx));
  for (const i of plan.inputs) {
    for (const f of SPLIT_FIELDS) {
      const split = i.overrides[f];
      if (split) errors.push(...splitErrors(f, split, `Input "${i.input}"`, ctx));
    }
  }
  return errors;
}
