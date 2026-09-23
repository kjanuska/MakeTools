// Profile group files: the shared file operations with the profile header.
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import { copyTableFile, createTableFile, deleteTableFile, renameTableFile } from "../../lib/table/fileOps";

/** Contents of a new, empty group: the header, CRLF, like the existing files. */
export const NEW_GROUP_TEXT = `${PROFILE_HEADER}\r\n`;

/** Creates an empty group. Returns its path. */
export const createGroup = (dir: string, name: string) => createTableFile(dir, name, NEW_GROUP_TEXT);

export { copyTableFile as copyGroup, renameTableFile as renameGroup, deleteTableFile as deleteGroup };
