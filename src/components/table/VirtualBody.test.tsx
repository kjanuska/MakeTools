import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_ROWS, OVERSCAN, VIRTUAL_MIN_ROWS, VirtualBody, type VirtualHandle } from "./VirtualBody";

const ROW = 28;
const VIEW = 280; // 10 rows in view

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function Table({ count, handle, onBlur }: { count: number; handle?: React.RefObject<VirtualHandle | null>; onBlur?: (i: number) => void }) {
  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <table>
        <VirtualBody
          items={range(count)}
          colSpan={2}
          handle={handle}
          renderRow={(item, i) => (
            <tr key={item}>
              <th scope="row">{`Row ${i + 1}`}</th>
              <td>
                <input aria-label={`Cell ${item}`} onBlur={() => onBlur?.(item)} />
              </td>
            </tr>
          )}
        />
      </table>
    </div>
  );
}

/** Row numbers drawn, in order. */
const drawn = () => screen.queryAllByRole("rowheader").map((th) => Number(th.textContent!.slice(4)) - 1);
const pads = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLTableCellElement>("tr.virtual-pad td")].map((td) => parseFloat(td.style.height));

describe("VirtualBody without layout (as in tests)", () => {
  it("draws every row of a short table, with no stand-in rows", () => {
    const { container } = render(<Table count={VIRTUAL_MIN_ROWS} />);
    expect(drawn()).toEqual(range(VIRTUAL_MIN_ROWS));
    expect(container.querySelectorAll("tr.virtual-pad")).toHaveLength(0);
  });

  it("draws only the first rows of a long table, with a stand-in for the rest", () => {
    const { container } = render(<Table count={5000} />);
    expect(drawn()).toEqual(range(INITIAL_ROWS));
    expect(pads(container)).toEqual([0, (5000 - INITIAL_ROWS) * ROW]);
  });

  it("reveal draws a row that wasn't, then calls back once it's in the DOM", () => {
    const handle = createRef<VirtualHandle>();
    render(<Table count={5000} handle={handle} />);
    let found: HTMLElement | null = null;
    act(() => handle.current!.reveal(4321, () => (found = screen.getByLabelText("Cell 4321"))));
    expect(found).not.toBeNull();
    expect(drawn()).toContain(4321);
    expect(drawn()).not.toContain(0);
  });

  it("reveal of a drawn row calls back straight away", () => {
    const handle = createRef<VirtualHandle>();
    render(<Table count={5000} handle={handle} />);
    const then = vi.fn();
    act(() => handle.current!.reveal(5, then));
    expect(then).toHaveBeenCalledTimes(1);
    expect(drawn()).toEqual(range(INITIAL_ROWS));
  });
});

describe("VirtualBody with a simulated layout", () => {
  let scroller: HTMLElement | undefined;
  let total = 0;
  beforeEach(() => {
    scroller = undefined;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
      f(0);
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "scroller" ? VIEW : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      // The scroller sits at the top of the window; the body moves up as it scrolls.
      const top = this.tagName === "TBODY" ? -(scroller?.scrollTop ?? 0) : 0;
      const height = this.tagName === "TBODY" ? total * ROW : VIEW;
      return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} } as DOMRect;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(count: number, onBlur?: (i: number) => void) {
    total = count;
    const handle = createRef<VirtualHandle>();
    const r = render(<Table count={count} handle={handle} onBlur={onBlur} />);
    scroller = screen.getByTestId("scroller");
    return { ...r, handle };
  }

  function scrollTo(top: number) {
    scroller!.scrollTop = top;
    fireEvent.scroll(scroller!);
  }

  it("draws the rows in view plus the margin, and moves with scrolling", () => {
    const { container } = setup(5000);
    expect(drawn()).toEqual(range(10 + OVERSCAN));
    scrollTo(1000 * ROW);
    expect(drawn()).toEqual(range(10 + 2 * OVERSCAN).map((i) => 1000 - OVERSCAN + i));
    // The stand-ins keep the full height, so the scrollbar stays true.
    const [top, bottom] = pads(container);
    expect(top + drawn().length * ROW + bottom).toBe(5000 * ROW);
    scrollTo(5000 * ROW - VIEW);
    expect(drawn().slice(-1)[0]).toBe(4999);
    expect(pads(container)[1]).toBe(0);
  });

  it("blurs a cell being edited before its row stops being drawn", () => {
    const onBlur = vi.fn();
    setup(5000, onBlur);
    const input = screen.getByLabelText("Cell 3");
    input.focus();
    scrollTo(20 * ROW); // row 3 is still within the margin
    expect(onBlur).not.toHaveBeenCalled();
    scrollTo(2000 * ROW);
    expect(onBlur).toHaveBeenCalledWith(3);
  });

  it("reveal scrolls the row into the middle of the view", () => {
    const { handle } = setup(5000);
    const then = vi.fn();
    act(() => handle.current!.reveal(3000, then));
    expect(then).toHaveBeenCalledTimes(1);
    expect(scroller!.scrollTop).toBe(3000 * ROW - (VIEW - ROW) / 2);
    expect(drawn()).toContain(3000);
  });

  it("redraws the window when rows are removed", () => {
    const { rerender } = setup(5000);
    scrollTo(4900 * ROW);
    total = 300;
    rerender(<Table count={300} />);
    expect(drawn().slice(-1)[0]).toBe(299);
  });
});
