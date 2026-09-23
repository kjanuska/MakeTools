// Group file operations: create, copy, rename, delete. Every write goes
// through a Rust command that backs up first or refuses to overwrite.
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import { createFile, deleteFile, readText, renameFile, type FileEntry } from "../../lib/fs";
import { joinPath } from "../../lib/paths";
import { fileNameFor } from "./groupNames";
import type { ProfileStore } from "./store";

/** Contents of a new, empty group: the header, CRLF, like the existing files. */
export const NEW_GROUP_TEXT = `${PROFILE_HEADER}\r\n`;

/** Creates an empty group. Returns its path. */
export async function createGroup(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, fileNameFor(name));
  await createFile(path, NEW_GROUP_TEXT);
  return path;
}

/** Copies a group's saved file byte for byte. Returns the new path. */
export async function copyGroup(file: FileEntry, dir: string, name: string): Promise<string> {
  const { text } = await readText(file.path);
  const path = joinPath(dir, fileNameFor(name));
  await createFile(path, text);
  return path;
}

export async function renameGroup(store: ProfileStore, file: FileEntry, dir: string, name: string): Promise<string> {
  const path = joinPath(dir, fileNameFor(name));
  await renameFile(file.path, path);
  store.forget(file.path);
  return path;
}

export async function deleteGroup(store: ProfileStore, file: FileEntry): Promise<void> {
  await deleteFile(file.path);
  store.forget(file.path);
}
