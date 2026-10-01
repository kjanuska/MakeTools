// Group/file names are file names (`<name>.csv`, or `<name>.txt` for accounts
// and proxies) and are referred to from task CSVs, so they must be valid on
// Windows and must not break a CSV value.

const EXT = ".csv";
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FORBIDDEN = /[<>:"/\\|?*,\x00-\x1f]/;

/** Group name for a file name: `25.csv` -> `25`. */
export function groupNameOf(fileName: string, ext = EXT): string {
  return fileName.toLowerCase().endsWith(ext) ? fileName.slice(0, -ext.length) : fileName;
}

export function fileNameFor(group: string, ext = EXT): string {
  return group + ext;
}

/**
 * Error for a proposed group name, or null if it's fine. `existing` holds the
 * folder's current file names; `current` is the file being renamed, which may
 * keep its own name in a different case.
 */
export function groupNameError(name: string, existing: readonly string[], current?: string, ext = EXT): string | null {
  if (name === "") return "Enter a name.";
  if (name !== name.trim()) return "The name can't start or end with a space.";
  if (FORBIDDEN.test(name)) return 'The name can\'t contain , < > : " / \\ | ? * or control characters.';
  if (name.endsWith(".")) return "The name can't end with a dot.";
  if (RESERVED.test(name.split(".")[0])) return `"${name}" is reserved by Windows.`;
  const file = fileNameFor(name, ext).toLowerCase();
  const clash = existing.find((e) => e.toLowerCase() === file && e !== current);
  if (clash && clash.toLowerCase() !== current?.toLowerCase()) return `A group named "${groupNameOf(clash, ext)}" already exists.`;
  if (current && fileNameFor(name, ext) === current) return "That's already its name.";
  return null;
}

/** First free "<base> copy", "<base> copy 2", ... */
export function copyName(base: string, existing: readonly string[], ext = EXT): string {
  const taken = new Set(existing.map((e) => e.toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base} copy` : `${base} copy ${i}`;
    if (!taken.has(fileNameFor(name, ext).toLowerCase())) return name;
  }
}

/** A file name as shown to the user, without its extension: `25.csv` -> `25`. */
export function displayName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
