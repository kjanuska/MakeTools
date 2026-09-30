// The right-click menu of a proxy file in the file list: Duplicate, Rename…,
// Delete…. Every write backs up first (rename, delete) or refuses to overwrite
// (duplicate). A file with unsaved changes can't be changed until it's saved
// or its changes are discarded.
import { useState } from "react";
import type { MenuItem } from "../../components/ContextMenu";
import { confirmAction, showMessage } from "../../lib/dialogs";
import { countProxies, parseProxies } from "../../lib/formats/proxies";
import { readText, type FileEntry } from "../../lib/fs";
import { copyName, fileNameFor, groupNameError, groupNameOf } from "../../lib/table/fileNames";
import { copyTableFile, deleteTableFile, renameTableFile } from "../../lib/table/fileOps";
import type { Renaming } from "../../shell/FileList";
import type { TaskStore } from "../tasks/store";
import type { ProxyStore } from "./store";
import { usageSentence } from "./usage";

const EXT = ".txt";

interface Options {
  /** The proxy folder. */
  dir: string;
  files: FileEntry[] | null;
  proxies: ProxyStore;
  tasks: TaskStore;
  selectedPath: string | null;
  /** The open file was renamed (to this entry) or deleted (null). */
  onSelectedChanged: (file: FileEntry | null) => void;
  onFilesChanged: () => void;
}

export function useProxyFileMenu(o: Options) {
  const [renaming, setRenaming] = useState<{ file: FileEntry; value: string } | null>(null);
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

  async function duplicate(file: FileEntry) {
    const name = copyName(groupNameOf(file.name, EXT), names, EXT);
    await run("Duplicate", () => copyTableFile(file, o.dir, name, EXT));
  }

  async function rename(file: FileEntry, name: string) {
    const from = groupNameOf(file.name, EXT);
    const usage = usageSentence(o.tasks, from, "They aren't updated automatically, so they'll show an error until changed.");
    const ok = await confirmAction(
      `Rename proxy file ${from} to ${name}?\n\n${usage ? `${usage}\n\n` : ""}The file is backed up first.`,
      "Rename proxy file",
    );
    if (!ok) return;
    let path = "";
    const done = await run("Rename", async () => {
      path = await renameTableFile(o.proxies, file, o.dir, name, EXT);
    });
    if (done && o.selectedPath === file.path) o.onSelectedChanged({ ...file, name: fileNameFor(name, EXT), path });
  }

  async function remove(file: FileEntry) {
    const name = groupNameOf(file.name, EXT);
    let size = "";
    try {
      const n = countProxies(parseProxies((await readText(file.path)).text));
      size = ` (${n.toLocaleString("en-US")} ${n === 1 ? "proxy" : "proxies"})`;
    } catch {
      // Unreadable: delete can still go ahead.
    }
    const usage = usageSentence(o.tasks, name, "They'll show an error.");
    const ok = await confirmAction(
      `Delete proxy file ${name}${size}?\n\n${usage ? `${usage}\n\n` : ""}It's backed up first, and the backup is kept for 7 days.`,
      "Delete proxy file",
    );
    if (!ok) return;
    const done = await run("Delete", () => deleteTableFile(o.proxies, file));
    if (done && o.selectedPath === file.path) o.onSelectedChanged(null);
  }

  function menuFor(file: FileEntry): { items: MenuItem[]; note?: string } {
    const locked = o.proxies.get(file.path)?.dirty ? "Save or discard its changes first." : undefined;
    return {
      note: locked,
      items: [
        { label: "Duplicate", disabled: !!locked, onSelect: () => void duplicate(file) },
        {
          label: "Rename…",
          disabled: !!locked,
          onSelect: () => setRenaming({ file, value: groupNameOf(file.name, EXT) }),
        },
        { label: "Delete…", danger: true, disabled: !!locked, onSelect: () => void remove(file) },
      ],
    };
  }

  let rename_: Renaming | null = null;
  if (renaming) {
    const { file, value } = renaming;
    const unchanged = value === groupNameOf(file.name, EXT);
    const error = unchanged ? null : groupNameError(value, names, file.name, EXT);
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
