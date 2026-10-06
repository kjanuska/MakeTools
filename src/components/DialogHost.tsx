// Draws the dialog queued by `showDialog` (lib/dialogStore) over the app.
// While it's open, keys don't reach the app (no shortcuts, no reload); Escape
// picks the cancel value and Tab stays inside the dialog.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { closeDialog, currentDialog, subscribeDialogs } from "../lib/dialogStore";

const ICONS = { info: "i", warning: "!", error: "×" } as const;

export function DialogHost() {
  const dialog = useSyncExternalStore(subscribeDialogs, currentDialog);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const box = ref.current!;
    const buttons = () => [...box.querySelectorAll<HTMLButtonElement>("button")];
    (box.querySelector<HTMLButtonElement>("button.primary") ?? buttons()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        closeDialog(dialog.id, dialog.spec.cancelValue);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const list = buttons();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + list.length) % list.length;
        list[next]?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const list = buttons();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowLeft" ? -1 : 1)));
        list[next]?.focus();
      } else if (!(e.key === "Enter" || e.key === " ") || !box.contains(document.activeElement)) {
        // Enter/Space press the focused button; everything else is swallowed.
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [dialog]);

  if (!dialog) return null;
  const { spec } = dialog;
  const titleId = `dialog-title-${dialog.id}`;
  const textId = `dialog-text-${dialog.id}`;
  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className={`dialog dialog-${spec.kind}`}
        role={spec.kind === "info" ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
      >
        <div className="dialog-head">
          <span className="dialog-icon" aria-hidden="true">
            {ICONS[spec.kind]}
          </span>
          <h2 id={titleId}>{spec.title}</h2>
        </div>
        <p id={textId} className="dialog-text">
          {spec.text}
        </p>
        <div className="dialog-buttons">
          {spec.buttons.map((b) => (
            <button
              key={b.label}
              className={b.primary ? "primary" : undefined}
              onClick={() => closeDialog(dialog.id, b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
