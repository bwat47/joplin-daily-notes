export type WeekStart = 'sunday' | 'monday';

export interface DailyNoteSettings {
    folderName: string;
    dateFormat: string;
    templateNoteId: string;
    weekStart: WeekStart;
}

/** Reads the current plugin settings. Injected so callers do not reach for the Joplin API. */
export type SettingsReader = () => Promise<DailyNoteSettings>;

export interface DailyNoteTarget {
    isoDate: string;
    folderSegments: string[];
    title: string;
}

export interface NoteRecord {
    id: string;
    parent_id: string;
    title: string;
    user_created_time?: number;
}

export interface QueryExistingDatesMessage {
    type: 'queryExistingDates';
    dates: string[];
}

export interface QueryExistingDatesResponse {
    existingDates: string[];
}

export function isQueryExistingDatesMessage(value: unknown): value is QueryExistingDatesMessage {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<QueryExistingDatesMessage>;
    return candidate.type === 'queryExistingDates' && Array.isArray(candidate.dates);
}
