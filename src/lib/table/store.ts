// Keeps every opened/scanned file of one module in memory, with its unsaved
// edits, so the user can move between files and save later (or all at once).
import { useSyncExternalStore } from "react";
import { parseTable, serializeTable, type TableDoc } from "../formats/csvTable";
import { readText, saveText, type FileEntry, type TextFile } from "../fs";
import { countErrors, type ValidationErrors } from "../rules/engine";
import { deleteRows, importRows, isRecord, nameClashes, selectedValues } from "./ops";
import type { TableSchema } from "./schema";

export interface DocEntry {
  file: FileEntry;
  /** The file as last read from (or written to) disk. */
  loaded: TextFile;
  /** `loaded` parsed (plus automatic fixes). Edits keep row ids, so `base` tells what each row was. */
  base: TableDoc;
  /** Saved values of each record in `base`, by row id. */
  original: ReadonlyMap<number, readonly string[]>;
  doc: TableDoc;
  serialized: string;
  dirty: boolean;
  errors: ValidationErrors<string>;
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

function originalValues(base: TableDoc): Map<number, readonly string[]> {
  return new Map(base.rows.filter(isRecord).map((r) => [r.id, r.values]));
}

export class TableStore<Ctx = unknown> {
  private entries = new Map<string, DocEntry>();
  private loadErrors = new Map<string, string>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    readonly schema: TableSchema<Ctx>,
    private ctx: Ctx,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private makeEntry(
    file: FileEntry,
    loaded: TextFile,
    base: TableDoc,
    original: ReadonlyMap<number, readonly string[]>,
    doc: TableDoc,
  ): DocEntry {
    const serialized = serializeTable(this.schema.format, doc);
    const errors = doc.headerOk ? this.schema.validate(doc.rows.filter(isRecord), this.ctx) : new Map();
    return {
      file,
      loaded,
      base,
      original,
      doc,
      serialized,
      dirty: serialized !== loaded.text,
      errors,
      errorCount: countErrors(errors),
    };
  }

  /** A fresh entry whose base is `doc` itself (nothing changed yet). */
  private freshEntry(file: FileEntry, loaded: TextFile, doc: TableDoc): DocEntry {
    return this.makeEntry(file, loaded, doc, originalValues(doc), doc);
  }

  private withDoc(e: DocEntry, doc: TableDoc): DocEntry {
    return this.makeEntry(e.file, e.loaded, e.base, e.original, doc);
  }

  private parse(text: string): TableDoc {
    const doc = parseTable(this.schema.format, text);
    return doc.headerOk && this.schema.fixOnLoad ? this.schema.fixOnLoad(doc) : doc;
  }

  getContext(): Ctx {
    return this.ctx;
  }

  /** New validation context (e.g. other files changed): re-checks every file. */
  setContext(ctx: Ctx): void {
    this.ctx = ctx;
    for (const [path, e] of this.entries) this.entries.set(path, this.withDoc(e, e.doc));
    this.changed();
  }

  get(path: string): DocEntry | undefined {
    return this.entries.get(path);
  }

  all(): DocEntry[] {
    return [...this.entries.values()];
  }

  loadError(path: string): string | undefined {
    return this.loadErrors.get(path);
  }

  /** Files with unsaved changes, sorted by path. */
  dirtyEntries(): DocEntry[] {
    return this.all()
      .filter((e) => e.dirty)
      .sort((a, b) => a.file.path.localeCompare(b.file.path));
  }

  /**
   * Reads a file from disk. A file with unsaved changes is left alone unless
   * `force` is set (which discards them).
   */
  async load(file: FileEntry, force = false): Promise<void> {
    const existing = this.entries.get(file.path);
    // Unsaved edits (not just automatic fixes): keep them.
    if (existing?.dirty && !force && !this.onlyAutoFixed(existing)) return;
    try {
      const loaded = await readText(file.path);
      const current = this.entries.get(file.path);
      if (current?.dirty && !force && !this.onlyAutoFixed(current)) return; // edited while reading
      // Unchanged on disk: keep the parsed rows (and their ids, so selections survive).
      if (current && !force && current.loaded.text === loaded.text && !this.loadErrors.has(file.path)) return;
      this.entries.set(file.path, this.freshEntry(file, loaded, this.parse(loaded.text)));
      this.loadErrors.delete(file.path);
    } catch (e) {
      if (!this.entries.get(file.path)?.dirty) this.entries.delete(file.path);
      this.loadErrors.set(file.path, String(e));
    }
    this.changed();
  }

  /** True if the only difference from disk is the automatic load fixes. */
  private onlyAutoFixed(e: DocEntry): boolean {
    return e.doc === e.base;
  }

  /** Re-reads every file without unsaved changes, e.g. when the file list loads. */
  async scan(files: readonly FileEntry[]): Promise<void> {
    await Promise.all(files.map((f) => this.load(f)));
  }

  update(path: string, fn: (doc: TableDoc) => TableDoc): void {
    const e = this.entries.get(path);
    if (!e || !e.doc.headerOk) return;
    const doc = fn(e.doc);
    if (doc === e.doc) return;
    this.entries.set(path, this.withDoc(e, doc));
    this.changed();
  }

  /**
   * Stages other contents (e.g. a backup) as unsaved changes; nothing is
   * written until saved. Rows are matched to the current file by position,
   * so changed cells show what they were.
   */
  stage(path: string, text: string): { ok: true } | { ok: false; error: string } {
    const e = this.entries.get(path);
    if (!e) return { ok: false, error: "File isn't loaded." };
    const staged = this.parse(text);
    if (!staged.headerOk) {
      return { ok: false, error: `That version doesn't have the ${this.schema.labels.item} header, so it can't be edited here.` };
    }
    const rows = staged.rows.map((r, i) => (i < e.base.rows.length ? { ...r, id: e.base.rows[i].id } : r));
    this.entries.set(path, this.withDoc(e, { ...staged, rows }));
    this.changed();
    return { ok: true };
  }

  /** Drops a file from memory, e.g. after it was renamed or deleted. */
  forget(path: string): void {
    this.entries.delete(path);
    this.loadErrors.delete(path);
    this.changed();
  }

  /**
   * Copies or moves the selected rows to the end of another file. If rows
   * have names, they're kept, and a name that already exists in the target
   * (or repeats within the selection) refuses the whole action. Both files
   * are left with unsaved changes.
   */
  transfer(from: string, to: string, ids: readonly number[], mode: "copy" | "move"): TransferResult {
    const src = this.entries.get(from);
    const dst = this.entries.get(to);
    const { item, items, file } = this.schema.labels;
    if (!src || !dst || from === to) return { ok: false, error: `Pick another ${file}.` };
    const readOnly = [src, dst].find((e) => !e.doc.headerOk);
    if (readOnly) return { ok: false, error: `${readOnly.file.name} is read-only (wrong header).` };
    const values = selectedValues(src.doc, ids);
    if (values.length === 0) return { ok: false, error: `Select ${item} rows first.` };
    const col = this.schema.nameCol;
    if (col !== null) {
      const clashes = nameClashes(this.schema, dst.doc, values.map((v) => v[col]));
      if (clashes.length) {
        return { ok: false, error: `${dst.file.name} already has ${items} named: ${clashes.join(", ")}. Rename them first.` };
      }
    }
    this.entries.set(to, this.withDoc(dst, importRows(this.schema, dst.doc, values)));
    if (mode === "move") {
      const moved = src.doc.rows.filter((r) => ids.includes(r.id) && isRecord(r)).map((r) => r.id);
      this.entries.set(from, this.withDoc(src, deleteRows(src.doc, moved)));
    }
    this.changed();
    return { ok: true, count: values.length };
  }

  discard(path: string): void {
    const e = this.entries.get(path);
    if (!e || e.doc === e.base) return;
    this.entries.set(path, this.withDoc(e, e.base));
    this.changed();
  }

  /**
   * Writes a file's edits. Re-reads it first and asks before overwriting a
   * version changed by another program; reads it back afterwards to verify.
   */
  async save(path: string, confirmOverwrite: ConfirmOverwrite): Promise<SaveResult> {
    let e = this.entries.get(path);
    if (!e) return { ok: false, reason: "error", error: "File isn't loaded." };
    if (!e.doc.headerOk) return { ok: false, reason: "readonly" };
    if (this.schema.cleanBeforeSave) {
      const cleaned = this.schema.cleanBeforeSave(e.doc);
      if (cleaned !== e.doc) {
        e = this.withDoc(e, cleaned);
        this.entries.set(path, e);
        this.changed();
      }
    }
    if (e.errorCount > 0) return { ok: false, reason: "invalid" };
    try {
      const onDisk = await readText(path);
      if (onDisk.text !== e.loaded.text && !(await confirmOverwrite(e.file))) {
        return { ok: false, reason: "cancelled" };
      }
      const text = e.serialized;
      await saveText(path, text);
      const after = await readText(path);
      const verified = after.text === text;
      const latest = this.entries.get(path)!;
      if (verified) {
        // The saved doc becomes the new base, keeping row ids (and selections).
        // Edits made while saving stay as unsaved changes on top of it.
        this.entries.set(path, this.makeEntry(e.file, after, e.doc, originalValues(e.doc), latest.doc));
      } else {
        this.entries.set(path, this.freshEntry(e.file, after, this.parse(after.text)));
      }
      this.changed();
      return { ok: true, verified };
    } catch (err) {
      return { ok: false, reason: "error", error: String(err) };
    }
  }

  /** Saves every file with unsaved changes that has no errors. */
  async saveAll(confirmOverwrite: ConfirmOverwrite): Promise<SaveAllResult> {
    const result: SaveAllResult = { saved: [], invalid: [], failed: [], cancelled: [] };
    for (const e of this.dirtyEntries()) {
      if (!e.doc.headerOk) {
        result.invalid.push(e);
        continue;
      }
      const r = await this.save(e.file.path, confirmOverwrite);
      if (r.ok && r.verified) result.saved.push(e);
      else if (r.ok) result.failed.push({ entry: e, error: "the file on disk doesn't match what was written" });
      else if (r.reason === "invalid") result.invalid.push(e);
      else if (r.reason === "cancelled") result.cancelled.push(e);
      else result.failed.push({ entry: e, error: r.error ?? r.reason });
    }
    return result;
  }
}

/** Re-renders the caller whenever the store changes. */
export function useStoreVersion<C>(store: TableStore<C>): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}
