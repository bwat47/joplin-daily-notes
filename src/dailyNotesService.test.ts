import { DailyNotesService, type DailyNotesRepository, type DailyNotesRuntime } from './dailyNotesService';
import type { DailyNoteSettings, NoteRecord } from './types';

const defaultSettings: DailyNoteSettings = {
    folderName: 'Daily Notes',
    dateFormat: 'YYYY-MM-DD',
    templateNoteId: '',
    weekStart: 'sunday',
    rolloverTodos: false,
    rolloverLookbackDays: 30,
};

function createRepository(): DailyNotesRepository {
    return {
        ensureFolderPath: vi.fn().mockResolvedValue({ id: 'folder' }),
        findCanonicalNote: vi.fn().mockResolvedValue(null),
        createNote: vi.fn().mockResolvedValue({ id: 'created', parent_id: 'folder', title: '2024-01-01' }),
        getNoteBody: vi.fn(),
        updateNoteBody: vi.fn(),
        findExistingDates: vi.fn().mockResolvedValue([]),
        findLatestNoteBefore: vi.fn().mockResolvedValue(null),
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
        expect(repository.getNoteBody).not.toHaveBeenCalled();
        expect(runtime.openNote).toHaveBeenCalledWith('existing');
        expect(runtime.focusEditor).toHaveBeenCalledOnce();
    });

    test('creates a templated note', async () => {
        const repository = createRepository();
        vi.mocked(repository.getNoteBody).mockResolvedValue('# {{title}}\n{{date:MMMM D, YYYY}}');
        const runtime = createRuntime({ ...defaultSettings, templateNoteId: 'template' });
        const service = new DailyNotesService(repository, runtime);

        await service.openDate(new Date(2024, 0, 1));

        expect(repository.createNote).toHaveBeenCalledWith('folder', '2024-01-01', '# 2024-01-01\nJanuary 1, 2024');
        expect(runtime.openNote).toHaveBeenCalledWith('created');
    });

    test('preserves intentional blank lines in a template', async () => {
        const repository = createRepository();
        const template = '# Heading\n\n\n\n```text\none\n\n\n\ntwo\n```';
        vi.mocked(repository.getNoteBody).mockResolvedValue(template);
        const runtime = createRuntime({ ...defaultSettings, templateNoteId: 'template' });

        await new DailyNotesService(repository, runtime).openDate(new Date(2024, 0, 1));

        expect(repository.createNote).toHaveBeenCalledWith('folder', '2024-01-01', template);
    });

    test('creates an empty note and warns when the template cannot be read', async () => {
        const repository = createRepository();
        vi.mocked(repository.getNoteBody).mockRejectedValue(new Error('missing'));
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
    describe('todo rollover', () => {
        const source: NoteRecord = { id: 'previous', parent_id: 'folder', title: '2024-01-05' };
        const rolloverSettings: DailyNoteSettings = { ...defaultSettings, rolloverTodos: true };

        function withPreviousNote(repository: DailyNotesRepository, body: string, template?: string): void {
            vi.mocked(repository.findLatestNoteBefore).mockResolvedValue(source);
            vi.mocked(repository.getNoteBody).mockImplementation(async (noteId: string) =>
                noteId === source.id ? body : (template ?? '')
            );
        }

        test('carries unfinished todos into a note created without a template', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist\n- [x] Ship the patch');
            const runtime = createRuntime(rolloverSettings);

            await new DailyNotesService(repository, runtime).openDate(new Date());

            expect(repository.createNote).toHaveBeenCalledWith('folder', expect.any(String), '- [ ] Call the dentist');
        });

        test('places todos at the {{todos}} variable', async () => {
            const repository = createRepository();
            withPreviousNote(
                repository,
                '- [ ] Call the dentist',
                '## Carried over\n{{todos}}\n\n## Today\n\n\n\n```text\nkeep blank lines\n```'
            );
            const runtime = createRuntime({ ...rolloverSettings, templateNoteId: 'template' });

            await new DailyNotesService(repository, runtime).openDate(new Date());

            expect(vi.mocked(repository.createNote).mock.calls[0][2]).toBe(
                '## Carried over\n- [ ] Call the dentist\n\n## Today\n\n\n\n```text\nkeep blank lines\n```'
            );
        });

        // Nothing to roll, so the placeholder has to disappear without leaving the
        // headed but empty section that expanding it in place would produce.
        test.each([
            [
                'takes its own line with it',
                '## Carried over\n\n{{todos}}\n\n## Today\n',
                '## Carried over\n\n## Today\n',
            ],
            [
                'leaves blank lines elsewhere alone',
                '{{todos}}\n\n## Today\n\n\n\n```text\na\n\n\nb\n```',
                '## Today\n\n\n\n```text\na\n\n\nb\n```',
            ],
            ['expands away in place when inline', 'Carried: {{todos}} (none today)\n', 'Carried:  (none today)\n'],
        ])('with nothing to roll, {{todos}} %s', async (_name, template, expected) => {
            const repository = createRepository();
            vi.mocked(repository.getNoteBody).mockResolvedValue(template);
            const runtime = createRuntime({ ...rolloverSettings, templateNoteId: 'template' });

            await new DailyNotesService(repository, runtime).openDate(new Date());

            expect(vi.mocked(repository.createNote).mock.calls[0][2]).toBe(expected);
        });

        test('appends todos when the template has no {{todos}} variable', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist', '## Today\n');
            const runtime = createRuntime({ ...rolloverSettings, templateNoteId: 'template' });

            await new DailyNotesService(repository, runtime).openDate(new Date());

            // Never dropped: they are already marked migrated in the source note.
            expect(vi.mocked(repository.createNote).mock.calls[0][2]).toBe('## Today\n\n- [ ] Call the dentist');
        });

        test('marks the source note only after the new note exists', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist');
            const order: string[] = [];
            vi.mocked(repository.createNote).mockImplementation(async () => {
                order.push('createNote');
                return { id: 'created', parent_id: 'folder', title: '2024-01-01' };
            });
            vi.mocked(repository.updateNoteBody).mockImplementation(async () => {
                order.push('updateNoteBody');
            });

            await new DailyNotesService(repository, createRuntime(rolloverSettings)).openDate(new Date());

            // The reverse order would leave the todos in neither note if creation failed.
            expect(order).toEqual(['createNote', 'updateNoteBody']);
            expect(repository.updateNoteBody).toHaveBeenCalledWith('previous', '- [>] Call the dentist');
        });

        test('does not overwrite the source note when it changes during rollover', async () => {
            const repository = createRepository();
            vi.mocked(repository.findLatestNoteBefore).mockResolvedValue(source);
            vi.mocked(repository.getNoteBody)
                .mockResolvedValueOnce('- [ ] Call the dentist')
                .mockResolvedValueOnce('- [ ] Call the dentist\n\nEdited while rollover was running.');
            const runtime = createRuntime(rolloverSettings);

            await new DailyNotesService(repository, runtime).openDate(new Date());

            expect(repository.createNote).toHaveBeenCalledWith('folder', expect.any(String), '- [ ] Call the dentist');
            expect(repository.updateNoteBody).not.toHaveBeenCalled();
            expect(runtime.showWarning).toHaveBeenCalledWith(
                'Todos were copied, but the previous note changed during rollover and was not modified.'
            );
            expect(runtime.openNote).toHaveBeenCalledWith('created');
        });

        test('does not roll over when the setting is off', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist');

            await new DailyNotesService(repository, createRuntime()).openDate(new Date());

            expect(repository.findLatestNoteBefore).not.toHaveBeenCalled();
            expect(repository.updateNoteBody).not.toHaveBeenCalled();
        });

        test('does not roll over into a date other than today', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist');

            // Backfilling an old date would rewrite a note from months ago.
            await new DailyNotesService(repository, createRuntime(rolloverSettings)).openDate(new Date(2024, 0, 1));

            expect(repository.findLatestNoteBefore).not.toHaveBeenCalled();
            expect(repository.updateNoteBody).not.toHaveBeenCalled();
        });

        test('does not roll over when the note already exists', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist');
            vi.mocked(repository.findCanonicalNote).mockResolvedValue({
                id: 'existing',
                parent_id: 'folder',
                title: 'today',
            });

            await new DailyNotesService(repository, createRuntime(rolloverSettings)).openDate(new Date());

            expect(repository.findLatestNoteBefore).not.toHaveBeenCalled();
            expect(repository.createNote).not.toHaveBeenCalled();
        });

        test('still creates the note when the previous note cannot be read', async () => {
            const repository = createRepository();
            vi.mocked(repository.findLatestNoteBefore).mockRejectedValue(new Error('offline'));
            const runtime = createRuntime(rolloverSettings);

            await expect(new DailyNotesService(repository, runtime).openDate(new Date())).resolves.toMatchObject({
                id: 'created',
            });
            expect(repository.createNote).toHaveBeenCalledWith('folder', expect.any(String), '');
            expect(runtime.openNote).toHaveBeenCalledWith('created');
        });

        test('still opens the note when marking the source fails', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist');
            vi.mocked(repository.updateNoteBody).mockRejectedValue(new Error('conflict'));
            const runtime = createRuntime(rolloverSettings);

            await expect(new DailyNotesService(repository, runtime).openDate(new Date())).resolves.toMatchObject({
                id: 'created',
            });
            expect(runtime.showWarning).toHaveBeenCalledWith(
                'Rolled todos forward but could not mark them migrated in the previous note.'
            );
            expect(runtime.openNote).toHaveBeenCalledWith('created');
        });

        test('still opens the note when showing a migration warning fails', async () => {
            const repository = createRepository();
            withPreviousNote(repository, '- [ ] Call the dentist');
            vi.mocked(repository.updateNoteBody).mockRejectedValue(new Error('conflict'));
            const runtime = createRuntime(rolloverSettings);
            vi.mocked(runtime.showWarning).mockRejectedValue(new Error('toast unavailable'));

            await expect(new DailyNotesService(repository, runtime).openDate(new Date())).resolves.toMatchObject({
                id: 'created',
            });
            expect(runtime.openNote).toHaveBeenCalledWith('created');
        });
    });
});
