# Architecture

## Overview

Daily Notes separates pure date/template logic from Joplin API access and UI registration. Modules that hold logic reach Joplin only through injected interfaces -- `JoplinDataApi` for the repository, `JoplinDialogApi` for the calendar -- so `index.ts`, `commands.ts` and `settings.ts` are the only places that touch the `joplin` global, and every logic module is testable without mocking it. `src/index.ts` is the composition root: it registers settings, detects the platform, constructs the repository and service, initializes the calendar dialog, and registers commands.

The main responsibilities are:

- **Settings and commands** register the four public settings and two stable command IDs. Desktop receives a Tools submenu and the today shortcut; mobile receives two note-toolbar overflow actions.
- **Date and template logic** validates the documented Day.js token subsets, produces canonical paths using local dates, parses calendar dates without UTC conversion, and expands template variables. Date and time tokens form separate dialects: note paths and `{{date:...}}` accept only date tokens, `{{time:...}}` only time-of-day tokens.
- **Joplin repository** paginates flat folder responses and traverses them by exact title and `parent_id`, paginates notes within the final notebook, creates notes/notebooks, and reads templates. Calendar highlight lookups are served from a short-lived cache; the open-or-create path always reads live.
- **Daily notes service** owns the open-or-create workflow and serializes mutating operations to prevent rapid local commands from creating duplicate notes.
- **Calendar dialog and webview** render the calendar, exchange typed messages, and query canonical note existence without creating data.

## Open-or-create flow

1. Read and validate the current settings.
2. Convert the target local date into a canonical ISO date, relative folder segments, and note title.
3. Resolve or create the top-level daily notes notebook and generated sub-notebooks.
4. List notes in the final notebook with pagination and find an exact title match.
5. If no note exists, read and expand the optional template, then create the note.
6. Open the note and focus the editor on desktop.

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

The cache serves highlight lookups only. `findCanonicalNote` always reads live, because a stale miss there would report that a date has no note when one already exists -- a note that just arrived by sync, say -- and the open-or-create flow would create a duplicate. Writes drop every entry, so a newly created note is highlighted immediately.

Month navigation moves the visible grid only: the selection is what the dialog's Open button acts on, so browsing never reassigns it. Because the selection can therefore sit outside the visible month, each render designates one tabbable cell — the selection when it is on the grid, otherwise the first day of the visible month — which keeps the calendar in the tab order and gives arrow-key navigation its origin.

The webview ignores stale asynchronous responses after month navigation. Highlight failures are isolated from date selection, so users can still open a date.

## Future todo functionality

Todo display or rollover should extend the new-note initialization step rather than command or persistence code. A future body-builder can combine the rendered template with content derived from earlier canonical daily notes before the single note-creation call. If a future feature needs identity independent of the canonical path and title, its metadata and conflict rules should be introduced together.

## Testing boundaries

Pure tests cover formatting, local-date parsing, template expansion, calendar grid math, and cache expiry, sharing, and invalidation. Joplin API tests use injected interfaces: a data interface to verify folder traversal, pagination, exact matching, and non-mutating highlight queries, and a dialog interface to verify view reuse, the open guard, and webview message validation. Service tests verify creation policy, platform behavior, error fallback, and serialized concurrent opens.
