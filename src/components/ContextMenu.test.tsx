import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, type MenuItem } from "./ContextMenu";

function setup(items: Partial<MenuItem>[] = [{}, {}, {}], note?: string) {
  const selected: string[] = [];
  const onClose = vi.fn();
  const full = items.map((it, i) => ({ label: `Item ${i + 1}`, onSelect: () => selected.push(`Item ${i + 1}`), ...it }));
  render(
    <>
      <button>outside</button>
      <ContextMenu x={50} y={60} items={full} label="p.txt" note={note} onClose={onClose} />
    </>,
  );
  return { selected, onClose, menu: screen.getByRole("menu", { name: "p.txt" }) };
}

const item = (name: string) => screen.getByRole("menuitem", { name }) as HTMLButtonElement;

describe("ContextMenu", () => {
  it("shows the items at the position and focuses the first enabled one", () => {
    const { menu } = setup([{ disabled: true }, {}, {}]);
    expect(menu.style.left).toBe("50px");
    expect(menu.style.top).toBe("60px");
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Item 1", "Item 2", "Item 3"]);
    expect(document.activeElement).toBe(item("Item 2"));
  });

  it("picking an item closes the menu and runs it", () => {
    const { selected, onClose } = setup();
    fireEvent.click(item("Item 2"));
    expect(onClose).toHaveBeenCalled();
    expect(selected).toEqual(["Item 2"]);
  });

  it("disabled items can't be picked", () => {
    const { selected } = setup([{ disabled: true, title: "why" }]);
    expect(item("Item 1").disabled).toBe(true);
    expect(item("Item 1").title).toBe("why");
    fireEvent.click(item("Item 1"));
    expect(selected).toEqual([]);
  });

  it("arrow keys move between enabled items, wrapping around", () => {
    const { menu } = setup([{}, { disabled: true }, {}]);
    expect(document.activeElement).toBe(item("Item 1"));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Item 3"));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Item 1"));
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Item 3"));
  });

  it("Escape, a click outside, scrolling or resizing closes it", () => {
    const { menu, onClose } = setup();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("a click inside doesn't close it", () => {
    const { menu, onClose } = setup();
    fireEvent.mouseDown(menu);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("danger items are marked, and a note is shown", () => {
    setup([{ danger: true }], "Save first.");
    expect(item("Item 1").className).toBe("danger");
    expect(screen.getByText("Save first.")).toBeTruthy();
  });
});
