import { buildDailyNoteTarget, parseIsoDate, toIsoDate, validateFolderName } from './dateFormat';
import { logger } from './logger';
import { extractUnfinishedTodos, markTodosMigrated } from './rollover';
import type { DailyNoteSettings, DailyNoteTarget, NoteRecord, SettingsReader } from './types';
import { renderTemplate } from './template';

/** Matches the same spellings `renderTemplate` accepts, including inner whitespace. */
const TODOS_PLACEHOLDER = /{{\s*todos\s*}}/;
/**
 * A `{{todos}}` alone on its line, with one line break that followed it.
 *
 * On a day with nothing to roll the variable expands to an empty string, which
 * leaves the blank lines that separated it from its neighbours stacked into a
 * headed but empty section. Taking the line and one adjacent break closes that
 * gap while leaving blank lines elsewhere in the template alone.
 */
const EMPTY_TODOS_LINE = /^[ \t]*{{\s*todos\s*}}[ \t]*(?:\r?\n[ \t]*)?(?:\r?\n|$)/gm;

export interface DailyNotesRuntime {
    readSettings: SettingsReader;
    openNote(noteId: string): Promise<void>;
    focusEditor(): Promise<void>;
    isMobile: boolean;
    showWarning(message: string): Promise<void>;
}

export interface DailyNotesRepository {
    ensureFolderPath(folderSegments: string[]): Promise<{ id: string }>;
    findCanonicalNote(folderId: string, title: string): Promise<NoteRecord | null>;
    createNote(folderId: string, title: string, body: string): Promise<NoteRecord>;
    getNoteBody(noteId: string): Promise<string>;
    updateNoteBody(noteId: string, body: string): Promise<void>;
    findExistingDates(folderName: string, targets: DailyNoteTarget[]): Promise<string[]>;
    findLatestNoteBefore(folderName: string, targets: DailyNoteTarget[]): Promise<NoteRecord | null>;
}

/** Todos found in an earlier note, held between reading that note and marking it. */
interface PendingRollover {
    rolled: string;
    source: NoteRecord | null;
    sourceBody: string;
    markerOffsets: number[];
}

/** A rollover that carries nothing. Built fresh so no caller shares one `markerOffsets`. */
function noRollover(): PendingRollover {
    return { rolled: '', source: null, sourceBody: '', markerOffsets: [] };
}

function isToday(date: Date): boolean {
    return toIsoDate(date) === toIsoDate(new Date());
}

/**
 * Builds candidate targets for the days preceding `date`, newest first.
 *
 * The repository returns the first of these that exists, which is what makes the
 * source "the previous daily note" rather than "yesterday" -- there may well be no
 * note yesterday.
 */
function buildLookbackTargets(date: Date, lookbackDays: number, format: string): DailyNoteTarget[] {
    const targets: DailyNoteTarget[] = [];

    for (let daysBack = 1; daysBack <= lookbackDays; daysBack += 1) {
        // Local-date arithmetic, matching parseIsoDate: the Date constructor
        // normalises a negative day into the previous month or year.
        const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBack);
        targets.push(buildDailyNoteTarget(candidate, format));
    }

    return targets;
}

export class DailyNotesService {
    private operationQueue: Promise<void> = Promise.resolve();

    public constructor(
        private readonly repository: DailyNotesRepository,
        private readonly runtime: DailyNotesRuntime
    ) {}

    public openDate(date: Date): Promise<NoteRecord> {
        const operation = this.operationQueue.then(
            () => this.openDateInternal(date),
            () => this.openDateInternal(date)
        );
        this.operationQueue = operation.then(
            () => undefined,
            () => undefined
        );
        return operation;
    }

    public async openIsoDate(isoDate: string): Promise<NoteRecord> {
        return this.openDate(parseIsoDate(isoDate));
    }

    public async findExistingDates(isoDates: string[]): Promise<string[]> {
        const settings = await this.runtime.readSettings();
        const folderName = validateFolderName(settings.folderName);
        const targets = isoDates.map((isoDate) => buildDailyNoteTarget(parseIsoDate(isoDate), settings.dateFormat));
        return this.repository.findExistingDates(folderName, targets);
    }

    private async openDateInternal(date: Date): Promise<NoteRecord> {
        const settings = await this.runtime.readSettings();
        const folderName = validateFolderName(settings.folderName);
        const target = buildDailyNoteTarget(date, settings.dateFormat);
        const folder = await this.repository.ensureFolderPath([folderName, ...target.folderSegments]);

        let note = await this.repository.findCanonicalNote(folder.id, target.title);
        if (!note) {
            const rollover = await this.collectRollover(settings, folderName, date);
            const body = await this.createInitialBody(settings, date, target.title, rollover.rolled);
            note = await this.repository.createNote(folder.id, target.title, body);
            // Strictly after creation succeeds. Marking the source first and then
            // failing here would leave the todos in neither note.
            await this.markSourceMigrated(rollover);
        }

        await this.runtime.openNote(note.id);
        if (!this.runtime.isMobile) await this.runtime.focusEditor();
        return note;
    }

    /**
     * Reads unfinished todos from the most recent earlier daily note.
     *
     * Restricted to today because the source note is rewritten: backfilling an old
     * date would stamp `[>]` into a note from months ago, and creating tomorrow's
     * note would mark today's still-open work as migrated before the day is out.
     *
     * Any failure degrades to "no rollover" so that a note is still created.
     */
    private async collectRollover(
        settings: DailyNoteSettings,
        folderName: string,
        date: Date
    ): Promise<PendingRollover> {
        if (!settings.rolloverTodos || !isToday(date)) return noRollover();

        try {
            const targets = buildLookbackTargets(date, settings.rolloverLookbackDays, settings.dateFormat);
            const source = await this.repository.findLatestNoteBefore(folderName, targets);
            if (!source) return noRollover();

            const sourceBody = await this.repository.getNoteBody(source.id);
            const { rolled, markerOffsets } = extractUnfinishedTodos(sourceBody);
            if (!rolled) return noRollover();

            return { rolled, source, sourceBody, markerOffsets };
        } catch (error) {
            logger.warn('Could not roll todos over from the previous daily note.', error);
            return noRollover();
        }
    }

    /** Rewrites the source note's markers to `[>]` so the work is claimed in one place. */
    private async markSourceMigrated(rollover: PendingRollover): Promise<void> {
        if (!rollover.source) return;

        try {
            const currentBody = await this.repository.getNoteBody(rollover.source.id);
            if (currentBody !== rollover.sourceBody) {
                const message =
                    'Todos were copied, but the previous note changed during rollover and was not modified.';
                logger.warn(message);
                await this.showWarning(message);
                return;
            }

            const marked = markTodosMigrated(currentBody, rollover.markerOffsets);
            await this.repository.updateNoteBody(rollover.source.id, marked);
        } catch (error) {
            // The new note already holds the todos, so the worst case is that they
            // read as open in both notes -- visible and fixable, unlike losing them.
            const message = 'Rolled todos forward but could not mark them migrated in the previous note.';
            logger.warn(message, error);
            await this.showWarning(message);
        }
    }

    /** A failed toast must not stop the note from being created or opened. */
    private async showWarning(message: string): Promise<void> {
        try {
            await this.runtime.showWarning(message);
        } catch (error) {
            logger.warn('Could not show a warning.', error);
        }
    }

    /**
     * Builds the body of a note being created, from the template and any rolled todos.
     *
     * Placement is one default with one override: `{{todos}}` decides where the block
     * lands, and without it the block is appended. Rolled todos are never dropped --
     * that would lose work already marked migrated in the source note.
     */
    private async createInitialBody(
        settings: DailyNoteSettings,
        date: Date,
        title: string,
        rolledTodos: string
    ): Promise<string> {
        const templateNoteId = settings.templateNoteId.trim();
        if (!templateNoteId) return rolledTodos;

        let template: string;
        try {
            template = await this.repository.getNoteBody(templateNoteId);
        } catch (error) {
            logger.warn('Could not read the configured template note.', error);
            await this.showWarning(
                'The configured template note could not be read. The daily note will be created without it.'
            );
            return rolledTodos;
        }

        // A placeholder that shares its line with other text is left to expand away
        // to nothing; only one occupying a line of its own takes that line with it.
        const source = rolledTodos ? template : template.replace(EMPTY_TODOS_LINE, '');
        const rendered = renderTemplate(source, { date, creationTime: new Date(), title, rolledTodos }, (message) =>
            logger.warn(message)
        );

        if (!rolledTodos || TODOS_PLACEHOLDER.test(template)) return rendered;

        logger.warn('The template has no {{todos}} variable; rolled todos were appended to the end of the note.');
        return `${rendered.trimEnd()}\n\n${rolledTodos}`;
    }
}
