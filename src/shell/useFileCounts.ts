// Counts shown next to each file in the file list (profiles, tasks, proxies,
// accounts), instead of the file size.
import { useEffect, useRef, useState } from "react";
import { readText, type FileEntry } from "../lib/fs";

/** A count in the file list: the number, and what it counts for the tooltip. */
export interface FileCount {
  value: string;
  title: string;
}

const fileKey = (f: FileEntry) => `${f.size}|${f.modifiedMs}`;

/**
 * Counts each file's contents as saved on disk. A file is read again only
 * when its size or modified time changes. Files are only read while `enabled`
 * (e.g. while their module is showing).
 */
export function useDiskCounts(
  files: FileEntry[] | null,
  count: (text: string) => number,
  enabled = true,
): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, { key: string; n: number }>>(new Map());
  const countRef = useRef(count);
  countRef.current = count;
  // Reads already started, by path, so a re-render doesn't read again.
  const started = useRef(new Map<string, string>());

  useEffect(() => {
    if (!files || !enabled) return;
    for (const f of files) {
      const key = fileKey(f);
      if (started.current.get(f.path) === key) continue;
      started.current.set(f.path, key);
      readText(f.path)
        .then(({ text }) => {
          if (started.current.get(f.path) !== key) return; // changed again since
          const n = countRef.current(text);
          setCounts((m) => new Map(m).set(f.path, { key, n }));
        })
        .catch(() => {
          // Unreadable: no count. Tried again when the folder is listed again.
          if (started.current.get(f.path) === key) started.current.delete(f.path);
        });
    }
  }, [files, enabled]);

  const result = new Map<string, number>();
  for (const f of files ?? []) {
    const c = counts.get(f.path);
    if (c && c.key === fileKey(f)) result.set(f.path, c.n);
  }
  return result;
}

/**
 * Remembers the last count per path, so text in memory (which may be large)
 * is only counted again when it changes.
 */
export function useTextCounter(count: (text: string) => number): (path: string, text: string) => number {
  const cache = useRef(new Map<string, { text: string; n: number }>());
  return (path, text) => {
    const c = cache.current.get(path);
    if (c && c.text === text) return c.n;
    const n = count(text);
    cache.current.set(path, { text, n });
    return n;
  };
}
