// Keyboard shortcuts: every action with its default keys, user overrides
// (saved in settings), key-combo parsing and a registry that the open views
// add their handlers to.
import { useEffect, useRef } from "react";

export const ACTIONS = [
  { id: "save", label: "Save file", keys: "Ctrl+S", whileTyping: true },
  { id: "saveAll", label: "Save all changed files", keys: "Ctrl+Shift+S", whileTyping: true },
  { id: "discard", label: "Discard changes to file", keys: null, whileTyping: false },
  { id: "selectAll", label: "Select all rows", keys: "Ctrl+A", whileTyping: false },
  { id: "clearSelection", label: "Clear row selection", keys: "Escape", whileTyping: false },
  { id: "addRow", label: "Add row", keys: "Ctrl+N", whileTyping: false },
  { id: "duplicate", label: "Duplicate selected rows", keys: "Ctrl+D", whileTyping: false },
  { id: "deleteRows", label: "Delete selected rows", keys: "Ctrl+Delete", whileTyping: false },
  { id: "moveUp", label: "Move selected rows up", keys: "Alt+ArrowUp", whileTyping: false },
  { id: "moveDown", label: "Move selected rows down", keys: "Alt+ArrowDown", whileTyping: false },
  { id: "bulkEdit", label: "Go to bulk edit", keys: "Ctrl+B", whileTyping: true },
  { id: "template", label: "From template", keys: "Ctrl+T", whileTyping: true },
  { id: "paste", label: "Paste rows", keys: "Ctrl+Shift+V", whileTyping: false },
  { id: "transfer", label: "Move / copy to group", keys: "Ctrl+M", whileTyping: true },
  { id: "backups", label: "Show backups", keys: "Ctrl+H", whileTyping: true },
  { id: "back", label: "Back to all groups", keys: "Alt+ArrowLeft", whileTyping: true },
  { id: "find", label: "Find a profile", keys: "Ctrl+F", whileTyping: true },
  { id: "refresh", label: "Refresh file list", keys: "F5", whileTyping: true },
  { id: "settings", label: "Open settings", keys: "Ctrl+,", whileTyping: true },
] as const satisfies readonly { id: string; label: string; keys: string | null; whileTyping: boolean }[];

export type ActionId = (typeof ACTIONS)[number]["id"];

/** Shortcut per action; null = none. */
export type Bindings = Record<ActionId, string | null>;

/** User changes on top of the defaults. */
export type BindingOverrides = Partial<Record<ActionId, string | null>>;

export const DEFAULT_BINDINGS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.keys])) as Bindings;

export function resolveBindings(overrides: BindingOverrides): Bindings {
  const out = { ...DEFAULT_BINDINGS };
  for (const a of ACTIONS) if (a.id in overrides) out[a.id] = overrides[a.id] ?? null;
  return out;
}

/** Overrides that turn the defaults into `bindings` (only what differs). */
export function overridesFor(bindings: Bindings): BindingOverrides {
  const out: BindingOverrides = {};
  for (const a of ACTIONS) if (bindings[a.id] !== a.keys) out[a.id] = bindings[a.id];
  return out;
}

export function actionForCombo(bindings: Bindings, combo: string): ActionId | undefined {
  return ACTIONS.find((a) => bindings[a.id] === combo)?.id;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "OS"]);

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** "Ctrl+Shift+S" style name for a key press, or null for a bare modifier. */
export function comboFromEvent(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key) || e.key === "Dead" || e.key === "Unidentified") return null;
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

const ALLOWED_WITHOUT_MODIFIER = /^(F([1-9]|1[0-2])|Escape)$/;

/**
 * Why a combo can't be used as a shortcut, or null if it can. Without Ctrl
 * or Alt it would get in the way of typing in cells.
 */
export function comboError(combo: string): string | null {
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const hasCtrlOrAlt = parts.includes("Ctrl") || parts.includes("Alt");
  if (!hasCtrlOrAlt && !ALLOWED_WITHOUT_MODIFIER.test(key)) {
    return "Use Ctrl or Alt with it (plain keys are for typing). F1–F12 and Escape work alone.";
  }
  return null;
}

type Handlers = Partial<Record<ActionId, () => void>>;

/** Views register handlers; the most recently registered one wins. */
export class ShortcutRegistry {
  private layers: { get: () => Handlers }[] = [];
  /** While true (e.g. recording a new shortcut), nothing runs. */
  paused = false;

  register(get: () => Handlers): () => void {
    const layer = { get };
    this.layers.push(layer);
    return () => {
      this.layers = this.layers.filter((l) => l !== layer);
    };
  }

  /** Runs the action if some view handles it. True if it ran. */
  run(id: ActionId): boolean {
    if (this.paused) return false;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const fn = this.layers[i].get()[id];
      if (fn) {
        fn();
        return true;
      }
    }
    return false;
  }
}

export const shortcuts = new ShortcutRegistry();

/** Registers this component's handlers (always the latest ones) while mounted. */
export function useShortcuts(handlers: Handlers, registry: ShortcutRegistry = shortcuts): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => registry.register(() => ref.current), [registry]);
}

/** Like useShortcuts, for handlers assigned to a ref later in render. */
export function useShortcutsRef(ref: { current: Handlers }, registry: ShortcutRegistry = shortcuts): void {
  useEffect(() => registry.register(() => ref.current), [registry, ref]);
}

/** True for text fields outside the spreadsheet grid, where typing shouldn't trigger most shortcuts. */
export function isTypingOutsideGrid(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const typing = target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox");
  return typing && !target.closest(".grid");
}

/** Browser keys that would reload the page and lose unsaved changes. */
export const BLOCKED_COMBOS = new Set(["F5", "Ctrl+R", "Ctrl+Shift+R"]);

/**
 * Handles a keydown for the whole app: blocks page reloads, then runs the
 * bound action if a view handles it.
 */
export function handleShortcutKey(e: KeyboardEvent, bindings: Bindings, registry: ShortcutRegistry = shortcuts): void {
  if (registry.paused) return;
  const combo = comboFromEvent(e);
  if (!combo) return;
  if (BLOCKED_COMBOS.has(combo)) e.preventDefault();
  const id = actionForCombo(bindings, combo);
  if (!id) return;
  const action = ACTIONS.find((a) => a.id === id)!;
  if (!action.whileTyping && isTypingOutsideGrid(e.target)) return;
  if (registry.run(id)) e.preventDefault();
}
