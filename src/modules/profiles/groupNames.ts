// Group names are file names (`<group>.csv`) and are referred to from task
// CSVs, so they must be valid on Windows and must not break a CSV value.

const EXT = ".csv";
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FORBIDDEN = /[<>:"/\\|?*,\x00-\x1f]/;

/** Group name for a file name: `25.csv` -> `25`. */
export function groupNameOf(fileName: string): string {
  return fileName.toLowerCase().endsWith(EXT) ? fileName.slice(0, -EXT.length) : fileName;
}

export function fileNameFor(group: string): string {
  return group + EXT;
}

/**
 * Error for a proposed group name, or null if it's fine. `existing` holds the
 * folder's current file names; `current` is the file being renamed, which may
 * keep its own name in a different case.
 */
export function groupNameError(name: string, existing: readonly string[], current?: string): string | null {
  if (name === "") return "Enter a name.";
  if (name !== name.trim()) return "The name can't start or end with a space.";
  if (FORBIDDEN.test(name)) return 'The name can\'t contain , < > : " / \\ | ? * or control characters.';
  if (name.endsWith(".")) return "The name can't end with a dot.";
  if (RESERVED.test(name.split(".")[0])) return `"${name}" is reserved by Windows.`;
  const file = fileNameFor(name).toLowerCase();
  const clash = existing.find((e) => e.toLowerCase() === file && e !== current);
  if (clash && clash.toLowerCase() !== current?.toLowerCase()) return `A group named "${groupNameOf(clash)}" already exists.`;
  if (current && fileNameFor(name) === current) return "That's already its name.";
  return null;
}

/** First free "<base> copy", "<base> copy 2", ... */
export function copyName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((e) => e.toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base} copy` : `${base} copy ${i}`;
    if (!taken.has(fileNameFor(name).toLowerCase())) return name;
  }
}
