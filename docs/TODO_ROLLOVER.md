# Todo rollover behavior

Todo rollover carries unfinished Markdown tasks into a newly created note for today. It does not run when opening an existing note or a past date.

## Finding the source note

The source is the previous daily note, not necessarily yesterday. The plugin searches backward from today until it finds a matching note or reaches **Rollover lookback (days)**, so weekends and holidays do not interrupt rollover.

## Selecting tasks

- Only non-empty `- [ ]` tasks are carried; empty checkbox placeholders remain in the source note.
- A task nested under an unfinished parent travels with its parent and is not carried twice.
- An unfinished task under a completed parent is carried on its own.
- Checkboxes inside code blocks are ignored.

## Updating notes

Carried tasks are copied to today's note and rewritten from `- [ ]` to `- [>]` in the source. The bullet-journal marker means “migrated forward,” not completed, and preserves the original text.

If the source changes while rollover is running, the tasks are copied but the source is left untouched. The plugin shows a warning instead of overwriting the newer edit.

Reopening today's note does not roll tasks over again because rollover occurs only during creation, and `- [>]` is not treated as open.

## Template placement

Use `{{todos}}` to choose where carried tasks appear:

```markdown
## Carried over

{{todos}}

## Today

- [ ]
```

Without `{{todos}}`, carried tasks are appended to the template. Without a template, the new note contains only the carried tasks. If there is nothing to carry, a `{{todos}}` variable on its own line is removed with that line by default. Enable **Keep empty todo placeholder line** to preserve it as an empty line instead.

## Sync caveat

Create today's note on only one device at a time. If another device created it but has not synced, the current device can create a duplicate and roll tasks into it. After syncing, the carried tasks may be in the duplicate rather than the note you open, while the source tasks are marked as migrated. No task text is deleted, but you may need to merge the notes manually.
