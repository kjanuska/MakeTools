export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local time as `YYYY-MM-DD HH:MM:SS`. */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Size of `text` in bytes when encoded as UTF-8. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
