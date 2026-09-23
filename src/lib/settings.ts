import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("settings.json");
const MAKEBOT_PATH = "makebotPath";

export async function getMakebotPath(): Promise<string | null> {
  return (await store.get<string>(MAKEBOT_PATH)) ?? null;
}

export async function setMakebotPath(path: string): Promise<void> {
  await store.set(MAKEBOT_PATH, path);
  await store.save();
}
