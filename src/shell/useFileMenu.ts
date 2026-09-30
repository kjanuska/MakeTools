// The right-click menu of a file in the file list, for every module:
// Duplicate, Rename…, Delete…. Every write backs up first (rename, delete) or
// refuses to overwrite (duplicate). A file with unsaved changes can't be
// changed until it's saved or its changes are discarded.
import { useState } from "react";
import type { MenuItem } from "../components/ContextMenu";
import { confirmAction, showMessage } from "../lib/dialogs";
import { readText, type FileEntry } from "../lib/fs";
import { TASK_COL } from "../lib/formats/tasks";
import { isRecord } from "../lib/table/ops";
import { copyName, fileNameFor, groupNameError, groupNameOf } from "../lib/table/fileNames";
import { copyTableFile, deleteTableFile, renameTableFile } from "../lib/table/fileOps";
import type { TaskStore } from "../modules/tasks/store";
import type { Renaming } from "./FileList";

/** What the menu needs to know about one module's files. */
export interface FileMenuConfig {
  /** e.g. "proxy file". */
  label: string;
  /** With the dot, e.g. ".txt". */
  ext: string;
  /** Files kept in memory with unsaved changes (none for modules that save right away). */
  store?: { get(path: string): { dirty: boolean } | undefined; forget(path: string): void };
  /** A short description of the saved file, e.g. "2 proxies". */
  describe: (text: string) => string;
  /** The task column that refers to these files by name, and what it's called. */
  usedBy?: { column: number; as: string };
}

/** How many task rows, in how many task files, have `value` in `column`. */
export function taskUsage(tasks: TaskStore, column: number, value: string): { rows: number; files: number } {
  let rows = 0;
  let files = 0;
  for (const e of tasks.all()) {
    const n = e.doc.rows.filter((r) => isRecord(r) && r.values[column] === value).length;
    rows += n;
    if (n) files++;
  }
  return { rows, files };
}

export const TASK_COLUMNS = {
  profileGroup: { column: TASK_COL.profileGroup, as: "profile group" },
  proxyGroup: { column: TASK_COL.proxyGroup, as: "proxy group" },
  accountGroup: { column: TASK_COL.accountGroup, as: "account group" },
};

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

interface Options {
  config: FileMenuConfig;
  /** The module's folder. */
  dir: string;
  files: FileEntry[] | null;
  tasks: TaskStore;
  selectedPath: string | null;
  /** The open file was renamed (to this entry) or deleted (null). */
  onSelectedChanged: (file: FileEntry | null) => void;
  onFilesChanged: () => void;
}

export function useFileMenu(o: Options) {
  const [renaming, setRenaming] = useState<{ file: FileEntry; value: string } | null>(null);
  const { label, ext, store, usedBy } = o.config;
  const names = (o.files ?? []).map((f) => f.name);

  async function run(what: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (e) {
      await showMessage(`${what} failed: ${e}`, what);
      return false;
    } finally {
      o.onFilesChanged();
    }
  }

  function usage(name: string, consequence: string): string {
    if (!usedBy) return "";
    const { rows, files } = taskUsage(o.tasks, usedBy.column, name);
    if (rows === 0) return "";
    const t = `${plural(rows, "task", "tasks")} in ${plural(files, "task file", "task files")}`;
    return `${t} ${rows === 1 ? "uses" : "use"} "${name}" as the ${usedBy.as}. ${consequence}\n\n`;
  }

  async function duplicate(file: FileEntry) {
    const name = copyName(groupNameOf(file.name, ext), names, ext);
    await run("Duplicate", () => copyTableFile(file, o.dir, name, ext));
  }

  async function rename(file: FileEntry, name: string) {
    const from = groupNameOf(file.name, ext);
    const warning = usage(from, "They aren't updated automatically, so they'll show an error until changed.");
    const ok = await confirmAction(`Rename ${label} ${from} to ${name}?\n\n${warning}The file is backed up first.`, `Rename ${label}`);
    if (!ok) return;
    let path = "";
    const done = await run("Rename", async () => {
      path = await renameTableFile(store ?? { forget: () => {} }, file, o.dir, name, ext);
    });
    if (done && o.selectedPath === file.path) o.onSelectedChanged({ ...file, name: fileNameFor(name, ext), path });
  }

  async function remove(file: FileEntry) {
    const name = groupNameOf(file.name, ext);
    let size = "";
    try {
      size = ` (${o.config.describe((await readText(file.path)).text)})`;
    } catch {
      // Unreadable: delete can still go ahead.
    }
    const warning = usage(name, "They'll show an error.");
    const ok = await confirmAction(
      `Delete ${label} ${name}${size}?\n\n${warning}It's backed up first, and the backup is kept for 7 days.`,
      `Delete ${label}`,
    );
    if (!ok) return;
    const done = await run("Delete", () => deleteTableFile(store ?? { forget: () => {} }, file));
    if (done && o.selectedPath === file.path) o.onSelectedChanged(null);
  }

  function menuFor(file: FileEntry): { items: MenuItem[]; note?: string } {
    const locked = store?.get(file.path)?.dirty ? "Save or discard its changes first." : undefined;
    return {
      note: locked,
      items: [
        { label: "Duplicate", disabled: !!locked, onSelect: () => void duplicate(file) },
        { label: "Rename…", disabled: !!locked, onSelect: () => setRenaming({ file, value: groupNameOf(file.name, ext) }) },
        { label: "Delete…", danger: true, disabled: !!locked, onSelect: () => void remove(file) },
      ],
    };
  }

  let rename_: Renaming | null = null;
  if (renaming) {
    const { file, value } = renaming;
    const unchanged = value === groupNameOf(file.name, ext);
    const error = unchanged ? null : groupNameError(value, names, file.name, ext);
    rename_ = {
      path: file.path,
      value,
      error,
      onChange: (v) => setRenaming({ file, value: v }),
      onCancel: () => setRenaming(null),
      onSubmit: () => {
        if (error) return;
        // Closed before the confirm dialog takes focus (which would cancel it).
        setRenaming(null);
        if (!unchanged) void rename(file, value);
      },
    };
  }

  return { menuFor, renaming: rename_, cancelRename: () => setRenaming(null) };
}
