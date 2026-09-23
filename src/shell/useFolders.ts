import { useEffect, useState } from "react";
import { listFiles, type FileEntry } from "../lib/fs";
import { MODULES, type ModuleId } from "../lib/modules";
import { joinPath } from "../lib/paths";

export interface FolderList {
  /** Null while loading or if the folder couldn't be listed. */
  files: FileEntry[] | null;
  error: string | null;
  /** True once listing finished (with files or an error). */
  done: boolean;
}

const LOADING: FolderList = { files: null, error: null, done: false };

export type FolderLists = Record<ModuleId, FolderList>;

const initial = (): FolderLists =>
  Object.fromEntries(MODULES.map((m) => [m.id, LOADING])) as FolderLists;

/** Lists every module's folder; again whenever `version` changes. */
export function useFolders(root: string | null | undefined, version: number): FolderLists {
  const [lists, setLists] = useState<FolderLists>(initial);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    for (const m of MODULES) {
      setLists((l) => ({ ...l, [m.id]: { ...l[m.id], error: null } }));
      listFiles(joinPath(root, m.folder), m.extension)
        .then((files) => {
          if (!cancelled) setLists((l) => ({ ...l, [m.id]: { files, error: null, done: true } }));
        })
        .catch((e) => {
          if (!cancelled) setLists((l) => ({ ...l, [m.id]: { files: null, error: String(e), done: true } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [root, version]);

  // A new folder starts from scratch.
  useEffect(() => setLists(initial()), [root]);

  return lists;
}
