# Tasks module spec

Status: **approved** by the user on 2026-09-23 (interview rounds 1–3).

The work is split in two:
- **3a (this spec):** editing task files, with the same editor as profiles plus task-specific fields and links.
- **3b:** batch operations and views (generating tasks, bulk changes, unused profiles, counts per site and so on), plus updating task references when profile groups or names are renamed. The user will describe these later, and 3b gets its own interview.

## Purpose
Each `task/*.csv` file is a **task group** that make-engine runs. Each row becomes tasks:
- `profileName` = `ALL`: one task **per profile** in the row's `profileGroup`. For example, group `25` with 25 profiles gives 25 tasks from one row.
- `profileName` = a profile's name: **one** task for that profile.

Tasks link to the other modules by name:
- `profileGroup` → `profile/<name>.csv`
- `profileName` → a `profileName` in that profile group
- `proxyGroup` → `proxy/<name>.txt`
- `accountGroup` → `account/<name>.txt`

## Format
Confirmed with the user and checked on the 78 current files (structure only):
- Path: `<Makebot>/task/<group>.csv`. 78 files, 1 to 1,000 rows each, 3,311 rows in total.
- Header line (exact, 11 columns): `profileGroup,profileName,proxyGroup,accountGroup,input,size,color,site,mode,cartQuantity,delay`
- Comma-separated with **no quoting**. A value can't contain a comma, quote or line break.
- Current files: **LF** line endings, no BOM, a trailing newline, no blank lines.
- **Byte-exact rules** are the same as for profiles:
  - An unedited file saves back identically.
  - Each line keeps its own line ending, and new lines use the file's (here LF).
  - Unparseable lines pass through unchanged and are flagged.
  - A file whose header doesn't match opens read-only.
- New task files: header + LF + trailing newline, no BOM, matching the current files.

### Automatic fixes (confirmed with the user)
These two cases are the exception to "rows you didn't edit are never changed". They're applied **silently** when a file is opened, as unsaved changes with no per-cell mark. The file does show under Unsaved changes, because the fix only reaches make-engine once saved.
1. **Whitespace in `input`:** leading and trailing spaces are removed, and runs of spaces become a single space. The same cleanup runs when you leave an `input` cell after editing it. This affects 1,009 rows in the current files.
2. **A quoted value split across lines** (e.g. `drift.csv`): if a line opens a `"` that closes on a following line, and joining those lines gives exactly 11 values, they're joined into one line. The quotes are removed and the line break becomes a space, and then the whitespace cleanup applies. Anything that doesn't fit that pattern stays as unparseable lines and is flagged.

## Fields and validation
All rules live in `src/lib/rules/tasks.ts`, using the same engine and one-line-per-field config as profiles. The input parsing rules and the mode parts list are there too, so they're easy to change later.

**Every field** also gets the format rule: no `,`, `"` or line breaks. Leading or trailing spaces are an error in every field except `input`, where they're cleaned up automatically. Validation errors block saving, including errors in rows you didn't edit, like profiles.

| Field | Input | Rule |
|---|---|---|
| profileGroup | **dropdown** of the current profile groups (files in `profile/`) | required; must exist |
| profileName | **dropdown**: `ALL` + the profile names in the chosen group | Disabled until a profileGroup is chosen, then defaults to `ALL`. **Error** if set without a profileGroup (e.g. hand-edited), or if the name isn't in that group. |
| proxyGroup | **dropdown** of `proxy/*.txt` | required; must exist |
| accountGroup | **dropdown** of `account/*.txt` | required; must exist |
| input | text, plus a read-only **parsed** column | required; cleaned up automatically; no classifying or lowercasing |
| size | text; **`random` is shown distinctly** (e.g. a 🎲 random chip) | required; free string, e.g. `9&9.5&10`, `Medium&Large`, `whole` |
| color | text; **`random` shown distinctly** | required; free string (the 2 current rows with an empty color will show as errors) |
| site | **dropdown** of the global site list, plus **"Add site…"** | required; must be in the list |
| mode | **ordered multi-select** of mode parts (see Modes) | required; must split into known parts |
| cartQuantity | **spin button** | whole number ≥ 1 |
| delay | **spin button**, milliseconds, step 100 | whole number ≥ 0, no maximum |

### Links
- The group dropdowns list the files currently in each folder, and they update when groups are created or renamed. Proxies and accounts work the same as profile groups even though those modules aren't built yet.
- The profileName dropdown uses the chosen group's profiles, **including unsaved edits** in the Profiles module.
- If a row's profileGroup changes and its profileName isn't in the new group, profileName resets to `ALL` (a visible, marked change).

### input
- Always treated as a **string**. It's never lowercased or sorted into keywords/variants/SKUs; uppercase codes like `A1234-123` are fine.
- **Parsed column:** when an input contains spaces, the words are split into **positive** (no leading `-`) and **negative** (leading `-`) and shown next to the input. It updates when you leave the cell.
- The parsing rules (separator, negative prefix) live in the tasks rules config, and more input validation will be added there later.

### Sites
- A **global site list**, kept in the app's settings (not in the Makebot folder), seeded the first time with the 67 sites used in the current task files.
- The site dropdown has an **"Add site…"** entry. A site added there stays in the list permanently.
- **Settings → Sites:** add, rename and remove sites.
  - **Rename:** first a warning ("This changes the site in N tasks in M files"). Then every task file using it is **updated and saved directly**, each backed up first, with no staging. A file that already has unsaved edits gets the rename added to those edits instead, so the user's unsaved work isn't saved without them.
  - **Remove:** allowed. Tasks that still use the site become invalid and are flagged.

### Modes
A mode is an **ordered list of parts joined with no separator**, e.g. `preload` + `stuck` + `wait` = `preloadstuckwait`.
- **Editor:** an ordered multi-select. The chosen parts appear as chips in order. Parts are added from a dropdown (appended at the end), and can be removed or moved left/right.
- **Checking a mode:** the saved string must split fully into known parts, matching the longest part first. Any leftover text is an error. Rules about which parts can go together come later.
- **Parts list** (in the rules config, in this order; from the bot guide unless noted):
  - Main modes: `preload`, `direct`. Also `safe`, `fast` and `human`, which the guide lists as discontinued.
  - Sub-modes: `wait`, `pause`, `login`, `stuck`, `shoppay`, `lite`, `store`, `free`.
  - Supreme JP only: `cod`.
  - Found in the files but not in the guide: `paypal`, `monitor`. The user confirmed they're real modes.
- **Order and combinations:** the guide's examples are `preloadwait`, `preloadstuck`, `preloadstuckwait`, `preloadwaitlite`, `preloadwaitlitestuck`, `preloadstore`, `fastwait`, `safewait` and `directwait`. Your files also use `preloadwaitstuck`, `directstuck`, `preloadlite` and `login` alone. The rules for which parts can combine, and in what order, are **unclear and flagged for later**. For now any order is accepted.

## Operations (3a)
The same as profiles, per task file:
- Add, duplicate, delete, reorder, bulk edit, from template, paste, and move/copy between task files.
- Create, rename, copy and delete task files.
- Changed-cell marks, git-status-style unsaved changes, backups dropdown with staged restore, shortcuts, and the file overview.

## UI
- The same grid as profiles, with the column types from the table above.
- **Task count:** each row shows how many tasks it runs: `ALL` gives the group's profile count, and a named profile gives 1. Each file shows its total, and the overview shows the totals per file and overall.
- **Overview search:** matches any field. It shows the matching rows (file, row, the matching field) and opens the file at that row.

## Code plan
Profiles and tasks are both unquoted CSVs with a fixed header. The CSV parser, the store, the grid and its panels, and the overview are generalised into shared code now that a second module needs it. The profiles module then configures them. The profiles tests stay as they are and must keep passing unchanged, which shows the refactor didn't change any behavior.

## Later (3b and beyond)
- Batch operations and views (the user will describe them).
- **Offer to update tasks** when a profile group is renamed or a profileName changes. Later, the same for proxy and account groups. (The user agreed on 2026-09-23.)
- Which mode parts can combine, and in what order.
- More validation for input.

## Open questions
_None._ (Round 3, 2026-09-23: `color` is required; `paypal` and `monitor` are real modes.)
