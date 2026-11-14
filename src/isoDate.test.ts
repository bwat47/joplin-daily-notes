import { tryParseIsoDate } from './isoDate';

describe('tryParseIsoDate', () => {
    test('parses a valid date as local midnight', () => {
        const date = tryParseIsoDate('2024-12-31');
        expect(date).toEqual(new Date(2024, 11, 31));
    });

    test('accepts leap days only in leap years', () => {
        expect(tryParseIsoDate('2024-02-29')).toEqual(new Date(2024, 1, 29));
        expect(tryParseIsoDate('2023-02-29')).toBeNull();
    });

    test.each(['2024-13-01', '2024-00-10', '2024-04-31', '2024-01-00'])(
        'rejects out-of-range date %s instead of rolling over',
        (value) => {
            expect(tryParseIsoDate(value)).toBeNull();
        }
    );

    test.each(['2024-2-01', '2024-02-1', '24-02-01', ' 2024-02-01', '2024-02-01 ', '2024/02/01', ''])(
        'rejects malformed input %j',
        (value) => {
            expect(tryParseIsoDate(value)).toBeNull();
        }
    );

    test('accepts four-digit years before 1000', () => {
        const date = tryParseIsoDate('0999-01-01');
        expect(date?.getFullYear()).toBe(999);
    });

    test('rejects years 0000-0099, which Date maps into the 1900s', () => {
        expect(tryParseIsoDate('0050-01-01')).toBeNull();
    });
});
