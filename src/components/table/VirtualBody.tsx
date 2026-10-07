// Draws only the rows of a long table that are in view (plus a margin), so a
// file with thousands of rows opens and scrolls without freezing. Empty rows
// above and below stand in for the rest, so the scrollbar stays true to size.
// Short tables (up to VIRTUAL_MIN_ROWS) are drawn whole, as before.
//
// Scrolling only re-renders this <tbody>, not the page around it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** Tables with more rows than this draw only the rows in view. */
export const VIRTUAL_MIN_ROWS = 200;
/** Rows drawn above and below the ones in view, so scrolling and arrow keys never meet a gap. */
export const OVERSCAN = 30;
/** Rows drawn before the first measurement (and where there's no layout, as in tests). */
export const INITIAL_ROWS = 100;
const DEFAULT_ROW_HEIGHT = 28;

export interface VirtualHandle {
  /** Makes row `index` drawn and roughly in view, then calls `then` once it's in the DOM. */
  reveal(index: number, then?: () => void): void;
}

interface Range {
  start: number;
  end: number;
}

interface Props<T> {
  items: readonly T[];
  /** Number of columns, for the stand-in rows. */
  colSpan: number;
  renderRow: (item: T, index: number) => ReactNode;
  /** Filled in with this body's handle, for revealing a row that may not be drawn. */
  handle?: RefObject<VirtualHandle | null>;
}

const clampRange = (start: number, end: number, count: number): Range => ({
  start: Math.max(0, Math.min(start, count)),
  end: Math.max(0, Math.min(end, count)),
});

/** The nearest ancestor that scrolls vertically, or null for the page itself. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

export function VirtualBody<T>({ items, colSpan, renderRow, handle }: Props<T>) {
  const count = items.length;
  const virtual = count > VIRTUAL_MIN_ROWS;
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [range, setRange] = useState<Range>(() => clampRange(0, INITIAL_ROWS, count));
  const rowHeight = useRef(DEFAULT_ROW_HEIGHT);
  const afterRender = useRef<(() => void) | null>(null);

  const shown = virtual ? clampRange(range.start, Math.max(range.end, range.start + 1), count) : { start: 0, end: count };
  const padTop = shown.start * rowHeight.current;
  const padBottom = (count - shown.end) * rowHeight.current;
  const live = useRef({ shown, padTop, padBottom, count });
  live.current = { shown, padTop, padBottom, count };

  /** The scroller's viewport, and where the body's top is within it (negative once scrolled past). */
  const viewport = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return null;
    const scroller = scrollParent(body);
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const height = scroller ? scroller.clientHeight : window.innerHeight;
    return { scroller, bodyTop: body.getBoundingClientRect().top - viewTop, height };
  }, []);

  const measure = useCallback(() => {
    const body = bodyRef.current;
    const { shown, padTop, padBottom } = live.current;
    const drawn = shown.end - shown.start;
    if (!body || drawn === 0) return;
    const h = (body.getBoundingClientRect().height - padTop - padBottom) / drawn;
    if (h > 0 && Number.isFinite(h)) rowHeight.current = h;
  }, []);

  /** Leaves a cell being edited properly (so its blur clean-up runs) before its row stops being drawn. */
  const blurIfLeaving = useCallback((next: Range) => {
    const body = bodyRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (!body || !active || !body.contains(active)) return;
    const tr = active.closest("tr");
    if (!tr) return;
    const index = live.current.shown.start + Array.prototype.indexOf.call(body.rows, tr) - 1; // row 0 is the top stand-in
    if (index < next.start || index >= next.end) active.blur();
  }, []);

  const update = useCallback(() => {
    const v = viewport();
    if (!v || v.height <= 0) return;
    measure();
    const h = rowHeight.current;
    const { count } = live.current;
    const inView = Math.ceil(v.height / h);
    // Scrolled past the end (rows were just removed): the last rows are the ones in view.
    const first = Math.min(Math.floor(Math.max(0, -v.bodyTop) / h), Math.max(0, count - inView));
    const next = clampRange(first - OVERSCAN, first + inView + OVERSCAN, count);
    const cur = live.current.shown;
    if (cur.start === next.start && cur.end === next.end) return;
    blurIfLeaving(next);
    setRange(next);
  }, [viewport, measure, blurIfLeaving]);

  // Follow the scroller and its size.
  useEffect(() => {
    if (!virtual) return;
    const body = bodyRef.current;
    if (!body) return;
    const scroller = scrollParent(body);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    if (scroller) ro?.observe(scroller);
    update();
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      ro?.disconnect();
    };
  }, [virtual, update]);

  // Rows added or removed: redo the window.
  useLayoutEffect(() => {
    if (virtual) update();
  }, [virtual, count, update]);

  // Run whatever was waiting for a revealed row to be drawn.
  useEffect(() => {
    const f = afterRender.current;
    afterRender.current = null;
    f?.();
  });

  const reveal = useCallback(
    (index: number, then?: () => void) => {
      const { shown, count } = live.current;
      if (index >= shown.start && index < shown.end) {
        then?.();
        return;
      }
      if (!virtual) {
        then?.();
        return;
      }
      const v = viewport();
      const h = rowHeight.current;
      const inView = v && v.height > 0 ? Math.ceil(v.height / h) : INITIAL_ROWS;
      if (v && v.height > 0) {
        // Put the row in the middle of the view; the caller's scrollIntoView does the fine placement.
        const top = v.scroller ? v.scroller.scrollTop : window.scrollY;
        const target = top + v.bodyTop + index * h - (v.height - h) / 2;
        if (v.scroller) v.scroller.scrollTop = Math.max(0, target);
        else window.scrollTo(0, Math.max(0, target));
      }
      const next = clampRange(index - inView - OVERSCAN, index + inView + OVERSCAN, count);
      blurIfLeaving(next);
      afterRender.current = then ?? null;
      setRange(next);
    },
    [virtual, viewport, blurIfLeaving],
  );

  useEffect(() => {
    if (!handle) return;
    handle.current = { reveal };
    return () => {
      handle.current = null;
    };
  }, [handle, reveal]);

  return (
    <tbody ref={bodyRef}>
      {virtual && <Pad colSpan={colSpan} height={padTop} />}
      {items.slice(shown.start, shown.end).map((item, k) => renderRow(item, shown.start + k))}
      {virtual && <Pad colSpan={colSpan} height={padBottom} />}
    </tbody>
  );
}

/** An empty row standing in for the rows above or below the ones drawn. */
function Pad({ colSpan, height }: { colSpan: number; height: number }) {
  return (
    <tr className="virtual-pad" aria-hidden="true">
      <td colSpan={colSpan} style={{ height }} />
    </tr>
  );
}
