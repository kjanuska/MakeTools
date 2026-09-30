// Task builder (spec: docs/modules/tasks.md, "3b"): profile groups with task
// counts, inputs with a %, and a % split of values for each other field
// (shared by every input unless an input overrides it). Next to it are the
// task counts it gives, compared with the file as it is now.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cell } from "../../components/table/cells";
import type { CellType, TableUI } from "../../components/table/types";
import { TASK_COL as C, TASK_FIELDS } from "../../lib/formats/tasks";
import { ACTIONS, useShortcutsRef } from "../../lib/shortcuts";
import { BreakdownView } from "./BreakdownView";
import "./tasks.css";
import {
  breakdown,
  evenCounts,
  FIELD_LABELS,
  generateRows,
  planErrors,
  planTotal,
  SPLIT_FIELDS,
  type Breakdown,
  type BuildPlan,
  type GroupPlan,
  type InputPlan,
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
  /** The generated rows, and the plan they came from. */
  onApply: (rows: string[][], plan: BuildPlan) => void;
  /** Start again from the file's counts. */
  onReset: () => void;
}

/** Short explanations shown under each split's name. */
const SPLIT_HINTS: Record<SplitField, string> = {
  proxyGroup: "Which proxy list the tasks use",
  mode: "Full mode, e.g. preloadwait",
  site: "Which site the tasks run on",
  size: "e.g. random, 9&9.5&10",
  color: "e.g. random",
  accountGroup: "Which account list the tasks use",
  cartQuantity: "Items per checkout",
  delay: "Milliseconds between retries",
};

const NO_ROW = TASK_FIELDS.map(() => "");
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Number field that keeps what's being typed (e.g. "33.") until it's a number. */
function NumberInput({
  value,
  onChange,
  label,
  step,
  className,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  step?: number;
  className?: string;
  disabled?: boolean;
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
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value === "" ? NaN : Number(e.target.value));
      }}
    />
  );
}

/** Equal shares of 100 (unrounded, so they add up to 100 and split counts exactly evenly). */
const evenPercents = (n: number): number[] => Array.from({ length: n }, () => 100 / n);

const isEven = (percents: readonly number[]) =>
  percents.length > 0 && percents.every((p) => Math.abs(p - 100 / percents.length) < 0.01);

function SumNote({ percents }: { percents: number[] }) {
  const total = sum(percents);
  const ok = Math.abs(total - 100) < 1e-6;
  return <span className={ok ? "muted" : "error"}>{ok ? "Total 100%" : `Total ${round2(total)}% (must be 100%)`}</span>;
}

/**
 * A list of rows that each get a %: a "+" row to add one, × to remove one,
 * and "Distribute evenly", which keeps the %s equal (also when rows are
 * added or removed) until it's unticked.
 */
function PercentList<T extends { percent: number }>({
  items,
  label,
  onChange,
  newItem,
  renderItem,
  renderAfter,
}: {
  items: T[];
  /** Names the list for screen readers and the buttons, e.g. "Proxy Group (all inputs)". */
  label: string;
  onChange: (items: T[]) => void;
  newItem: () => T;
  /** The item's own fields, before its %. */
  renderItem: (item: T, i: number, set: (part: Partial<T>) => void) => ReactNode;
  /** Shown under an item's row, e.g. its own splits. */
  renderAfter?: (item: T, i: number, set: (part: Partial<T>) => void) => ReactNode;
}) {
  const [even, setEven] = useState(() => isEven(items.map((x) => x.percent)));
  const spread = (list: T[]) => (even ? list.map((x, i) => ({ ...x, percent: evenPercents(list.length)[i] })) : list);
  const setAt = (i: number) => (part: Partial<T>) => onChange(items.map((x, j) => (j === i ? { ...x, ...part } : x)));

  return (
    <div className="percent-list" role="group" aria-label={label}>
      {items.map((item, i) => (
        <div className="percent-item" key={i}>
          <div className="split-row">
            {renderItem(item, i, setAt(i))}
            <NumberInput
              label={`${label} ${i + 1} %`}
              value={item.percent}
              disabled={even}
              onChange={(percent) => setAt(i)({ percent } as Partial<T>)}
            />
            <span className="muted">%</span>
            <button
              className="remove"
              aria-label={`Remove ${label} ${i + 1}`}
              title="Remove this row"
              disabled={items.length === 1}
              onClick={() => onChange(spread(items.filter((_, j) => j !== i)))}
            >
              ×
            </button>
          </div>
          {renderAfter?.(item, i, setAt(i))}
        </div>
      ))}
      <button
        className="add-row"
        aria-label={`Add ${label}`}
        title="Add a row"
        onClick={() => onChange(spread([...items, newItem()]))}
      >
        +
      </button>
      <div className="split-foot">
        <label>
          <input
            type="checkbox"
            aria-label={`Distribute ${label} evenly`}
            checked={even}
            onChange={(e) => {
              setEven(e.target.checked);
              if (e.target.checked) onChange(items.map((x, i) => ({ ...x, percent: evenPercents(items.length)[i] })));
            }}
          />{" "}
          Distribute evenly
        </label>
        <SumNote percents={items.map((x) => x.percent)} />
      </div>
    </div>
  );
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
  return (
    <PercentList
      items={split}
      label={label}
      onChange={onChange}
      newItem={() => ({ value: "", percent: 0 })}
      renderItem={(p, i, set) => (
        <Cell
          type={type}
          field={field}
          value={p.value}
          values={NO_ROW}
          ctx={ctx}
          label={`${label} ${i + 1}`}
          onChange={(value) => set({ value })}
        />
      )}
    />
  );
}

/** One field's split in a card: its name and hint, then `extra` (e.g. a toggle), then the editor. */
function SplitCard({ field, extra, children }: { field: SplitField; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="builder-card split-card">
      <h4>{FIELD_LABELS[field]}</h4>
      <p className="muted hint">{SPLIT_HINTS[field]}</p>
      {extra}
      {children}
    </div>
  );
}

/** A split shown read-only, e.g. the default an input uses. */
function SplitSummary({ split, label }: { split: Split; label: string }) {
  return (
    <table className="split-summary" aria-label={label}>
      <tbody>
        {split.map((p, i) => (
          <tr key={i}>
            <th scope="row">{p.value === "" ? <span className="muted">(empty)</span> : p.value}</th>
            <td className="num">{Number.isFinite(p.percent) ? `${round2(p.percent)}%` : "?"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Dialog with one input's splits, laid out like "Splits for every input".
 * Each field uses the default until "Custom for this input" is ticked. Edits
 * apply as they're made; Cancel (or Escape) puts back what was there when it
 * opened.
 */
function InputSplitsDialog({
  input,
  index,
  defaults,
  ctx,
  typeOf,
  onChange,
  onDone,
  onCancel,
}: {
  input: InputPlan;
  index: number;
  defaults: BuildPlan["defaults"];
  ctx: TaskContext;
  typeOf: (f: SplitField) => CellType<TaskContext>;
  onChange: (overrides: InputPlan["overrides"]) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // While open, the app's shortcuts (save, back…) don't act behind the dialog:
  // it handles every action itself, as a no-op, so lower views never get them.
  const noShortcuts = useRef(Object.fromEntries(ACTIONS.map((a) => [a.id, () => {}])));
  useShortcutsRef(noShortcuts);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const name = input.input.trim() ? `"${input.input.trim()}"` : `input ${index + 1}`;
  const titleId = `input-splits-title-${index}`;

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={boxRef}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="modal-head">
          <h3 id={titleId}>Splits for {name}</h3>
          <p className="muted">
            Each field uses the split for every input unless you make it custom for this input.
          </p>
        </div>
        <div className="modal-body builder-splits">
          {SPLIT_FIELDS.map((f) => {
            const own = input.overrides[f];
            const label = FIELD_LABELS[f];
            return (
              <SplitCard
                key={f}
                field={f}
                extra={
                  <label className="custom-toggle">
                    <input
                      type="checkbox"
                      aria-label={`Custom ${label} split`}
                      checked={!!own}
                      onChange={(e) => {
                        const overrides = { ...input.overrides };
                        if (e.target.checked) overrides[f] = defaults[f].map((p) => ({ ...p }));
                        else delete overrides[f];
                        onChange(overrides);
                      }}
                    />{" "}
                    Custom for this input
                  </label>
                }
              >
                {own ? (
                  <SplitEditor
                    field={f}
                    split={own}
                    ctx={ctx}
                    type={typeOf(f)}
                    label={`${label} for input ${index + 1}`}
                    onChange={(s) => onChange({ ...input.overrides, [f]: s })}
                  />
                ) : (
                  <>
                    <p className="muted uses-default">Uses the split for every input:</p>
                    <SplitSummary split={defaults[f]} label={`${label} (all inputs), used by input ${index + 1}`} />
                  </>
                )}
              </SplitCard>
            );
          })}
        </div>
        <div className="modal-foot">
          <button className="primary" onClick={onDone}>
            Done
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
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
  const counts = group.counts.map((c) => c.count);
  const spreadEvenly = counts.length > 0 && Math.max(...counts) - Math.min(...counts) <= 1;

  const pickGroup = (name: string) => {
    const names = ctx.profileGroups.get(name) ?? [];
    const counts = evenCounts(Number.isFinite(total) ? total : 0, names.length);
    onChange({ profileGroup: name, counts: names.map((profileName, i) => ({ profileName, count: counts[i] })) });
  };
  const setTotal = (n: number) => {
    const counts = Number.isInteger(n) && n >= 0 ? evenCounts(n, group.counts.length) : group.counts.map(() => NaN);
    onChange({ ...group, counts: group.counts.map((c, i) => ({ ...c, count: counts[i] })) });
  };

  return (
    <div className="builder-card group-card">
      <div className="builder-row">
        <label className="field">
          <span>Profile Group</span>
          <select aria-label="Profile Group" value={group.profileGroup} onChange={(e) => pickGroup(e.target.value)}>
            {!groups.includes(group.profileGroup) && (
              <option value={group.profileGroup}>{group.profileGroup || "Pick…"}</option>
            )}
            {groups.map((g) => (
              <option key={g} value={g}>
                {g} ({plural(ctx.profileGroups.get(g)?.length ?? 0, "profile", "profiles")})
              </option>
            ))}
          </select>
        </label>
        <label className="field total-field">
          <span>Total tasks</span>
          <NumberInput
            label={`Total tasks for ${group.profileGroup || "this group"}`}
            className="total-input"
            value={total}
            step={1}
            onChange={setTotal}
          />
        </label>
        <span className="spacer" />
        <button className="remove" aria-label={`Remove profile group ${group.profileGroup}`} title="Remove" onClick={onRemove}>
          ×
        </button>
      </div>
      <div className="builder-row">
        <span className="muted">
          {spreadEvenly
            ? `Spread evenly over ${plural(group.counts.length, "profile", "profiles")}`
            : `Set per profile (${plural(group.counts.length, "profile", "profiles")})`}
        </span>
        <button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide profiles" : "Tasks per profile…"}
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
                  onChange({ ...group, counts: group.counts.map((x, j) => (j === i ? { ...x, count } : x)) })
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
  /** The input whose splits are open in the dialog, and its overrides when it opened (for Cancel). */
  const [editing, setEditing] = useState<{ k: number; saved: InputPlan["overrides"] } | null>(null);
  const setOverrides = (k: number, overrides: InputPlan["overrides"]) =>
    setPlan((p) => ({ ...p, inputs: p.inputs.map((x, j) => (j === k ? { ...x, overrides } : x)) }));

  const errors = useMemo(() => planErrors(plan, ctx), [plan, ctx]);
  const rows = useMemo(() => (errors.length ? null : generateRows(plan)), [plan, errors]);
  const after = useMemo(() => (rows ? breakdown(rows, ctx) : null), [rows, ctx]);

  /** The cell editor for a field's values; "Add site…" is left to the grid and Settings. */
  const typeOf = (f: SplitField): CellType<TaskContext> => {
    const t = ui.cell(C[f]);
    return t.kind === "select" ? { ...t, add: undefined } : t;
  };
  const total = planTotal(plan);
  const changed = !!after && JSON.stringify(after) !== JSON.stringify(before);

  return (
    <div className="task-layout">
      <div className="task-builder">
        <section>
          <h3>
            <span className="step">1</span> Profiles
          </h3>
          {plan.groups.map((g, gi) => (
            <GroupEditor
              key={gi}
              group={g}
              ctx={ctx}
              onChange={(ng) => setPlan((p) => ({ ...p, groups: p.groups.map((x, j) => (j === gi ? ng : x)) }))}
              onRemove={() => setPlan((p) => ({ ...p, groups: p.groups.filter((_, j) => j !== gi) }))}
            />
          ))}
          <button
            className="add-row"
            aria-label="Add profile group"
            title="Add a profile group"
            onClick={() => setPlan((p) => ({ ...p, groups: [...p.groups, { profileGroup: "", counts: [] }] }))}
          >
            +
          </button>
          <p className="grand-total" aria-label="Total tasks">
            Total: <strong>{Number.isFinite(total) ? total : "?"}</strong> tasks
          </p>
        </section>

        <section>
          <h3>
            <span className="step">2</span> Inputs
          </h3>
          <p className="muted">What share of the total tasks each input gets.</p>
          <div className="builder-card input-card">
            <PercentList<InputPlan>
              items={plan.inputs}
              label="Input"
              onChange={(inputs) => setPlan((p) => ({ ...p, inputs }))}
              newItem={() => ({ input: "", percent: 0, overrides: {} })}
              renderItem={(input, k, set) => {
                const custom = SPLIT_FIELDS.filter((f) => input.overrides[f]).map((f) => FIELD_LABELS[f]);
                return (
                  <>
                    <input
                      aria-label={`Input ${k + 1}`}
                      className="input-text"
                      placeholder="keywords, variant or SKU"
                      value={input.input}
                      spellCheck={false}
                      onChange={(e) => set({ input: e.target.value })}
                    />
                    <button aria-haspopup="dialog" onClick={() => setEditing({ k, saved: input.overrides })}>
                      {custom.length ? `Custom: ${custom.join(", ")}` : "Custom splits…"}
                    </button>
                  </>
                );
              }}
            />
          </div>
        </section>

        <section>
          <h3>
            <span className="step">3</span> Splits for every input
          </h3>
          <p className="muted">Each input's tasks are split like this, unless the input has a custom split.</p>
          <div className="builder-splits">
            {SPLIT_FIELDS.map((f) => (
              <SplitCard key={f} field={f}>
                <SplitEditor
                  field={f}
                  split={plan.defaults[f]}
                  ctx={ctx}
                  type={typeOf(f)}
                  label={`${FIELD_LABELS[f]} (all inputs)`}
                  onChange={(s) => setPlan((p) => ({ ...p, defaults: { ...p.defaults, [f]: s } }))}
                />
              </SplitCard>
            ))}
          </div>
        </section>

        <div className="toolbar builder-actions">
          <button className="primary" disabled={!rows || !changed} onClick={() => rows && onApply(rows, plan)}>
            Apply to file
          </button>
          <button disabled={plan === initial} onClick={onReset}>
            Reset to file
          </button>
          {rows && changed && (
            <span className="muted">
              Replaces every task row with {plural(rows.length, "generated row", "generated rows")}. Nothing is written
              until you save.
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

      {editing && plan.inputs[editing.k] && (
        <InputSplitsDialog
          input={plan.inputs[editing.k]}
          index={editing.k}
          defaults={plan.defaults}
          ctx={ctx}
          typeOf={typeOf}
          onChange={(overrides) => setOverrides(editing.k, overrides)}
          onDone={() => setEditing(null)}
          onCancel={() => {
            setOverrides(editing.k, editing.saved);
            setEditing(null);
          }}
        />
      )}

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
