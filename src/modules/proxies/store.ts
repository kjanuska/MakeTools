// Keeps opened proxy files in memory with their unsaved edits (paste, shuffle,
// a staged backup), so they can be saved later or with Save all. A file's text
// is kept exactly as read until it's edited, so an unedited file is never
// rewritten.
import { readText, saveText, type FileEntry, type TextFile } from "../../lib/fs";
import type { ConfirmOverwrite, SaveResult } from "../../lib/table/store";

export interface ProxyEntry {
  file: FileEntry;
  /** The file as last read from (or written to) disk. */
  loaded: TextFile;
  /** Current contents, with any unsaved edits. */
  text: string;
  dirty: boolean;
}

export interface ProxySaveAllResult {
  saved: ProxyEntry[];
  failed: { entry: ProxyEntry; error: string }[];
  cancelled: ProxyEntry[];
}

export class ProxyStore {
  private entries = new Map<string, ProxyEntry>();
  private loadErrors = new Map<string, string>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private entry(file: FileEntry, loaded: TextFile, text: string): ProxyEntry {
    return { file, loaded, text, dirty: text !== loaded.text };
  }

  get(path: string): ProxyEntry | undefined {
    return this.entries.get(path);
  }

  loadError(path: string): string | undefined {
    return this.loadErrors.get(path);
  }

  /** Files with unsaved changes, sorted by path. */
  dirtyEntries(): ProxyEntry[] {
    return [...this.entries.values()].filter((e) => e.dirty).sort((a, b) => a.file.path.localeCompare(b.file.path));
  }

  /** Reads a file from disk. A file with unsaved changes is left alone. */
  async load(file: FileEntry): Promise<void> {
    if (this.entries.get(file.path)?.dirty) return;
    try {
      const loaded = await readText(file.path);
      const current = this.entries.get(file.path);
      if (current?.dirty) return; // edited while reading
      if (current && current.loaded.text === loaded.text && !this.loadErrors.has(file.path)) return;
      this.entries.set(file.path, this.entry(file, loaded, loaded.text));
      this.loadErrors.delete(file.path);
    } catch (e) {
      this.entries.delete(file.path);
      this.loadErrors.set(file.path, String(e));
    }
    this.changed();
  }

  /** Replaces a file's contents as unsaved changes (e.g. `text => shuffleProxies(text)`). */
  update(path: string, fn: (text: string) => string): void {
    const e = this.entries.get(path);
    if (!e) return;
    const text = fn(e.text);
    if (text === e.text) return;
    this.entries.set(path, this.entry(e.file, e.loaded, text));
    this.changed();
  }

  /** Stages other contents (e.g. a backup) as unsaved changes. */
  stage(path: string, text: string): { ok: true } | { ok: false; error: string } {
    if (!this.entries.has(path)) return { ok: false, error: "File isn't loaded." };
    this.update(path, () => text);
    return { ok: true };
  }

  discard(path: string): void {
    this.update(path, () => this.entries.get(path)!.loaded.text);
  }

  /**
   * Writes a file's edits. Re-reads it first and asks before overwriting a
   * version changed by another program; reads it back afterwards to verify.
   */
  async save(path: string, confirmOverwrite: ConfirmOverwrite): Promise<SaveResult> {
    const e = this.entries.get(path);
    if (!e) return { ok: false, reason: "error", error: "File isn't loaded." };
    try {
      const onDisk = await readText(path);
      if (onDisk.text !== e.loaded.text && !(await confirmOverwrite(e.file))) {
        return { ok: false, reason: "cancelled" };
      }
      await saveText(path, e.text);
      const after = await readText(path);
      const verified = after.text === e.text;
      // Edits made while saving stay as unsaved changes on top of what was written.
      const latest = this.entries.get(path)!;
      this.entries.set(path, this.entry(e.file, after, verified ? latest.text : after.text));
      this.changed();
      return { ok: true, verified };
    } catch (err) {
      return { ok: false, reason: "error", error: String(err) };
    }
  }

  /** Saves every file with unsaved changes. */
  async saveAll(confirmOverwrite: ConfirmOverwrite): Promise<ProxySaveAllResult> {
    const result: ProxySaveAllResult = { saved: [], failed: [], cancelled: [] };
    for (const e of this.dirtyEntries()) {
      const r = await this.save(e.file.path, confirmOverwrite);
      if (r.ok && r.verified) result.saved.push(e);
      else if (r.ok) result.failed.push({ entry: e, error: "the file on disk doesn't match what was written" });
      else if (r.reason === "cancelled") result.cancelled.push(e);
      else result.failed.push({ entry: e, error: r.error ?? r.reason });
    }
    return result;
  }
}
