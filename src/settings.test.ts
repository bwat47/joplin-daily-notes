import { SettingItemType } from 'api/types';
import { readSettings, registerSettings } from './settings';

const settingsApi = vi.hoisted(() => ({
    registerSection: vi.fn(),
    registerSettings: vi.fn(),
    values: vi.fn(),
}));

vi.mock('api', () => ({
    default: { settings: settingsApi },
}));

describe('settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('registers the empty todo line setting off by default', async () => {
        await registerSettings();

        expect(settingsApi.registerSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest's asymmetric matcher returns any.
                keepEmptyTodoLine: expect.objectContaining({
                    value: false,
                    type: SettingItemType.Bool,
                    label: 'Keep empty todo placeholder line',
                }),
            })
        );
    });

    test('preserves configured string settings, including an empty template ID', async () => {
        const strings = { folderName: 'Journal', dateFormat: 'YYYY/MM-DD', templateNoteId: '' };
        settingsApi.values.mockResolvedValue(strings);

        await expect(readSettings()).resolves.toMatchObject(strings);
    });

    test.each([{ value: undefined }, { value: null }, { value: {} }, { value: [] }, { value: 42 }, { value: true }])(
        'uses defaults for non-string settings %j',
        async ({ value }) => {
            settingsApi.values.mockResolvedValue({ folderName: value, dateFormat: value, templateNoteId: value });

            await expect(readSettings()).resolves.toMatchObject({
                folderName: 'Daily Notes',
                dateFormat: 'YYYY-MM-DD',
                templateNoteId: '',
            });
        }
    );

    test('reads the empty todo line setting', async () => {
        settingsApi.values.mockResolvedValue({ keepEmptyTodoLine: true });

        await expect(readSettings()).resolves.toMatchObject({ keepEmptyTodoLine: true });
    });
});
