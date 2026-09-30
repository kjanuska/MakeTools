// Tasks per profile group, input, proxy group, mode and the other fields, as
// rows with a count and a share. With `before` (the file now), each row shows
// how its count would change.
import { BREAKDOWN_FIELDS, type Breakdown, type BreakdownField } from "./build";

export const BREAKDOWN_LABELS: Record<BreakdownField, string> = {
  profileGroup: "Profile groups",
  input: "Inputs",
  proxyGroup: "Proxy groups",
  mode: "Modes",
  site: "Sites",
  size: "Sizes",
  color: "Colors",
  accountGroup: "Account groups",
  cartQuantity: "Cart quantity",
  delay: "Delay (ms)",
};

type Counts = { value: string; count: number }[];

const share = (n: number, total: number) => (total ? `${Math.round((n * 1000) / total) / 10}%` : "–");

/** With `before`: its values first (in its order, so rows don't jump around), then new ones. */
function merged(after: Counts, before?: Counts): { value: string; count: number; was?: number }[] {
  if (!before) return after;
  const now = new Map(after.map((c) => [c.value, c.count]));
  const rows = before.map((c) => ({ value: c.value, count: now.get(c.value) ?? 0, was: c.count }));
  for (const c of after) if (!before.some((b) => b.value === c.value)) rows.push({ ...c, was: 0 });
  return rows;
}

function Rows({ counts, before, total, label }: { counts: Counts; before?: Counts; total: number; label: string }) {
  return (
    <table className="breakdown" aria-label={label}>
      <tbody>
        {merged(counts, before).map((c) => (
          <tr key={c.value} title={`${c.value === "" ? "(empty)" : c.value}: ${c.count} tasks (${share(c.count, total)})`}>
            <th scope="row">{c.value === "" ? <span className="muted">(empty)</span> : c.value}</th>
            <td className="num">
              {c.was !== undefined && c.was !== c.count && <span className="was">{c.was} → </span>}
              {c.count}
            </td>
            <td className="num muted">{share(c.count, total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BreakdownView({ b, before }: { b: Breakdown; before?: Breakdown }) {
  const changed = before && before.total !== b.total;
  // Rows that can't be counted are a property of the file, not of a build.
  const unknown = before ? before.unknownRows : b.unknownRows;
  return (
    <div className="breakdown-view">
      <p className="breakdown-total">
        <strong>
          {changed && <span className="was">{before.total} → </span>}
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
      <div className="breakdown-grid">
        {BREAKDOWN_FIELDS.map((f) => (
          <section key={f}>
            <h3>{BREAKDOWN_LABELS[f]}</h3>
            <Rows counts={b.by[f]} before={before?.by[f]} total={b.total} label={BREAKDOWN_LABELS[f]} />
            {f === "profileGroup" &&
              b.by.profileGroup.map(({ value, count }) => (
                <details key={value} className="breakdown-profiles">
                  <summary>Profiles in {value}</summary>
                  <Rows
                    counts={b.profiles.get(value) ?? []}
                    before={before?.profiles.get(value)}
                    total={count}
                    label={`Profiles in ${value}`}
                  />
                </details>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
