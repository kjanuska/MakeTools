// How a module's table looks and behaves in the shared editor and overview.
import type { ReactNode } from "react";
import type { DataRow } from "../../lib/formats/csvTable";
import type { TableSchema } from "../../lib/table/schema";
import type { DocEntry } from "../../lib/table/store";

export type CellType<Ctx> =
  /**
   * Free text. `random` highlights the special value "random". `display`, when
   * it returns something, is shown in place of the text while the cell isn't
   * being edited; clicking into the cell shows the text to edit.
   */
  | { kind: "text"; random?: boolean; display?: (value: string) => ReactNode }
  /** Dropdown. `add` puts an "Add…" entry at the end that creates a new option. */
  | {
      kind: "select";
      options: (values: readonly string[], ctx: Ctx) => readonly string[];
      disabled?: (values: readonly string[]) => boolean;
      add?: { label: string; prompt: string; onAdd: (value: string) => void };
    }
  /** Whole-number spin button. */
  | { kind: "spin"; min: number; step: number }
  /** Ordered multi-select of parts joined without a separator. */
  | { kind: "parts"; parts: readonly string[]; split: (value: string) => string[] | null };

export interface ExtraColumn<Ctx> {
  header: string;
  /** Shown after this field column. */
  after: number;
  className?: string;
  render(values: readonly string[], ctx: Ctx): ReactNode;
}

export interface SearchMatch {
  /** Shown as the link that opens the row. */
  match: string;
  detail: string;
}

export interface TableUI<Ctx> {
  schema: TableSchema<Ctx>;
  cell(col: number): CellType<Ctx>;
  optional(col: number): boolean;
  /** Changing one cell may change others (e.g. profileName follows profileGroup). */
  applyEdit?(values: readonly string[], col: number, value: string, ctx: Ctx): string[];
  /** Cleanup when leaving a cell. */
  cleanOnBlur?(col: number, value: string): string;
  extraColumns?: ExtraColumn<Ctx>[];
  /** Counts shown next to the file name, e.g. "3 profiles". */
  summary(rows: readonly DataRow[], ctx: Ctx): string;
  /** Column that gets the cursor after Add row. */
  firstEditCol: number;
  /** Field preselected in the bulk edit panel. */
  bulkDefaultCol: number;

  overview: {
    heading: string;
    stats: { header: string; value(e: DocEntry, ctx: Ctx): string | number }[];
    /** e.g. "4 groups · 5 profiles in total" (as React nodes). */
    totals(entries: readonly (DocEntry | undefined)[], ctx: Ctx): ReactNode;
    /** e.g. "3 profiles", for the delete prompt. */
    describe(e: DocEntry | undefined, ctx: Ctx): string;
    renameWarning?(from: string): string;
    newFileText: string;
    search: {
      title: string;
      label: string;
      placeholder: string;
      headers: [string, string, string, string];
      find(values: readonly string[], query: string): SearchMatch | null;
    };
  };
}
