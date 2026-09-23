import { PROFILE_FIELDS, PROFILE_FORMAT } from "../../lib/formats/profiles";
import { validateRecords } from "../../lib/rules/engine";
import { PROFILE_RULES } from "../../lib/rules/profiles";
import type { TableSchema } from "../../lib/table/schema";

const COUNTRY = PROFILE_FIELDS.indexOf("country");

export const PROFILE_SCHEMA: TableSchema<null> = {
  format: PROFILE_FORMAT,
  labels: { item: "profile", items: "profiles", file: "group", files: "groups" },
  nameCol: PROFILE_FIELDS.indexOf("profileName"),
  /** Country is prefilled because "US" is the only allowed value. */
  newRow() {
    const values = PROFILE_FIELDS.map(() => "");
    values[COUNTRY] = "US";
    return values;
  },
  validate: (rows) => validateRecords(PROFILE_FIELDS, PROFILE_RULES, rows),
};
