import { TableEditor } from "../../components/table/TableEditor";
import type { FileEntry } from "../../lib/fs";
import { confirmOverwrite } from "./prompts";
import type { ProfileStore } from "./store";
import { PROFILE_UI } from "./ui";

interface Props {
  file: FileEntry;
  store: ProfileStore;
  onSaved: () => void;
  /** Every profile group, for moving/copying rows. */
  groups: FileEntry[];
  onBack: () => void;
  /** Select and scroll to this row once loaded. */
  highlightId?: number;
}

export function ProfilesEditor({ groups, ...props }: Props) {
  return <TableEditor {...props} files={groups} ui={PROFILE_UI} confirmOverwrite={confirmOverwrite} />;
}
