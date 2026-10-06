// In-app dialogs (themed like the rest of the app, unlike the native message
// boxes). `showDialog` queues a dialog and resolves to the value of the button
// the user picked; one dialog is shown at a time, in order.

export type DialogKind = "info" | "warning" | "error";

export interface DialogButton<T> {
  label: string;
  value: T;
  /** The highlighted button; it gets focus when the dialog opens. */
  primary?: boolean;
}

export interface DialogSpec<T> {
  title: string;
  text: string;
  kind: DialogKind;
  buttons: DialogButton<T>[];
  /** Picked by Escape. */
  cancelValue: T;
}

export interface OpenDialog {
  id: number;
  spec: DialogSpec<unknown>;
  resolve: (value: unknown) => void;
}

let queue: OpenDialog[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showDialog<T>(spec: DialogSpec<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    queue = [...queue, { id: nextId++, spec: spec as DialogSpec<unknown>, resolve: resolve as (v: unknown) => void }];
    emit();
  });
}

/** The dialog on screen, or null. */
export function currentDialog(): OpenDialog | null {
  return queue[0] ?? null;
}

/** Closes the dialog on screen with `value` and shows the next one. */
export function closeDialog(id: number, value: unknown): void {
  const d = queue[0];
  if (!d || d.id !== id) return;
  queue = queue.slice(1);
  d.resolve(value);
  emit();
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
