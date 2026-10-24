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
 * Completed items are left out of a carried block; unfinished work beneath them is
 * lifted into their place.
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

const taskListParser = parser.configure(TaskList);

export interface RolloverExtraction {
    /** Unfinished items with their unfinished descendants, dedented, in source order. Empty when none. */
    rolled: string;
    /** Offset of every rolled item's task marker in the source body, in document order. */
    markerOffsets: number[];
}

interface ListItemInfo {
    /** Parser range; `from` may sit inside indentation allowed by a parent list. */
    from: number;
    to: number;
    /** Start of the line holding the item's bullet. */
    lineFrom: number;
    /** Source text before the bullet on that line: indentation and any blockquote markers. */
    prefix: string;
    task: { markerFrom: number; done: boolean; empty: boolean } | null;
    parent: ListItemInfo | null;
}

/** Where an item lands inside a carried block. */
interface Placement {
    /** False for completed tasks and for plain items that belong to one. */
    kept: boolean;
    /** Output text that replaces the item's source prefix. */
    slot: string;
}

/** Lists every list item, task or not, in document order with its parent. */
function collectListItems(body: string): ListItemInfo[] {
    const items: ListItemInfo[] = [];
    const ancestors: ListItemInfo[] = [];

    taskListParser.parse(body).iterate({
        enter: (node) => {
            if (node.name !== 'ListItem') return;

            // The bullet may sit later than the parser range, which can start inside
            // the indentation allowed by a parent list.
            const bulletFrom = node.node.getChild('ListMark')?.from ?? node.from;
            const lineFrom = body.lastIndexOf('\n', bulletFrom - 1) + 1;
            const marker = node.node.getChild('Task')?.getChild('TaskMarker');
            const item: ListItemInfo = {
                from: node.from,
                to: node.to,
                lineFrom,
                prefix: body.slice(lineFrom, bulletFrom),
                task: marker
                    ? {
                          markerFrom: marker.from,
                          done: body.slice(marker.from, marker.to) !== UNCHECKED_MARKER,
                          // An item holding nothing but its marker is a placeholder rather than
                          // work. A bare `- [ ]` is not even a task to the grammar, but `- [ ] `
                          // is, and that trailing space is what a checkbox button leaves behind --
                          // so without this an abandoned placeholder rolls forward every day and
                          // they accumulate. Descendants count as content, so an empty parent
                          // still carries its children.
                          empty: !body.slice(marker.to, node.to).trim(),
                      }
                    : null,
                parent: ancestors[ancestors.length - 1] ?? null,
            };

            items.push(item);
            ancestors.push(item);
        },
        leave: (node) => {
            if (node.name === 'ListItem') ancestors.pop();
        },
    });

    return items;
}

/**
 * Decides whether each item under a carried root is kept and where it lands.
 * The returned map holds the root and its descendants in document order.
 */
function placeSubtree(items: ListItemInfo[], rootIndex: number): Map<ListItemInfo, Placement> {
    const root = items[rootIndex];
    const placements = new Map<ListItemInfo, Placement>([[root, { kept: true, slot: '' }]]);

    // Document order places every parent before its children.
    for (const item of items.slice(rootIndex + 1)) {
        if (item.lineFrom > root.to) break;

        const parent = item.parent && placements.get(item.parent);
        if (!item.parent || !parent) continue;

        // A kept parent keeps the child's indentation relative to itself; a dropped
        // parent hands its own slot down, lifting the child into its place.
        const slot =
            parent.kept && item.prefix.startsWith(item.parent.prefix)
                ? parent.slot + item.prefix.slice(item.parent.prefix.length)
                : parent.slot;
        placements.set(item, { kept: item.task ? !item.task.done : parent.kept, slot });
    }

    return placements;
}

/** The innermost item covering a line is the last such item in document order. */
function findLineOwner(subtree: ListItemInfo[], lineFrom: number): ListItemInfo {
    let owner = subtree[0];
    for (const item of subtree) {
        if (item.lineFrom <= lineFrom && lineFrom <= item.to) owner = item;
    }
    return owner;
}

/**
 * Renders a carried item without its completed descendants, dedented to the top level.
 *
 * A completed task is dropped along with its own text and plain sub-bullets, but an
 * unfinished task beneath it is still open work: it is lifted into the completed
 * task's position so it neither disappears nor arrives as an orphaned sub-item.
 * Each kept line has its item's source prefix swapped for that item's output slot,
 * which also strips the indentation and blockquote markers the root sat under.
 *
 * @example
 * // - [ ] parent                   - [ ] parent
 * //   - [x] done              =>     - [ ] open grandchild
 * //     - [ ] open grandchild
 */
function renderCarriedItem(body: string, items: ListItemInfo[], rootIndex: number): string {
    const root = items[rootIndex];
    const placements = placeSubtree(items, rootIndex);
    const subtree = [...placements.keys()];

    const lines: string[] = [];
    for (let lineFrom = root.lineFrom; lineFrom <= root.to;) {
        const newline = body.indexOf('\n', lineFrom);
        const lineTo = newline === -1 || newline > root.to ? root.to : newline;

        const owner = findLineOwner(subtree, lineFrom);
        const { kept, slot } = placements.get(owner)!;
        if (kept) {
            const text = body.slice(lineFrom, lineTo).replace(/\r$/, '');
            // A lazy continuation line does not repeat the prefix, so it is left as written.
            lines.push(text.startsWith(owner.prefix) ? slot + text.slice(owner.prefix.length) : text);
        }
        lineFrom = lineTo + 1;
    }

    return lines.join('\n');
}

/**
 * Collects the unfinished todos in a note body.
 *
 * An item nested under an unfinished parent is carried by that parent's block and
 * never becomes a block of its own, so nothing is duplicated. An unfinished item
 * under a *completed* parent is still open work, so it rolls over on its own.
 */
export function extractUnfinishedTodos(body: string): RolloverExtraction {
    const items = collectListItems(body);
    const blocks: string[] = [];
    const markerOffsets: number[] = [];
    let collectedEnd = -1;

    items.forEach((item, index) => {
        if (!item.task || item.task.done || item.task.empty) return;

        // Document order guarantees a parent is seen before the children its range covers.
        if (item.from >= collectedEnd) {
            blocks.push(renderCarriedItem(body, items, index));
            collectedEnd = item.to;
        }
        markerOffsets.push(item.task.markerFrom);
    });

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
