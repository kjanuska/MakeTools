import { describe, expect, it, vi } from "vitest";
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  ShortcutRegistry,
  actionForCombo,
  comboError,
  comboFromEvent,
  handleShortcutKey,
  overridesFor,
  resolveBindings,
} from "./shortcuts";

const key = (key: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe("combos", () => {
  it.each([
    [key("s", { ctrl: true }), "Ctrl+S"],
    [key("S", { ctrl: true, shift: true }), "Ctrl+Shift+S"],
    [key("ArrowUp", { alt: true }), "Alt+ArrowUp"],
    [key("Delete", { ctrl: true }), "Ctrl+Delete"],
    [key(",", { ctrl: true }), "Ctrl+,"],
    [key(" ", { ctrl: true }), "Ctrl+Space"],
    [key("F5"), "F5"],
    [key("Escape"), "Escape"],
    [key("a", { meta: true }), "Ctrl+A"],
    [key("Control", { ctrl: true }), null],
    [key("Shift", { shift: true }), null],
  ])("%j -> %s", (e, combo) => {
    expect(comboFromEvent(e)).toBe(combo);
  });

  it("requires Ctrl or Alt except for F-keys and Escape", () => {
    for (const ok of ["Ctrl+S", "Alt+ArrowUp", "Ctrl+Shift+V", "F5", "F12", "Escape"]) expect(comboError(ok), ok).toBeNull();
    for (const bad of ["A", "Shift+A", "Delete", "Enter", "ArrowUp", "Shift+F13", "Space"]) expect(comboError(bad), bad).not.toBeNull();
  });
});

describe("bindings", () => {
  it("every action has a unique id and the defaults don't clash", () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = ACTIONS.map((a) => a.keys).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(comboError(k!), k!).toBeNull();
  });

  it("has the shortcuts the user asked for", () => {
    expect(DEFAULT_BINDINGS.selectAll).toBe("Ctrl+A");
    expect(DEFAULT_BINDINGS.save).toBe("Ctrl+S");
  });

  it("applies overrides, including removing a shortcut", () => {
    const b = resolveBindings({ save: "Ctrl+Alt+S", duplicate: null });
    expect(b.save).toBe("Ctrl+Alt+S");
    expect(b.duplicate).toBeNull();
    expect(b.addRow).toBe(DEFAULT_BINDINGS.addRow);
  });

  it("ignores unknown override keys", () => {
    expect(resolveBindings({ nope: "Ctrl+Q" } as never)).toEqual(DEFAULT_BINDINGS);
  });

  it("overridesFor stores only differences", () => {
    expect(overridesFor(DEFAULT_BINDINGS)).toEqual({});
    expect(overridesFor({ ...DEFAULT_BINDINGS, save: null, addRow: "Ctrl+Q" })).toEqual({ save: null, addRow: "Ctrl+Q" });
  });

  it("finds the action for a combo", () => {
    expect(actionForCombo(DEFAULT_BINDINGS, "Ctrl+S")).toBe("save");
    expect(actionForCombo(DEFAULT_BINDINGS, "Ctrl+Q")).toBeUndefined();
  });
});

describe("registry and key handling", () => {
  function event(k: ReturnType<typeof key>, target: EventTarget | null = document.body) {
    const e = new KeyboardEvent("keydown", { ...k, cancelable: true });
    Object.defineProperty(e, "target", { value: target });
    return e;
  }

  it("runs the most recently registered handler", () => {
    const r = new ShortcutRegistry();
    const a = vi.fn();
    const b = vi.fn();
    r.register(() => ({ save: a }));
    const off = r.register(() => ({ save: b }));
    expect(r.run("save")).toBe(true);
    expect(b).toHaveBeenCalledOnce();
    off();
    r.run("save");
    expect(a).toHaveBeenCalledOnce();
    expect(r.run("addRow")).toBe(false);
  });

  it("falls through to an older layer for actions the newer one doesn't handle", () => {
    const r = new ShortcutRegistry();
    const saveAll = vi.fn();
    r.register(() => ({ saveAll }));
    r.register(() => ({ save: vi.fn() }));
    r.run("saveAll");
    expect(saveAll).toHaveBeenCalled();
  });

  it("does nothing while paused", () => {
    const r = new ShortcutRegistry();
    const fn = vi.fn();
    r.register(() => ({ save: fn }));
    r.paused = true;
    const e = event(key("s", { ctrl: true }));
    handleShortcutKey(e, DEFAULT_BINDINGS, r);
    expect(fn).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("runs the bound action and prevents the browser default", () => {
    const r = new ShortcutRegistry();
    const fn = vi.fn();
    r.register(() => ({ save: fn }));
    const e = event(key("s", { ctrl: true }));
    handleShortcutKey(e, DEFAULT_BINDINGS, r);
    expect(fn).toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves unhandled keys alone", () => {
    const r = new ShortcutRegistry();
    const e = event(key("s", { ctrl: true }));
    handleShortcutKey(e, DEFAULT_BINDINGS, r);
    expect(e.defaultPrevented).toBe(false);
  });

  it("always blocks page reloads", () => {
    const r = new ShortcutRegistry();
    for (const k of [key("r", { ctrl: true }), key("F5"), key("R", { ctrl: true, shift: true })]) {
      const e = event(k);
      handleShortcutKey(e, { ...DEFAULT_BINDINGS, refresh: null }, r);
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it("in a text field outside the grid only runs actions meant for typing", () => {
    const r = new ShortcutRegistry();
    const selectAll = vi.fn();
    const save = vi.fn();
    r.register(() => ({ selectAll, save }));
    const input = document.createElement("input");
    const ctrlA = event(key("a", { ctrl: true }), input);
    handleShortcutKey(ctrlA, DEFAULT_BINDINGS, r);
    expect(selectAll).not.toHaveBeenCalled();
    expect(ctrlA.defaultPrevented).toBe(false);
    handleShortcutKey(event(key("s", { ctrl: true }), input), DEFAULT_BINDINGS, r);
    expect(save).toHaveBeenCalled();
  });

  it("in a grid cell, Ctrl+A is left to the cell; other actions run", () => {
    const r = new ShortcutRegistry();
    const selectAll = vi.fn();
    const addRow = vi.fn();
    r.register(() => ({ selectAll, addRow }));
    const table = document.createElement("table");
    table.className = "grid";
    const input = document.createElement("input");
    table.appendChild(input);
    const ctrlA = event(key("a", { ctrl: true }), input);
    handleShortcutKey(ctrlA, DEFAULT_BINDINGS, r);
    expect(selectAll).not.toHaveBeenCalled();
    expect(ctrlA.defaultPrevented).toBe(false);
    handleShortcutKey(event(key("n", { ctrl: true }), input), DEFAULT_BINDINGS, r);
    expect(addRow).toHaveBeenCalled();
  });

  it("a grid dropdown isn't a text box, so Ctrl+A selects rows there", () => {
    const r = new ShortcutRegistry();
    const selectAll = vi.fn();
    r.register(() => ({ selectAll }));
    const table = document.createElement("table");
    table.className = "grid";
    const select = document.createElement("select");
    table.appendChild(select);
    handleShortcutKey(event(key("a", { ctrl: true }), select), DEFAULT_BINDINGS, r);
    expect(selectAll).toHaveBeenCalled();
  });
});
