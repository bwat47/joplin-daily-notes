import {
    DateFormatError,
    buildDailyNoteTarget,
    formatDate,
    parseIsoDate,
    toIsoDate,
    validateDateFormat,
    validateFolderName,
} from './dateFormat';

describe('dateFormat', () => {
    test('formats the documented hierarchical example', () => {
        const date = new Date(2023, 0, 1);

        expect(formatDate(date, 'YYYY/MMMM/YYYY-MMM-DD')).toBe('2023/January/2023-Jan-01');
        expect(buildDailyNoteTarget(date, 'YYYY/MMMM/YYYY-MMM-DD')).toEqual({
            isoDate: '2023-01-01',
            folderSegments: ['2023', 'January'],
            title: '2023-Jan-01',
        });
    });

    test('supports bracketed literals and advanced date tokens', () => {
        expect(formatDate(new Date(2024, 1, 29), '[Day]-Do-[Q]Q-[Week]WW')).toBe('Day-29th-Q1-Week09');
    });

    test.each(['', 'YYYY-HH-DD', 'YYYY-[month'])('rejects invalid format %j', (format) => {
        expect(() => validateDateFormat(format)).toThrow(DateFormatError);
    });

    test.each(['YYYY//MM-DD', 'YYYY/../MM-DD', 'YYYY/[ .. ]/MM-DD'])('rejects invalid generated path %j', (format) => {
        expect(() => buildDailyNoteTarget(new Date(2024, 0, 1), format)).toThrow(DateFormatError);
    });

    test('trims whitespace from generated notebook segments and the note title', () => {
        expect(buildDailyNoteTarget(new Date(2024, 0, 5), 'YYYY / MM-DD')).toEqual({
            isoDate: '2024-01-05',
            folderSegments: ['2024'],
            title: '01-05',
        });
        expect(buildDailyNoteTarget(new Date(2024, 0, 5), '[ ]YYYY-MM-DD[ ]').title).toBe('2024-01-05');
    });

    test('validates and normalizes the top-level notebook name', () => {
        expect(validateFolderName('  Daily Notes  ')).toBe('Daily Notes');
        expect(() => validateFolderName('Notes/Daily')).toThrow(DateFormatError);
        expect(() => validateFolderName('   ')).toThrow(DateFormatError);
    });

    test('parses ISO dates in local time and rejects impossible dates', () => {
        const leapDay = parseIsoDate('2024-02-29');
        expect(toIsoDate(leapDay)).toBe('2024-02-29');
        expect(leapDay.getHours()).toBe(0);
        expect(() => parseIsoDate('2023-02-29')).toThrow(DateFormatError);
        expect(() => parseIsoDate('2024-2-01')).toThrow(DateFormatError);
    });
});
