# Canonical note lookup

- **Status:** Accepted
- **Decision:** Resolve canonical notes by exact notebook-path traversal and exact title matching.

## Context

A daily note is identified by the notebook path and note title generated from the active settings. Lookup must therefore:

- distinguish notebooks with the same title under different parents;
- reject duplicate segments that make a path ambiguous;
- support user-configurable titles containing punctuation or non-Latin text;
- see recent writes before deciding to create a note; and
- reuse the same path model when missing notebooks must be created.

A false positive opens the wrong note. A false negative in the open-or-create flow creates a duplicate, so lookup correctness matters more than minimizing API calls.

## Decision

The repository fetches Joplin's flat, paginated folder list and resolves each path segment by exact `(parent_id, title)` equality. It then lists every page of notes in the resolved leaf notebook and compares titles with exact string equality.

If more than one notebook matches a path segment, lookup fails with `AmbiguousPathError`. If a leaf notebook contains duplicate exact-title notes, the repository selects the earliest-created note, using its ID as a stable tie-breaker, and logs a warning.

Open-or-create and todo-source lookups always use live listings. The calendar may cache folder and note-title listings because highlights are advisory and cannot create or modify data. Any repository write invalidates those caches.

## Alternatives considered

### Joplin full-text search

Full-text search does not express the required identity:

- A `title:` query is tokenized rather than an exact string comparison. Results would still need to be filtered, while configurable punctuation, quotes, and non-Latin text add query-escaping and tokenizer edge cases.
- A `notebook:` filter identifies notebooks by title and includes descendants; it cannot express an exact parent-child path or detect ambiguous duplicate segments.
- The search index is updated asynchronously. A recently created or synced note may exist before it appears in search, and that stale miss could cause a duplicate.

Search would also not replace folder traversal because creation still needs to resolve each path segment and create the missing ones.

### Cached identity lookups

A cached miss could hide a note that was recently created or synced. A cached hit during rollover could select an outdated source. Caching is therefore restricted to calendar highlights.

## Consequences

- Canonical identity has one implementation for lookup, creation, rollover, and calendar highlights.
- Exact traversal detects ambiguous notebook paths instead of silently choosing one.
- Open-or-create decisions do not depend on an asynchronously updated search index or a local cache.
- Lookup costs scale with the total folder count and the number of notes in the leaf notebook. Flat layouts accumulate more paginated reads than layouts such as `YYYY/MM`; the calendar cache absorbs repeated advisory reads, while user-initiated identity lookups pay the live-read cost.
- Serialization prevents duplicates within one Joplin process, but separate devices can still create duplicates before they synchronize.
