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
| input | text, shown as its **parsed** keywords until clicked into | required; cleaned up automatically; no classifying or lowercasing |
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
- **Parsed view:** when an input contains spaces, the words are split into **positive** (no leading `-`) and **negative** (leading `-`) and shown in the input cell in place of the raw text. Clicking into the cell shows the raw text to edit; the parsed view comes back when you leave the cell.
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

## Build notes (3a, 2026-09-23)
- **Shared code:**
  - `src/lib/formats/csvTable.ts`: parse/serialize for both modules.
  - `src/lib/table/`: schema, edit operations, store, file operations and file-name rules.
  - `src/components/table/`: editor, overview, cells and backups menu.
  - Profiles and tasks only add config: `modules/<module>/schema.ts` and `ui.tsx`.
  - During the refactor, the only change to the profiles tests was renaming the row kind "profile" to "record".
- **Tasks code:**
  - Format and automatic fixes in `src/lib/formats/tasks.ts`.
  - Rules, the mode parts list and input parsing in `src/lib/rules/tasks.ts`.
  - Link checks and task counts in `src/modules/tasks/schema.ts`.
  - UI config in `ui.tsx`, the site list logic in `sites.ts`, and the validation context in `context.ts`.
- **All folders are listed up front** (profile, task, proxy, account), and every profile and task file is loaded, so links, counts and red file marks are known right away.
- **Validation context:** profile groups with their names (including unsaved profile edits), proxy and account groups, and the site list. Existence checks wait until all of these have loaded, so no errors flash up while loading.
- **New task rows:**
  - `size` and `color` start as `random`, `cartQuantity` as `1` and `delay` as `3000`, the most common values in the current files. Everything else starts empty.
  - The cursor goes to `profileGroup`.
- **Templates and duplicates** copy task rows exactly, since tasks have no names.
- **"Add site…"** opens a small "New site" field above the grid. The site is added to the global list (and saved) and put in the cell.
- **Mode editor:** clicking a mode cell opens a popover. It lists the parts in order, with ← → × buttons and an "Add part…" dropdown.
- **Parsed view (in the input cell, no separate column):** shows positive keywords and red "−negative" keywords. Clicking into the cell shows the raw text for editing; leaving it cleans up the spaces and shows the updated view. Single-word inputs just show their text.
- **Tasks column and counts:** `?` means the count isn't known (an unknown group). Totals show that as "(+N unknown)".
- **Site rename:** the new site list is applied to the task checks before files are saved, so renamed tasks are valid when they're saved. A file that can't be saved (e.g. it has other errors) keeps the rename as unsaved changes, and the result message lists it.
- **Real-file tests:**
  - All 78 current task files round-trip byte for byte.
  - After the automatic fixes, every row parses, including `drift.csv`.
  - The fixes change nothing but spaces, quotes and line breaks.

## 3b: task builder and file summary
Interview on 2026-09-30. The user approved the plan the same day, which serves as approval of this section.

### Why
The user doesn't edit tasks one row at a time. They think of a task file as a **plan**: which profiles run how many tasks, which inputs get what share, and how each input is split across proxy groups, modes and the other fields. So a task file now opens on one **Tasks** view: a **builder** that generates the whole file from a plan, next to the task counts it gives. The 3a row grid is still there behind **Advanced: raw rows**.

### Decisions
| Topic | Decision |
|---|---|
| Output | The builder generates **every task row** of a file, either a new file or replacing an existing file's rows. |
| Row style | **One row per task** with a named profileName. The builder never writes `ALL`, but `ALL` rows in older files are still read, and count as the group's profile count. |
| Profile groups | A build can include **several profile groups**. Each has a total and per-profile counts, which default to an even spread and can be edited (uneven is fine). |
| Inputs | A list of inputs, each with a **%** of the total. The input mix applies to the whole build, so every profile gets the same mix. |
| Other fields | proxyGroup, mode, accountGroup, size, color, site, cartQuantity and delay are each a **% split of values**. Each field has a **shared default split** that every input uses, and an input can **override** it. |
| Mode values | Full mode strings built with the mode-parts editor, e.g. 75% `preloadwait` and 25% `direct`. |
| Crossing | The splits are independent and **evenly crossed**. Every profile gets the same input mix, and within an input each field's split is independent of the others (e.g. every proxy group gets the same mode mix). |
| Rounding | Largest remainder, so the totals are always exact. The live view shows the actual counts. |
| Row order | **Interleaved**: profiles, inputs and values are spread through the file. |
| Re-editing | The builder **reads the plan back from the file's rows**. Nothing is stored outside the task file. A hand-made file that isn't evenly crossed is evened out when it's rebuilt, and the confirm step shows the before and after counts. |
| Views | One **Tasks** view per file: the builder next to the task counts, with no bars. It shows the file's counts, or before → after while the build differs from the file. The overview across files stays as it is. (Changed at the first check on 2026-09-30: the summary and builder had been separate tabs, with bars.) |
| Proxies | Only **tasks per proxy group** are shown. Proxy files aren't read. |

### Writing the file
- Applying a build replaces the file's task rows. The header, BOM and line endings stay as they are, and unparseable lines are kept (still flagged).
- The change is a normal **unsaved change**: it's validated, listed under Unsaved changes, and saved with a backup like any other edit.
- While the build differs from the file, the counts show before → after for each value.
- The builder is disabled for read-only files (wrong header).

### Open questions (3b)
- Which mode parts can combine, and in what order (still open from 3a).

### Build notes (3b, 2026-09-30)
- **Code:**
  - Logic in `src/modules/tasks/build.ts`: `apportion`, `allocate`, `interleave`, `generateRows`, `inferPlan`, `breakdown`, `planErrors`.
  - UI in `TaskFileView.tsx` (Tasks / Raw rows tabs), `TaskBuilder.tsx` (the builder with the counts beside it) and `BreakdownView.tsx`.
  - `replaceRecords` in `src/lib/table/ops.ts` writes the generated rows. Save, discard and restore-a-backup moved into `components/table/useFileActions.ts`, which the grid and the summary both use.
- **How counts are worked out:**
  - Tasks per input = the input %s applied to the total.
  - For each field, the inputs sharing the default split have it applied to their combined tasks, so the totals per value are exact. The result is then shared out between those inputs. An input with its own split has it applied to its own tasks.
  - Within an input, the fields are crossed one at a time, which keeps them independent (each proxy group gets the same mode mix).
  - Profiles get each input's value combinations in proportion to their tasks. Rounding extras go where a profile has had too few of a value so far, so each profile's mix stays within about 1 task of its exact share.
- **Row order:** profiles take turns (1, 2, 3, 1, 2, 3…). Each profile's tasks alternate between inputs, and within an input between value combinations.
- **Reading a file back:** inputs share a field's default while it reproduces their counts. Otherwise the input furthest from the default gets its own split. Rebuilding from a file without changes gives the same counts per profile, per input and per input × value. This was checked on all 78 real task files.
- **The counts:**
  - Each field has its own card with a table, and there are no bars. The columns are labelled ("Proxy Group | Tasks | Share"), rows are separated by lines, and a Total row appears when there's more than one value.
  - The number columns have the same fixed width in every card, so they line up, and use tabular digits. Rows stay in the file's order.
  - While a build differs from the file, the tasks column becomes **Now | New**, and each count that would change is highlighted. When nothing would change, the file's own counts are shown with a single Tasks column. (From the fourth check on 2026-09-30: the panel had no column labels, alignment or separation.)
  - Tasks per profile are shown per group, as a share of the group.
  - Rows that can't be counted (`ALL` in an unknown group, or an empty profileName) are flagged.
- **The builder:**
  - The builder has three numbered steps: 1 Profiles, 2 Inputs, 3 Splits for every input. Each profile group, the inputs and each split sit in their own card.
  - **Profile groups:** pick the group, then fill in the **Total tasks** field, which is highlighted and spread evenly. Tasks can also be set per profile. The grand total is shown under the groups.
  - **Inputs:** each input has a % and a "Custom splits…" button (it reads "Custom: Site, …" once the input has some).
  - **An input's splits dialog:** the button opens a dialog titled `Splits for "<input>"` with the same split cards as step 3.
    - A field that isn't custom shows the split every input uses, read-only.
    - Ticking "Custom for this input" puts the step-3 editor in the card, starting from that default. Unticking it goes back to the default.
    - Edits apply as they're made, so the counts update behind the dialog. **Done** keeps them, and **Cancel** or Escape puts back what was there when it opened.
    - While it's open, the app's shortcuts (Ctrl+S, back…) do nothing.
    - (From the fifth check on 2026-09-30: this used to be an inline, condensed list under the input.)
  - **Field names:** fields show readable names such as "Proxy Group" and "Cart Quantity", with a short hint under each. The file keeps its own column names.
  - **% lists** (inputs and every split):
    - A dashed **"+"** row adds a row, and × removes one.
    - **"Distribute evenly"** keeps the %s equal, including when rows are added or removed. It starts ticked when the %s are already equal (one value at 100% counts). Untick it to type %s.
    - A "Total" note shows when the %s don't add up to 100.
  - (Changed at the second check on 2026-09-30. It used to have "Add value" and "Even %" buttons and field keys as names.)
  - Problems are listed, and the counts fall back to the file's until they're fixed.
  - "Apply to file" is enabled when the build differs from the file, and makes the change unsaved.
  - **Sticky header:** the file name, Backups, the tabs, one toolbar and the status line stay at the top while the builder scrolls.
    - The toolbar reads: Apply to file, Reset to file | Save, Discard changes.
    - Next to the buttons it shows either the "Replaces every task row…" note or "N problems to fix", which is a link that scrolls to the list under the builder.
    - The builder puts its buttons there through a React portal, so its state stays in the builder.
    - The counts panel sticks just below the header, whose height is measured into `--task-head-h`.
    - (From the sixth check on 2026-09-30.)
  - "Reset to file" goes back to the file's counts.
  - The builder starts again from the file whenever its rows change (apply, discard or restore).
  - **Applied plans are remembered** for the session. While a file still has exactly the rows a build produced, the builder shows that plan as it was left, custom splits included. A file only holds counts, so reading it back can't always tell which input had the custom split (for example, two equal inputs on different sites). After a restart, or once the rows change (discard, restore, hand edits), the builder reads the file again. On a tie, the earlier input keeps the defaults and the later one gets the custom split. (Fix from the third check on 2026-09-30: after Apply and Save, a custom split per keyword wasn't shown any more.)
  - "Add site…" isn't offered in the builder. Sites are added in the grid or in Settings.
- **Views:** a file opens on Tasks, or on Raw rows when opened from the overview search. The last view is remembered per file for the session.
- **Tests:** 809 frontend and 42 Rust.
  - Algorithm tests cover the user's examples, exact totals, evenness per profile, independence of proxy group and mode, overrides, interleaving and determinism.
  - The `inferPlan` round trip is tested, along with `replaceRecords` (BOM, CRLF, a missing trailing newline, unparseable lines), the summary and builder UI, and real-file checks for all 78 task files.

## Later (3b and beyond)
- **Offer to update tasks** when a profile group is renamed or a profileName changes. Later, the same for proxy and account groups. (The user agreed on 2026-09-23.)
- Which mode parts can combine, and in what order.
- More validation for input.

## Open questions
_None._ (Round 3, 2026-09-23: `color` is required; `paypal` and `monitor` are real modes.)
