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
| profileName | yes | unique within the file (the only duplicate check); not `ALL` (case-sensitive: `all` is allowed) | text |
| firstName | yes | none beyond the format rule | text |
| lastName | yes | none beyond the format rule | text |
| email | yes | valid email format: `local@domain.tld`, no spaces | text |
| address1 | yes | none beyond the format rule | text |
| address2 | **no** | none beyond the format rule | text |
| city | yes | none beyond the format rule | text |
| state | yes | one of the 50 US state codes, uppercase (DC and territories not included) | **dropdown** |
| zipcode | yes | exactly 5 digits | text |
| country | yes | `US` only | **dropdown** |
| phoneNumber | yes | exactly 10 digits | text |
| ccNumber | yes | digits only, any length (all card types) | text |
| ccMonth | yes | `01`–`12`, two digits | **dropdown** |
| ccYear | yes | two digits; the dropdown shows the current year to +10 (`26`–`36` in 2026), plus an older value a row already has | **dropdown** |
| cvv | yes | digits only, any length | text |

Rule: when a field's set of allowed values is known and reasonably small, it's shown as a dropdown.

No masking. Card numbers and CVVs are shown in full in the grid. They are still never logged or printed.

## Operations
Per group (the file being edited):
- Add, delete, duplicate and reorder rows.
- **Bulk edit:** select many rows (or the whole group) and set one field to the same value on all of them. The bulk edit panel is always open.
- **Create from template:** pick an existing row as a template and create N new rows from it.
- **Default profileName for new rows** (added, from a template or pasted without a name): the row's 1-based position in the file, not counting the header. For example, a new 51st row gets `51`. It can be edited afterwards. If that name is already taken, the uniqueness rule flags it like any other duplicate.
- **Import:** paste rows in the same 15-column comma-separated format and add them to the group. They're validated like any other row.

Across groups:
- Create a new empty group, and rename, copy or delete a group file.
- Move or copy selected profiles to another group. Name clashes in the target group block the action.

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
- Every rule in the config, including the edge values (`00`/`13` month, 4- or 6-digit zip, lowercase state, `ALL`, duplicate name, comma in value).
- Bulk edit, template creation, import parsing, and move/copy between groups including name clashes.
- Rust: `rename_file` and `delete_file` back up first, work atomically and fail safely.

## Decisions (open questions answered 2026-09-23)
1. Saving is blocked until **every** row in the file is valid, including old placeholder rows.
2. email: valid email format check.
3. phoneNumber: exactly 10 digits.
4. state: the 50 states only.
5. ccYear: current year to +10, and an older existing value is still shown.
6. `ALL` is reserved only in that exact uppercase form.
7. New rows' profileName defaults to their row number, and can be edited.
8. Spaces at the start or end of a value block saving.
9. Rules live in a config file in the code, not an in-app editor.
10. profileName must be unique within a file. There are no other duplicate checks.

## Open questions
_None._

## Build notes (2a, 2026-09-23)
Details settled while building. Each is small, and the user can change any of them at the 2a check:
- **New rows always go at the end:** added, duplicated, from a template, or pasted. Use Move up/down to reorder. This keeps new row numbers (and so default names) from clashing with rows below them.
- **Add row** prefills `country` with `US`, the only allowed value. Every other field starts empty.
- **Duplicate** copies every value except `profileName`, which becomes the new row number.
- **Paste rows** rejects the whole paste if any line doesn't have exactly 15 values. A pasted row with an empty name gets its row number.
- **Template count** is 1–1000 per action.
- **Save safety:** before writing, the file is read again. If another program (such as Ron's Data Edit) changed it since it was opened here, the app asks before overwriting it. After writing, the file is read back and compared with what was sent.
- **Restoring a backup** is disabled while there are unsaved changes.
- The close prompt needs the `core:window:allow-destroy` and `dialog:allow-message` capabilities.
- Changed after the first 2a check (2026-09-23): shift-select, the always-open bulk edit panel, git-status-style unsaved changes with no prompt when switching files, red highlighting for invalid files, and the Ron's Data Edit-style grid.
- Code: format in `src/lib/formats/profiles.ts`, rules engine and config in `src/lib/rules/`, edit operations in `src/modules/profiles/ops.ts`, open files and unsaved edits in `src/modules/profiles/store.ts`, UI in `src/modules/profiles/ProfilesEditor.tsx`, and the sidebar list in `src/shell/ChangesPanel.tsx`.
