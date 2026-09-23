// Shared validation engine. Each module keeps its rules in a config file
// next to this one (e.g. profiles.ts); tweak the config, not this file.

export interface FieldRule {
  /** Empty value is an error. */
  required?: boolean;
  /** Non-empty value must match. */
  pattern?: RegExp;
  /** Error shown when `pattern` doesn't match. */
  patternMessage?: string;
  /** Dropdown choices. A function is re-evaluated each time (e.g. years). */
  options?: readonly string[] | (() => readonly string[]);
  /** Non-empty value must be one of `options`. */
  mustBeOption?: boolean;
  /** Values that are not allowed (case-sensitive). */
  reserved?: readonly string[];
  /** Value must not repeat within the file. */
  unique?: boolean;
}

export type Rules<F extends string> = Record<F, FieldRule>;

export function optionsOf(rule: FieldRule): readonly string[] | null {
  if (!rule.options) return null;
  return typeof rule.options === "function" ? rule.options() : rule.options;
}

/** Checks every value must pass: characters the file format can't hold, and surrounding spaces. */
function formatError(value: string): string | null {
  if (value.includes(",")) return "can't contain a comma";
  if (value.includes('"')) return "can't contain a quote";
  if (/[\r\n]/.test(value)) return "can't contain a line break";
  if (value !== value.trim()) return "can't start or end with a space";
  return null;
}

/** First error for a single value, ignoring `unique`. */
export function validateValue(rule: FieldRule, value: string): string | null {
  if (value === "") return rule.required ? "is required" : null;
  const fmt = formatError(value);
  if (fmt) return fmt;
  if (rule.reserved?.includes(value)) return `can't be "${value}"`;
  if (rule.mustBeOption && !optionsOf(rule)?.includes(value)) return "isn't one of the allowed values";
  if (rule.pattern && !rule.pattern.test(value)) return rule.patternMessage ?? "has the wrong format";
  return null;
}

export interface RecordToCheck {
  id: number;
  values: readonly string[];
}

/** Errors by record id, then by field. Records without errors are left out. */
export type ValidationErrors<F extends string> = Map<number, Partial<Record<F, string>>>;

export function validateRecords<F extends string>(
  fields: readonly F[],
  rules: Rules<F>,
  records: readonly RecordToCheck[],
): ValidationErrors<F> {
  const errors: ValidationErrors<F> = new Map();
  const add = (id: number, field: F, msg: string) => {
    const e: Partial<Record<F, string>> = errors.get(id) ?? {};
    if (!e[field]) e[field] = msg;
    errors.set(id, e);
  };

  fields.forEach((field, col) => {
    const rule = rules[field];
    const seen = new Map<string, number[]>();
    for (const r of records) {
      const value = r.values[col] ?? "";
      const msg = validateValue(rule, value);
      if (msg) add(r.id, field, msg);
      if (rule.unique && value !== "") seen.set(value, [...(seen.get(value) ?? []), r.id]);
    }
    for (const ids of seen.values()) {
      if (ids.length > 1) ids.forEach((id) => add(id, field, "is used by more than one row"));
    }
  });
  return errors;
}

export function countErrors(errors: ValidationErrors<string>): number {
  let n = 0;
  for (const e of errors.values()) n += Object.keys(e).length;
  return n;
}
