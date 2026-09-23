import { useEffect, useState } from "react";
import "./App.css";
import { pickFolder } from "./lib/dialogs";
import type { FileEntry } from "./lib/fs";
import { MODULES, type ModuleId } from "./lib/modules";
import { joinPath } from "./lib/paths";
import { getMakebotPath, setMakebotPath } from "./lib/settings";
import { FileList } from "./shell/FileList";
import { FilePanel } from "./shell/FilePanel";

export default function App() {
  // undefined while the saved setting is loading
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  const [moduleId, setModuleId] = useState<ModuleId>(MODULES[0].id);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMakebotPath()
      .then(setRoot)
      .catch(() => setRoot(null));
  }, []);

  async function chooseFolder() {
    setError(null);
    try {
      const path = await pickFolder(root ?? undefined);
      if (!path) return;
      await setMakebotPath(path);
      setRoot(path);
      setSelected(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function selectModule(id: ModuleId) {
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
        onSelect={setSelected}
        version={listVersion}
      />
      <main className="main">
        {selected ? (
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
