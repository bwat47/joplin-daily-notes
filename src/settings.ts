import joplin from 'api';
import { SettingItemType } from 'api/types';
import type { DailyNoteSettings, WeekStart } from './types';

const SETTING_KEYS = {
    folderName: 'folderName',
    dateFormat: 'dateFormat',
    templateNoteId: 'templateNoteId',
    weekStart: 'weekStart',
} as const;

const SETTING_SECTION = 'dailyNotes';

export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SETTING_SECTION, {
        label: 'Daily Notes',
        iconName: 'fas fa-calendar-day',
    });

    await joplin.settings.registerSettings({
        [SETTING_KEYS.folderName]: {
            value: 'Daily Notes',
            type: SettingItemType.String,
            section: SETTING_SECTION,
            public: true,
            label: 'Daily notes notebook',
            description: 'Name of the top-level notebook that contains daily notes.',
        },
        [SETTING_KEYS.dateFormat]: {
            value: 'YYYY-MM-DD',
            type: SettingItemType.String,
            section: SETTING_SECTION,
            public: true,
            label: 'Date format',
            description: 'Date-based note path. Use / to create sub-notebooks, for example YYYY/MMMM/YYYY-MMM-DD.',
        },
        [SETTING_KEYS.templateNoteId]: {
            value: '',
            type: SettingItemType.String,
            section: SETTING_SECTION,
            public: true,
            label: 'Template note ID',
            description: 'ID of a note whose Markdown body is copied into newly created daily notes.',
        },
        [SETTING_KEYS.weekStart]: {
            value: 'sunday',
            type: SettingItemType.String,
            section: SETTING_SECTION,
            public: true,
            isEnum: true,
            options: {
                sunday: 'Sunday',
                monday: 'Monday',
            },
            label: 'First day of week',
        },
    });
}

export async function readSettings(): Promise<DailyNoteSettings> {
    const values = await joplin.settings.values(Object.values(SETTING_KEYS));
    const weekStart: WeekStart = values[SETTING_KEYS.weekStart] === 'monday' ? 'monday' : 'sunday';

    return {
        folderName: String(values[SETTING_KEYS.folderName] ?? 'Daily Notes'),
        dateFormat: String(values[SETTING_KEYS.dateFormat] ?? 'YYYY-MM-DD'),
        templateNoteId: String(values[SETTING_KEYS.templateNoteId] ?? ''),
        weekStart,
    };
}
