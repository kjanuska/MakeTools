import { useEffect, useRef, useState } from "react";
import { askUpdateNow, showMessage } from "../lib/dialogs";
import { currentVersion, findUpdate, type AvailableUpdate } from "../lib/updater";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; progress: number | null }
  | { kind: "error"; message: string };

export function updatePrompt(current: string | null, update: AvailableUpdate): string {
  const head = current
    ? `Make Tools ${update.version} is available. You have ${current}.`
    : `Make Tools ${update.version} is available.`;
  const notes = update.notes ? `\n\nWhat's new:\n${update.notes}` : "";
  return `${head}${notes}\n\nThe app restarts after updating.`;
}

/**
 * Checks for an update on start and offers it. `beforeInstall` deals with
 * unsaved changes first; returning false postpones the update.
 */
export function useUpdater(beforeInstall: () => Promise<boolean>) {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const pending = useRef<AvailableUpdate | null>(null);
  const versionRef = useRef<string | null>(null);
  const beforeInstallRef = useRef(beforeInstall);
  beforeInstallRef.current = beforeInstall;

  async function install(update: AvailableUpdate) {
    if (!(await beforeInstallRef.current())) {
      setStatus({ kind: "available", version: update.version });
      return;
    }
    setStatus({ kind: "downloading", version: update.version, progress: null });
    try {
      await update.install((progress) => setStatus({ kind: "downloading", version: update.version, progress }));
    } catch (e) {
      setStatus({ kind: "available", version: update.version });
      await showMessage(`The update couldn't be installed:\n${String(e)}`, "Update failed");
    }
  }

  async function offer(update: AvailableUpdate) {
    pending.current = update;
    setStatus({ kind: "available", version: update.version });
    if (await askUpdateNow(updatePrompt(versionRef.current, update))) await install(update);
  }

  /** `quiet`: a failed check (e.g. offline) isn't worth mentioning on start. */
  async function checkNow(quiet = false) {
    setStatus({ kind: "checking" });
    let update: AvailableUpdate | null;
    try {
      update = await findUpdate();
    } catch (e) {
      setStatus(quiet ? { kind: "idle" } : { kind: "error", message: String(e) });
      return;
    }
    if (update) await offer(update);
    else setStatus({ kind: "latest" });
  }

  function installPending() {
    if (pending.current) void install(pending.current);
  }

  useEffect(() => {
    currentVersion()
      .then((v) => {
        versionRef.current = v;
        setVersion(v);
      })
      .catch(() => {})
      .finally(() => void checkNow(true));
    // Once, on start.
  }, []);

  return { version, status, checkNow: () => void checkNow(), installPending };
}
