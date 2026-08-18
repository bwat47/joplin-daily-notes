import { collapseBlankRuns, extractUnfinishedTodos, markTodosMigrated } from './rollover';

function lines(...values: string[]): string {
    return values.join('\n');
}

describe('extractUnfinishedTodos', () => {
    test('carries unfinished items and leaves completed ones behind', () => {
        const body = lines('- [ ] Call the dentist', '- [x] Ship the patch', '- [ ] Draft the RFC');

        expect(extractUnfinishedTodos(body).rolled).toBe(lines('- [ ] Call the dentist', '- [ ] Draft the RFC'));
    });

    test('keeps a multi-line item whole', () => {
        const body = lines('- [ ] Draft the RFC', '  context that belongs to the item', '- [x] done');

        expect(extractUnfinishedTodos(body).rolled).toBe(
            lines('- [ ] Draft the RFC', '  context that belongs to the item')
        );
    });

    test('keeps a lazy continuation line with its item', () => {
        const body = lines('- [ ] lazy', 'continuation that is not indented');

        expect(extractUnfinishedTodos(body).rolled).toBe(lines('- [ ] lazy', 'continuation that is not indented'));
    });

    test('carries nested children with their parent exactly once', () => {
        const body = lines('- [ ] parent', '  - [x] finished child', '  - [ ] open child');

        // The open child is inside the parent's block, so it must not also appear
        // as a block of its own.
        expect(extractUnfinishedTodos(body).rolled).toBe(
            lines('- [ ] parent', '  - [x] finished child', '  - [ ] open child')
        );
    });

    test('carries an unfinished child of a completed parent', () => {
        const body = lines('- [x] parent done', '  - [ ] child still open');

        // The parent does not roll, so the child has to stand on its own -- and it
        // is dedented to the top level rather than arriving as an orphaned sub-item.
        expect(extractUnfinishedTodos(body).rolled).toBe('- [ ] child still open');
    });

    test('dedents a nested block while preserving its internal shape', () => {
        const body = lines('- [x] parent done', '  - [ ] child', '    - [ ] grandchild');

        expect(extractUnfinishedTodos(body).rolled).toBe(lines('- [ ] child', '  - [ ] grandchild'));
    });

    test('lifts an item out of a blockquote', () => {
        const body = lines('> - [ ] quoted todo', '> continuation');

        expect(extractUnfinishedTodos(body).rolled).toBe(lines('- [ ] quoted todo', 'continuation'));
    });

    test('ignores checkboxes inside a fenced code block', () => {
        const body = lines('- [ ] real todo', '', '```markdown', '- [ ] documentation example', '```');

        expect(extractUnfinishedTodos(body).rolled).toBe('- [ ] real todo');
    });

    test('ignores checkboxes inside an indented code block', () => {
        const body = lines('Example:', '', '    - [ ] indented code, not a todo');

        expect(extractUnfinishedTodos(body)).toEqual({ rolled: '', markerOffsets: [] });
    });

    test('does not re-roll completed or already-migrated items', () => {
        const body = lines('- [x] done', '- [X] also done', '- [>] migrated yesterday');

        expect(extractUnfinishedTodos(body)).toEqual({ rolled: '', markerOffsets: [] });
    });

    test('is idempotent across a migration round trip', () => {
        const body = lines('- [ ] one', '  - [ ] two', '- [x] three');
        const first = extractUnfinishedTodos(body);
        const migrated = markTodosMigrated(body, first.markerOffsets);

        expect(extractUnfinishedTodos(migrated)).toEqual({ rolled: '', markerOffsets: [] });
    });

    test('handles the bullet characters and ordered items Markdown allows', () => {
        const body = lines('* [ ] star', '+ [ ] plus', '', '1. [ ] ordered');

        expect(extractUnfinishedTodos(body).rolled).toBe(lines('* [ ] star', '+ [ ] plus', '1. [ ] ordered'));
    });

    test('strips carriage returns from a CRLF note', () => {
        const body = '- [ ] one\r\n- [x] two\r\n';

        expect(extractUnfinishedTodos(body).rolled).toBe('- [ ] one');
    });

    test('returns nothing for a note with no todos', () => {
        expect(extractUnfinishedTodos('# Just a heading\n\nSome prose.')).toEqual({ rolled: '', markerOffsets: [] });
        expect(extractUnfinishedTodos('')).toEqual({ rolled: '', markerOffsets: [] });
    });

    test('reports a marker offset for every rolled item, nested ones included', () => {
        const body = lines('- [ ] parent', '  - [ ] child');
        const { markerOffsets } = extractUnfinishedTodos(body);

        expect(markerOffsets).toHaveLength(2);
        for (const offset of markerOffsets) expect(body.slice(offset, offset + 3)).toBe('[ ]');
    });
});

describe('markTodosMigrated', () => {
    test('rewrites only the given markers and preserves every other byte', () => {
        const body = lines('# Heading', '', '- [ ] one', '- [x] two', '  - [ ] three', '', 'Trailing prose.');
        const { markerOffsets } = extractUnfinishedTodos(body);

        expect(markTodosMigrated(body, markerOffsets)).toBe(
            lines('# Heading', '', '- [>] one', '- [x] two', '  - [>] three', '', 'Trailing prose.')
        );
    });

    test('leaves the body unchanged when there is nothing to migrate', () => {
        const body = '- [x] done';

        expect(markTodosMigrated(body, [])).toBe(body);
    });

    test('skips an offset that no longer holds an unchecked marker', () => {
        // Guards the window between reading a note and writing it back: a stale
        // offset must not rewrite whatever now sits at that position.
        const body = '- [x] edited since it was read';

        expect(markTodosMigrated(body, [2])).toBe(body);
    });

    test('does not shift later markers when rewriting several', () => {
        const body = lines('- [ ] a', '- [ ] b', '- [ ] c');
        const { markerOffsets } = extractUnfinishedTodos(body);

        expect(markTodosMigrated(body, markerOffsets)).toBe(lines('- [>] a', '- [>] b', '- [>] c'));
    });
});

describe('collapseBlankRuns', () => {
    test('collapses the gap an empty expansion leaves behind', () => {
        expect(collapseBlankRuns('## Carried over\n\n\n\n## Today')).toBe('## Carried over\n\n## Today');
    });

    test('keeps a single blank line between blocks', () => {
        const body = '## One\n\nprose\n\n## Two';

        expect(collapseBlankRuns(body)).toBe(body);
    });
});
