// The right-click file menu's settings for each module (see useFileMenu).
import { accountsOf, parseAccounts } from "../lib/formats/accounts";
import { parseProfiles } from "../lib/formats/profiles";
import { countProxies, parseProxies } from "../lib/formats/proxies";
import { parseTasks } from "../lib/formats/tasks";
import type { ModuleId } from "../lib/modules";
import { isRecord } from "../lib/table/ops";
import type { ProfileStore } from "../modules/profiles/store";
import type { ProxyStore } from "../modules/proxies/store";
import type { TaskStore } from "../modules/tasks/store";
import { plural, TASK_COLUMNS, type FileMenuConfig } from "./useFileMenu";

export function fileMenuConfigs(stores: {
  profiles: ProfileStore;
  proxies: ProxyStore;
  tasks: TaskStore;
}): Record<ModuleId, FileMenuConfig> {
  return {
    // Account files are saved as soon as they change, so they're never locked.
    accounts: {
      label: "account file",
      ext: ".txt",
      describe: (t) => plural(accountsOf(parseAccounts(t)).length, "account", "accounts"),
      usedBy: TASK_COLUMNS.accountGroup,
    },
    profiles: {
      label: "profile group",
      ext: ".csv",
      store: stores.profiles,
      describe: (t) => plural(parseProfiles(t).rows.filter(isRecord).length, "profile", "profiles"),
      usedBy: TASK_COLUMNS.profileGroup,
    },
    proxies: {
      label: "proxy file",
      ext: ".txt",
      store: stores.proxies,
      describe: (t) => plural(countProxies(parseProxies(t)), "proxy", "proxies"),
      usedBy: TASK_COLUMNS.proxyGroup,
    },
    // Nothing refers to task files.
    tasks: {
      label: "task file",
      ext: ".csv",
      store: stores.tasks,
      describe: (t) => plural(parseTasks(t).rows.filter(isRecord).length, "row", "rows"),
    },
  };
}
