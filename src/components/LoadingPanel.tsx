// Keeps navigation instant. A click shows the new page's frame (heading, back
// button, toolbar) straight away, with a loader where the slow part goes. The
// slow part (a big grid, the counts, an overview) is drawn only once that
// frame is on screen, so the loader is always seen while it's drawn. The
// loader fades in after SPINNER_DELAY_MS, so quick opens don't flash it. The
// delay and the spinning are CSS animations, so they keep going while the app
// is busy drawing.
//
// Every file view opens its file through useFileLoad, the one way in:
//   - not read yet: LoadingPanel (heading, back button, then the spinner or the read error)
//   - read, `ready` false: the view's frame, with a LoadingNote where the slow part goes
//   - `ready`: everything
import { startTransition, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { FileEntry } from "../lib/fs";

/** The loader fades in after this, so quick opens don't flash it. */
export const SPINNER_DELAY_MS = 150;

/** Where a page's content goes while it's loading: a spinner and "Loading …", faded in after the delay. */
export function LoadingNote({ label }: { label: string }) {
  return (
    <div
      className="loading-region"
      aria-busy="true"
      style={{ "--loading-delay": `${SPINNER_DELAY_MS}ms` } as CSSProperties}
    >
      <p className="loading" aria-live="polite">
        <span className="spinner large" aria-hidden="true" />
        Loading {label}…
      </p>
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
 * True once the browser has painted a frame showing `key` (false while it's
 * null). A view that's slow to draw shows its frame and a LoadingNote first,
 * and draws the slow part only after that's on screen. The switch happens in
 * a transition, so a click while the slow part is drawn still goes through.
 */
export function usePainted(key: string | null): boolean {
  const [painted, setPainted] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // An animation frame runs just before the paint; a timeout set in it runs just after.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => startTransition(() => setPainted(key)));
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [key]);
  return key !== null && painted === key;
}

/** False on a view's first render, then true once that's on screen. */
export function useFirstPaintDone(): boolean {
  return usePainted("");
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
  // False when the file is first there to draw, then true once its frame is on screen.
  const ready = usePainted(entry !== undefined ? file.path : null);
  return { entry, error: entry === undefined ? source.loadError(file.path) : undefined, ready };
}
