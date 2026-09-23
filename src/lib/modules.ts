export type ModuleId = "accounts" | "profiles" | "proxies" | "tasks";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** Subfolder of the Makebot folder. */
  folder: string;
  /** File extension, without the dot. */
  extension: string;
}

export const MODULES: readonly ModuleDef[] = [
  { id: "accounts", label: "Accounts", folder: "account", extension: "txt" },
  { id: "profiles", label: "Profiles", folder: "profile", extension: "csv" },
  { id: "proxies", label: "Proxies", folder: "proxy", extension: "txt" },
  { id: "tasks", label: "Tasks", folder: "task", extension: "csv" },
];
