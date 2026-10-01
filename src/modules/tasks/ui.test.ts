import { describe, expect, it } from "vitest";
import { parseTable } from "../../lib/formats/csvTable";
import { TASK_FORMAT, TASK_HEADER } from "../../lib/formats/tasks";
import type { DocEntry } from "../../lib/table/store";
import type { TaskContext } from "./schema";
import { entryRows, entryTotals, totalTasks } from "./ui";

const CTX: TaskContext = {
  ready: true,
  profileGroups: new Map([["25", ["1", "2", "3"]]]),
  proxyGroups: new Set(["wealth"]),
  accountGroups: new Set(["example"]),
  sites: ["kith.com"],
};

const row = (name: string, group = "25") => `${group},${name},wealth,example,box logo -tee,random,random,kith.com,preload,1,3000`;
const entry = (rows: string[]) =>
  ({ doc: parseTable(TASK_FORMAT, `${TASK_HEADER}\n${rows.map((r) => `${r}\n`).join("")}`) }) as unknown as DocEntry;

describe("entryTotals", () => {
  it("gives the same totals as totalTasks", () => {
    const e = entry([row("ALL"), row("1"), row("ALL", "99")]);
    expect(entryTotals(e, CTX)).toEqual(totalTasks(entryRows(e), CTX));
    expect(entryTotals(e, CTX)).toEqual({ tasks: 4, unknown: 1 });
  });

  it("reuses the totals while the rows and context are the same", () => {
    const e = entry([row("ALL")]);
    expect(entryTotals(e, CTX)).toBe(entryTotals(e, CTX));
  });

  it("works them out again for new rows (an edit) or a new context", () => {
    const e = entry([row("ALL")]);
    expect(entryTotals(e, CTX).tasks).toBe(3);
    const edited = entry([row("ALL"), row("2")]);
    expect(entryTotals(edited, CTX).tasks).toBe(4);
    const fewer: TaskContext = { ...CTX, profileGroups: new Map([["25", ["1"]]]) };
    expect(entryTotals(e, fewer).tasks).toBe(1);
    expect(entryTotals(e, CTX).tasks).toBe(3);
  });
});
