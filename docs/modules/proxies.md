# Proxies module spec

Status: **approved 2026-09-30** (interview 2026-09-30).

## Format
Files are `proxy/*.txt`: one proxy per line, with no header. Task files refer to a proxy file by name (its "proxy group").

Observed in the 10 real files (2026-09-30):
- Every file uses CRLF, with no blank lines, BOM or leading/trailing spaces.
- Some files end with a newline and some don't.
- Line shapes:
  - `host:port:user:pass`, where the host is an IP or a hostname
  - `ip:port`
  - `localhost` on its own (the only line in `local.txt`, and line 1 of `example.txt`)
- Files hold real credentials. They are shown in the app but never logged, printed or committed.

## What the tab does
1. **Editable list:** the file is shown in one editable text box, with line numbers and passwords visible.
   - The user edits it like any text: paste over everything to replace the list, paste at the end to add, or change single lines.
   - Nothing is trimmed or cleaned. The text is kept as typed.
   - *Changed 2026-09-30 at the user's request:* this replaces the original separate paste box with Replace/Append buttons ("the user will decide what they need to replace/append").
2. **Count:** the number of proxies in the file, meaning non-blank lines. It updates live with unsaved changes.
3. **Shuffle:** puts every line in a random order that differs from the current one, unless all lines are identical or there are fewer than 2. It shuffles what's in the editor, including unsaved edits.
4. **Warnings on odd lines:** a count in the status line, plus an "Odd lines" list (up to 100) whose entries select that line in the editor. These are warnings only and never block saving. A line is accepted without a warning if it is:
   - `host:port`
   - `host:port:user:pass`
   - `localhost`

   A host has no spaces or colons, and the port is 1–65535. Anything else gets a warning, such as a missing port, 3 fields, 5+ fields or spaces inside a line.

## Saving
The same as profiles and tasks:
- Editing and Shuffle make the file **unsaved**. It shows up in the Changes panel, with Save / Discard, and Save all and the close prompt include it.
- Save goes through `save_text`, so a backup is made first. It asks before overwriting a file that changed on disk, and it reads the file back to check it.
- The Backups dropdown stages a backup as unsaved changes.

## Writing rules
- A file that hasn't been changed is never rewritten. Loading and saving without changes gives identical bytes.
- The editor shows `\n` line endings and no BOM. An edit is written back with the file-on-disk's line ending on every line (CRLF, or LF if the file uses LF only), and its BOM is kept. An empty or single-line file gets CRLF, since every real file uses it.
- A final line ending is present or absent exactly as typed.
- If the editor text is changed back to what's on disk, the file is unchanged, byte for byte, even with mixed endings.
- Adding lines at the end keeps every existing byte of a single-ending file.
- Shuffle keeps the file's final-newline style and drops blank lines.

## Not included (not asked for)
- Creating, renaming or deleting proxy files. Tasks refer to them by name, so a rename would break task files.
- Removing duplicates, and trimming or cleaning up lines automatically.

## Build notes (2026-09-30)
- Format: `src/lib/formats/proxies.ts`. It holds pure text-in/text-out functions: `parseProxies`, `countProxies`, `proxyProblem`/`oddLines`, `toEditorText`/`fromEditorText` (editor ↔ file text) and `shuffleProxies`.
  - Shuffle is Fisher–Yates. It tries again if it lands on the same order; if the random source keeps doing that, it moves every line one place.
- Store: `src/modules/proxies/store.ts` (`ProxyStore`). It keeps each file's text exactly as read, and saves the same way the table store does: re-read first, ask before overwriting a file that changed on disk, then read it back to check.
  - `useFileActions` and `useStoreVersion` now take any store with the right shape, so the proxies view reuses the Save / Discard / Backups code.
- View: `src/modules/proxies/ProxyFileView.tsx`. With no file selected, the Proxies tab says "Select a proxy file."
- The count uses the current text, including unsaved changes. Odd lines count toward it.
- The editor is a plain `<textarea>` (no wrapping) with a line-number gutter that scrolls with it, so it copes with the 10,000-line files.

## Open questions
- None.
