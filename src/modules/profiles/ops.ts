// Profile edit operations: the shared table operations bound to the profile
// schema, addressed by field name.
import { PROFILE_FIELDS, type ProfileDoc, type ProfileField } from "../../lib/formats/profiles";
import * as table from "../../lib/table/ops";
import { PROFILE_SCHEMA } from "./schema";

export { deleteRows, moveRows, selectedValues, isRecord as isProfile, type ImportResult } from "../../lib/table/ops";

const col = (field: ProfileField) => PROFILE_FIELDS.indexOf(field);

export const addRow = (doc: ProfileDoc) => table.addRow(PROFILE_SCHEMA, doc);

export const setCell = (doc: ProfileDoc, id: number, field: ProfileField, value: string) =>
  table.bulkSet(doc, [id], col(field), value);

export const bulkSet = (doc: ProfileDoc, ids: readonly number[], field: ProfileField, value: string) =>
  table.bulkSet(doc, ids, col(field), value);

export const duplicateRows = (doc: ProfileDoc, ids: readonly number[]) => table.duplicateRows(PROFILE_SCHEMA, doc, ids);

export const fromTemplate = (doc: ProfileDoc, templateId: number, count: number) =>
  table.fromTemplate(PROFILE_SCHEMA, doc, templateId, count);

export const parseImport = (text: string) => table.parseImport(PROFILE_SCHEMA, text);

export const importRows = (doc: ProfileDoc, rows: readonly (readonly string[])[]) =>
  table.importRows(PROFILE_SCHEMA, doc, rows);

export const nameClashes = (target: ProfileDoc, names: readonly string[]) =>
  table.nameClashes(PROFILE_SCHEMA, target, names);
