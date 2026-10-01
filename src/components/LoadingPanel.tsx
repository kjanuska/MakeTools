// What a file view shows until its file is ready: the name with a spinner,
// or the read error. Shared by every module's file view.
import { useDeferredValue, useEffect, useState } from "react";

/** The spinner only shows if loading takes longer than this, so quick opens don't flash it. */
export const SPINNER_DELAY_MS = 150;

interface Props {
  /** The file's name as shown in its heading. */
  name: string;
  /** Set if the file couldn't be read. */
  error?: string | null;
}

export function LoadingPanel({ name, error }: Props) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="file-panel loading-panel" aria-busy={!error}>
      <h2>{name}</h2>
      {error ? (
        <p className="error">Couldn't read file: {error}</p>
      ) : (
        slow && (
          <p className="loading" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> Loading {name}…
          </p>
        )
      )}
    </div>
  );
}

/**
 * False on a view's first render, then true in a background render. A view
 * that's slow to draw (thousands of rows) shows its LoadingPanel first, so
 * clicking a file opens it at once instead of freezing until it's drawn.
 */
export function useFirstPaintDone(): boolean {
  return useDeferredValue(true, false);
}
