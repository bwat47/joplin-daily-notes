import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import isoWeek from 'dayjs/plugin/isoWeek';
import type { DailyNoteTarget } from './types';

dayjs.extend(advancedFormat);
dayjs.extend(isoWeek);

const SUPPORTED_TOKENS = [
    'YYYY',
    'MMMM',
    'dddd',
    'MMM',
    'ddd',
    'YY',
    'MM',
    'DD',
    'dd',
    'Do',
    'WW',
    'M',
    'D',
    'd',
    'Q',
    'W',
] as const;

const MAX_REPEATED_TOKEN_LENGTH: Readonly<Record<string, number>> = {
    Y: 4,
    M: 4,
    D: 2,
    d: 4,
    Q: 1,
    W: 2,
};

export class DateFormatError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'DateFormatError';
    }
}

function validateRepeatedToken(format: string, index: number): void {
    const repeatedTokenLimit = MAX_REPEATED_TOKEN_LENGTH[format[index]];
    if (repeatedTokenLimit === undefined) return;

    let runEnd = index + 1;
    while (format[runEnd] === format[index]) runEnd += 1;
    if (runEnd - index > repeatedTokenLimit) {
        throw new DateFormatError(
            `Unsupported repeated date format token "${format.slice(index, runEnd)}". ` +
                'Wrap literal text in square brackets.'
        );
    }
}

export function validateDateFormat(format: string): void {
    if (!format.trim()) throw new DateFormatError('Date format cannot be empty.');

    for (let index = 0; index < format.length;) {
        if (format[index] === '[') {
            const closingIndex = format.indexOf(']', index + 1);
            if (closingIndex < 0) throw new DateFormatError('Date format contains an unclosed [literal].');
            index = closingIndex + 1;
            continue;
        }

        if (/[A-Za-z]/.test(format[index])) {
            validateRepeatedToken(format, index);
            const token = SUPPORTED_TOKENS.find((candidate) => format.startsWith(candidate, index));
            if (!token) {
                const unsupported = format.slice(index).match(/^[A-Za-z]+/)?.[0] ?? format[index];
                throw new DateFormatError(
                    `Unsupported date format token near "${unsupported}". Wrap literal text in square brackets.`
                );
            }
            index += token.length;
            continue;
        }

        index += 1;
    }
}

export function formatDate(date: Date, format: string): string {
    validateDateFormat(format);
    return dayjs(date).format(format);
}

export function toIsoDate(date: Date): string {
    return dayjs(date).format('YYYY-MM-DD');
}

export function parseIsoDate(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new DateFormatError(`Invalid calendar date: "${value}".`);

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);

    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
        throw new DateFormatError(`Invalid calendar date: "${value}".`);
    }

    return date;
}

export function validateFolderName(folderName: string): string {
    const normalized = folderName.trim();
    if (!normalized) throw new DateFormatError('Daily notes notebook cannot be empty.');
    if (normalized.includes('/')) {
        throw new DateFormatError('Daily notes notebook must be a single top-level notebook name.');
    }
    if (normalized === '.' || normalized === '..') {
        throw new DateFormatError('Daily notes notebook cannot be "." or "..".');
    }
    return normalized;
}

/**
 * Builds the canonical notebook path and note title for a date.
 *
 * Segments are trimmed to match `validateFolderName`, so `YYYY / MM-DD` yields
 * `2024` and `01-05` rather than `2024 ` and ` 01-05`. Canonical lookups compare
 * titles exactly, so an untrimmed segment that Joplin later normalizes would
 * never match and would recreate the notebook on every open.
 */
export function buildDailyNoteTarget(date: Date, format: string): DailyNoteTarget {
    const segments = formatDate(date, format)
        .split('/')
        .map((segment) => segment.trim());

    if (segments.some((segment) => !segment)) {
        throw new DateFormatError('Date format generated an empty notebook or note name.');
    }
    if (segments.some((segment) => segment === '.' || segment === '..')) {
        throw new DateFormatError('Date format generated an invalid "." or ".." path segment.');
    }

    return {
        isoDate: toIsoDate(date),
        folderSegments: segments.slice(0, -1),
        title: segments[segments.length - 1],
    };
}

export function dateTemplateValues(date: Date): Record<string, string> {
    return {
        date: toIsoDate(date),
        year: dayjs(date).format('YYYY'),
        month: dayjs(date).format('MM'),
        monthName: dayjs(date).format('MMMM'),
        day: dayjs(date).format('DD'),
        weekdayName: dayjs(date).format('dddd'),
        weekNum: dayjs(date).format('WW'),
    };
}
