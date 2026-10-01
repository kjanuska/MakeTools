export type ModuleId = "accounts" | "profiles" | "proxies" | "tasks";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** Subfolder of the Makebot folder. */
  folder: string;
  /** File extension, without the dot. */
  extension: string;
  /** Column headers in the file list. */
  columns: { name: string; count: string };
}

export const MODULES: readonly ModuleDef[] = [
  { id: "accounts", label: "Accounts", folder: "account", extension: "txt", columns: { name: "Account group", count: "Number of accounts" } },
  { id: "profiles", label: "Profiles", folder: "profile", extension: "csv", columns: { name: "Profile group", count: "Number of profiles" } },
  { id: "proxies", label: "Proxies", folder: "proxy", extension: "txt", columns: { name: "Proxy group", count: "Number of proxies" } },
  { id: "tasks", label: "Tasks", folder: "task", extension: "csv", columns: { name: "Task file", count: "Number of tasks" } },
];
