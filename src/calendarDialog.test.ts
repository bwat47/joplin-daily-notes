import type { DialogResult } from 'api/types';
import { CalendarDialog, type JoplinDialogApi } from './calendarDialog';
import type { DailyNotesService } from './dailyNotesService';
import type { SettingsReader } from './types';

// A plain stand-in for the port. The dialog no longer touches the Joplin
// global, so no module mocking is needed.
const dialogs = {
    create: vi.fn<JoplinDialogApi['create']>(),
    addScript: vi.fn<JoplinDialogApi['addScript']>(),
    setButtons: vi.fn<JoplinDialogApi['setButtons']>(),
    setHtml: vi.fn<JoplinDialogApi['setHtml']>(),
    open: vi.fn<JoplinDialogApi['open']>(),
    onMessage: vi.fn<JoplinDialogApi['onMessage']>(),
} satisfies JoplinDialogApi;

const readSettings: SettingsReader = async () => ({
    folderName: 'Daily Notes',
    dateFormat: 'YYYY-MM-DD',
    templateNoteId: '',
    weekStart: 'sunday',
    rolloverTodos: false,
    rolloverLookbackDays: 30,
});

function createDialog(service: DailyNotesService = createService()): CalendarDialog {
    return new CalendarDialog(dialogs, service, readSettings);
}

function createService(): DailyNotesService {
    return {
        openIsoDate: vi.fn(),
        findExistingDates: vi.fn().mockResolvedValue([]),
    } as unknown as DailyNotesService;
}

describe('CalendarDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The handle only resolves after an await, which is what makes the
        // "already created?" check racy.
        dialogs.create.mockImplementation(async () => {
            await Promise.resolve();
            return 'handle';
        });
        dialogs.open.mockResolvedValue({ id: 'cancel' });
    });

    test('concurrent initialization creates a single dialog and one message handler', async () => {
        const dialog = createDialog();

        await Promise.all([dialog.initialize(), dialog.initialize(), dialog.initialize()]);

        expect(dialogs.create).toHaveBeenCalledOnce();
        expect(dialogs.onMessage).toHaveBeenCalledOnce();
    });

    test('an initialized dialog is reused by a later open', async () => {
        const dialog = createDialog();

        await dialog.initialize();
        await dialog.open();

        expect(dialogs.create).toHaveBeenCalledOnce();
        expect(dialogs.setHtml).toHaveBeenCalledWith('handle', expect.stringContaining('data-daily-notes-calendar'));
        expect(dialogs.open).toHaveBeenCalledWith('handle');
    });

    test('a failed creation is not cached, so a later open retries', async () => {
        dialogs.create.mockRejectedValueOnce(new Error('view creation failed'));
        const dialog = createDialog();

        await expect(dialog.initialize()).rejects.toThrow('view creation failed');
        await dialog.open();

        expect(dialogs.create).toHaveBeenCalledTimes(2);
        expect(dialogs.open).toHaveBeenCalledWith('handle');
    });

    test('opens the date the calendar form returned', async () => {
        const service = createService();
        dialogs.open.mockResolvedValue({ id: 'confirm', formData: { calendar: { date: '2024-03-09' } } });
        const dialog = createDialog(service);

        await dialog.open();

        expect(service.openIsoDate).toHaveBeenCalledWith('2024-03-09');
    });

    test('a repeat open while the dialog is on screen is ignored', async () => {
        const service = createService();
        const pending: { close?: (result: DialogResult | null) => void } = {};
        dialogs.open.mockReturnValue(
            new Promise((resolve) => {
                pending.close = resolve;
            })
        );
        const dialog = createDialog(service);

        const first = dialog.open();
        await vi.waitFor(() => expect(dialogs.open).toHaveBeenCalledOnce());

        await dialog.open();
        await dialog.open();

        // Joplin resolves the extra open() with null, which used to crash on result.id.
        expect(dialogs.open).toHaveBeenCalledOnce();

        pending.close?.({ id: 'confirm', formData: { calendar: { date: '2024-03-09' } } });
        await first;
        expect(service.openIsoDate).toHaveBeenCalledOnce();
    });

    test('repeat commands fired while the dialog is still opening are ignored', async () => {
        const dialog = createDialog();

        // The guard is set before the first await, so these are rejected even
        // though the dialog has not reached the screen yet.
        void dialog.open();
        void dialog.open();
        void dialog.open();

        await vi.waitFor(() => expect(dialogs.open).toHaveBeenCalledOnce());
        expect(dialogs.create).toHaveBeenCalledOnce();
    });

    test('the dialog can be opened again after it closes', async () => {
        const dialog = createDialog();

        await dialog.open();
        await dialog.open();

        expect(dialogs.open).toHaveBeenCalledTimes(2);
    });

    test('a failed open releases the guard so the next command still works', async () => {
        dialogs.open.mockRejectedValueOnce(new Error('dialog failed'));
        const dialog = createDialog();

        await expect(dialog.open()).rejects.toThrow('dialog failed');
        await dialog.open();

        expect(dialogs.open).toHaveBeenCalledTimes(2);
    });

    test('tolerates a null result instead of crashing on result.id', async () => {
        const service = createService();
        dialogs.open.mockResolvedValue(null);

        await expect(createDialog(service).open()).resolves.toBeUndefined();
        expect(service.openIsoDate).not.toHaveBeenCalled();
    });

    test('rejects unknown webview messages', async () => {
        const service = createService();
        await createDialog(service).initialize();
        const handler = dialogs.onMessage.mock.calls[0][1] as (message: unknown) => Promise<unknown>;

        await expect(handler({ type: 'nope' })).rejects.toThrow('Unknown calendar message.');
        await expect(handler({ type: 'queryExistingDates', dates: ['2024-03-09'] })).resolves.toEqual({
            existingDates: [],
        });
    });
});
