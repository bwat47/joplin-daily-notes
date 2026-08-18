# Daily Notes for Joplin

Daily Notes provides a small, Obsidian-style daily note workflow for Joplin. Open today's note directly or choose any date from a calendar. The plugin creates the required notebook hierarchy and note when they do not already exist.

## Features

- Open or create today's daily note.
- Choose any date from a calendar and open or create its note.
- Highlight dates that already have a canonical daily note.
- Build sub-notebooks from the configured date format.
- Initialize new notes from a Joplin note template.
- Use Sunday-first or Monday-first calendar weeks.
- Use the same commands on desktop and mobile.

## Commands

| Command                  | Default desktop shortcut            |
| ------------------------ | ----------------------------------- |
| Open today's daily note  | `Ctrl+Alt+D` (`Cmd+Alt+D` on macOS) |
| Open daily note calendar | `Ctrl+Alt+O` (`Cmd+Alt+O` on macOS) |

On desktop, both commands are available from **Tools → Daily Notes**, the command palette, and the keyboard shortcut editor. On mobile, they are available from the note toolbar overflow menu.

## Settings

| Setting              | Default       | Description                                                   |
| -------------------- | ------------- | ------------------------------------------------------------- |
| Daily notes notebook | `Daily Notes` | Top-level notebook that contains daily notes.                 |
| Date format          | `YYYY-MM-DD`  | Note name and optional sub-notebook hierarchy.                |
| Template note ID     | Empty         | ID of a note whose Markdown body initializes new daily notes. |
| First day of week    | Sunday        | Sunday-first or Monday-first calendar layout.                 |

The daily notes notebook must be a single top-level notebook name. If it does not exist, the plugin creates it.

### Date format and sub-notebooks

The `/` character creates a notebook hierarchy beneath the daily notes notebook. For example:

```text
Date format: YYYY/MMMM/YYYY-MMM-DD
Date:        2023-01-01
Result:      Daily Notes/2023/January/2023-Jan-01
```

Supported Moment-style date tokens are:

```text
YYYY YY M MM MMM MMMM D DD d dd ddd dddd Do Q W WW
```

Wrap literal letters in square brackets, for example `[Week]-WW`. Textual month and weekday names are English in version 1.

The plugin treats a daily note as canonical only when its current notebook path and title exactly match the active settings. Renaming or moving a daily note means it will no longer appear as existing in the calendar, and opening that date can create a new canonical note.

## Templates

Set **Template note ID** to the 32-character Joplin ID of a note. Its Markdown body is copied only when a daily note is first created. To find a note ID, open the note properties dialog or copy the note's Markdown link.

Templates use the same Moment-style tokens as the date format setting above, under two namespaces:

| Variable       | Example           | Expands to                                    |
| -------------- | ----------------- | --------------------------------------------- |
| `{{date:...}}` | `{{date:dddd}}`   | `Sunday` -- the day the note is for           |
| `{{time:...}}` | `{{time:h:mm A}}` | `9:05 AM` -- when the note was created        |
| `{{date}}`     | `{{date}}`        | `2024-01-07`, short for `{{date:YYYY-MM-DD}}` |
| `{{time}}`     | `{{time}}`        | `09:05`, short for `{{time:HH:mm}}`           |
| `{{title}}`    | `{{title}}`       | `2024-01-07`, the generated note title        |

`{{date:...}}` accepts the date tokens listed above. `{{time:...}}` accepts time-of-day tokens:

```text
H HH h hh m mm s ss A a
```

`{{date:...}}` uses the date you chose for the daily note, while `{{time:...}}` uses the time the note is created. For example, if you create yesterday's note today, the date variables show yesterday and the time variables show the current time. Date tokens only work with `date:`, and time tokens only work with `time:`.

Bracketed literals work in both, for example `{{date:[Week] WW}}`.

Unknown or incorrectly formatted variables are left unchanged. If the configured template cannot be read, the plugin creates an empty daily note and shows a warning.

## Calendar markers

A dot marks each visible date whose exact generated note title exists in its generated notebook. Marker checks are read-only: browsing the calendar never creates notebooks or notes. If marker loading fails, dates remain selectable and the calendar displays a warning.

## Development

```bash
npm install
npm test
npm run lint
npm run knip
npm run dist
```

The packaged plugin is written to `publish/com.bwat47.joplin-daily-notes.jpl`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation details and [GENERATOR_DOC.md](GENERATOR_DOC.md) for framework maintenance and publishing instructions.
