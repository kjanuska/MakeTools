// Tasks per profile group, input, proxy group, mode and the other fields: one
// table per field with its tasks and share. With `before` (the file now), the
// tables show the file's counts next to the new ones.
import { BREAKDOWN_FIELDS, FIELD_LABELS, type Breakdown, type BreakdownField } from "./build";

export const BREAKDOWN_LABELS: Record<BreakdownField, string> = {
  profileGroup: "Profile Groups",
  input: "Inputs",
  proxyGroup: "Proxy Groups",
  mode: "Modes",
  site: "Sites",
  size: "Sizes",
  color: "Colors",
  accountGroup: "Account Groups",
  cartQuantity: "Cart Quantity",
  delay: "Delay (ms)",
};

type Counts = { value: string; count: number }[];

const share = (n: number, total: number) => (total ? `${Math.round((n * 1000) / total) / 10}%` : "–");
const sumOf = (counts: Counts) => counts.reduce((a, c) => a + c.count, 0);

/** With `before`: its values first (in its order, so rows don't jump around), then new ones. */
function merged(after: Counts, before?: Counts): { value: string; count: number; was?: number }[] {
  if (!before) return after;
  const now = new Map(after.map((c) => [c.value, c.count]));
  const rows = before.map((c) => ({ value: c.value, count: now.get(c.value) ?? 0, was: c.count }));
  for (const c of after) if (!before.some((b) => b.value === c.value)) rows.push({ ...c, was: 0 });
  return rows;
}

/** True if both give the same count for every value, in any order (so there's nothing to compare). */
function sameCounts(a: Breakdown, b: Breakdown): boolean {
  const list = (counts: Counts) => counts.map((c) => `${c.value}\u0000${c.count}`).sort();
  const key = (x: Breakdown) =>
    JSON.stringify([
      x.total,
      BREAKDOWN_FIELDS.map((f) => list(x.by[f])),
      [...x.profiles].map(([g, counts]) => [g, list(counts)]).sort(),
    ]);
  return key(a) === key(b);
}

/**
 * One field's counts as a table: value, tasks and share, with a total row.
 * With `before`, the tasks column becomes "Now" and "New", and changed
 * counts are marked.
 */
function CountsTable({
  counts,
  before,
  total,
  label,
  valueHeader,
}: {
  counts: Counts;
  before?: Counts;
  total: number;
  label: string;
  valueHeader: string;
}) {
  const rows = merged(counts, before);
  return (
    <table className="breakdown" aria-label={label}>
      <colgroup>
        <col />
        {before && <col className="num-col" />}
        <col className="num-col" />
        <col className="num-col" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{valueHeader}</th>
          {before && (
            <th scope="col" className="num">
              Now
            </th>
          )}
          <th scope="col" className="num">
            {before ? "New" : "Tasks"}
          </th>
          <th scope="col" className="num">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const changed = c.was !== undefined && c.was !== c.count;
          return (
            <tr key={c.value}>
              <th scope="row" title={c.value}>
                {c.value === "" ? <span className="muted">(empty)</span> : c.value}
              </th>
              {before && <td className="num muted">{c.was}</td>}
              <td className={changed ? "num changed-num" : "num"}>{c.count}</td>
              <td className="num muted">{share(c.count, total)}</td>
            </tr>
          );
        })}
      </tbody>
      {rows.length > 1 && (
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {before && <td className="num">{sumOf(before)}</td>}
            <td className="num">{sumOf(counts)}</td>
            <td className="num muted">{total ? "100%" : "–"}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export function BreakdownView({ b: after, before }: { b: Breakdown; before?: Breakdown }) {
  // Rows that can't be counted are a property of the file, not of a build.
  const unknown = before ? before.unknownRows : after.unknownRows;
  const was = before && !sameCounts(before, after) ? before : undefined;
  // Nothing would change: show the file's own counts, in its order.
  const b = before && !was ? before : after;
  return (
    <div className="breakdown-view">
      <p className="breakdown-total">
        <strong>
          {was && was.total !== b.total && <span className="was">{was.total} → </span>}
          {b.total}
        </strong>{" "}
        {b.total === 1 ? "task" : "tasks"}
        {unknown > 0 && (
          <span className="error">
            {" "}
            · {unknown} {unknown === 1 ? "row" : "rows"} in the file not counted (ALL in an unknown profile group, or no
            profileName)
          </span>
        )}
      </p>
      {was && <p className="muted breakdown-note">Now: the file as it is. New: what Apply would give.</p>}
      <div className="breakdown-grid">
        {BREAKDOWN_FIELDS.map((f) => (
          <section key={f} className="breakdown-card">
            <CountsTable
              counts={b.by[f]}
              before={was?.by[f]}
              total={b.total}
              label={BREAKDOWN_LABELS[f]}
              valueHeader={FIELD_LABELS[f]}
            />
            {f === "profileGroup" &&
              b.by.profileGroup.map(({ value, count }) => (
                <details key={value} className="breakdown-profiles">
                  <summary>Profiles in {value}</summary>
                  <CountsTable
                    counts={b.profiles.get(value) ?? []}
                    before={was ? (was.profiles.get(value) ?? []) : undefined}
                    total={count}
                    label={`Profiles in ${value}`}
                    valueHeader="Profile"
                  />
                </details>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
