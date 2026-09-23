// Builds the task validation context from the other folders and the site list.
import type { FileEntry } from "../../lib/fs";
import { isRecord } from "../../lib/table/ops";
import type { ProfileStore } from "../profiles/store";
import type { FolderList } from "../../shell/useFolders";
import type { TaskContext } from "./schema";

/** File name without its extension: `25.csv` -> `25`. */
export const baseName = (name: string) => name.replace(/\.[^.]*$/, "");

const names = (files: FileEntry[] | null) => new Set((files ?? []).map((f) => baseName(f.name)));

export function buildTaskContext(
  profiles: FolderList,
  proxies: FolderList,
  accounts: FolderList,
  profileStore: ProfileStore,
  sites: readonly string[] | null | undefined,
): TaskContext {
  const profileGroups = new Map<string, string[]>();
  let allProfilesLoaded = true;
  for (const f of profiles.files ?? []) {
    const e = profileStore.get(f.path);
    if (!e && !profileStore.loadError(f.path)) allProfilesLoaded = false;
    const rows = e?.doc.headerOk ? e.doc.rows.filter(isRecord) : [];
    profileGroups.set(baseName(f.name), rows.map((r) => r.values[0]));
  }
  return {
    ready: profiles.done && proxies.done && accounts.done && Array.isArray(sites) && allProfilesLoaded,
    profileGroups,
    proxyGroups: names(proxies.files),
    accountGroups: names(accounts.files),
    sites: sites ?? [],
  };
}

/** A string that changes whenever the context would validate differently. */
export function contextKey(ctx: TaskContext): string {
  return JSON.stringify([
    ctx.ready,
    [...ctx.profileGroups],
    [...ctx.proxyGroups],
    [...ctx.accountGroups],
    ctx.sites,
  ]);
}
