import { buildDailyNoteTarget, parseIsoDate, validateFolderName } from './dateFormat';
import { logger } from './logger';
import type { DailyNoteTarget, NoteRecord, SettingsReader } from './types';
import { renderTemplate } from './template';

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
    getTemplateBody(noteId: string): Promise<string>;
    findExistingDates(folderName: string, targets: DailyNoteTarget[]): Promise<string[]>;
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
            const body = await this.createInitialBody(settings.templateNoteId.trim(), date, target.title);
            note = await this.repository.createNote(folder.id, target.title, body);
        }

        await this.runtime.openNote(note.id);
        if (!this.runtime.isMobile) await this.runtime.focusEditor();
        return note;
    }

    private async createInitialBody(templateNoteId: string, date: Date, title: string): Promise<string> {
        if (!templateNoteId) return '';

        try {
            const body = await this.repository.getTemplateBody(templateNoteId);
            return renderTemplate(body, { date, creationTime: new Date(), title }, (message) => logger.warn(message));
        } catch (error) {
            logger.warn('Could not read the configured template note.', error);
            await this.runtime.showWarning(
                'The configured template note could not be read. The daily note will be created empty.'
            );
            return '';
        }
    }
}
