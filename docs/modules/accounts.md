# Accounts module spec

Status: **built, awaiting user check** (2026-09-30). The user described the scope in one request: a formatted page instead of plain text, batch import in the account-file format, and passwords shown in plain text.

## Format
- Files are `account/*.txt`. Each file is one account group, and task files refer to it by name (without `.txt`).
- One account per line, colon-delimited, no header. The real files use CRLF.
- A line has 2, 4 or 6 parts:
  - `email:password`
  - `email:password:proxyHost:proxyPort`
  - `email:password:proxyHost:proxyPort:proxyUser:proxyPass`
- A line is read as an account when it has 2, 4 or 6 parts, the email has an `@` and no spaces, the password isn't empty, the port is 1–65535, and (for 6 parts) the proxy user and password aren't empty. Any other line (including blank ones) is kept exactly as it is and listed as not in the account format.
- A password containing `:` can't be represented; such a line shows up as unrecognized.

## Operations
- **View** a group: summary cards (accounts, with/without a proxy, email domains), a table with line number, email, password, proxy `host:port`, and the proxy user and password (those two columns appear only when some account has them). Passwords aren't hidden. Clicking a value selects it for copying.
- **Search** by email, proxy host or proxy user, and filter by All / With proxy / Without proxy.
- **Import**: paste lines, or load a `.txt` file (added to what's already pasted). The preview counts new accounts, duplicates and invalid lines, and lists the last two with line numbers and reasons.
  - Blank lines are ignored and spaces around a line are trimmed.
  - Duplicates (by email, ignoring case) of an account already in the file, or earlier in the import, are skipped.
  - Invalid lines are skipped.
  - "Add N accounts" appends the new lines to the end of the file through `save_text` (backup first). It saves right away and isn't staged. It re-reads the file first, so duplicates are checked against what's on disk at that moment.
  - Existing bytes are never changed. New lines use the file's most common line ending (CRLF for an empty file or a tie), and a missing final line ending is added before them.
  - Newly added rows are highlighted until the page is left.
- **Overview**: every group with accounts, accounts with a proxy, main email domain and status (OK / N unrecognized lines / Couldn't read), plus totals. **New account group** creates an empty `<name>.txt` (`create_file`, never overwrites). The name rules are the same as for profile groups.
- **Backups**: the page lists the file's backups. A restore is written right away (the current version is backed up first).

## Not included (not asked for)
Editing or deleting single accounts, renaming, copying or deleting groups, moving accounts between groups, and changes in the Changes panel (imports save immediately).

## Build notes (2026-09-30)
- `src/lib/formats/accounts.ts`: `parseAccounts`, `planImport` and `appendLines`. Files are only read or appended to, so no serializer is needed. The byte-for-byte guarantee is that the output starts with the exact original text.
- `src/modules/accounts/`: `AccountsOverview`, `AccountFileView`, `ImportPanel` and `stats.ts`. Styles are in `accounts.css`.
- `lib/table/fileNames.ts` helpers take an optional extension (default `.csv`) so account groups use `.txt`.
- `pickTextFile` has been added to `lib/dialogs.ts`.
- Tests: format unit tests (the three line shapes, odd lines, BOM, LF/CRLF/tie, missing trailing newline, empty file, non-ASCII, symbols in passwords, import planning and appending), UI tests (overview, create, table, filters, import, loading from a file, on-disk duplicate check, save failure), and real-file tests (every line of the real files parses as an account, and appending keeps every existing byte).

## Open questions
- Is the reading of parts 3–6 as proxy host, port, user and password right? It was inferred from `example.txt`.
- Should duplicates be checked across all account groups, not just the one being imported into?
