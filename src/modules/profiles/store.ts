// Keeps every opened/scanned profile file in memory, with its unsaved edits,
// so the user can move between files and save later (or all at once).
import { useSyncExternalStore } from "react";
import { PROFILE_FIELDS, parseProfiles, serializeProfiles, type ProfileDoc, type ProfileField } from "../../lib/formats/profiles";
import { readText, saveText, type FileEntry, type TextFile } from "../../lib/fs";
import { countErrors, validateRecords, type ValidationErrors } from "../../lib/rules/engine";
import { PROFILE_RULES } from "../../lib/rules/profiles";
import { deleteRows, importRows, isProfile, nameClashes, selectedValues } from "./ops";

export interface DocEntry {
  file: FileEntry;
  /** The file as last read from (or written to) disk. */
  loaded: TextFile;
  doc: ProfileDoc;
  serialized: string;
  dirty: boolean;
  errors: ValidationErrors<ProfileField>;
  /** Validation errors; 0 for read-only files (wrong header). */
  errorCount: number;
}

/** Asked when a file changed on disk since it was read; true = overwrite. */
export type ConfirmOverwrite = (file: FileEntry) => Promise<boolean>;

export type SaveResult =
  | { ok: true; verified: boolean }
  | { ok: false; reason: "cancelled" | "invalid" | "readonly" | "error"; error?: string };

export type TransferResult = { ok: true; count: number } | { ok: false; error: string };

export interface SaveAllResult {
  saved: DocEntry[];
  /** Not saved because they have validation errors. */
  invalid: DocEntry[];
  failed: { entry: DocEntry; error: string }[];
  cancelled: DocEntry[];
}

function makeEntry(file: FileEntry, loaded: TextFile, doc: ProfileDoc): DocEntry {
  const serialized = serializeProfiles(doc);
  const errors = doc.headerOk
    ? validateRecords(PROFILE_FIELDS, PROFILE_RULES, doc.rows.filter(isProfile))
    : new Map();
  return {
    file,
    loaded,
    doc,
    serialized,
    dirty: serialized !== loaded.text,
    errors,
    errorCount: countErrors(errors),
  };
}

export class ProfileStore {
  private entries = new Map<string, DocEntry>();
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

  get(path: string): DocEntry | undefined {
    return this.entries.get(path);
  }

  loadError(path: string): string | undefined {
    return this.loadErrors.get(path);
  }

  /** Files with unsaved changes, sorted by path. */
  dirtyEntries(): DocEntry[] {
    return [...this.entries.values()].filter((e) => e.dirty).sort((a, b) => a.file.path.localeCompare(b.file.path));
  }

  /**
   * Reads a file from disk. A file with unsaved changes is left alone unless
   * `force` is set (which discards them).
   */
  async load(file: FileEntry, force = false): Promise<void> {
    const existing = this.entries.get(file.path);
    if (existing?.dirty && !force) return;
    try {
      const loaded = await readText(file.path);
      const current = this.entries.get(file.path);
      if (current?.dirty && !force) return; // edited while reading
      // Unchanged on disk: keep the parsed rows (and their ids, so selections survive).
      if (current && !force && current.loaded.text === loaded.text && !this.loadErrors.has(file.path)) return;
      this.entries.set(file.path, makeEntry(file, loaded, parseProfiles(loaded.text)));
      this.loadErrors.delete(file.path);
    } catch (e) {
      if (!this.entries.get(file.path)?.dirty) this.entries.delete(file.path);
      this.loadErrors.set(file.path, String(e));
    }
    this.changed();
  }

  /** Re-reads every file without unsaved changes, e.g. when the file list loads. */
  async scan(files: readonly FileEntry[]): Promise<void> {
    await Promise.all(files.map((f) => this.load(f)));
  }

  update(path: string, fn: (doc: ProfileDoc) => ProfileDoc): void {
    const e = this.entries.get(path);
    if (!e || !e.doc.headerOk) return;
    const doc = fn(e.doc);
    if (doc === e.doc) return;
    this.entries.set(path, makeEntry(e.file, e.loaded, doc));
    this.changed();
  }

  /** Drops a file from memory, e.g. after it was renamed or deleted. */
  forget(path: string): void {
    this.entries.delete(path);
    this.loadErrors.delete(path);
    this.changed();
  }

  /**
   * Copies or moves the selected profile rows to the end of another group,
   * keeping their names. Refused if any name already exists in the target
   * or repeats within the selection. Both files are left with unsaved changes.
   */
  transfer(from: string, to: string, ids: readonly number[], mode: "copy" | "move"): TransferResult {
    const src = this.entries.get(from);
    const dst = this.entries.get(to);
    if (!src || !dst || from === to) return { ok: false, error: "Pick another group." };
    const readOnly = [src, dst].find((e) => !e.doc.headerOk);
    if (readOnly) return { ok: false, error: `${readOnly.file.name} is read-only (wrong header).` };
    const values = selectedValues(src.doc, ids);
    if (values.length === 0) return { ok: false, error: "Select profile rows first." };
    const clashes = nameClashes(dst.doc, values.map((v) => v[0]));
    if (clashes.length) {
      return { ok: false, error: `${dst.file.name} already has profiles named: ${clashes.join(", ")}. Rename them first.` };
    }
    this.entries.set(to, makeEntry(dst.file, dst.loaded, importRows(dst.doc, values)));
    if (mode === "move") {
      const moved = new Set(src.doc.rows.filter((r) => ids.includes(r.id) && isProfile(r)).map((r) => r.id));
      this.entries.set(from, makeEntry(src.file, src.loaded, deleteRows(src.doc, [...moved])));
    }
    this.changed();
    return { ok: true, count: values.length };
  }

  discard(path: string): void {
    const e = this.entries.get(path);
    if (!e || !e.dirty) return;
    this.entries.set(path, makeEntry(e.file, e.loaded, parseProfiles(e.loaded.text)));
    this.changed();
  }

  /**
   * Writes a file's edits. Re-reads it first and asks before overwriting a
   * version changed by another program; reads it back afterwards to verify.
   */
  async save(path: string, confirmOverwrite: ConfirmOverwrite): Promise<SaveResult> {
    const e = this.entries.get(path);
    if (!e) return { ok: false, reason: "error", error: "File isn't loaded." };
    if (!e.doc.headerOk) return { ok: false, reason: "readonly" };
    if (e.errorCount > 0) return { ok: false, reason: "invalid" };
    try {
      const onDisk = await readText(path);
      if (onDisk.text !== e.loaded.text && !(await confirmOverwrite(e.file))) {
        return { ok: false, reason: "cancelled" };
      }
      const text = e.serialized;
      await saveText(path, text);
      const after = await readText(path);
      // Keep edits made while saving; otherwise start fresh from disk.
      const latest = this.entries.get(path)!;
      const doc = latest.doc === e.doc ? parseProfiles(after.text) : latest.doc;
      this.entries.set(path, makeEntry(e.file, after, doc));
      this.changed();
      return { ok: true, verified: after.text === text };
    } catch (err) {
      return { ok: false, reason: "error", error: String(err) };
    }
  }

  /** Saves every file with unsaved changes that has no errors. */
  async saveAll(confirmOverwrite: ConfirmOverwrite): Promise<SaveAllResult> {
    const result: SaveAllResult = { saved: [], invalid: [], failed: [], cancelled: [] };
    for (const e of this.dirtyEntries()) {
      if (e.errorCount > 0 || !e.doc.headerOk) {
        result.invalid.push(e);
        continue;
      }
      const r = await this.save(e.file.path, confirmOverwrite);
      if (r.ok && r.verified) result.saved.push(e);
      else if (r.ok) result.failed.push({ entry: e, error: "the file on disk doesn't match what was written" });
      else if (r.reason === "cancelled") result.cancelled.push(e);
      else result.failed.push({ entry: e, error: r.error ?? r.reason });
    }
    return result;
  }
}

/** Re-renders the caller whenever the store changes. */
export function useStoreVersion(store: ProfileStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}
