# Architecture

## Boundaries

Daily Notes separates pure date, template, and rollover logic from Joplin API access and UI registration. Logic modules reach Joplin through injected interfaces, so they can be tested without mocking the `joplin` global.

`src/index.ts` is the composition root. It registers settings, detects the platform, constructs the repository and service, initializes the calendar, and registers commands.

The main responsibilities are:

- **Settings and commands** expose configuration and platform-appropriate entry points.
- **Date and template logic** validates supported Day.js tokens, builds canonical note targets from local dates, and expands template variables. Note paths and `{{date:...}}` accept date tokens; `{{time:...}}` accepts time-of-day tokens.
- **Joplin repository** traverses notebooks, lists and creates notes, reads templates, and isolates pagination and caching from the service.
- **Daily notes service** owns note creation, todo rollover, and the policy for opening a note.
- **Calendar dialog and webview** render the calendar, exchange typed messages, and query note existence without creating data.

## Canonical identity and repository policy

A daily note's canonical identity is its generated notebook path plus its exact title under the active settings. Therefore:

- Renaming or moving a note makes it non-canonical.
- Setting changes affect future lookups and creations; existing notes are not migrated.
- Duplicate notebook segments are errors because the path is ambiguous.
- Duplicate exact-title notes in one notebook resolve to the earliest-created note and produce a warning.

The repository resolves notebook paths through exact `(parent_id, title)` relationships and matches note titles exactly within the leaf notebook. See [Canonical note lookup](decisions/canonical-note-lookup.md) for the decision and tradeoffs.

Cached reads are used only for advisory UI state such as calendar highlights. Reads that influence creation or rollover always query Joplin directly. Repository writes invalidate all highlight caches.

## Open-or-create flow

1. Read and validate the current settings.
2. Convert the target local date into a canonical ISO date, notebook segments, and note title.
3. Resolve or create the notebook path.
4. Find an exact-title note in the leaf notebook.
5. If none exists, collect eligible rollover todos, render the optional template, and create the note.
6. After creation succeeds, mark any source todos as migrated.
7. Open the note and focus the editor on desktop.

All open-or-create operations share a promise queue. Concurrent commands in one Joplin process therefore perform their lookups in order and do not create the same note twice. Unsynced operations on separate devices remain subject to Joplin's normal conflict behavior.

## Calendar flow

The calendar reuses one Joplin dialog and loads a dependency-free TypeScript/CSS webview. Each open begins at today and applies the configured week start.

For each visible grid, the webview sends its ISO dates to the plugin. The service builds canonical targets and groups them by leaf notebook path. The repository resolves those paths without creating notebooks, lists each distinct leaf notebook once, and returns the dates with matching titles.

Folder and note-title listings use a short-lived read-through cache that also shares in-flight requests. This cache is limited to highlights; stale or failed highlight queries never affect date selection or note creation. The webview also ignores responses for a grid that is no longer visible.

## Todo rollover

Rollover runs only while creating today's note. The service finds the most recent canonical note within the configured lookback and extracts unfinished tasks with a Markdown parser so task boundaries, nested items, and code blocks follow Markdown structure.

Carried tasks are inserted at `{{todos}}`, or appended when the template has no placeholder. The new note is created before the source is changed. The service then re-reads the source and marks tasks migrated only if its body still matches the version used for extraction. Failures leave tasks open in the source and do not prevent note creation.

See [Todo rollover behavior](TODO_ROLLOVER.md) for user-visible selection, placement, and sync behavior.

## Testing boundaries

Pure logic is tested without Joplin. Repository and dialog behavior is tested through injected API interfaces, while service tests cover orchestration, concurrency, and failure policy.
