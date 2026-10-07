// Keeps opened account files in memory, parsed, so a group reopens at once and
// opens like every other module's files (through useFileLoad). Accounts have
// no unsaved edits: imports and restores write the file straight away and then
// reload it here.
import type { FileSource } from "../../components/LoadingPanel";
import { parseAccounts, type AccountsDoc } from "../../lib/formats/accounts";
import { readText, type FileEntry } from "../../lib/fs";

export interface AccountEntry {
  file: FileEntry;
  /** The file as last read. */
  text: string;
  doc: AccountsDoc;
  /** Always false; for the file menu, which locks files with unsaved changes. */
  dirty: false;
}

export class AccountStore implements FileSource<AccountEntry> {
  private entries = new Map<string, AccountEntry>();
  private loadErrors = new Map<string, string>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get(path: string): AccountEntry | undefined {
    return this.entries.get(path);
  }

  loadError(path: string): string | undefined {
    return this.loadErrors.get(path);
  }

  /** Reads a file from disk. If it's unchanged, the parsed copy is kept. */
  async load(file: FileEntry): Promise<void> {
    try {
      const { text } = await readText(file.path);
      const current = this.entries.get(file.path);
      if (current && current.text === text && !this.loadErrors.has(file.path)) return;
      this.entries.set(file.path, { file, text, doc: parseAccounts(text), dirty: false });
      this.loadErrors.delete(file.path);
    } catch (e) {
      this.entries.delete(file.path);
      this.loadErrors.set(file.path, String(e));
    }
    this.changed();
  }

  /** Drops a file from memory, e.g. after it was renamed or deleted. */
  forget(path: string): void {
    this.entries.delete(path);
    this.loadErrors.delete(path);
    this.changed();
  }
}
