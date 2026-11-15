/** Parses a local calendar date, returning null for malformed or impossible dates. */
export function tryParseIsoDate(value: string): Date | null {
    // Exactly YYYY-MM-DD, for example 2024-02-29; unpadded dates are rejected.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);

    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
        return null;
    }

    return date;
}
