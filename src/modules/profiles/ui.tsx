import { recordCount } from "../../components/table/TableOverview";
import type { CellType, TableUI } from "../../components/table/types";
import { PROFILE_FIELDS } from "../../lib/formats/profiles";
import { optionsOf } from "../../lib/rules/engine";
import { PROFILE_RULES } from "../../lib/rules/profiles";
import { PROFILE_SCHEMA } from "./schema";
import { NEW_GROUP_TEXT } from "./groups";

const NAME = PROFILE_FIELDS.indexOf("profileName");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const cells: CellType<null>[] = PROFILE_FIELDS.map((f) => {
  const rule = PROFILE_RULES[f];
  return rule.options ? { kind: "select", options: () => optionsOf(rule) ?? [] } : { kind: "text" };
});

export const PROFILE_UI: TableUI<null> = {
  schema: PROFILE_SCHEMA,
  cell: (col) => cells[col],
  optional: (col) => !PROFILE_RULES[PROFILE_FIELDS[col]].required,
  summary: (rows) => plural(rows.length, "profile", "profiles"),
  firstEditCol: PROFILE_FIELDS.indexOf("firstName"),
  bulkDefaultCol: PROFILE_FIELDS.indexOf("address1"),
  overview: {
    heading: "Profile groups",
    stats: [{ header: "Profiles", value: (e) => recordCount(e) }],
    totals: (entries) => {
      const total = entries.reduce((n, e) => n + recordCount(e), 0);
      return (
        <>
          <strong>{entries.length}</strong> {entries.length === 1 ? "group" : "groups"} · <strong>{total}</strong>{" "}
          {total === 1 ? "profile" : "profiles"} in total
        </>
      );
    },
    describe: (e) => plural(recordCount(e), "profile", "profiles"),
    renameWarning: (from) => `Tasks that refer to "${from}" are not updated automatically.`,
    newFileText: NEW_GROUP_TEXT,
    search: {
      title: "Find a profile",
      label: "Find by profileName",
      placeholder: "profileName contains…",
      headers: ["profileName", "Group", "Row", "Name"],
      find: (values, q) =>
        values[NAME].toLowerCase().includes(q) ? { match: values[NAME], detail: `${values[1]} ${values[2]}` } : null,
    },
  },
};
