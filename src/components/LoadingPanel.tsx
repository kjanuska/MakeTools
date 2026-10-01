// Keeps navigation instant. A click shows the new page's frame (heading, back
// button, toolbar) straight away. The slow part (a big grid, the counts, an
// overview) is drawn just after, and it gets a spinner only if that takes
// longer than SPINNER_DELAY_MS, so quick opens don't flash one.
import { useDeferredValue, useEffect, useState, type ReactNode } from "react";

/** The spinner only shows if loading takes longer than this, so quick opens don't flash it. */
export const SPINNER_DELAY_MS = 150;

/** Where a page's content goes while it's loading: empty at first, "Loading …" with a spinner after the delay. */
export function LoadingNote({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="loading-region" aria-busy="true">
      {slow && (
        <p className="loading" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Loading {label}…
        </p>
      )}
    </div>
  );
}

interface PanelProps {
  /** The file's name as shown in its heading. */
  name: string;
  /** Set if the file couldn't be read. */
  error?: string | null;
  /** The page's back button, so it's there from the first click. */
  back?: { label: string; onClick: () => void };
}

/** A file view whose file isn't read yet: the page's heading row, then the loading note (or the read error). */
export function LoadingPanel({ name, error, back }: PanelProps) {
  return (
    <div className="file-panel loading-panel">
      <div className="editor-head">
        {back && <button onClick={back.onClick}>{back.label}</button>}
        <h2>{name}</h2>
      </div>
      {error ? <p className="error">Couldn't read file: {error}</p> : <LoadingNote label={name} />}
    </div>
  );
}

/**
 * False on a view's first render, then true in a background render. A view
 * that's slow to draw shows its frame and a LoadingNote first, so the click
 * that opened it shows at once instead of waiting until it's all drawn.
 */
export function useFirstPaintDone(): boolean {
  return useDeferredValue(true, false);
}

/** Draws its children just after the first paint, with a LoadingNote until then. Give it a key per page. */
export function AfterFirstPaint({ label, children }: { label: string; children: ReactNode }) {
  return useFirstPaintDone() ? <>{children}</> : <LoadingNote label={label} />;
}
