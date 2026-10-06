import type { UpdateStatus } from "./useUpdater";

interface Props {
  version: string | null;
  status: UpdateStatus;
  onCheck: () => void;
  onInstall: () => void;
}

export function updateStatusText(status: UpdateStatus): string | null {
  switch (status.kind) {
    case "checking":
      return "Checking for updates…";
    case "latest":
      return "You have the latest version.";
    case "available":
      return `Version ${status.version} is available.`;
    case "downloading":
      return status.progress === null
        ? `Downloading ${status.version}…`
        : `Downloading ${status.version}… ${Math.round(status.progress * 100)}%`;
    case "error":
      return `Couldn't check for updates: ${status.message}`;
    default:
      return null;
  }
}

export function UpdateSettings({ version, status, onCheck, onInstall }: Props) {
  const busy = status.kind === "checking" || status.kind === "downloading";
  const text = updateStatusText(status);
  return (
    <section aria-label="Updates">
      <h3>Updates</h3>
      <p>Version {version ?? "unknown"}</p>
      {text && <p className={status.kind === "error" ? "error" : "status"}>{text}</p>}
      <button disabled={busy} onClick={onCheck}>
        Check for updates
      </button>{" "}
      {status.kind === "available" && <button onClick={onInstall}>Update to {status.version}</button>}
    </section>
  );
}
