import { TableOverview } from "../../components/table/TableOverview";
import type { FileEntry } from "../../lib/fs";
import type { ProfileStore } from "./store";
import { PROFILE_UI } from "./ui";

interface Props {
  files: FileEntry[] | null;
  dir: string;
  store: ProfileStore;
  onOpen: (file: FileEntry, highlightId?: number) => void;
  onFilesChanged: () => void;
  findRequest?: number;
}

export function GroupsOverview(props: Props) {
  return <TableOverview {...props} ui={PROFILE_UI} />;
}
