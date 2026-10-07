import { recordCount } from "../../components/table/TableOverview";
import type { CellType, TableUI } from "../../components/table/types";
import type { DataRow } from "../../lib/formats/csvTable";
import { TASK_COL as C, TASK_FIELDS, TASK_HEADER, cleanInput } from "../../lib/formats/tasks";
import { isRecord } from "../../lib/table/ops";
import type { DocEntry } from "../../lib/table/store";
import { ALL_PROFILES } from "../../lib/rules/tasks";
import { taskCount, TASK_SCHEMA, type TaskContext } from "./schema";

/** Contents of a new, empty task file: the header, LF, like the existing files. */
export const NEW_TASK_FILE_TEXT = `${TASK_HEADER}\n`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sorted = (items: Iterable<string>) => [...items].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** Total tasks of some rows; `unknown` counts rows whose count isn't known. */
export function totalTasks(rows: readonly DataRow[], ctx: TaskContext) {
  let tasks = 0;
  let unknown = 0;
  for (const r of rows) {
    const n = taskCount(r.values, ctx);
    if (n === null) unknown++;
    else tasks += n;
  }
  return { tasks, unknown };
}

const tasksText = ({ tasks, unknown }: { tasks: number; unknown: number }) =>
  `${plural(tasks, "task", "tasks")}${unknown ? ` (+${unknown} unknown)` : ""}`;

export const entryRows = (e: DocEntry | undefined) => (e ? e.doc.rows.filter(isRecord) : []);

/** The last totals worked out per file version, so the file list and overview don't recount every render. */
const totalsCache = new WeakMap<object, { ctx: TaskContext; totals: { tasks: number; unknown: number } }>();

/** Total tasks of a file, as totalTasks gives, reused while the file's rows and the task context are unchanged. */
export function entryTotals(e: DocEntry, ctx: TaskContext) {
  const hit = totalsCache.get(e.doc);
  if (hit && hit.ctx === ctx) return hit.totals;
  const totals = totalTasks(entryRows(e), ctx);
  totalsCache.set(e.doc, { ctx, totals });
  return totals;
}

/**
 * The tasks UI. `addSite` saves a site typed in "Add site…" to the global list.
 * Fields without a dropdown are plain text boxes showing the raw value.
 */
export function makeTaskUI(addSite: (site: string) => void): TableUI<TaskContext> {
  const cells: Record<number, CellType<TaskContext>> = {
    [C.profileGroup]: { kind: "select", options: (_, ctx) => sorted(ctx.profileGroups.keys()) },
    [C.profileName]: {
      kind: "select",
      options: (values, ctx) => [ALL_PROFILES, ...(ctx.profileGroups.get(values[C.profileGroup]) ?? [])],
      disabled: (values) => values[C.profileGroup] === "",
    },
    [C.proxyGroup]: { kind: "select", options: (_, ctx) => sorted(ctx.proxyGroups) },
    [C.accountGroup]: { kind: "select", options: (_, ctx) => sorted(ctx.accountGroups) },
    [C.site]: {
      kind: "select",
      options: (_, ctx) => ctx.sites,
      add: { label: "Add site…", prompt: "New site", onAdd: addSite },
    },
  };
  const text: CellType<TaskContext> = { kind: "text" };

  return {
    schema: TASK_SCHEMA,
    cell: (col) => cells[col] ?? text,
    optional: () => false,
    applyEdit(values, col, value, ctx) {
      if (values[col] === value) return values as string[];
      const next = [...values];
      next[col] = value;
      // A new profile group: keep the profileName only if that group has it.
      if (col === C.profileGroup) {
        const names = ctx.profileGroups.get(value) ?? [];
        const name = next[C.profileName];
        if (value !== "" && (name === "" || (name !== ALL_PROFILES && !names.includes(name)))) {
          next[C.profileName] = ALL_PROFILES;
        }
      }
      return next;
    },
    cleanOnBlur: (col, value) => (col === C.input ? cleanInput(value) : value),
    extraColumns: [
      {
        header: "tasks",
        after: TASK_FIELDS.length - 1,
        className: "num",
        render: (values, ctx) => taskCount(values, ctx) ?? "?",
      },
    ],
    summary: (rows, ctx) => `${plural(rows.length, "row", "rows")} · ${tasksText(totalTasks(rows, ctx))}`,
    firstEditCol: C.profileGroup,
    bulkDefaultCol: C.site,
    overview: {
      heading: "Task files",
      stats: [
        { header: "Rows", value: (e) => recordCount(e) },
        { header: "Tasks", value: (e, ctx) => tasksText(entryTotals(e, ctx)) },
      ],
      totals: (entries, ctx) => {
        const rows = entries.flatMap(entryRows);
        return (
          <>
            <strong>{entries.length}</strong> {entries.length === 1 ? "task file" : "task files"} ·{" "}
            <strong>{rows.length}</strong> {rows.length === 1 ? "row" : "rows"} · <strong>{tasksText(totalTasks(rows, ctx))}</strong>{" "}
            in total
          </>
        );
      },
      describe: (e) => plural(recordCount(e), "row", "rows"),
      newFileText: NEW_TASK_FILE_TEXT,
      search: {
        title: "Find a task",
        label: "Find in any field",
        placeholder: "any field contains…",
        headers: ["Match", "Task file", "Row", "Field"],
        find(values, q) {
          const i = values.findIndex((v) => v.toLowerCase().includes(q));
          return i < 0 ? null : { match: values[i], detail: TASK_FIELDS[i] };
        },
      },
    },
  };
}
