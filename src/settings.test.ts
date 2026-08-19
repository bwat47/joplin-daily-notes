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
                keepEmptyTodoLine: expect.objectContaining({
                    value: false,
                    type: SettingItemType.Bool,
                    label: 'Keep empty todo placeholder line',
                }),
            })
        );
    });

    test('reads the empty todo line setting', async () => {
        settingsApi.values.mockResolvedValue({ keepEmptyTodoLine: true });

        await expect(readSettings()).resolves.toMatchObject({ keepEmptyTodoLine: true });
    });
});
