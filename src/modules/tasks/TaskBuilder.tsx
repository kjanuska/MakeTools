// Task builder (spec: docs/modules/tasks.md, "3b"): profile groups with task
// counts, inputs with a %, and a % split of values for each other field
// (shared by every input unless an input overrides it). Next to it are the
// task counts it gives, compared with the file as it is now.
import { useEffect, useMemo, useState } from "react";
import { Cell } from "../../components/table/cells";
import type { CellType, TableUI } from "../../components/table/types";
import { TASK_COL as C, TASK_FIELDS } from "../../lib/formats/tasks";
import { BreakdownView } from "./BreakdownView";
import {
  breakdown,
  evenCounts,
  generateRows,
  planErrors,
  planTotal,
  SPLIT_FIELDS,
  type Breakdown,
  type BuildPlan,
  type GroupPlan,
  type Split,
  type SplitField,
} from "./build";
import type { TaskContext } from "./schema";

interface Props {
  initial: BuildPlan;
  ctx: TaskContext;
  ui: TableUI<TaskContext>;
  /** The file's counts now. */
  before: Breakdown;
  onApply: (rows: string[][]) => void;
  /** Start again from the file's counts. */
  onReset: () => void;
}

const NO_ROW = TASK_FIELDS.map(() => "");
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

/** Number field that keeps what's being typed (e.g. "33.") until it's a number. */
function NumberInput({
  value,
  onChange,
  label,
  step,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  step?: number;
  className?: string;
}) {
  const shown = Number.isFinite(value) ? String(round2(value)) : "";
  const [text, setText] = useState(shown);
  useEffect(() => {
    // Take outside changes, but not while the typed text already means this value.
    setText((t) => (Number(t) === value && t !== "" ? t : shown));
  }, [value, shown]);
  return (
    <input
      type="number"
      className={className ?? "num-input"}
      aria-label={label}
      min={0}
      step={step ?? "any"}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value === "" ? NaN : Number(e.target.value));
      }}
    />
  );
}

/** Even %s for n values that add up to exactly 100 (the last one takes the rest). */
function evenPercents(n: number): number[] {
  if (n === 0) return [];
  const each = round2(100 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? round2(100 - each * (n - 1)) : each));
}

function SumNote({ percents }: { percents: number[] }) {
  const total = sum(percents);
  const ok = Math.abs(total - 100) < 1e-6;
  return <span className={ok ? "muted" : "error"}>{ok ? "100%" : `${round2(total)}% (must be 100%)`}</span>;
}

function SplitEditor({
  field,
  split,
  ctx,
  type,
  label,
  onChange,
}: {
  field: SplitField;
  split: Split;
  ctx: TaskContext;
  type: CellType<TaskContext>;
  label: string;
  onChange: (s: Split) => void;
}) {
  const set = (i: number, part: Partial<Split[number]>) =>
    onChange(split.map((p, j) => (j === i ? { ...p, ...part } : p)));
  return (
    <div className="split-editor" role="group" aria-label={label}>
      {split.map((p, i) => (
        <div className="split-row" key={i}>
          <Cell
            type={type}
            field={field}
            value={p.value}
            values={NO_ROW}
            ctx={ctx}
            label={`${label} value ${i + 1}`}
            onChange={(value) => set(i, { value })}
          />
          <NumberInput
            label={`${label} value ${i + 1} %`}
            value={p.percent}
            onChange={(percent) => set(i, { percent })}
          />
          <span className="muted">%</span>
          <button
            aria-label={`Remove ${label} value ${i + 1}`}
            disabled={split.length === 1}
            onClick={() => onChange(split.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="split-foot">
        <button onClick={() => onChange([...split, { value: "", percent: 0 }])}>Add value</button>
        <button
          onClick={() =>
            onChange(
              split.map((p, i) => ({
                ...p,
                percent: evenPercents(split.length)[i],
              })),
            )
          }
        >
          Even %
        </button>
        <SumNote percents={split.map((p) => p.percent)} />
      </div>
    </div>
  );
}

function GroupEditor({
  group,
  ctx,
  onChange,
  onRemove,
}: {
  group: GroupPlan;
  ctx: TaskContext;
  onChange: (g: GroupPlan) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const total = sum(group.counts.map((c) => c.count));
  const groups = [...ctx.profileGroups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const label = `Profile group ${group.profileGroup}`;

  const pickGroup = (name: string) => {
    const names = ctx.profileGroups.get(name) ?? [];
    const counts = evenCounts(Number.isFinite(total) ? total : 0, names.length);
    onChange({
      profileGroup: name,
      counts: names.map((profileName, i) => ({
        profileName,
        count: counts[i],
      })),
    });
  };
  const setTotal = (n: number) => {
    const counts = Number.isInteger(n) && n >= 0 ? evenCounts(n, group.counts.length) : group.counts.map(() => NaN);
    onChange({
      ...group,
      counts: group.counts.map((c, i) => ({ ...c, count: counts[i] })),
    });
  };

  return (
    <div className="builder-group">
      <div className="builder-row">
        <select aria-label="Profile group" value={group.profileGroup} onChange={(e) => pickGroup(e.target.value)}>
          {!groups.includes(group.profileGroup) && (
            <option value={group.profileGroup}>{group.profileGroup || "Pick…"}</option>
          )}
          {groups.map((g) => (
            <option key={g} value={g}>
              {g} ({ctx.profileGroups.get(g)?.length ?? 0} profiles)
            </option>
          ))}
        </select>
        <NumberInput label={`${label} tasks`} value={total} step={1} onChange={setTotal} />
        <span className="muted">tasks, spread evenly over {group.counts.length} profiles</span>
        <button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide profiles" : "Per profile…"}
        </button>
        <button aria-label={`Remove ${label}`} onClick={onRemove}>
          ×
        </button>
      </div>
      {open && (
        <div className="builder-profiles">
          {group.counts.map((c, i) => (
            <label key={c.profileName}>
              <span>{c.profileName}</span>
              <NumberInput
                label={`${group.profileGroup} / ${c.profileName} tasks`}
                value={c.count}
                step={1}
                onChange={(count) =>
                  onChange({
                    ...group,
                    counts: group.counts.map((x, j) => (j === i ? { ...x, count } : x)),
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskBuilder({ initial, ctx, ui, before, onApply, onReset }: Props) {
  const [plan, setPlan] = useState<BuildPlan>(initial);
  const [openOverrides, setOpenOverrides] = useState<Set<number>>(new Set());

  const errors = useMemo(() => planErrors(plan, ctx), [plan, ctx]);
  const rows = useMemo(() => (errors.length ? null : generateRows(plan)), [plan, errors]);
  const after = useMemo(() => (rows ? breakdown(rows, ctx) : null), [rows, ctx]);

  /** The cell editor for a field's values; "Add site…" is left to the grid and Settings. */
  const typeOf = (f: SplitField): CellType<TaskContext> => {
    const t = ui.cell(C[f]);
    return t.kind === "select" ? { ...t, add: undefined } : t;
  };
  const update = (fn: (p: BuildPlan) => BuildPlan) => setPlan(fn);

  const total = planTotal(plan);

  const changed = !!after && JSON.stringify(after) !== JSON.stringify(before);

  return (
    <div className="task-layout">
      <div className="task-builder">
        <section>
          <h3>Profiles</h3>
          {plan.groups.map((g, gi) => (
            <GroupEditor
              key={gi}
              group={g}
              ctx={ctx}
              onChange={(ng) =>
                update((p) => ({
                  ...p,
                  groups: p.groups.map((x, j) => (j === gi ? ng : x)),
                }))
              }
              onRemove={() =>
                update((p) => ({
                  ...p,
                  groups: p.groups.filter((_, j) => j !== gi),
                }))
              }
            />
          ))}
          <button
            onClick={() =>
              update((p) => ({
                ...p,
                groups: [...p.groups, { profileGroup: "", counts: [] }],
              }))
            }
          >
            Add profile group
          </button>
          <p className="muted">{Number.isFinite(total) ? `${total} tasks in total` : ""}</p>
        </section>

        <section>
          <h3>Inputs</h3>
          {plan.inputs.map((input, k) => {
            const overridden = SPLIT_FIELDS.filter((f) => input.overrides[f]);
            const setInput = (part: Partial<typeof input>) =>
              update((p) => ({
                ...p,
                inputs: p.inputs.map((x, j) => (j === k ? { ...x, ...part } : x)),
              }));
            const open = openOverrides.has(k);
            return (
              <div className="builder-input" key={k}>
                <div className="builder-row">
                  <input
                    aria-label={`Input ${k + 1}`}
                    className="input-text"
                    value={input.input}
                    spellCheck={false}
                    onChange={(e) => setInput({ input: e.target.value })}
                  />
                  <NumberInput
                    label={`Input ${k + 1} %`}
                    value={input.percent}
                    onChange={(percent) => setInput({ percent })}
                  />
                  <span className="muted">%</span>
                  <button
                    aria-expanded={open}
                    onClick={() =>
                      setOpenOverrides((s) => {
                        const n = new Set(s);
                        if (!n.delete(k)) n.add(k);
                        return n;
                      })
                    }
                  >
                    {overridden.length ? `Own splits: ${overridden.join(", ")}` : "Own splits…"}
                  </button>
                  <button
                    aria-label={`Remove input ${k + 1}`}
                    onClick={() =>
                      update((p) => ({
                        ...p,
                        inputs: p.inputs.filter((_, j) => j !== k),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
                {open && (
                  <div className="builder-overrides">
                    {SPLIT_FIELDS.map((f) => {
                      const own = input.overrides[f];
                      return (
                        <div key={f} className="override">
                          <label>
                            <input
                              type="checkbox"
                              checked={!!own}
                              onChange={(e) => {
                                const overrides = { ...input.overrides };
                                if (e.target.checked)
                                  overrides[f] = plan.defaults[f].map((p) => ({
                                    ...p,
                                  }));
                                else delete overrides[f];
                                setInput({ overrides });
                              }}
                            />{" "}
                            Own {f} split
                          </label>
                          {own && (
                            <SplitEditor
                              field={f}
                              split={own}
                              ctx={ctx}
                              type={typeOf(f)}
                              label={`Input ${k + 1} ${f}`}
                              onChange={(s) =>
                                setInput({
                                  overrides: { ...input.overrides, [f]: s },
                                })
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div className="split-foot">
            <button
              onClick={() =>
                update((p) => ({
                  ...p,
                  inputs: [...p.inputs, { input: "", percent: 0, overrides: {} }],
                }))
              }
            >
              Add input
            </button>
            <button
              onClick={() =>
                update((p) => ({
                  ...p,
                  inputs: p.inputs.map((x, i) => ({
                    ...x,
                    percent: evenPercents(p.inputs.length)[i],
                  })),
                }))
              }
            >
              Even %
            </button>
            <SumNote percents={plan.inputs.map((i) => i.percent)} />
          </div>
        </section>

        <section>
          <h3>Splits for every input</h3>
          <p className="muted">Each input uses these unless it has its own split.</p>
          <div className="builder-splits">
            {SPLIT_FIELDS.map((f) => (
              <div key={f}>
                <h4>{f}</h4>
                <SplitEditor
                  field={f}
                  split={plan.defaults[f]}
                  ctx={ctx}
                  type={typeOf(f)}
                  label={`Default ${f}`}
                  onChange={(s) =>
                    update((p) => ({
                      ...p,
                      defaults: { ...p.defaults, [f]: s },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </section>

        <div className="toolbar builder-actions">
          <button className="primary" disabled={!rows || !changed} onClick={() => rows && onApply(rows)}>
            Apply to file
          </button>
          <button disabled={plan === initial} onClick={onReset}>
            Reset to file
          </button>
          {rows && changed && (
            <span className="muted">
              Replaces every task row with {rows.length} generated {rows.length === 1 ? "row" : "rows"}. Nothing is
              written until you save.
            </span>
          )}
        </div>
        {errors.length > 0 && (
          <ul className="error builder-errors" aria-label="Problems">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <section className="task-counts">
        <h3>Tasks</h3>
        {after ? (
          <BreakdownView b={after} before={before} />
        ) : (
          <>
            <p className="muted">Fix the problems to see what the build gives. The file now:</p>
            <BreakdownView b={before} />
          </>
        )}
      </section>
    </div>
  );
}
