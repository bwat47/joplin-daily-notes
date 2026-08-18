import { DailyNotesService, type DailyNotesRepository, type DailyNotesRuntime } from './dailyNotesService';
import type { DailyNoteSettings, NoteRecord } from './types';

const defaultSettings: DailyNoteSettings = {
    folderName: 'Daily Notes',
    dateFormat: 'YYYY-MM-DD',
    templateNoteId: '',
    weekStart: 'sunday',
};

function createRepository(): DailyNotesRepository {
    return {
        ensureFolderPath: vi.fn().mockResolvedValue({ id: 'folder' }),
        findCanonicalNote: vi.fn().mockResolvedValue(null),
        createNote: vi.fn().mockResolvedValue({ id: 'created', parent_id: 'folder', title: '2024-01-01' }),
        getTemplateBody: vi.fn(),
        findExistingDates: vi.fn().mockResolvedValue([]),
    };
}

function createRuntime(settings: DailyNoteSettings = defaultSettings): DailyNotesRuntime {
    return {
        readSettings: vi.fn().mockResolvedValue(settings),
        openNote: vi.fn(),
        focusEditor: vi.fn(),
        isMobile: false,
        showWarning: vi.fn(),
    };
}

describe('DailyNotesService', () => {
    test('opens an existing canonical note without modifying it', async () => {
        const repository = createRepository();
        const existing: NoteRecord = {
            id: 'existing',
            parent_id: 'folder',
            title: '2024-01-01',
        };
        vi.mocked(repository.findCanonicalNote).mockResolvedValue(existing);
        const runtime = createRuntime();

        await expect(new DailyNotesService(repository, runtime).openDate(new Date(2024, 0, 1))).resolves.toBe(existing);

        expect(repository.createNote).not.toHaveBeenCalled();
        expect(repository.getTemplateBody).not.toHaveBeenCalled();
        expect(runtime.openNote).toHaveBeenCalledWith('existing');
        expect(runtime.focusEditor).toHaveBeenCalledOnce();
    });

    test('creates a templated note', async () => {
        const repository = createRepository();
        vi.mocked(repository.getTemplateBody).mockResolvedValue('# {{title}}\n{{date:MMMM D, YYYY}}');
        const runtime = createRuntime({ ...defaultSettings, templateNoteId: 'template' });
        const service = new DailyNotesService(repository, runtime);

        await service.openDate(new Date(2024, 0, 1));

        expect(repository.createNote).toHaveBeenCalledWith('folder', '2024-01-01', '# 2024-01-01\nJanuary 1, 2024');
        expect(runtime.openNote).toHaveBeenCalledWith('created');
    });

    test('creates an empty note and warns when the template cannot be read', async () => {
        const repository = createRepository();
        vi.mocked(repository.getTemplateBody).mockRejectedValue(new Error('missing'));
        const runtime = createRuntime({ ...defaultSettings, templateNoteId: 'bad-id' });

        await new DailyNotesService(repository, runtime).openDate(new Date(2024, 0, 1));

        expect(repository.createNote).toHaveBeenCalledWith('folder', '2024-01-01', '');
        expect(runtime.showWarning).toHaveBeenCalledOnce();
    });

    test('serializes simultaneous opens so only one note is created', async () => {
        const repository = createRepository();
        let existing: NoteRecord | null = null;
        vi.mocked(repository.findCanonicalNote).mockImplementation(async () => existing);
        vi.mocked(repository.createNote).mockImplementation(async (_folderId, title) => {
            existing = { id: 'created', parent_id: 'folder', title };
            return existing;
        });
        const runtime = createRuntime();
        const service = new DailyNotesService(repository, runtime);

        await Promise.all([service.openDate(new Date(2024, 0, 1)), service.openDate(new Date(2024, 0, 1))]);

        expect(repository.createNote).toHaveBeenCalledOnce();
        expect(runtime.openNote).toHaveBeenCalledTimes(2);
    });

    test('does not focus the desktop editor on mobile', async () => {
        const repository = createRepository();
        const runtime = { ...createRuntime(), isMobile: true };

        await new DailyNotesService(repository, runtime).openDate(new Date(2024, 0, 1));

        expect(runtime.focusEditor).not.toHaveBeenCalled();
    });

    test('builds canonical targets for calendar highlight queries', async () => {
        const repository = createRepository();
        const runtime = createRuntime({ ...defaultSettings, dateFormat: 'YYYY/MM-DD' });

        await new DailyNotesService(repository, runtime).findExistingDates(['2024-01-01', '2024-01-02']);

        expect(repository.findExistingDates).toHaveBeenCalledWith('Daily Notes', [
            { isoDate: '2024-01-01', folderSegments: ['2024'], title: '01-01' },
            { isoDate: '2024-01-02', folderSegments: ['2024'], title: '01-02' },
        ]);
    });
});
