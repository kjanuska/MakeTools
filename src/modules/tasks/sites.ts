// The global site list: seeding it from the task files, and renaming a site
// in every task file.
import { TASK_COL } from "../../lib/formats/tasks";
import { isRecord, updateRows } from "../../lib/table/ops";
import type { ConfirmOverwrite, DocEntry } from "../../lib/table/store";
import type { TaskStore } from "./store";

const sitesIn = (e: DocEntry) => e.doc.rows.filter(isRecord).map((r) => r.values[TASK_COL.site]);

/** Distinct non-empty sites used in the loaded task files, sorted. */
export function usedSites(store: TaskStore): string[] {
  const all = new Set(store.all().flatMap(sitesIn));
  all.delete("");
  return [...all].sort();
}

/** How many task rows, in how many files, use a site. */
export function siteUsage(store: TaskStore, site: string): { rows: number; files: number } {
  let rows = 0;
  let files = 0;
  for (const e of store.all()) {
    const n = sitesIn(e).filter((s) => s === site).length;
    rows += n;
    if (n) files++;
  }
  return { rows, files };
}

export interface SiteRenameResult {
  /** Files changed and saved. */
  saved: string[];
  /** Files changed but left unsaved: they had your own unsaved edits, or couldn't be saved (e.g. errors). */
  unsaved: { file: string; reason: string }[];
}

/**
 * Renames a site in every task file. A file without unsaved edits of its own
 * is saved right away (backed up first); one with unsaved edits gets the
 * rename added to them, so nothing of the user's is saved without them.
 */
export async function renameSiteEverywhere(
  store: TaskStore,
  from: string,
  to: string,
  confirmOverwrite: ConfirmOverwrite,
): Promise<SiteRenameResult> {
  const result: SiteRenameResult = { saved: [], unsaved: [] };
  const col = TASK_COL.site;
  for (const e of store.all()) {
    const ids = e.doc.rows.filter((r) => isRecord(r) && r.values[col] === from).map((r) => r.id);
    if (ids.length === 0 || !e.doc.headerOk) continue;
    const hadEdits = e.doc !== e.base;
    store.update(e.file.path, (d) =>
      updateRows(d, ids, (values) => {
        const next = [...values];
        next[col] = to;
        return next;
      }),
    );
    if (hadEdits) {
      result.unsaved.push({ file: e.file.name, reason: "it has other unsaved changes" });
      continue;
    }
    const r = await store.save(e.file.path, confirmOverwrite);
    if (r.ok) result.saved.push(e.file.name);
    else {
      const reason = r.reason === "invalid" ? "it has errors" : r.reason === "cancelled" ? "not overwritten" : (r.error ?? r.reason);
      result.unsaved.push({ file: e.file.name, reason });
    }
  }
  return result;
}
