// Validation rules for task files. Edit these to change what the app accepts.
// Every field also can't contain , " or line breaks (see engine.ts). Checks
// that need other files (groups, profiles, sites) are in modules/tasks/schema.ts.
// Any error blocks saving.
import type { TaskField } from "../formats/tasks";
import type { Rules } from "./engine";

export const TASK_RULES: Rules<TaskField> = {
  profileGroup: { required: true },
  // Required once a profileGroup is set; checked in modules/tasks/schema.ts.
  profileName:  {},
  proxyGroup:   { required: true },
  accountGroup: { required: true },
  // Spaces are cleaned up automatically (on leaving the cell and before saving).
  input:        { required: true, spacesAllowed: true },
  size:         { required: true },
  color:        { required: true },
  site:         { required: true },
  mode:         { required: true },
  cartQuantity: { required: true, pattern: /^[1-9]\d*$/, patternMessage: "must be a whole number, 1 or more" },
  delay:        { required: true, pattern: /^\d+$/, patternMessage: "must be a whole number of milliseconds" },
};

/** profileName value meaning "every profile in the group". */
export const ALL_PROFILES = "ALL";

/**
 * Mode parts, in the order they're offered. A mode is parts joined together,
 * e.g. preload + stuck + wait = "preloadstuckwait". From the bot guide, plus
 * paypal and monitor (used in the task files, confirmed as real by the user).
 * Which parts can combine, and in what order, isn't known yet.
 */
export const MODE_PARTS = [
  // Main modes
  "preload",
  "direct",
  // Discontinued main modes (guide)
  "safe",
  "fast",
  "human",
  // Sub-modes
  "wait",
  "pause",
  "login",
  "stuck",
  "shoppay",
  "lite",
  "store",
  "free",
  // Supreme JP only
  "cod",
  // Not in the guide
  "paypal",
  "monitor",
] as const;

const BY_LENGTH = [...MODE_PARTS].sort((a, b) => b.length - a.length);

/** Splits a mode into its parts (longest match first), or null if some text isn't a known part. */
export function splitMode(mode: string): string[] | null {
  const parts: string[] = [];
  let i = 0;
  while (i < mode.length) {
    const part = BY_LENGTH.find((p) => mode.startsWith(p, i));
    if (!part) return null;
    parts.push(part);
    i += part.length;
  }
  return parts;
}

/** How inputs are split into keywords for the parsed view. */
export const INPUT_PARSING = {
  separator: " ",
  negativePrefix: "-",
};

/** Positive and negative keywords of an input, or null if it's a single word. */
export function parseInput(input: string): { positive: string[]; negative: string[] } | null {
  const words = input.split(INPUT_PARSING.separator).filter(Boolean);
  if (words.length < 2) return null;
  const p = INPUT_PARSING.negativePrefix;
  const isNegative = (w: string) => w.startsWith(p) && w.length > p.length;
  return {
    positive: words.filter((w) => !isNegative(w)),
    negative: words.filter(isNegative).map((w) => w.slice(p.length)),
  };
}
