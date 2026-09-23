// Profile files in memory: the shared table store with the profile schema.
import { TableStore } from "../../lib/table/store";
import { PROFILE_SCHEMA } from "./schema";

export {
  useStoreVersion,
  type ConfirmOverwrite,
  type DocEntry,
  type SaveAllResult,
  type SaveResult,
  type TransferResult,
} from "../../lib/table/store";

export class ProfileStore extends TableStore<null> {
  constructor() {
    super(PROFILE_SCHEMA, null);
  }
}
