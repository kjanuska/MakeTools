# Profiles module spec

Status: **approved** by the user on 2026-09-23. It is built in two parts: **2a** (editing one group) and **2b** (working across groups). See the ROADMAP.

## Purpose
Each `profile/*.csv` file is a **profile group**, with one profile per row. Tasks (a later module) refer to profiles either by group (`ALL` = every profile in the group) or by a single `profileName`. Profiles are the base for everything else, so profile and group identity must stay stable and easy to link to later.

## Format
Confirmed with the user and checked on the 6 current files (structure only):
- Path: `<Makebot>/profile/<group>.csv`. The group name is the file name without `.csv`. There can be any number of files (usually no more than 200).
- Header line (exact, 15 columns):
  `profileName,firstName,lastName,email,address1,address2,city,state,zipcode,country,phoneNumber,ccNumber,ccMonth,ccYear,cvv`
- One profile per line, comma-separated, **no quoting**. Values never contain commas or quotes.
- Current files: **CRLF**, **no BOM**, **trailing newline**, no blank lines, no surrounding spaces, ASCII only.
- A group can be empty. That's a header-only file, and a 0-byte file is also valid.
- Files are also edited by hand in Ron's Data Edit, so the app must tolerate whatever that tool writes.

### Parsing and saving (byte-exact rules)
- Loading a file and saving it without edits reproduces it **byte for byte**.
- Each line keeps its own line ending. New lines use the file's line ending. If the file has none (0-byte, or header with no newline), they use **CRLF**. Whether the file ends with a newline is kept as is.
- A BOM, if present, is kept.
- Rows the user didn't edit are written back unchanged. An edited row is written as its 15 values joined with `,`.
- **Unparseable rows**, meaning the wrong number of fields, are shown read-only and flagged, and pass through unchanged. Blank lines pass through unchanged too.
- If the **header doesn't match** exactly, the file opens read-only with a warning.
- New files and new groups are written as header + rows, CRLF, trailing newline, no BOM, the same as current files.

## Fields and validation
All rules live in **one easy-to-edit config file per module**: `src/lib/rules/profiles.ts` now, and `tasks.ts` later with the same format. Each field's rule is a plain object, so tweaking one means changing one line. The same rule engine is used for every module.

**Validation blocks saving:** the save button is disabled while **any row in the file** has an error, including rows that were already there and weren't edited. Each error is shown on its cell. Unparseable rows are the exception: they pass through unchanged, are flagged, and don't block saving.

Rules for every field: the value must not contain `,`, `"`, CR or LF (the file format forbids them), and must not have spaces at the start or end (blocked, not trimmed).

| Field | Required | Rule | Input |
|---|---|---|---|
| profileName | yes | any value, repeats allowed; not `ALL` (case-sensitive: `all` is allowed) | text |
| firstName | yes | none beyond the format rule | text |
| lastName | yes | none beyond the format rule | text |
| email | yes | valid email format: `local@domain.tld`, no spaces | text |
| address1 | yes | none beyond the format rule | text |
| address2 | **no** | none beyond the format rule | text |
| city | yes | none beyond the format rule | text |
| state | US: yes · other: **no** | US: one of the 50 US state codes, uppercase (DC and territories not included). Other countries: free text (e.g. `ENG`, `東京都`) | US: **dropdown** · other: text |
| zipcode | yes | US: exactly 5 digits. Other countries: any format (e.g. `PR3 1NJ`, `150-0001`) | text |
| country | yes | any 2 uppercase letters (`US`, `LT`, `GB`, `JP`, …) | text, suggesting `US` and the codes already in the group |
| phoneNumber | yes | US: exactly 10 digits. Other countries: digits, optionally starting with `+` (e.g. `+37060000000`) | text |
| ccNumber | yes | digits only, any length (all card types) | text |
| ccMonth | yes | `01`–`12`, two digits | **dropdown** |
| ccYear | yes | two digits; the dropdown shows the current year to +10 (`26`–`36` in 2026), plus an older value a row already has | **dropdown** |
| cvv | yes | digits only, any length | text |

**US vs other countries (2026-10-07):** a row whose country is exactly `US` gets the strict US checks for state, zipcode and phoneNumber; any other country gets the relaxed ones. Changing a row's country switches its state cell between the dropdown and free text. Bulk edit of state follows the first selected row's country. The US rules are `US_RULES` in the config, picked per row by `profileRulesFor`.

Rule: when a field's set of allowed values is known and reasonably small, it's shown as a dropdown.

No masking. Card numbers and CVVs are shown in full in the grid. They are still never logged or printed.

## Operations
Per group (the file being edited):
- Add, delete, duplicate and reorder rows.
- **Bulk edit:** select many rows (or the whole group) and set one field to the same value on all of them. The bulk edit panel is always open.
- **Create from template:** pick an existing row as a template and create N new rows from it.
- **Default profileName for new rows** (added, from a template or pasted without a name): the row's 1-based position in the file, not counting the header. For example, a new 51st row gets `51`. It can be edited afterwards. Names may repeat, so a taken name is fine.
- **Import:** paste rows in the same 15-column comma-separated format and add them to the group. They're validated like any other row.

Across groups:
- Create a new empty group, and rename, copy or delete a group file.
- Move or copy selected profiles to another group. Names already in the target group are allowed.

Every change is saved through `save_text`, which makes a backup first. **Renaming and deleting group files needs new Rust commands** (`rename_file`, `delete_file`), and both make a backup first.

## UI
- **Groups overview:** every group with its profile count, the **total number of profiles** across all groups, and each group's validation status.
- **Group grid (like Ron's Data Edit):** one row per profile and one column per field.
  - The whole cell is the input, with no boxes inside cells. Cells with a value list are dropdowns.
  - Invalid cells are highlighted red with the reason.
  - Rows are selected by clicking the row number: Shift-click selects a range, Ctrl-click adds or removes a row, and the `#` header selects all. There are no checkboxes.
  - Enter / Shift+Enter and Up/Down move between rows in the same column.
- **Quick lookup:** search `profileName` across all groups to see what already exists.
- **Unused profiles:** deferred to the Tasks module, which will show which profiles or groups no task refers to.
- **Unsaved changes (like git status):** edits stay in memory per file, so you can switch files and modules freely without being asked.
  - Changed files get a ● next to their name in the file list and are listed under "Unsaved changes" in the sidebar (`M profile/<file>`). Clicking one opens it. **Save all** saves every changed file without errors and reports the rest.
  - The only prompt is on **closing the app**, and on switching the Makebot folder: Save all / Discard / Cancel. If a file can't be saved (for example, it has errors), the app stays open and explains why.
- **Files with validation errors are highlighted red** in the file list, including files not opened yet (every profile file is checked when the list loads) and files with a wrong header.

## Tests
Same change as the feature, following the project's testing rules:
- Byte-exact round trip: CRLF, LF, mixed, trailing newline or not, BOM, 0-byte, header-only, blank lines, unparseable rows, header mismatch, non-ASCII.
- Editing one cell changes only that row's bytes. Adding a row uses the file's line ending.
- Every rule in the config, including the edge values (`00`/`13` month, 4- or 6-digit zip, lowercase state, `ALL`, comma in value), the US vs other-country rules, and repeated names being allowed.
- Bulk edit, template creation, import parsing, and move/copy between groups (names already in the target are allowed).
- Rust: `rename_file` and `delete_file` back up first, work atomically and fail safely.

## Decisions (open questions answered 2026-09-23)
1. Saving is blocked until **every** row in the file is valid, including old placeholder rows.
2. email: valid email format check.
3. phoneNumber: exactly 10 digits (US rows; see 11).
4. state: the 50 states only (US rows; see 11).
5. ccYear: current year to +10, and an older existing value is still shown.
6. `ALL` is reserved only in that exact uppercase form.
7. New rows' profileName defaults to their row number, and can be edited.
8. Spaces at the start or end of a value block saving.
9. Rules live in a config file in the code, not an in-app editor.
10. ~~profileName must be unique within a file.~~ Changed 2026-10-07: profileName can be anything and may repeat (only `ALL` is reserved). There are no duplicate checks.
11. (2026-10-07) Profiles can be outside the US (see `eu.csv`, `example.csv`). country is any 2 uppercase letters. US rows keep the strict state/zip/phone checks; other countries have an optional free-text state, a required zipcode in any format, and a phone of digits with an optional leading `+`.

## Open questions
_None._

## Build notes (2a, 2026-09-23)
Details settled while building. Each is small, and the user can change any of them at the 2a check:
- **New rows always go at the end:** added, duplicated, from a template, or pasted. Use Move up/down to reorder. This keeps new row numbers (and so default names) from clashing with rows below them.
- **Add row** prefills `country` with `US`, the usual value. Every other field starts empty.
- **Duplicate** copies every value except `profileName`, which becomes the new row number.
- **Paste rows** rejects the whole paste if any line doesn't have exactly 15 values. A pasted row with an empty name gets its row number.
- **Template count** is 1–1000 per action.
- **Save safety:** before writing, the file is read again. If another program (such as Ron's Data Edit) changed it since it was opened here, the app asks before overwriting it. After writing, the file is read back and compared with what was sent.
- **Restoring a backup** is disabled while there are unsaved changes.
- The close prompt needs the `core:window:allow-destroy` and `dialog:allow-message` capabilities.
- Changed after the first 2a check (2026-09-23): shift-select, the always-open bulk edit panel, git-status-style unsaved changes with no prompt when switching files, red highlighting for invalid files, and the Ron's Data Edit-style grid.
## Build notes (2b, 2026-09-23)
- **Groups overview:** shown when Profiles is open and no group is selected. Clicking **Profiles** again or **← All groups** in a group returns to it.
  - It lists each group with its profile count and status (OK, N errors, unsaved changes, wrong header, couldn't read), with problem groups in red.
  - The total above the table counts unsaved edits.
- **Find a profile:** case-insensitive "contains" search on `profileName` across all groups, showing up to 200 matches. Opening a match opens its group with that row selected.
- **Group files:**
  - **Create** writes the header + CRLF and opens the new group.
  - **Copy** is byte-exact from the saved file, with a suggested name of "<name> copy".
  - **Rename** warns that tasks referring to the old name aren't updated.
  - **Delete** says how many profiles the group has.
  - Rename, copy and delete are disabled while the group has unsaved changes.
- **Group names** are file names without `.csv`. They can't be empty, can't start or end with a space and can't end with a dot. They can't be a Windows reserved name. They can't contain `, < > : " / \ | ? *` or control characters (a comma or quote would break task CSVs). They must be unique, ignoring case. A rename can change only the case.
- **Safety:** `create_file` never overwrites an existing file, and `rename_file` refuses to replace another file. Delete and rename back up the file first under its old path. To get a deleted group back, create a group with the same name and restore it from Backups.
- **Move / copy to group** (editor panel): the selected profiles are added to the end of another editable group with their names kept, even if the target already has those names. Both groups are left with unsaved changes until saved.
- Reloading a file that hasn't changed on disk keeps its rows as they are, so selections survive list refreshes.
## Build notes (2b feedback, 2026-09-23)
- **Changed cells:**
  - An edited cell gets a tinted background and a corner mark, and hovering it shows "Was: <old value>". An empty old value shows as "(empty)". A validation error, if any, is listed first.
  - New rows are tinted green, and their row number says "New row (not saved yet)".
  - The marks clear on save or discard, and they stay while you switch between files.
  - Each file keeps its as-loaded rows (the store's `base` and `original`), and edits keep row ids, so every cell can be compared with its saved value.
- **Row numbers:** clicking the only selected row deselects it.
- **Shortcuts:** every action is listed in `src/lib/shortcuts.ts` with a default, and all of them can be changed on the Settings page. The defaults:
  - Saving: Save `Ctrl+S`, Save all `Ctrl+Shift+S`, Discard (none).
  - Selection: Select all rows `Ctrl+A`, Clear selection `Escape`.
  - Rows: Add row `Ctrl+N` (puts the cursor in the new row), Duplicate `Ctrl+D`, Delete rows `Ctrl+Delete`, Move up/down `Alt+↑/↓`.
  - Panels: Bulk edit `Ctrl+B`, From template `Ctrl+T`, Paste rows `Ctrl+Shift+V`, Move/copy `Ctrl+M`, Backups `Ctrl+H`.
  - Navigation: Back to all groups `Alt+←`, Find a profile `Ctrl+F`, Refresh file list `F5`, Settings `Ctrl+,`.
  - In a text box outside the grid (paste box, search, bulk value), only the save, panel and navigation shortcuts work, so Ctrl+A and similar keys still act on the text.
  - While a grid cell is being edited, Ctrl+A selects the cell's text, not all rows (user request, 2026-09-23). It selects all rows when focus is elsewhere, for example after clicking a row number or on a dropdown cell. Other shortcuts still work in cells.
  - A shortcut must use Ctrl or Alt, except F1–F12 and Escape.
  - Giving one action another action's keys removes them from the other action, with a note.
  - Page-reload keys (`F5`, `Ctrl+R`, `Ctrl+Shift+R`) are always blocked, so unsaved changes can't be lost by accident.
  - Changes to shortcuts are saved in settings.json as differences from the defaults.
- **Settings page** (the ⚙ Settings button in the top right, or `Ctrl+,`): shows the Makebot folder with **Change folder…**, and the shortcut editor. The top bar no longer has a Change folder button.
- **Backups:** the backups panel under the grid is gone. Each group has a **Backups ▾** button in the top right, which opens a dropdown of its backups with Restore buttons.
- **Staged restore:** Restore reads the backup (Rust `read_backup`) and loads it as unsaved changes. The file on disk isn't touched until Save, and Discard changes undoes the restore. Rows are matched by position, so changed cells show what they were. If there are unsaved edits, the app asks first. A backup without the profile header is refused.

- Code: overview in `src/modules/profiles/GroupsOverview.tsx`, file operations in `groups.ts` and name rules in `groupNames.ts`.

- Code: format in `src/lib/formats/profiles.ts`, rules engine and config in `src/lib/rules/`, edit operations in `src/modules/profiles/ops.ts`, open files and unsaved edits in `src/modules/profiles/store.ts`, UI in `src/modules/profiles/ProfilesEditor.tsx`, and the sidebar list in `src/shell/ChangesPanel.tsx`.
