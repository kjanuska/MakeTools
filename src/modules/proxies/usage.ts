// Which tasks use a proxy file: task rows refer to it by name (its "proxy
// group", the file name without .txt) in their proxyGroup column.
import { TASK_COL } from "../../lib/formats/tasks";
import { isRecord } from "../../lib/table/ops";
import type { TaskStore } from "../tasks/store";

/** How many task rows, in how many task files, use a proxy group. */
export function proxyGroupUsage(tasks: TaskStore, group: string): { rows: number; files: number } {
  let rows = 0;
  let files = 0;
  for (const e of tasks.all()) {
    const n = e.doc.rows.filter((r) => isRecord(r) && r.values[TASK_COL.proxyGroup] === group).length;
    rows += n;
    if (n) files++;
  }
  return { rows, files };
}

/** A sentence about the tasks using a proxy group, or "" if none do. */
export function usageSentence(tasks: TaskStore, group: string, consequence: string): string {
  const { rows, files } = proxyGroupUsage(tasks, group);
  if (rows === 0) return "";
  const t = `${rows} ${rows === 1 ? "task" : "tasks"} in ${files} task ${files === 1 ? "file" : "files"}`;
  return `${t} ${rows === 1 ? "uses" : "use"} "${group}" as the proxy group. ${consequence}`;
}
