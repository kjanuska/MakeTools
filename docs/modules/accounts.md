# Accounts module spec

Status: **built, awaiting user check** (2026-09-30). The user described the scope in one request: a formatted page instead of plain text, batch import in the account-file format, and passwords shown in plain text.

## Format
- Files are `account/*.txt`. Each file is one account group, and task files refer to it by name (without `.txt`).
- One account per line, colon-delimited, no header. The real files use CRLF.
- A line has 2, 4 or 6 parts:
  - `email:password`
  - `email:password:proxyHost:proxyPort`
  - `email:password:proxyHost:proxyPort:proxyUser:proxyPass`
- A line is an account when it has 2, 4 or 6 parts. The values aren't checked: any email, password, host or port is accepted, including empty ones (user, 2026-09-30). Any other line (including blank ones) is kept exactly as it is and listed as not in the account format.
- A password containing `:` can't be represented; such a line shows up as unrecognized.

## Operations
- **View** a group: summary cards (accounts, with/without a proxy, email domains), a table with line number, email, password, proxy `host:port`, and the proxy user and password (those two columns appear only when some account has them). Passwords aren't hidden. Clicking a value selects it for copying.
- **Filter** by clicking the summary cards (user, 2026-09-30). Each one is a toggle:
  - "with a proxy" and "without a proxy" (turning one on turns the other off);
  - any number of email domains, matching any of those selected ("(no domain)" for emails without an `@`).
  - The domain card lists the top 6 domains plus any selected ones, and has "+N more" / "Show fewer".
  - Filters combine with each other and with search. "Clear filters" turns them all off.
- **Search** by email, proxy host or proxy user.
- **Import**: paste lines, or load a `.txt` file (added to what's already pasted). The preview counts the accounts to add and lists lines not in the format with their line numbers and part counts.
  - Only parsing, no other checks (user, 2026-09-30): there's no deduplication, and lines are added exactly as pasted, without trimming.
  - Blank lines are ignored. Lines without 2, 4 or 6 parts are skipped.
  - "Add N accounts" appends the lines to the end of the file through `save_text` (backup first). It saves right away and isn't staged. It re-reads the file first, so changes made on disk since the page was opened are kept.
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
- Tests: format unit tests (the three line shapes, part-count-only checks, odd lines, BOM, LF/CRLF/tie, missing trailing newline, empty file, non-ASCII, symbols in passwords, import planning and appending), UI tests (overview, create, table, filters, import, loading from a file, appending to the current on-disk file, save failure), and real-file tests (every line of the real files parses as an account, and appending keeps every existing byte).

## Decisions
- Parts 3–6 are the proxy host, port, user and password (confirmed by the user, 2026-09-30).
- Import doesn't deduplicate or check values, only the line format (user, 2026-09-30).

## Open questions
None.
