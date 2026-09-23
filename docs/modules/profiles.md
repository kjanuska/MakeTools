# Profiles module spec

Status: **draft, awaiting user approval** (interview held 2026-09-23). Nothing is built until the user approves it.

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

**Validation blocks saving:** the save button is disabled while any row the save would write has an error, and each error is shown on its cell. (See the open question about pre-existing bad rows.)

The file format itself forbids `,`, `"`, CR and LF in any value, so this applies to every field.

| Field | Required | Rule | Input |
|---|---|---|---|
| profileName | yes | unique within the file; not `ALL` | text |
| firstName | yes | none beyond the format rule | text |
| lastName | yes | none beyond the format rule | text |
| email | yes | _open question_ | text |
| address1 | yes | none beyond the format rule | text |
| address2 | **no** | none beyond the format rule | text |
| city | yes | none beyond the format rule | text |
| state | yes | uppercase 2-letter US state code | **dropdown** |
| zipcode | yes | exactly 5 digits | text |
| country | yes | `US` only | **dropdown** |
| phoneNumber | yes | digits only | text |
| ccNumber | yes | digits only, any length (all card types) | text |
| ccMonth | yes | `01`–`12`, two digits | **dropdown** |
| ccYear | yes | two digits (e.g. `27`) | **dropdown** |
| cvv | yes | digits only, any length | text |

Rule: when a field's set of allowed values is known and reasonably small, it's shown as a dropdown.

No masking. Card numbers and CVVs are shown in full in the grid. They are still never logged or printed.

## Operations
Per group (the file being edited):
- Add, delete, duplicate and reorder rows.
- **Bulk edit:** select many rows (or the whole group) and set one field to the same value on all of them.
- **Create from template:** pick an existing row as a template and create N new rows from it with auto-assigned profile names (see open questions).
- **Import:** paste rows in the same 15-column comma-separated format and add them to the group. They're validated like any other row.

Across groups:
- Create a new empty group, and rename, copy or delete a group file.
- Move or copy selected profiles to another group. Name clashes in the target group block the action.

Every change is saved through `save_text`, which makes a backup first. **Renaming and deleting group files needs new Rust commands** (`rename_file`, `delete_file`), and both make a backup first.

## UI
- **Groups overview:** every group with its profile count, the **total number of profiles** across all groups, and each group's validation status.
- **Group grid:** one row per profile and one column per field. Cells can be edited inline, with dropdowns where the rule has a value list. Invalid cells are highlighted with the reason, and rows can be multi-selected for bulk actions.
- **Quick lookup:** search `profileName` across all groups to see what already exists.
- **Unused profiles:** deferred to the Tasks module, which will show which profiles or groups no task refers to.
- Unsaved changes are marked. Leaving a file or closing the app with unsaved changes asks first.

## Tests
Same change as the feature, following the project's testing rules:
- Byte-exact round trip: CRLF, LF, mixed, trailing newline or not, BOM, 0-byte, header-only, blank lines, unparseable rows, header mismatch, non-ASCII.
- Editing one cell changes only that row's bytes. Adding a row uses the file's line ending.
- Every rule in the config, including the edge values (`00`/`13` month, 4- or 6-digit zip, lowercase state, `ALL`, duplicate name, comma in value).
- Bulk edit, template creation, import parsing, and move/copy between groups including name clashes.
- Rust: `rename_file` and `delete_file` back up first, work atomically and fail safely.

## Open questions
1. **Pre-existing invalid rows:** current files have placeholder rows that break the rules (letters in zipcode, lowercase state). Should save be blocked until **every** row in the file is valid, or only until the rows **you changed or added** are valid?
2. **email:** should it be checked (for example, something@something.something), or accepted as any value?
3. **phoneNumber:** digits only, or exactly 10 digits?
4. **state list:** only the 50 states, or also DC and territories (PR, GU, VI, …)?
5. **ccYear dropdown range:** for example, this year to +10 (`26`–`36`)? Should older years be kept as options for existing rows?
6. **`ALL`:** reserved only in exactly that form, or in any case (`all`, `All`)?
7. **Template naming:** new rows take the next free numbers after the highest numeric `profileName` in the group (for example `51`, `52`, …)? Or do you set a prefix and start number?
8. **Leading or trailing spaces** in a value: allow them, block them, or trim them automatically?
9. **Rule config editing:** is a code-level config file (`src/lib/rules/profiles.ts`) "easy to edit" enough, or do you want to edit rules inside the app?
10. **"Duplicates don't really matter":** I read this as "I don't need a view to find duplicates," so duplicate `profileName` within a file still blocks saving. Correct?
