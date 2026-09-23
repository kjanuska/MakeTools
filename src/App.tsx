import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { confirmAction, pickFolder } from "./lib/dialogs";
import type { FileEntry } from "./lib/fs";
import { MODULES, type ModuleId } from "./lib/modules";
import { joinPath } from "./lib/paths";
import { getMakebotPath, setMakebotPath } from "./lib/settings";
import { guardWindowClose } from "./lib/window";
import { ProfilesEditor } from "./modules/profiles/ProfilesEditor";
import { FileList } from "./shell/FileList";
import { FilePanel } from "./shell/FilePanel";

export default function App() {
  // undefined while the saved setting is loading
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  const [moduleId, setModuleId] = useState<ModuleId>(MODULES[0].id);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Whether the open editor has unsaved changes. A ref so the close guard sees the latest value.
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  useEffect(() => {
    getMakebotPath()
      .then(setRoot)
      .catch(() => setRoot(null));
  }, []);

  useEffect(() => {
    const unlisten = guardWindowClose(confirmLeave).catch(() => null);
    return () => {
      unlisten.then((f) => f?.());
    };
  }, []);

  /** True if there are no unsaved changes, or the user agrees to discard them. */
  async function confirmLeave(): Promise<boolean> {
    if (!dirtyRef.current) return true;
    return confirmAction("You have unsaved changes. Discard them?", "Unsaved changes");
  }

  async function selectFile(file: FileEntry) {
    if (file.path === selected?.path || !(await confirmLeave())) return;
    setSelected(file);
  }

  async function chooseFolder() {
    setError(null);
    try {
      const path = await pickFolder(root ?? undefined);
      if (!path || !(await confirmLeave())) return;
      await setMakebotPath(path);
      setRoot(path);
      setSelected(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function selectModule(id: ModuleId) {
    if (id === moduleId || !(await confirmLeave())) return;
    setModuleId(id);
    setSelected(null);
  }

  if (root === undefined) return null;

  if (root === null) {
    return (
      <div className="welcome">
        <h1>Make Tools</h1>
        <p>Choose your Makebot folder (the one with the account, profile, proxy and task folders).</p>
        <button onClick={chooseFolder}>Choose Makebot folder</button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const mod = MODULES.find((m) => m.id === moduleId) ?? MODULES[0];

  return (
    <div className="app">
      <header className="topbar">
        <strong>Make Tools</strong>
        <span className="root-path" title={root}>
          {root}
        </span>
        <button onClick={chooseFolder}>Change folder</button>
        {error && <span className="error">{error}</span>}
      </header>
      <nav className="sidebar" aria-label="Modules">
        {MODULES.map((m) => (
          <button
            key={m.id}
            className="nav-item"
            aria-current={m.id === mod.id ? "page" : undefined}
            onClick={() => selectModule(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      <FileList
        key={`${root}|${mod.id}`}
        dir={joinPath(root, mod.folder)}
        extension={mod.extension}
        selectedPath={selected?.path ?? null}
        onSelect={selectFile}
        version={listVersion}
      />
      <main className="main">
        {selected && mod.id === "profiles" ? (
          <ProfilesEditor
            key={selected.path}
            file={selected}
            onChanged={() => setListVersion((v) => v + 1)}
            onDirtyChange={onDirtyChange}
          />
        ) : selected ? (
          <FilePanel
            key={selected.path}
            file={selected}
            onChanged={() => setListVersion((v) => v + 1)}
          />
        ) : (
          <p className="muted">Select a file.</p>
        )}
      </main>
    </div>
  );
}
