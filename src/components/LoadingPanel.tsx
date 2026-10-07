// Keeps navigation instant. A click shows the new page's frame (heading, back
// button, toolbar) straight away. The slow part (a big grid, the counts, an
// overview) is drawn just after, and it gets a spinner only if that takes
// longer than SPINNER_DELAY_MS, so quick opens don't flash one.
//
// Every file view opens its file through useFileLoad, the one way in:
//   - not read yet: LoadingPanel (heading, back button, then the spinner or the read error)
//   - read, `ready` false: the view's frame, with a LoadingNote where the slow part goes
//   - `ready`: everything
import { useDeferredValue, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { FileEntry } from "../lib/fs";

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

/** Where a module's opened files are read and kept (its store). */
export interface FileSource<E> {
  subscribe(fn: () => void): () => void;
  getVersion(): number;
  /** Reads the file in the background; subscribers hear when it's in. */
  load(file: FileEntry): Promise<void>;
  get(path: string): E | undefined;
  loadError(path: string): string | undefined;
}

export interface FileLoad<E> {
  /** The file as its store holds it, once read. */
  entry: E | undefined;
  /** Why the file couldn't be read, while there's nothing to show. */
  error: string | undefined;
  /** The file is read and the view's frame is drawn: time to draw the slow part. */
  ready: boolean;
}

/**
 * Opens a file in a view: starts reading it, re-renders when its store
 * changes, and says when the slow part can be drawn. The click that opened
 * the file never waits for the read or for the slow part.
 */
export function useFileLoad<E>(source: FileSource<E>, file: FileEntry): FileLoad<E> {
  useSyncExternalStore(source.subscribe, source.getVersion);
  useEffect(() => {
    void source.load(file);
  }, [source, file]);
  const entry = source.get(file.path);
  // False when the file is first there to draw, then true in a background render.
  const ready = useDeferredValue(entry !== undefined, false);
  return {
    entry,
    error: entry === undefined ? source.loadError(file.path) : undefined,
    ready: ready && entry !== undefined,
  };
}
