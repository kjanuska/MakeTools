// Profile group files: `profile/<group>.csv` (spec: docs/modules/profiles.md).
// Unquoted CSV with a fixed header; see csvTable.ts for the byte-exact rules.
import { headerOf, parseTable, serializeTable, type DataRow, type TableDoc, type TableFormat } from "./csvTable";

export { newRowId, type Eol, type RawRow, type Row } from "./csvTable";

export const PROFILE_FIELDS = [
  "profileName",
  "firstName",
  "lastName",
  "email",
  "address1",
  "address2",
  "city",
  "state",
  "zipcode",
  "country",
  "phoneNumber",
  "ccNumber",
  "ccMonth",
  "ccYear",
  "cvv",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Existing profile files use CRLF, so new ones do too. */
export const PROFILE_FORMAT: TableFormat = { fields: PROFILE_FIELDS, newFileEol: "\r\n" };

export const PROFILE_HEADER = headerOf(PROFILE_FORMAT);

export type ProfileDoc = TableDoc;
export type ProfileRow = DataRow;

export const parseProfiles = (fileText: string): ProfileDoc => parseTable(PROFILE_FORMAT, fileText);
export const serializeProfiles = (doc: ProfileDoc): string => serializeTable(PROFILE_FORMAT, doc);
