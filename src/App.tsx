import { useEffect, useState } from "react";
import "./App.css";
import { askSaveDiscardCancel, pickFolder, showMessage } from "./lib/dialogs";
import type { FileEntry } from "./lib/fs";
import { MODULES, type ModuleId } from "./lib/modules";
import { joinPath } from "./lib/paths";
import { getMakebotPath, setMakebotPath } from "./lib/settings";
import { guardWindowClose } from "./lib/window";
import { GroupsOverview } from "./modules/profiles/GroupsOverview";
import { ProfilesEditor } from "./modules/profiles/ProfilesEditor";
import { confirmOverwrite } from "./modules/profiles/prompts";
import { ProfileStore, useStoreVersion } from "./modules/profiles/store";
import { ChangesPanel } from "./shell/ChangesPanel";
import { FileList } from "./shell/FileList";
import { FilePanel } from "./shell/FilePanel";

const PROFILES_FOLDER = MODULES.find((m) => m.id === "profiles")!.folder;

export default function App() {
  // undefined while the saved setting is loading
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  const [moduleId, setModuleId] = useState<ModuleId>(MODULES[0].id);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [store] = useState(() => new ProfileStore());
  const [savingAll, setSavingAll] = useState(false);
  const [changesMessage, setChangesMessage] = useState<string | null>(null);
  // The profile folder's files (for the overview and move/copy targets).
  const [profileFiles, setProfileFiles] = useState<FileEntry[] | null>(null);
  // profileName to jump to when a file is opened from the overview search.
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  useStoreVersion(store);

  useEffect(() => {
    getMakebotPath()
      .then(setRoot)
      .catch(() => setRoot(null));
  }, []);

  useEffect(() => {
    const unlisten = guardWindowClose(() => resolveUnsaved("closing")).catch(() => null);
    return () => {
      unlisten.then((f) => f?.());
    };
    // Registered once; everything it uses is stable (store, state setters).
  }, []);

  /** Saves every changed file without errors. True if nothing is left unsaved. */
  async function saveAll(): Promise<{ ok: boolean; summary: string }> {
    setSavingAll(true);
    setChangesMessage(null);
    const r = await store.saveAll(confirmOverwrite);
    setSavingAll(false);
    setListVersion((v) => v + 1);
    const problems = [
      ...r.invalid.map((e) => `${e.file.name}: has errors, fix them first`),
      ...r.failed.map((f) => `${f.entry.file.name}: ${f.error}`),
      ...r.cancelled.map((e) => `${e.file.name}: not overwritten`),
    ];
    const saved = `Saved ${r.saved.length} ${r.saved.length === 1 ? "file" : "files"}.`;
    const summary = problems.length ? `${saved} Not saved:\n${problems.join("\n")}` : saved;
    setChangesMessage(summary);
    return { ok: problems.length === 0, summary };
  }

  /**
   * Before closing or switching folders with unsaved changes: Save all,
   * Discard or Cancel. True if it's fine to go ahead.
   */
  async function resolveUnsaved(action: string): Promise<boolean> {
    const dirty = store.dirtyEntries();
    if (dirty.length === 0) return true;
    const list = dirty.map((e) => `  ${e.file.name}`).join("\n");
    const choice = await askSaveDiscardCancel(
      `You have unsaved changes in ${dirty.length} ${dirty.length === 1 ? "file" : "files"}:\n\n${list}\n\nSave them before ${action}?`,
      "Unsaved changes",
    );
    if (choice === "cancel") return false;
    if (choice === "discard") {
      for (const e of dirty) store.discard(e.file.path);
      return true;
    }
    const { ok, summary } = await saveAll();
    if (!ok) await showMessage(summary, "Not everything was saved");
    return ok;
  }

  async function chooseFolder() {
    setError(null);
    try {
      const path = await pickFolder(root ?? undefined);
      if (!path || !(await resolveUnsaved("switching folders"))) return;
      await setMakebotPath(path);
      setRoot(path);
      setSelected(null);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Clicking the current module again goes back to its overview. */
  function selectModule(id: ModuleId) {
    setModuleId(id);
    setSelected(null);
  }

  function openFile(file: FileEntry, highlightName?: string) {
    setHighlight(highlightName);
    setSelected(file);
  }

  function openChanged(path: string) {
    const e = store.get(path);
    if (!e) return;
    setModuleId("profiles");
    openFile(e.file);
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
  const isProfiles = mod.id === "profiles";

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
      <aside className="sidebar">
        <nav aria-label="Modules">
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
        <ChangesPanel
          files={store.dirtyEntries().map((e) => ({
            path: e.file.path,
            name: e.file.name,
            folder: PROFILES_FOLDER,
            invalid: e.errorCount > 0,
          }))}
          onOpen={openChanged}
          onSaveAll={() => void saveAll()}
          busy={savingAll}
          message={changesMessage}
        />
      </aside>
      <FileList
        key={`${root}|${mod.id}`}
        dir={joinPath(root, mod.folder)}
        extension={mod.extension}
        selectedPath={selected?.path ?? null}
        onSelect={(f) => openFile(f)}
        version={listVersion}
        onLoaded={
          isProfiles
            ? (files) => {
                setProfileFiles(files);
                void store.scan(files);
              }
            : undefined
        }
        marker={
          isProfiles
            ? (f) => {
                const e = store.get(f.path);
                if (!e) return store.loadError(f.path) ? { invalid: true } : undefined;
                return { modified: e.dirty, invalid: e.errorCount > 0 || !e.doc.headerOk };
              }
            : undefined
        }
      />
      <main className="main">
        {selected && isProfiles ? (
          <ProfilesEditor
            key={selected.path}
            file={selected}
            store={store}
            onSaved={() => setListVersion((v) => v + 1)}
            groups={profileFiles ?? []}
            onBack={() => setSelected(null)}
            highlightName={highlight}
          />
        ) : selected ? (
          <FilePanel
            key={selected.path}
            file={selected}
            onChanged={() => setListVersion((v) => v + 1)}
          />
        ) : isProfiles ? (
          <GroupsOverview
            files={profileFiles}
            dir={joinPath(root, mod.folder)}
            store={store}
            onOpen={openFile}
            onFilesChanged={() => setListVersion((v) => v + 1)}
          />
        ) : (
          <p className="muted">Select a file.</p>
        )}
      </main>
    </div>
  );
}
