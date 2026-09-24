import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CellType } from "./types";

/** Option value that stands for "Add…" in a dropdown. */
export const ADD_OPTION = "\u0000add";

export interface CellProps<Ctx> {
  type: CellType<Ctx>;
  field: string;
  value: string;
  /** The whole row, for dropdowns whose options depend on other cells. */
  values: readonly string[];
  ctx: Ctx;
  error?: string;
  /** Saved value, when this cell was changed. */
  was?: string;
  label: string;
  /** The cell is being edited (text cells then show their text, not `display`). */
  focused?: boolean;
  disabled?: boolean;
  dataRow?: number;
  dataCol?: number;
  className?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** "Add…" was picked in a dropdown. */
  onRequestAdd?: () => void;
}

export function Cell<Ctx>(props: CellProps<Ctx>) {
  const { type, field, value, values, ctx, error, was, label, disabled, dataRow, dataCol, className } = props;
  const { onChange, onKeyDown, onFocus, onBlur, onRequestAdd } = props;
  const tips = [error && `${field} ${error}`, was !== undefined && `Was: ${was === "" ? "(empty)" : was}`].filter(Boolean);
  const common = {
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    title: tips.length ? tips.join("\n") : undefined,
    className: className ?? "cell",
    disabled,
    "data-row": dataRow,
    "data-col": dataCol,
    onKeyDown,
    onFocus,
    onBlur,
  };

  switch (type.kind) {
    case "select": {
      const options = type.options(values, ctx);
      const off = disabled || type.disabled?.(values);
      return (
        <select
          {...common}
          disabled={off}
          value={value}
          onChange={(e) => {
            if (e.target.value === ADD_OPTION) onRequestAdd?.();
            else onChange(e.target.value);
          }}
        >
          {!options.includes(value) && <option value={value}>{value === "" ? "" : `${value} (current)`}</option>}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {type.add && <option value={ADD_OPTION}>{type.add.label}</option>}
        </select>
      );
    }
    case "spin":
      return (
        <input
          {...common}
          type="number"
          min={type.min}
          step={type.step}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "parts":
      return <PartsCell {...props} type={type} />;
    case "text": {
      const random = type.random && value === "random";
      const shown = props.focused ? null : type.display?.(value);
      const input = (
        <input
          {...common}
          className={`${common.className}${random ? " is-random" : ""}${shown != null ? " has-display" : ""}`}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      );
      if (shown == null) return input;
      // The input stays underneath (for focus, keyboard moves and clicks); the view covers its text.
      return (
        <div className="display-cell">
          {input}
          <div className="cell-display" aria-hidden>
            {shown}
          </div>
        </div>
      );
    }
  }
}

/**
 * Ordered multi-select: the chosen parts as chips, in order. Clicking opens
 * an editor to add (at the end), remove and reorder parts.
 */
function PartsCell<Ctx>(props: CellProps<Ctx> & { type: Extract<CellType<Ctx>, { kind: "parts" }> }) {
  const { type, value, label, disabled, dataRow, dataCol, error, was, field, onChange, onKeyDown, onFocus, onBlur } = props;
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const parts = type.split(value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const set = (next: string[]) => onChange(next.join(""));
  const tips = [error && `${field} ${error}`, was !== undefined && `Was: ${was === "" ? "(empty)" : was}`].filter(Boolean);

  return (
    <div className="parts-cell" ref={boxRef}>
      <button
        type="button"
        className={props.className ?? "cell parts-button"}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-expanded={open}
        title={tips.length ? tips.join("\n") : undefined}
        disabled={disabled}
        data-row={dataRow}
        data-col={dataCol}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
            return;
          }
          onKeyDown?.(e);
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {parts ? (
          parts.length ? (
            parts.map((p, i) => (
              <span key={i} className="chip">
                {p}
              </span>
            ))
          ) : (
            <span className="muted">none</span>
          )
        ) : (
          <span className="chip unknown">{value}</span>
        )}
      </button>
      {open && (
        <div className="parts-editor" role="dialog" aria-label={`Edit ${label}`}>
          {parts ? (
            <ol>
              {parts.map((p, i) => (
                <li key={i}>
                  <span className="chip">{p}</span>
                  <button aria-label={`Move ${p} left`} disabled={i === 0} onClick={() => set(swap(parts, i, i - 1))}>
                    ←
                  </button>
                  <button
                    aria-label={`Move ${p} right`}
                    disabled={i === parts.length - 1}
                    onClick={() => set(swap(parts, i, i + 1))}
                  >
                    →
                  </button>
                  <button aria-label={`Remove ${p}`} onClick={() => set(parts.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="error">
              "{value}" isn't made of known parts. <button onClick={() => set([])}>Clear</button>
            </p>
          )}
          <select
            aria-label="Add part"
            value=""
            onChange={(e) => {
              if (e.target.value) set([...(parts ?? []), e.target.value]);
            }}
          >
            <option value="">Add part…</option>
            {type.parts.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}

function swap<T>(list: readonly T[], i: number, j: number): T[] {
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
