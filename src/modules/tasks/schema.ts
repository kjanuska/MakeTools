import type { DataRow } from "../../lib/formats/csvTable";
import { TASK_COL, TASK_FIELDS, TASK_FORMAT, cleanInputs, joinBrokenLines } from "../../lib/formats/tasks";
import { validateRecords, type ValidationErrors } from "../../lib/rules/engine";
import { ALL_PROFILES, TASK_RULES, splitMode } from "../../lib/rules/tasks";
import type { TableSchema } from "../../lib/table/schema";

/** What task validation needs to know about the rest of the Makebot folder. */
export interface TaskContext {
  /** False until the other folders and the site list are loaded; existence checks wait until then. */
  ready: boolean;
  /** Profile group name → its profileNames (including unsaved edits). */
  profileGroups: ReadonlyMap<string, readonly string[]>;
  proxyGroups: ReadonlySet<string>;
  accountGroups: ReadonlySet<string>;
  sites: readonly string[];
}

export const EMPTY_TASK_CONTEXT: TaskContext = {
  ready: false,
  profileGroups: new Map(),
  proxyGroups: new Set(),
  accountGroups: new Set(),
  sites: [],
};

const C = TASK_COL;

/** Checks that need other files: groups, profiles, sites, mode parts. */
export function linkError(field: string, values: readonly string[], ctx: TaskContext): string | null {
  const v = values[TASK_FIELDS.indexOf(field as (typeof TASK_FIELDS)[number])];
  switch (field) {
    case "profileGroup":
      return ctx.ready && !ctx.profileGroups.has(v) ? "isn't an existing profile group" : null;
    case "profileName": {
      const group = values[C.profileGroup];
      if (group === "") return v === "" ? null : "is set without a profileGroup";
      if (v === "") return "is required";
      const names = ctx.profileGroups.get(group);
      if (!ctx.ready || !names || v === ALL_PROFILES) return null;
      return names.includes(v) ? null : `isn't a profile in ${group}`;
    }
    case "proxyGroup":
      return ctx.ready && !ctx.proxyGroups.has(v) ? "isn't an existing proxy group" : null;
    case "accountGroup":
      return ctx.ready && !ctx.accountGroups.has(v) ? "isn't an existing account group" : null;
    case "site":
      return ctx.ready && !ctx.sites.includes(v) ? "isn't in the site list" : null;
    case "mode":
      return splitMode(v) ? null : "has parts that aren't known modes";
    default:
      return null;
  }
}

function validateTasks(rows: readonly DataRow[], ctx: TaskContext): ValidationErrors<string> {
  const errors: ValidationErrors<string> = validateRecords(TASK_FIELDS, TASK_RULES, rows);
  for (const r of rows) {
    const e = errors.get(r.id) ?? {};
    for (const f of TASK_FIELDS) {
      if (e[f]) continue;
      if (f !== "profileName" && r.values[C[f]] === "") continue;
      const msg = linkError(f, r.values, ctx);
      if (msg) e[f] = msg;
    }
    if (Object.keys(e).length) errors.set(r.id, e);
  }
  return errors;
}

/** How many tasks a row runs: the group's profile count for ALL, else 1. Null if unknown. */
export function taskCount(values: readonly string[], ctx: TaskContext): number | null {
  const name = values[C.profileName];
  if (name !== ALL_PROFILES) return name === "" ? null : 1;
  return ctx.profileGroups.get(values[C.profileGroup])?.length ?? null;
}

export const TASK_SCHEMA: TableSchema<TaskContext> = {
  format: TASK_FORMAT,
  labels: { item: "task", items: "tasks", file: "task file", files: "task files" },
  nameCol: null,
  /** The most common values in the current files; everything else starts empty. */
  newRow() {
    const values = TASK_FIELDS.map(() => "");
    values[C.size] = "random";
    values[C.color] = "random";
    values[C.cartQuantity] = "1";
    values[C.delay] = "3000";
    return values;
  },
  validate: validateTasks,
  fixOnLoad: (doc) => cleanInputs(joinBrokenLines(doc)),
  cleanBeforeSave: cleanInputs,
};
