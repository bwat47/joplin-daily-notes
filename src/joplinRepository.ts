import { ExpiringCache } from './expiringCache';
import type { DailyNoteTarget, NoteRecord } from './types';
import { logger } from './logger';

const PAGE_SIZE = 100;
/**
 * How long calendar highlight lookups may reuse a previous listing.
 *
 * Highlight queries re-list the same notebooks on every month change, which for
 * a flat date format means re-reading the whole daily notes notebook -- roughly
 * one request per hundred notes -- each time the user navigates.
 */
const HIGHLIGHT_CACHE_TTL_MS = 30_000;
const FOLDER_CACHE_KEY = 'folders';
// Guards against a malformed response that never clears `has_more`. At 100 items
// per page this still covers 500k notebooks or notes in one collection.
const MAX_PAGES = 5000;

export interface JoplinDataApi {
    get(path: string[], query?: unknown): Promise<unknown>;
    post(path: string[], query?: unknown, body?: unknown): Promise<unknown>;
    put(path: string[], query?: unknown, body?: unknown): Promise<unknown>;
}

interface FolderNode {
    id: string;
    title: string;
    parent_id: string;
}

interface Page<T> {
    items: T[];
    has_more?: boolean;
}

export class AmbiguousPathError extends Error {
    public constructor(path: string) {
        super(`Multiple notebooks match the daily notes path "${path}". Rename the duplicate notebook.`);
        this.name = 'AmbiguousPathError';
    }
}

function asPage<T>(value: unknown, itemDescription: string): Page<T> {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
        throw new Error(`Joplin returned an invalid ${itemDescription} list.`);
    }
    return value as Page<T>;
}

function asCreatedFolder(value: unknown): FolderNode {
    if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
        throw new Error('Joplin did not return the created notebook.');
    }
    return value as FolderNode;
}

function asNote(value: unknown): NoteRecord {
    if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
        throw new Error('Joplin did not return a note.');
    }
    return value as NoteRecord;
}

function pathKey(segments: string[]): string {
    return JSON.stringify(segments);
}

export class JoplinRepository {
    // Read-only highlight lookups only. The open-or-create path always reads
    // live, so a stale miss can never cause a duplicate note.
    private readonly folderCache = new ExpiringCache<FolderNode[]>(HIGHLIGHT_CACHE_TTL_MS);
    private readonly noteTitleCache = new ExpiringCache<Set<string>>(HIGHLIGHT_CACHE_TTL_MS);

    public constructor(private readonly data: JoplinDataApi) {}

    public async ensureFolderPath(folderSegments: string[]): Promise<FolderNode> {
        const folders = await this.fetchFolders();
        let parent: FolderNode | undefined;
        let parentId = '';
        const traversed: string[] = [];

        for (const segment of folderSegments) {
            traversed.push(segment);
            const matches = folders.filter((folder) => folder.parent_id === parentId && folder.title === segment);
            if (matches.length > 1) throw new AmbiguousPathError(traversed.join('/'));

            if (matches.length === 1) {
                parent = matches[0];
            } else {
                parent = asCreatedFolder(
                    await this.data.post(['folders'], null, {
                        title: segment,
                        parent_id: parentId,
                    })
                );
                folders.push(parent);
                this.invalidateCaches();
            }

            parentId = parent.id;
        }

        if (!parent) throw new Error('Cannot resolve an empty notebook path.');
        return parent;
    }

    /**
     * Finds the canonical note for a title, always from a live listing.
     *
     * This deliberately bypasses the highlight cache: a stale miss would report
     * that a date has no note when one already exists -- for instance a note
     * that just arrived from another device -- and the caller would create a
     * duplicate.
     */
    public async findCanonicalNote(folderId: string, title: string): Promise<NoteRecord | null> {
        const notes = (await this.listFolderNotes(folderId)).filter((note) => note.title === title);
        if (notes.length === 0) return null;

        notes.sort((left, right) => {
            const timeDifference =
                (left.user_created_time ?? Number.MAX_SAFE_INTEGER) -
                (right.user_created_time ?? Number.MAX_SAFE_INTEGER);
            return timeDifference || left.id.localeCompare(right.id);
        });
        if (notes.length > 1) {
            logger.warn(
                `Found ${notes.length} notes titled "${title}" in notebook ${folderId}; opening the earliest-created note.`
            );
        }
        return notes[0];
    }

    public async createNote(folderId: string, title: string, body: string): Promise<NoteRecord> {
        const note = asNote(
            await this.data.post(['notes'], null, {
                parent_id: folderId,
                title,
                body,
            })
        );
        // After the write, so a highlight listing that started before it is
        // dropped rather than left cached without the new note.
        this.invalidateCaches();
        return note;
    }

    public async getNoteBody(noteId: string): Promise<string> {
        const value = await this.data.get(['notes', noteId], { fields: ['body'] });
        if (!value || typeof value !== 'object' || typeof (value as { body?: unknown }).body !== 'string') {
            throw new Error(`Note ${noteId} has no readable Markdown body.`);
        }
        return (value as { body: string }).body;
    }

    public async updateNoteBody(noteId: string, body: string): Promise<void> {
        await this.data.put(['notes', noteId], null, { body });
        // Same reason as createNote: the listing that produced this note is now stale.
        this.invalidateCaches();
    }

    /**
     * Finds the note for the first of `targets` that exists, in the order given.
     *
     * Callers pass candidate dates newest-first, so this answers "the previous
     * daily note" without assuming one exists on any particular calendar day.
     *
     * Like `findCanonicalNote` this reads live rather than through the highlight
     * cache. A stale hit here would carry todos forward out of the wrong note, and
     * a stale miss would skip a note whose todos are still open. Listings are
     * memoised per call, so a lookback that stays inside one notebook -- the usual
     * case -- reads that notebook once.
     */
    public async findLatestNoteBefore(folderName: string, targets: DailyNoteTarget[]): Promise<NoteRecord | null> {
        if (targets.length === 0) return null;

        const folders = await this.fetchFolders();
        const listings = new Map<string, NoteRecord[]>();

        for (const target of targets) {
            // Never creates: an absent notebook simply has no candidate note.
            const folder = this.findFolderPath(folders, [folderName, ...target.folderSegments]);
            if (!folder) continue;

            let notes = listings.get(folder.id);
            if (!notes) {
                notes = await this.listFolderNotes(folder.id);
                listings.set(folder.id, notes);
            }

            const match = notes.find((note) => note.title === target.title);
            if (match) return match;
        }

        return null;
    }

    public async findExistingDates(folderName: string, targets: DailyNoteTarget[]): Promise<string[]> {
        if (targets.length === 0) return [];

        const folders = await this.cachedFolders();
        const groupedTargets = new Map<string, DailyNoteTarget[]>();

        for (const target of targets) {
            const segments = [folderName, ...target.folderSegments];
            const key = pathKey(segments);
            const group = groupedTargets.get(key) ?? [];
            group.push(target);
            groupedTargets.set(key, group);
        }

        const existingDates: string[] = [];
        for (const group of groupedTargets.values()) {
            const folder = this.findFolderPath(folders, [folderName, ...group[0].folderSegments]);
            if (!folder) continue;

            const titles = await this.cachedNoteTitles(folder.id);
            for (const target of group) {
                if (titles.has(target.title)) existingDates.push(target.isoDate);
            }
        }

        return existingDates;
    }

    private async fetchFolders(): Promise<FolderNode[]> {
        return this.listAll<FolderNode>(['folders'], ['id', 'parent_id', 'title'], 'folder');
    }

    private async cachedFolders(): Promise<FolderNode[]> {
        return this.folderCache.fetch(FOLDER_CACHE_KEY, () => this.fetchFolders());
    }

    private async cachedNoteTitles(folderId: string): Promise<Set<string>> {
        return this.noteTitleCache.fetch(
            folderId,
            async () => new Set((await this.listFolderNotes(folderId)).map((note) => note.title))
        );
    }

    /** Any write makes the cached listings unreliable, so all of them are dropped. */
    private invalidateCaches(): void {
        this.folderCache.clear();
        this.noteTitleCache.clear();
    }

    private findFolderPath(folders: FolderNode[], segments: string[]): FolderNode | null {
        let current: FolderNode | null = null;
        let parentId = '';
        const traversed: string[] = [];

        for (const segment of segments) {
            traversed.push(segment);
            const matches = folders.filter((folder) => folder.parent_id === parentId && folder.title === segment);
            if (matches.length > 1) throw new AmbiguousPathError(traversed.join('/'));
            if (matches.length === 0) return null;
            current = matches[0];
            parentId = current.id;
        }

        return current;
    }

    private async listFolderNotes(folderId: string): Promise<NoteRecord[]> {
        return this.listAll<NoteRecord>(
            ['folders', folderId, 'notes'],
            ['id', 'parent_id', 'title', 'user_created_time'],
            'note'
        );
    }

    private async listAll<T>(path: string[], fields: string[], itemDescription: string): Promise<T[]> {
        const items: T[] = [];

        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const result = asPage<T>(
                await this.data.get(path, {
                    fields,
                    limit: PAGE_SIZE,
                    page,
                }),
                itemDescription
            );
            items.push(...result.items);
            if (!result.has_more) return items;
        }

        throw new Error(`Joplin returned more than ${MAX_PAGES} pages of ${itemDescription}s.`);
    }
}
