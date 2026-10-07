import { displayName } from "./lib/table/fileNames";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { AfterFirstPaint } from "./components/LoadingPanel";
import { ModuleIcon } from "./components/ModuleIcon";
import { recordCount, TableOverview } from "./components/table/TableOverview";
import { TaskFileView } from "./modules/tasks/TaskFileView";
import { askSaveDiscardCancel, confirmAction, pickFolder, showMessage } from "./lib/dialogs";
import { accountsOf, parseAccounts } from "./lib/formats/accounts";
import { countProxies, parseProxies } from "./lib/formats/proxies";
import type { FileEntry } from "./lib/fs";
import { MODULES, type ModuleId } from "./lib/modules";
import { joinPath } from "./lib/paths";
import {
  getMakebotPath,
  getShortcutOverrides,
  getSites,
  setMakebotPath,
  setShortcutOverrides,
  setSites as saveSites,
} from "./lib/settings";
import {
  DEFAULT_BINDINGS,
  handleShortcutKey,
  overridesFor,
  resolveBindings,
  useShortcuts,
  type Bindings,
} from "./lib/shortcuts";
import type { TableStore } from "./lib/table/store";
import { useStoreVersion } from "./lib/table/store";
import { guardWindowClose } from "./lib/window";
import { AccountFileView } from "./modules/accounts/AccountFileView";
import { AccountsOverview } from "./modules/accounts/AccountsOverview";
import { AccountStore } from "./modules/accounts/store";
import { GroupsOverview } from "./modules/profiles/GroupsOverview";
import { ProfilesEditor } from "./modules/profiles/ProfilesEditor";
import { confirmOverwrite } from "./modules/profiles/prompts";
import { ProfileStore } from "./modules/profiles/store";
import { ProxyFileView } from "./modules/proxies/ProxyFileView";
import { ProxyStore } from "./modules/proxies/store";
import { buildTaskContext, contextKey } from "./modules/tasks/context";
import { renameSiteEverywhere, siteUsage, usedSites } from "./modules/tasks/sites";
import { TaskStore } from "./modules/tasks/store";
import { entryTotals, makeTaskUI } from "./modules/tasks/ui";
import { ChangesPanel } from "./shell/ChangesPanel";
import { fileMenuConfigs } from "./shell/fileMenus";
import { FileList } from "./shell/FileList";
import { FilePanel } from "./shell/FilePanel";
import { SettingsPage } from "./shell/SettingsPage";
import { SitesSettings } from "./shell/SitesSettings";
import { UpdateSettings, updateStatusText } from "./shell/UpdateSettings";
import { useDiskCounts, useTextCounter, type FileCount } from "./shell/useFileCounts";
import { plural, useFileMenu } from "./shell/useFileMenu";
import { useFolders } from "./shell/useFolders";
import { useUpdater } from "./shell/useUpdater";

const folderOf = (id: ModuleId) => MODULES.find((m) => m.id === id)!.folder;

const countAccountText = (text: string) => accountsOf(parseAccounts(text)).length;
const countProxyText = (text: string) => countProxies(parseProxies(text));
const formatCount = (n: number) => n.toLocaleString("en-US");

export default function App() {
  // undefined while the saved setting is loading
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  const [moduleId, setModuleId] = useState<ModuleId>(MODULES[0].id);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [profileStore] = useState(() => new ProfileStore());
  const [taskStore] = useState(() => new TaskStore());
  const [proxyStore] = useState(() => new ProxyStore());
  const [accountStore] = useState(() => new AccountStore());
  const [savingAll, setSavingAll] = useState(false);
  const [changesMessage, setChangesMessage] = useState<string | null>(null);
  // Row to jump to when a file is opened from the overview search.
  const [highlight, setHighlight] = useState<number | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bindings, setBindings] = useState<Bindings>(DEFAULT_BINDINGS);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  // Bumped to focus the overview's search box.
  const [findRequest, setFindRequest] = useState(0);
  // The global site list: undefined while loading, null if never saved (seeded from the task files).
  const [sites, setSites] = useState<string[] | null | undefined>(undefined);
  const [tasksScanned, setTasksScanned] = useState(false);
  const profileVersion = useStoreVersion(profileStore);
  useStoreVersion(taskStore);
  useStoreVersion(proxyStore);
  const folders = useFolders(root, listVersion);
  const updater = useUpdater(() => resolveUnsaved("updating"));
  // Counts in the file list. Proxy and account files are read once their module is shown.
  const accountCounts = useDiskCounts(folders.accounts.files, countAccountText, moduleId === "accounts");
  const proxyDiskCounts = useDiskCounts(folders.proxies.files, countProxyText, moduleId === "proxies");
  const countProxyEntry = useTextCounter(countProxyText);

  const stores: Partial<Record<ModuleId, TableStore<never>>> = {
    profiles: profileStore as unknown as TableStore<never>,
    tasks: taskStore as unknown as TableStore<never>,
  };

  useEffect(() => {
    getShortcutOverrides()
      .then((o) => setBindings(resolveBindings(o)))
      .catch(() => {});
    getSites()
      .then(setSites)
      .catch(() => setSites(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleShortcutKey(e, bindingsRef.current);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load every profile and task file, so links, counts and error marks are known.
  const profileFiles = folders.profiles.files;
  const taskFiles = folders.tasks.files;
  useEffect(() => {
    if (profileFiles) void profileStore.scan(profileFiles);
  }, [profileFiles, profileStore]);
  useEffect(() => {
    if (!taskFiles) return;
    void taskStore.scan(taskFiles).then(() => setTasksScanned(true));
  }, [taskFiles, taskStore]);

  // First run: the site list starts as the sites the task files already use.
  useEffect(() => {
    if (sites !== null || !tasksScanned) return;
    const seeded = usedSites(taskStore);
    setSites(seeded);
    saveSites(seeded).catch((e) => setError(`Couldn't save the site list: ${e}`));
  }, [sites, tasksScanned, taskStore]);

  // Task checks depend on the other folders, the profiles in them and the site list.
  const taskContext = useMemo(
    () => buildTaskContext(folders.profiles, folders.proxies, folders.accounts, profileStore, sites),
    // profileVersion: profile edits change the profile names tasks can use.
    [folders.profiles, folders.proxies, folders.accounts, profileStore, sites, profileVersion],
  );
  const lastContextKey = useRef("");
  useEffect(() => {
    const key = contextKey(taskContext);
    if (key === lastContextKey.current) return;
    lastContextKey.current = key;
    taskStore.setContext(taskContext);
  }, [taskContext, taskStore]);

  function changeBindings(next: Bindings) {
    setBindings(next);
    setShortcutOverrides(overridesFor(next)).catch((e) => setError(`Couldn't save shortcuts: ${e}`));
  }

  function updateSites(next: string[]) {
    setSites(next);
    saveSites(next).catch((e) => setError(`Couldn't save the site list: ${e}`));
  }

  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const [taskUI] = useState(() =>
    makeTaskUI((site) => {
      const current = sitesRef.current ?? [];
      if (!current.includes(site)) updateSites([...current, site]);
    }),
  );

  async function renameSite(from: string, to: string): Promise<string | null> {
    const u = siteUsage(taskStore, from);
    const ok = await confirmAction(
      `Rename ${from} to ${to}?\n\nThis changes it everywhere: ${u.rows} ${u.rows === 1 ? "task" : "tasks"} in ${u.files} ${u.files === 1 ? "file" : "files"}. Files are saved right away (each is backed up first); files with other unsaved changes get the rename added to those changes.`,
      "Rename site",
    );
    if (!ok) return null;
    const next = (sites ?? []).map((s) => (s === from ? to : s));
    updateSites(next);
    // Check the renamed tasks against the new list right away, before saving them.
    taskStore.setContext({ ...taskStore.getContext(), sites: next });
    const r = await renameSiteEverywhere(taskStore, from, to, confirmOverwrite);
    setListVersion((v) => v + 1);
    const parts = [`Renamed ${from} to ${to}. Saved ${r.saved.length} ${r.saved.length === 1 ? "file" : "files"}.`];
    if (r.unsaved.length) {
      parts.push(`Not saved yet: ${r.unsaved.map((u) => `${displayName(u.file)} (${u.reason})`).join(", ")}.`);
    }
    return parts.join(" ");
  }

  async function removeSite(site: string) {
    const u = siteUsage(taskStore, site);
    if (u.rows) {
      const ok = await confirmAction(
        `Remove ${site}? ${u.rows} ${u.rows === 1 ? "task" : "tasks"} in ${u.files} ${u.files === 1 ? "file" : "files"} still use it and will show an error.`,
        "Remove site",
      );
      if (!ok) return;
    }
    updateSites((sites ?? []).filter((s) => s !== site));
  }

  useShortcuts({
    saveAll: () => void saveAll(),
    settings: () => setSettingsOpen((o) => !o),
    refresh: () => setListVersion((v) => v + 1),
    find: () => {
      setSettingsOpen(false);
      if (moduleId !== "tasks") setModuleId("profiles");
      setSelected(null);
      setFindRequest((n) => n + 1);
    },
  });

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
    // Registered once; everything it uses is stable (stores, state setters).
  }, []);

  const allDirty = () => [...profileStore.dirtyEntries(), ...taskStore.dirtyEntries(), ...proxyStore.dirtyEntries()];

  /** Saves every changed file without errors. True if nothing is left unsaved. */
  async function saveAll(): Promise<{ ok: boolean; summary: string }> {
    proxyStore.flushPending();
    setSavingAll(true);
    setChangesMessage(null);
    const results = [
      await profileStore.saveAll(confirmOverwrite),
      await taskStore.saveAll(confirmOverwrite),
      { ...(await proxyStore.saveAll(confirmOverwrite)), invalid: [] },
    ];
    setSavingAll(false);
    setListVersion((v) => v + 1);
    const saved = results.reduce((n, r) => n + r.saved.length, 0);
    const problems = results.flatMap((r) => [
      ...r.invalid.map((e) => `${displayName(e.file.name)}: has errors, fix them first`),
      ...r.failed.map((f) => `${displayName(f.entry.file.name)}: ${f.error}`),
      ...r.cancelled.map((e) => `${displayName(e.file.name)}: not overwritten`),
    ]);
    const savedText = `Saved ${saved} ${saved === 1 ? "file" : "files"}.`;
    const summary = problems.length ? `${savedText} Not saved:\n${problems.join("\n")}` : savedText;
    setChangesMessage(summary);
    return { ok: problems.length === 0, summary };
  }

  /**
   * Before closing or switching folders with unsaved changes: Save all,
   * Discard or Cancel. True if it's fine to go ahead.
   */
  async function resolveUnsaved(action: string): Promise<boolean> {
    proxyStore.flushPending();
    const dirty = allDirty();
    if (dirty.length === 0) return true;
    const list = dirty.map((e) => `  ${displayName(e.file.name)}`).join("\n");
    const choice = await askSaveDiscardCancel(
      `You have unsaved changes in ${dirty.length} ${dirty.length === 1 ? "file" : "files"}:\n\n${list}\n\nSave them before ${action}?`,
      "Unsaved changes",
    );
    if (choice === "cancel") return false;
    if (choice === "discard") {
      for (const e of profileStore.dirtyEntries()) profileStore.discard(e.file.path);
      for (const e of taskStore.dirtyEntries()) taskStore.discard(e.file.path);
      for (const e of proxyStore.dirtyEntries()) proxyStore.discard(e.file.path);
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
  const [menuConfigs] = useState(() =>
    fileMenuConfigs({ accounts: accountStore, profiles: profileStore, proxies: proxyStore, tasks: taskStore }),
  );
  const fileMenu = useFileMenu({
    config: menuConfigs[moduleId],
    dir: root ? joinPath(root, folderOf(moduleId)) : "",
    files: folders[moduleId].files,
    tasks: taskStore,
    selectedPath: selected?.path ?? null,
    onSelectedChanged: setSelected,
    onFilesChanged: () => setListVersion((v) => v + 1),
  });

  function selectModule(id: ModuleId) {
    fileMenu.cancelRename();
    // From Settings, the module that was open comes back as it was (its file stays open).
    if (settingsOpen && id === moduleId) {
      setSettingsOpen(false);
      return;
    }
    setSettingsOpen(false);
    setModuleId(id);
    setSelected(null);
  }

  function openFile(file: FileEntry, highlightId?: number) {
    setSettingsOpen(false);
    setHighlight(highlightId);
    setSelected(file);
  }

  function openChanged(path: string) {
    const proxy = proxyStore.get(path);
    if (proxy) {
      setModuleId("proxies");
      openFile(proxy.file);
      return;
    }
    const id = (["profiles", "tasks"] as const).find((m) => stores[m]!.get(path));
    if (!id) return;
    setModuleId(id);
    openFile(stores[id]!.get(path)!.file);
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
  const dir = joinPath(root, mod.folder);
  const list = folders[mod.id];
  const store = stores[mod.id];

  /** How many records a file has, including unsaved changes. */
  function fileCount(f: FileEntry): FileCount | undefined {
    const shown = (n: number | undefined, one: string, many: string) =>
      n === undefined ? undefined : { value: formatCount(n), title: plural(n, one, many) };
    switch (mod.id) {
      case "profiles": {
        const e = profileStore.get(f.path);
        return e && shown(recordCount(e), "profile", "profiles");
      }
      case "tasks": {
        const e = taskStore.get(f.path);
        if (!e) return undefined;
        const { tasks, unknown } = entryTotals(e, taskContext);
        if (!unknown) return shown(tasks, "task", "tasks");
        return {
          value: `${formatCount(tasks)}+?`,
          title: `${plural(tasks, "task", "tasks")} (+${plural(unknown, "row", "rows")} with an unknown count)`,
        };
      }
      case "proxies": {
        const e = proxyStore.get(f.path);
        return shown(e ? countProxyEntry(f.path, e.text) : proxyDiskCounts.get(f.path), "proxy", "proxies");
      }
      case "accounts":
        return shown(accountCounts.get(f.path), "account", "accounts");
    }
  }

  const changed = [
    ...(["profiles", "tasks"] as const).flatMap((m) =>
      stores[m]!.dirtyEntries().map((e) => ({
        path: e.file.path,
        name: e.file.name,
        folder: folderOf(m),
        invalid: e.errorCount > 0,
      })),
    ),
    ...proxyStore.dirtyEntries().map((e) => ({
      path: e.file.path,
      name: e.file.name,
      folder: folderOf("proxies"),
      invalid: false,
    })),
  ];

  let main;
  if (settingsOpen) {
    main = (
      <SettingsPage
        root={root}
        onChangeFolder={chooseFolder}
        bindings={bindings}
        onChangeBindings={changeBindings}
        top={
          <UpdateSettings
            version={updater.version}
            status={updater.status}
            onCheck={updater.checkNow}
            onInstall={updater.installPending}
          />
        }
      >
        <SitesSettings
          sites={sites ?? null}
          usage={(s) => siteUsage(taskStore, s)}
          onAdd={(s) => updateSites([...(sites ?? []), s])}
          onRename={renameSite}
          onRemove={removeSite}
        />
      </SettingsPage>
    );
  } else if (mod.id === "profiles") {
    main = selected ? (
      <ProfilesEditor
        key={selected.path}
        file={selected}
        store={profileStore}
        onSaved={() => setListVersion((v) => v + 1)}
        groups={profileFiles ?? []}
        onBack={() => setSelected(null)}
        highlightId={highlight}
      />
    ) : (
      <AfterFirstPaint key="profiles" label="profile groups">
        <GroupsOverview
          files={profileFiles}
          dir={dir}
          store={profileStore}
          onOpen={openFile}
          onFilesChanged={() => setListVersion((v) => v + 1)}
          findRequest={findRequest}
        />
      </AfterFirstPaint>
    );
  } else if (mod.id === "tasks") {
    main = selected ? (
      <TaskFileView
        key={selected.path}
        file={selected}
        store={taskStore}
        ui={taskUI}
        confirmOverwrite={confirmOverwrite}
        onSaved={() => setListVersion((v) => v + 1)}
        files={taskFiles ?? []}
        onBack={() => setSelected(null)}
        highlightId={highlight}
      />
    ) : (
      <AfterFirstPaint key="tasks" label="task files">
        <TableOverview
          files={taskFiles}
          dir={dir}
          store={taskStore}
          ui={taskUI}
          onOpen={openFile}
          onFilesChanged={() => setListVersion((v) => v + 1)}
          findRequest={findRequest}
        />
      </AfterFirstPaint>
    );
  } else if (mod.id === "accounts") {
    main = selected ? (
      <AccountFileView
        key={selected.path}
        file={selected}
        store={accountStore}
        onBack={() => setSelected(null)}
        onChanged={() => setListVersion((v) => v + 1)}
      />
    ) : (
      <AfterFirstPaint key="accounts" label="account groups">
        <AccountsOverview
          files={folders.accounts.files}
          dir={dir}
          onOpen={openFile}
          onFilesChanged={() => setListVersion((v) => v + 1)}
        />
      </AfterFirstPaint>
    );
  } else if (mod.id === "proxies") {
    main = selected ? (
      <ProxyFileView
        key={selected.path}
        file={selected}
        store={proxyStore}
        confirmOverwrite={confirmOverwrite}
        onSaved={() => setListVersion((v) => v + 1)}
      />
    ) : (
      <p className="muted">Select a proxy file.</p>
    );
  } else {
    main = selected ? (
      <FilePanel key={selected.path} file={selected} onChanged={() => setListVersion((v) => v + 1)} />
    ) : (
      <p className="muted">Select a file.</p>
    );
  }

  return (
    <div className={settingsOpen ? "app settings-open" : "app"}>
      <header className="topbar">
        <strong>Make Tools</strong>
        <span className="topbar-spacer" />
        {error && <span className="error">{error}</span>}
        {updater.status.kind === "downloading" && <span className="status">{updateStatusText(updater.status)}</span>}
      </header>
      <aside className="sidebar">
        <nav aria-label="Modules">
          {MODULES.map((m) => (
            <button
              key={m.id}
              className="nav-item"
              aria-current={!settingsOpen && m.id === mod.id ? "page" : undefined}
              onClick={() => selectModule(m.id)}
            >
              <ModuleIcon id={m.id} />
              <span>{m.label}</span>
            </button>
          ))}
          <button
            className="nav-item"
            aria-current={settingsOpen ? "page" : undefined}
            onClick={() => {
              fileMenu.cancelRename();
              setSettingsOpen(true);
            }}
          >
            <ModuleIcon id="settings" />
            <span>Settings</span>
          </button>
        </nav>
        <ChangesPanel
          files={changed}
          onOpen={openChanged}
          onSaveAll={() => void saveAll()}
          busy={savingAll}
          message={changesMessage}
        />
      </aside>
      {!settingsOpen && (
      <FileList
        dir={dir}
        files={list.files}
        columns={mod.columns}
        error={list.error}
        selectedPath={selected?.path ?? null}
        onSelect={(f) => openFile(f)}
        onRefresh={() => setListVersion((v) => v + 1)}
        menuFor={fileMenu.menuFor}
        renaming={fileMenu.renaming}
        count={fileCount}
        marker={
          mod.id === "proxies"
            ? (f) => (proxyStore.get(f.path)?.dirty ? { modified: true } : undefined)
            : store
            ? (f) => {
                const e = store.get(f.path);
                if (!e) return store.loadError(f.path) ? { invalid: true } : undefined;
                return { modified: e.dirty, invalid: e.errorCount > 0 || !e.doc.headerOk };
              }
            : undefined
        }
      />
      )}
      <main className="main">{main}</main>
    </div>
  );
}
