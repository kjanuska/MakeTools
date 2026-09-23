// File operations for a module's folder: create, copy, rename, delete. Every
// write goes through a Rust command that backs up first or refuses to overwrite.
import { createFile, deleteFile, readText, renameFile, type FileEntry } from "../fs";
import { joinPath } from "../paths";
import { fileNameFor } from "./fileNames";
import type { TableStore } from "./store";

/** Creates a file with `text` (e.g. just the header). Returns its path. */
export async function createTableFile(dir: string, name: string, text: string): Promise<string> {
  const path = joinPath(dir, fileNameFor(name));
  await createFile(path, text);
  return path;
}

/** Copies a file's saved bytes exactly. Returns the new path. */
export async function copyTableFile(file: FileEntry, dir: string, name: string): Promise<string> {
  const { text } = await readText(file.path);
  const path = joinPath(dir, fileNameFor(name));
  await createFile(path, text);
  return path;
}

export async function renameTableFile<C>(store: TableStore<C>, file: FileEntry, dir: string, name: string): Promise<string> {
  const path = joinPath(dir, fileNameFor(name));
  await renameFile(file.path, path);
  store.forget(file.path);
  return path;
}

export async function deleteTableFile<C>(store: TableStore<C>, file: FileEntry): Promise<void> {
  await deleteFile(file.path);
  store.forget(file.path);
}
