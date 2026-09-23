# Tasks module spec

Status: **draft, awaiting user approval** (interview round 1 held 2026-09-23). Nothing is built until the user approves it.

The work is split in two:
- **3a (this spec):** editing task files, with the same editor as profiles plus task-specific fields and links.
- **3b:** batch operations and views (generating tasks, bulk changes, unused profiles, counts per site and so on). The user will describe these later, and 3b gets its own interview.

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
- New task files: header + LF + trailing newline, no BOM, matching the current files. (Profiles use CRLF because their files do.)
- **Known broken file:** in `drift.csv`, one `input` is wrapped in quotes and split over two lines, so it shows up as two unparseable lines. The user confirmed it should be one line. See open question 4 for how to fix it.

## Fields and validation
All rules live in `src/lib/rules/tasks.ts`, using the same engine and one-line-per-field config as profiles. Input parsing is its own small config there too, since the user will add input validation later.

**Every field** also gets the format rule: no `,`, `"` or line breaks. Leading and trailing spaces: see `input` below and open question 1.

| Field | Input | Rule |
|---|---|---|
| profileGroup | **dropdown** of the current profile groups (files in `profile/`) | required; must exist |
| profileName | **dropdown**: `ALL` + the profile names in the chosen group | disabled until a profileGroup is chosen, then defaults to `ALL`. **Error** if set without a profileGroup (e.g. hand-edited), or if the name isn't in that group. |
| proxyGroup | **dropdown** of `proxy/*.txt` | must exist (required? open question 2) |
| accountGroup | **dropdown** of `account/*.txt` | must exist (required? open question 2) |
| input | text, with a **parsed view** | trailing spaces are removed (open question 1); little validation for now, with more rules later in the config |
| size | text; **`random` is shown distinctly** (e.g. a 🎲 random chip) | free string, e.g. `9&9.5&10`, `Medium&Large`, `whole` |
| color | text; **`random` shown distinctly** | free string, e.g. `Black&Blue&Navy` |
| site | **dropdown** of the global site list, plus **"Add site…"** | must be in the list |
| mode | **dropdown** (see open question 6) | validation comes later |
| cartQuantity | **spin button** | whole number ≥ 1 |
| delay | **spin button** (milliseconds) | whole number ≥ 0 |

### Links
- The group dropdowns list the files currently in each folder, and they update when groups are created or renamed.
- The profileName dropdown uses the chosen group's profiles, **including unsaved edits** in the Profiles module.
- If a row's profileGroup changes and its profileName isn't in the new group, profileName resets to `ALL`. This is a visible, marked change.
- Validation errors block saving, like profiles, including errors in rows you didn't edit.

### input: the parsed view
- **Format (from the user and the bot guide):** lowercase words separated by spaces. Negative keywords start with `-` and go at the end, e.g. `box logo hoodie -shirt -tee`. Variants are IDs, usually separated by spaces (e.g. `11111111111111 22222222222222`). The guide says `+` isn't used for separating (except the multi-cart beta).
- **After an input is changed** (see open question 3 for exactly when), a parsed version is shown: positive keywords, negative keywords, or a variant list.
- **Parsing rules** (separator, negative prefix, how variants are recognised) live in the tasks rules config so they can be changed later.

### Sites
- A **global site list**, kept in the app's settings (not in the Makebot folder), seeded the first time with the 67 sites used in the current task files.
- The site dropdown has an **"Add site…"** entry. A site added there stays in the list permanently.
- **Settings → Sites** lists the sites for adding, editing and removing. See open question 5 for what editing a site does to existing tasks.

## Operations (3a)
The same as profiles, per task file:
- Add, duplicate, delete, reorder, bulk edit, from template, paste, and move/copy between task files.
- Create, rename, copy and delete task files.
- Changed-cell marks, git-status-style unsaved changes, backups dropdown with staged restore, shortcuts, and the file overview with search.

Batch generation and the like are **3b**.

## UI
- The same grid as profiles, with the column types from the table above.
- **Task count:** each row shows how many tasks it runs: `ALL` gives the group's profile count, and a named profile gives 1. Each file shows its total, and the overview shows the totals per file and overall.
- The overview lists task files with row count, task count and status. Search looks through the `input` column (open question 7).

## Code plan
Profiles and tasks are both unquoted CSVs with a fixed header. The CSV parser, the store, the grid and its panels, and the overview are generalised into shared code now that a second module needs it. The profiles module then configures them. The profiles tests stay as they are and must keep passing unchanged. That's how we know the refactor didn't change any behavior.

## Open questions
1. **Trailing spaces in input** (1,009 rows):
   - Proposal: when a task file is opened, they're removed automatically as **unsaved, marked changes** ("Was: `x `"), so you see them and save them. Should that happen on opening, or only when a row is edited?
   - Should leading spaces or double spaces inside an input be cleaned up the same way?
2. **proxyGroup / accountGroup:** can either be empty? Today every row has both.
3. **Parsed input view:** when should it update? After you leave the cell (my reading of "after the user saves the input"), or only after the file is saved? Where should it show: an extra read-only column next to `input` (proposal), or on hover?
4. **drift.csv repair:** offer a **"Join into one line"** fix on the broken pair (removing the quotes and the line break) as an unsaved, reviewable change? Or just flag it and let you fix it by hand?
5. **Editing a site in Settings** ("applies globally"):
   - Proposal: renaming a site also changes it in every task file that uses it, as unsaved changes listed under Unsaved changes, which you then Save all.
   - Removing a site that tasks still use: block it, or allow it and flag those tasks?
6. **Mode list for now:** make it like sites (seeded with the 11 in use, "Add mode…", editable in Settings)? Or a fixed list in the rules config? And should combinations the guide mentions but your files don't use (e.g. `preloadstuckwait`, `preloadwaitlite`) be added now?
7. **Overview search:** search `input` text across task files? Or also by site, profile group, etc.?
8. **Uppercase in input:** you said inputs are lowercase, but ~900 rows have uppercase codes (shape `A1234` or `A1234-123`, likely SKUs). Flag uppercase, or allow it? And for "dash (for variants)": could you give an example of a variant input that uses a dash?
9. **Spin buttons:** what step should the arrows use for `delay`? Proposal: 100 ms. Any sensible maximum?
10. **Renaming things tasks refer to:** now that tasks exist, should renaming a profile group, proxy group or account group, or renaming a profileName, offer to update the tasks that use it? This could be part of 3b.
