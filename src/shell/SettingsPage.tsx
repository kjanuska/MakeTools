import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  comboError,
  comboFromEvent,
  shortcuts,
  type ActionId,
  type Bindings,
} from "../lib/shortcuts";

interface Props {
  root: string;
  onChangeFolder: () => void;
  bindings: Bindings;
  onChangeBindings: (bindings: Bindings) => void;
  /** Shown first, above the Makebot folder (the Updates section). */
  top?: ReactNode;
  /** Extra sections from modules (e.g. the task site list). */
  children?: ReactNode;
}

export function SettingsPage({ root, onChangeFolder, bindings, onChangeBindings, top, children }: Props) {
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Other shortcuts must not fire while a new one is being pressed.
  useEffect(() => {
    shortcuts.paused = recording !== null;
    return () => {
      shortcuts.paused = false;
    };
  }, [recording]);

  function assign(id: ActionId, combo: string | null) {
    const next = { ...bindings, [id]: combo };
    let msg: string | null = null;
    if (combo) {
      for (const a of ACTIONS) {
        if (a.id !== id && next[a.id] === combo) {
          next[a.id] = null;
          msg = `${combo} was removed from "${a.label}".`;
        }
      }
    }
    onChangeBindings(next);
    setNote(msg);
  }

  function onRecordKey(e: KeyboardEvent, id: ActionId) {
    e.preventDefault();
    e.stopPropagation();
    const combo = comboFromEvent(e.nativeEvent);
    if (!combo) return;
    if (combo === "Escape" && recording) {
      setRecording(null);
      setNote(null);
      return;
    }
    const err = comboError(combo);
    if (err) {
      setNote(`${combo}: ${err}`);
      return;
    }
    setRecording(null);
    assign(id, combo);
  }

  return (
    <div className="settings">
      <div className="editor-head">
        <h2>Settings</h2>
      </div>

      {top}

      <section aria-label="Makebot folder">
        <h3>Makebot folder</h3>
        <p className="path">{root}</p>
        <button onClick={onChangeFolder}>Change folder…</button>
      </section>

      {children}

      <section aria-label="Keyboard shortcuts">
        <h3>Keyboard shortcuts</h3>
        <p className="muted">
          Click a shortcut, then press the new keys. Escape cancels. Shortcuts need Ctrl or Alt, except F1–F12 and Escape.
        </p>
        {note && <p className="status">{note}</p>}
        <table className="overview-table shortcuts-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Shortcut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ACTIONS.map((a) => {
              const current = bindings[a.id];
              const isRecording = recording === a.id;
              return (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  <td>
                    <button
                      className={`key-button${isRecording ? " recording" : ""}`}
                      aria-label={`Shortcut for ${a.label}`}
                      onClick={() => {
                        setNote(null);
                        setRecording(isRecording ? null : a.id);
                      }}
                      onKeyDown={isRecording ? (e) => onRecordKey(e, a.id) : undefined}
                      onBlur={() => isRecording && setRecording(null)}
                    >
                      {isRecording ? "Press keys…" : current ?? "None"}
                    </button>
                  </td>
                  <td className="row-actions">
                    <button aria-label={`Remove shortcut for ${a.label}`} disabled={!current} onClick={() => assign(a.id, null)}>
                      Remove
                    </button>
                    <button
                      aria-label={`Reset shortcut for ${a.label}`}
                      disabled={current === DEFAULT_BINDINGS[a.id]}
                      onClick={() => assign(a.id, DEFAULT_BINDINGS[a.id])}
                    >
                      Default
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          onClick={() => {
            onChangeBindings({ ...DEFAULT_BINDINGS });
            setNote("All shortcuts are back to their defaults.");
          }}
        >
          Reset all to defaults
        </button>
      </section>
    </div>
  );
}
