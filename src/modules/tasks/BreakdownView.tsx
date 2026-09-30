// Tasks per profile group, input, proxy group, mode and the other fields, as
// rows with a count, a share and a bar. With `before`, each row shows how its
// count changes (for the builder's review step).
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

/** Values of `after`, then values only in `before` (now 0). */
function merged(after: Counts, before?: Counts): { value: string; count: number; was?: number }[] {
  if (!before) return after;
  const was = new Map(before.map((c) => [c.value, c.count]));
  const rows = after.map((c) => ({ ...c, was: was.get(c.value) ?? 0 }));
  for (const c of before) if (!after.some((a) => a.value === c.value)) rows.push({ value: c.value, count: 0, was: c.count });
  return rows;
}

function Rows({ counts, before, total, label }: { counts: Counts; before?: Counts; total: number; label: string }) {
  return (
    <table className="breakdown" aria-label={label}>
      <tbody>
        {merged(counts, before).map((c) => (
          <tr key={c.value} title={`${c.value === "" ? "(empty)" : c.value}: ${c.count} tasks (${share(c.count, total)})`}>
            <th scope="row">{c.value === "" ? <span className="muted">(empty)</span> : c.value}</th>
            <td className="bar-cell">
              <span className="bar" style={{ width: total ? `${(c.count * 100) / total}%` : 0 }} />
            </td>
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
  return (
    <div className="breakdown-view">
      <p className="breakdown-total">
        <strong>
          {changed && <span className="was">{before.total} → </span>}
          {b.total}
        </strong>{" "}
        {b.total === 1 ? "task" : "tasks"}
        {b.unknownRows > 0 && (
          <span className="error">
            {" "}
            · {b.unknownRows} {b.unknownRows === 1 ? "row" : "rows"} not counted (ALL in an unknown profile group, or no
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
