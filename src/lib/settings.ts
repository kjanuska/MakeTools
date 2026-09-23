import { LazyStore } from "@tauri-apps/plugin-store";
import type { BindingOverrides } from "./shortcuts";

const store = new LazyStore("settings.json");
const MAKEBOT_PATH = "makebotPath";
const SHORTCUTS = "shortcuts";
const SITES = "sites";

export async function getMakebotPath(): Promise<string | null> {
  return (await store.get<string>(MAKEBOT_PATH)) ?? null;
}

export async function setMakebotPath(path: string): Promise<void> {
  await store.set(MAKEBOT_PATH, path);
  await store.save();
}

/** Shortcut changes on top of the defaults. */
export async function getShortcutOverrides(): Promise<BindingOverrides> {
  return (await store.get<BindingOverrides>(SHORTCUTS)) ?? {};
}

export async function setShortcutOverrides(overrides: BindingOverrides): Promise<void> {
  await store.set(SHORTCUTS, overrides);
  await store.save();
}

/** The global site list, or null if it was never saved (then it's seeded from the task files). */
export async function getSites(): Promise<string[] | null> {
  return (await store.get<string[]>(SITES)) ?? null;
}

export async function setSites(sites: readonly string[]): Promise<void> {
  await store.set(SITES, [...sites]);
  await store.save();
}
