import { parser, TaskList } from '@lezer/markdown';

/**
 * Extraction and migration of unfinished GFM task list items.
 *
 * The module is deliberately split across two very different risk levels. Reading
 * needs real Markdown structure: an item may span continuation lines, carry nested
 * children, or sit inside a blockquote, and an item's true end is what decides
 * whether it is carried over whole. Writing needs none of that -- it replaces the
 * three characters of a task marker in place -- so a parser bug can never remove
 * content from the note being migrated.
 *
 * Several cases fall out of the grammar rather than being handled here: `- [ ]`
 * inside a fenced or four-space-indented code block never becomes a `Task` node,
 * and an already-migrated `- [>]` parses as an ordinary paragraph, which is what
 * makes a second rollover over the same note a no-op.
 */

/** GFM task markers are exactly three characters, so a rewrite never shifts offsets. */
const MARKER_LENGTH = 3;
const UNCHECKED_MARKER = '[ ]';
/** Bullet-journal "migrated forward". Not a GFM checkbox, so checkbox scanners skip it. */
const MIGRATED_MARKER = '[>]';
/** Markdown unordered markers or an ordered marker of up to nine digits. */
const LIST_MARKER_BEFORE_TASK = /(?:[-+*]|\d{1,9}[.)])[ \t]+$/;

const taskListParser = parser.configure(TaskList);

export interface RolloverExtraction {
    /** Unfinished items with their descendants, dedented, in source order. Empty when none. */
    rolled: string;
    /** Offset of every rolled item's task marker in the source body, in document order. */
    markerOffsets: number[];
}

interface UncheckedItem {
    /** Parser range used to determine whether another item is its descendant. */
    from: number;
    to: number;
    /** Actual source offset of the list bullet, which may be later than `from`. */
    bulletFrom: number;
    markerFrom: number;
}

function findBulletFrom(body: string, itemFrom: number, markerFrom: number): number {
    const lineStart = body.lastIndexOf('\n', markerFrom - 1) + 1;
    const match = LIST_MARKER_BEFORE_TASK.exec(body.slice(lineStart, markerFrom));

    // TaskList only produces a TaskMarker after a list marker. Retain the parser
    // range as a defensive fallback if a future grammar changes that invariant.
    return match ? lineStart + match.index : itemFrom;
}

function collectUncheckedItems(body: string): UncheckedItem[] {
    const items: UncheckedItem[] = [];

    taskListParser.parse(body).iterate({
        enter: (node) => {
            if (node.name !== 'ListItem') return;

            const marker = node.node.getChild('Task')?.getChild('TaskMarker');
            if (!marker || body.slice(marker.from, marker.to) !== UNCHECKED_MARKER) return;

            // An item holding nothing but its marker is a placeholder rather than work.
            // A bare `- [ ]` is not even a task to the grammar, but `- [ ] ` is, and that
            // trailing space is what a checkbox button leaves behind -- so without this
            // an abandoned placeholder rolls forward every day and they accumulate.
            // Descendants count as content, so an empty parent still carries its children.
            if (!body.slice(marker.to, node.to).trim()) return;

            items.push({
                from: node.from,
                to: node.to,
                bulletFrom: findBulletFrom(body, node.from, marker.from),
                markerFrom: marker.from,
            });
        },
    });

    return items;
}

/**
 * Slices an item out of the body and removes the indentation it sat under.
 *
 * Lezer's `ListItem` range may start inside the indentation allowed by a parent
 * list, rather than at the nested item's actual bullet. The caller supplies the
 * bullet offset derived from the task marker, making the first line flush. Stripping
 * the full prefix before that bullet from later lines restores the block's internal
 * shape at the top level. The prefix may also contain blockquote markers.
 */
function dedent(body: string, from: number, to: number): string {
    const lineStart = body.lastIndexOf('\n', from - 1) + 1;
    const prefix = body.slice(lineStart, from);

    return body
        .slice(from, to)
        .split('\n')
        .map((line, index) => {
            const text = line.replace(/\r$/, '');
            if (index === 0 || !prefix || !text.startsWith(prefix)) return text;
            return text.slice(prefix.length);
        })
        .join('\n');
}

/**
 * Collects the unfinished todos in a note body.
 *
 * An item nested under an unfinished parent is carried by that parent's block and
 * never becomes a block of its own, so nothing is duplicated. An unfinished item
 * under a *completed* parent is still open work, so it rolls over on its own.
 */
export function extractUnfinishedTodos(body: string): RolloverExtraction {
    const blocks: string[] = [];
    const markerOffsets: number[] = [];
    let collectedEnd = -1;

    for (const item of collectUncheckedItems(body)) {
        // Document order guarantees a parent is seen before the children its range covers.
        if (item.from >= collectedEnd) {
            blocks.push(dedent(body, item.bulletFrom, item.to));
            collectedEnd = item.to;
        }
        markerOffsets.push(item.markerFrom);
    }

    return { rolled: blocks.join('\n'), markerOffsets };
}

/**
 * Rewrites the given task markers to the migrated marker.
 *
 * Every other byte of the supplied body is preserved. An offset is only rewritten
 * when it still holds an unchecked marker. The caller remains responsible for
 * ensuring that the supplied body is the same version from which the offsets came.
 */
export function markTodosMigrated(body: string, markerOffsets: number[]): string {
    let result = body;

    // Descending, so an applied splice can never invalidate a later offset. The two
    // markers are the same length today; the order keeps this correct if that changes.
    for (const offset of [...markerOffsets].sort((left, right) => right - left)) {
        if (result.slice(offset, offset + MARKER_LENGTH) !== UNCHECKED_MARKER) continue;
        result = result.slice(0, offset) + MIGRATED_MARKER + result.slice(offset + MARKER_LENGTH);
    }

    return result;
}
