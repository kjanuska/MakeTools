// What a module tells the shared table code about its files.
import type { DataRow, TableDoc, TableFormat } from "../formats/csvTable";
import type { ValidationErrors } from "../rules/engine";

export interface TableLabels {
  /** One row, e.g. "profile" or "task". */
  item: string;
  items: string;
  /** One file, e.g. "group" or "task file". */
  file: string;
  files: string;
}

export interface TableSchema<Ctx = unknown> {
  format: TableFormat;
  labels: TableLabels;
  /**
   * Column holding each row's name (new rows get their row number), or null
   * if rows have no name.
   */
  nameCol: number | null;
  /** Values for a new, empty row. */
  newRow(): string[];
  /** Errors by row id, then field. `ctx` is whatever the module needs (e.g. other files). */
  validate(rows: readonly DataRow[], ctx: Ctx): ValidationErrors<string>;
  /**
   * Fixes applied silently when a file is loaded. The fixed doc becomes the
   * base, so the fixes aren't marked per cell, but the file is dirty until saved.
   */
  fixOnLoad?(doc: TableDoc): TableDoc;
  /** Cleanup applied right before saving (e.g. whitespace left by typing). */
  cleanBeforeSave?(doc: TableDoc): TableDoc;
}
