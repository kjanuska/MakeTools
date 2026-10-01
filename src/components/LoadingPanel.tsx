// What a file view shows until its file is ready: the name with a spinner,
// or the read error. Shared by every module's file view.
import { useDeferredValue } from "react";

interface Props {
  /** The file's name as shown in its heading. */
  name: string;
  /** Set if the file couldn't be read. */
  error?: string | null;
}

export function LoadingPanel({ name, error }: Props) {
  return (
    <div className="file-panel">
      <h2>{name}</h2>
      {error ? (
        <p className="error">Couldn't read file: {error}</p>
      ) : (
        <p className="loading" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Loading {name}…
        </p>
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
