import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export interface AvailableUpdate {
  version: string;
  notes: string;
  /** Downloads, installs and restarts. Progress is 0–1, or null if the size is unknown. */
  install(onProgress: (fraction: number | null) => void): Promise<void>;
}

/** The running app's version (0.1.<commit count>, see scripts/version.mjs). */
export function currentVersion(): Promise<string> {
  return getVersion();
}

/** Asks the release server for a newer version. Null if this one is the latest. */
export async function findUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body?.trim() ?? "",
    async install(onProgress) {
      let total: number | undefined;
      let done = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength;
          onProgress(total ? 0 : null);
        } else if (e.event === "Progress") {
          done += e.data.chunkLength;
          onProgress(total ? Math.min(1, done / total) : null);
        }
      });
      // On Windows the installer usually closes the app before this point.
      await relaunch();
    },
  };
}
