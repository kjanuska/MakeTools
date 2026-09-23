// Typed wrappers around the Rust file I/O commands (src-tauri/src/lib.rs).
// Shapes must match the serde output tested in src-tauri/src/fsops.rs.
import { invoke } from "@tauri-apps/api/core";

export type LineEnding = "none" | "lf" | "crlf" | "mixed";

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  modifiedMs: number;
}

export interface TextFile {
  /** Exact file contents, including a BOM if present. */
  text: string;
  lineEnding: LineEnding;
  hasBom: boolean;
}

export interface BackupEntry {
  id: string;
  createdMs: number;
  size: number;
}

/** Files directly in `dir` with the given extension (no dot), sorted by name. */
export function listFiles(dir: string, extension: string): Promise<FileEntry[]> {
  return invoke("list_files", { dir, extension });
}

/** Reads a file verbatim. Rejects files that are not valid UTF-8. */
export function readText(path: string): Promise<TextFile> {
  return invoke("read_text", { path });
}

/**
 * Writes `text` exactly as given (no line-ending conversion), atomically.
 * The current file is always backed up first.
 */
export function saveText(path: string, text: string): Promise<void> {
  return invoke("save_text", { path, text });
}

/** Backups of `path`, newest first. */
export function listBackups(path: string): Promise<BackupEntry[]> {
  return invoke("list_backups", { path });
}

/** Replaces `path` with a backup. The current version is backed up first. */
export function restoreBackup(path: string, id: string): Promise<void> {
  return invoke("restore_backup", { path, id });
}
