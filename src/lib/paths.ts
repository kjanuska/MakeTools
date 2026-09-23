/** Joins Windows path parts with exactly one backslash between them. */
export function joinPath(...parts: string[]): string {
  const nonEmpty = parts.filter((p) => p !== "");
  return nonEmpty
    .map((p, i) => {
      let s = p;
      if (i > 0) s = s.replace(/^[\\/]+/, "");
      if (i < nonEmpty.length - 1) s = s.replace(/[\\/]+$/, "");
      return s;
    })
    .join("\\");
}
