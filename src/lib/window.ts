import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Runs `shouldClose` when the user closes the window; returning false keeps
 * it open. Resolves to an unsubscribe function.
 */
export function guardWindowClose(shouldClose: () => Promise<boolean>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await shouldClose())) event.preventDefault();
  });
}
