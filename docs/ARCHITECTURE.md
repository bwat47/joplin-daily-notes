# Architecture

## Overview

Daily Notes separates pure date/template logic from Joplin API access and UI registration. Modules that hold logic reach Joplin only through injected interfaces -- `JoplinDataApi` for the repository, `JoplinDialogApi` for the calendar -- so `index.ts`, `commands.ts` and `settings.ts` are the only places that touch the `joplin` global, and every logic module is testable without mocking it. `src/index.ts` is the composition root: it registers settings, detects the platform, constructs the repository and service, initializes the calendar dialog, and registers commands.

The main responsibilities are:

- **Settings and commands** register the six public settings and two stable command IDs. Desktop receives a Tools submenu and the today shortcut; mobile receives two note-toolbar overflow actions.
- **Date and template logic** validates the documented Day.js token subsets, produces canonical paths using local dates, parses calendar dates without UTC conversion, and expands template variables. Date and time tokens form separate dialects: note paths and `{{date:...}}` accept only date tokens, `{{time:...}}` only time-of-day tokens.
- **Joplin repository** paginates flat folder responses and traverses them by exact title and `parent_id`, paginates notes within the final notebook, creates notes/notebooks, and reads templates. Calendar highlight lookups are served from a short-lived cache; the open-or-create path always reads live.
- **Daily notes service** owns the open-or-create workflow and serializes mutating operations to prevent rapid local commands from creating duplicate notes.
- **Calendar dialog and webview** render the calendar, exchange typed messages, and query canonical note existence without creating data.

## Open-or-create flow

1. Read and validate the current settings.
2. Convert the target local date into a canonical ISO date, relative folder segments, and note title.
3. Resolve or create the top-level daily notes notebook and generated sub-notebooks.
4. List notes in the final notebook with pagination and find an exact title match.
5. If no note exists, collect any todos to roll over, read and expand the optional template, compose the two, then create the note.
6. If todos were rolled over, mark them migrated in the source note. This follows creation, never precedes it.
7. Open the note and focus the editor on desktop.

All calls to this flow share a promise queue. A second invocation begins its lookup only after the first finishes, so it sees a note created by the first invocation. This protects one Joplin process; synchronization conflicts created concurrently on separate devices remain subject to Joplin's normal sync behavior.

## Canonical identity

Canonical identity is the generated notebook path plus exact note title under the active settings. Consequently:

- Renaming or moving a note makes it non-canonical.
- Changing the notebook or date format affects future lookups and creations only.
- Existing notes are never migrated automatically.
- Duplicate notebook segments are treated as an error because the target path is ambiguous.
- Duplicate exact-title notes in one notebook resolve to the earliest-created note and produce a warning.

The repository deliberately avoids Joplin full-text search. It consumes the default flat, paginated `/folders` response, resolves each segment through `(parent_id, title)` relationships, and lists `folders/:id/notes` to match titles exactly. This follows from the identity model rather than from any single API limitation:

- **Search cannot express exact-title equality.** The index tokenizes titles, so a `title:` query matches by term, not by literal string, and every result would still need re-filtering in the plugin. Because the date format is user-configurable, generated titles can contain punctuation, quotes or non-Latin text, each of which becomes a separate escaping or tokenizer edge case. `note.title === title` has none of that surface.
- **The `notebook:` filter cannot express a canonical path.** It scopes by notebook title and includes descendants, so it would silently accept the duplicate segments that the traversal reports as `AmbiguousPathError`. `ensureFolderPath` also needs the flat folder walk in order to create missing segments, so search would not remove the traversal -- only duplicate the leaf lookup beside it.
- **The index lags writes.** Joplin populates its search tables from a debounced background job, so a note can exist while a search still misses it. On the open-or-create guard that false negative creates a duplicate daily note, which is the same staleness that `findCanonicalNote` already refuses from the local cache.

The cost is that a lookup pages the whole leaf notebook at a hundred notes per request. For a flat date format that grows with the note count -- a few years of dailies is on the order of twenty requests -- while a nested format such as `YYYY/MM` keeps each leaf near a single page. Highlight lookups absorb this through the cache below; the open-or-create path pays it live on a user-initiated action, which is the intended trade.

## Calendar flow

The dialog reuses one Joplin view handle and injects a dependency-free TypeScript/CSS webview. Every open starts at today and applies the configured week start.

When a month is rendered, the webview sends the 42 visible ISO dates to the plugin. The service builds canonical targets, groups them by generated leaf-notebook path, and the repository:

1. Fetches every page of the flat folder list once.
2. Resolves each leaf path without creating it.
3. Fetches each distinct leaf notebook once, including all pages.
4. Returns dates whose exact generated titles are present.

Both listings are cached for 30 seconds, keyed by notebook. Without it, every month change re-reads the same notebooks, which for a flat date format means re-listing the entire daily notes notebook -- about one request per hundred notes -- on each navigation. Entries hold the in-flight request, so rapid month changes share one listing rather than issuing duplicates.

The cache serves highlight lookups only. `findCanonicalNote` and `findLatestNoteBefore` always read live, because a stale miss there would report that a date has no note when one already exists -- a note that just arrived by sync, say -- and the open-or-create flow would create a duplicate. Writes drop every entry, so a newly created note is highlighted immediately.

Month navigation moves the visible grid only: the selection is what the dialog's Open button acts on, so browsing never reassigns it. Because the selection can therefore sit outside the visible month, each render designates one tabbable cell — the selection when it is on the grid, otherwise the first day of the visible month — which keeps the calendar in the tab order and gives arrow-key navigation its origin.

The webview ignores stale asynchronous responses after month navigation. Highlight failures are isolated from date selection, so users can still open a date.

## Todo rollover

Rollover extends the new-note initialization step: the body-builder combines the rendered template with unfinished todos read from an earlier canonical daily note, and the result reaches the single note-creation call. It introduces no identity of its own -- the source note is found through the same canonical path and title as everything else.

`src/rollover.ts` is pure and parses with `@lezer/markdown`, configured with the `TaskList` extension. The split across the two directions is deliberate:

- **Reading needs real Markdown structure.** An item's true end decides whether it is carried whole, and that end covers continuation lines, lazy continuations and nested children. A line-oriented scanner approximates this with indentation rules that accumulate special cases; `ListItem` node ranges are specified. Several cases then fall out of the grammar rather than being coded: a checkbox inside a fenced or four-space-indented code block never becomes a `Task` node, and an already-migrated `- [>]` parses as an ordinary paragraph, which is what makes a second pass over the same note a no-op.
- **Writing needs none of it.** Migration replaces the three characters of a `TaskMarker` in place, so no parser mistake can remove content from the note being rewritten. The marker is only replaced when that offset still holds `[ ]`, so a body that changed between the read and the write is left alone rather than corrupted at a stale position.

The source is resolved by generating candidate targets for the preceding days, newest first, and asking the repository for the first that exists. This answers "the previous daily note" rather than "yesterday" without reverse-parsing titles back into dates, which an arbitrary Day.js format does not support. The lookback setting bounds the search. `findLatestNoteBefore` reads live for the same reason `findCanonicalNote` does: a stale hit would carry todos out of the wrong note, and a stale miss would strand todos that are still open.

Ordering is the one hard constraint. The source note is marked only after `createNote` resolves. The reverse order would leave the todos in neither note if creation then failed; in the chosen order a failed marking leaves them open in both, which is visible and recoverable. Every step degrades to "create the note without todos" and a warning, matching how an unreadable template behaves.

Rollover runs only when the note being created is for today, because it rewrites another note. Backfilling a past date would stamp `[>]` into a note from months ago, and creating tomorrow's note would mark today's still-open work as migrated before the day is out.

Placement is one default with one override: `{{todos}}` decides where the block lands, and without it the block is appended. This keeps the template as the single placement mechanism -- a heading setting would compete with the variable for the same job and add heading-matching semantics that the variable does not need. Rolled todos are never dropped, since they are already marked migrated in the source.

## Testing boundaries

Pure tests cover formatting, local-date parsing, template expansion, todo extraction and migration, calendar grid math, and cache expiry, sharing, and invalidation. Joplin API tests use injected interfaces: a data interface to verify folder traversal, pagination, exact matching, non-mutating highlight queries, and the live backwards search for a previous note, and a dialog interface to verify view reuse, the open guard, and webview message validation. Service tests verify creation policy, platform behavior, error fallback, serialized concurrent opens, and rollover -- placement, the today-only guard, and that the source note is marked only after creation succeeds.
