import initializeCalendar, { calendarGridDates, parseCalendarIsoDate, toCalendarIsoDate } from './calendar';

function calendarMarkup(weekStart: 'sunday' | 'monday' = 'sunday'): string {
    return `<form name="calendar">
        <div data-daily-notes-calendar data-selected-date="2024-01-15" data-week-start="${weekStart}">
            <button type="button" data-calendar-previous>Previous</button>
            <h1 data-calendar-heading></h1>
            <button type="button" data-calendar-next>Next</button>
            <div data-calendar-grid></div>
            <p data-calendar-status></p>
        </div>
        <input id="daily-notes-selected-date" name="date" type="hidden">
    </form>`;
}

function setWebviewApi(postMessage: (message: unknown) => Promise<unknown>): void {
    (globalThis as typeof globalThis & { webviewApi: { postMessage: typeof postMessage } }).webviewApi = {
        postMessage,
    };
}

describe('calendar helpers', () => {
    test('builds a Sunday-first six-week grid', () => {
        const dates = calendarGridDates(2024, 0, 'sunday');

        expect(dates).toHaveLength(42);
        expect(toCalendarIsoDate(dates[0])).toBe('2023-12-31');
        expect(toCalendarIsoDate(dates[41])).toBe('2024-02-10');
    });

    test('builds a Monday-first six-week grid', () => {
        const dates = calendarGridDates(2024, 0, 'monday');

        expect(toCalendarIsoDate(dates[0])).toBe('2024-01-01');
        expect(toCalendarIsoDate(dates[41])).toBe('2024-02-11');
    });

    test('round-trips valid local dates and rejects impossible ones', () => {
        expect(toCalendarIsoDate(parseCalendarIsoDate('2024-12-31'))).toBe('2024-12-31');
        expect(() => parseCalendarIsoDate('2024-02-30')).toThrow();
    });
});

describe('calendar webview', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    test('renders selection and existing-note markers', async () => {
        const postMessage = vi.fn().mockResolvedValue({ existingDates: ['2024-01-15'] });
        setWebviewApi(postMessage);
        document.body.innerHTML = calendarMarkup();

        initializeCalendar();

        await vi.waitFor(() => {
            expect(
                document.querySelector('[data-date="2024-01-15"]')?.classList.contains('calendar-date--existing')
            ).toBe(true);
        });
        expect(document.querySelector('[data-calendar-heading]')?.textContent).toBe('January 2024');
        expect(document.querySelector('[data-date="2024-01-15"]')?.classList.contains('calendar-date--selected')).toBe(
            true
        );
        expect(document.querySelectorAll('[data-calendar-grid] > *')).toHaveLength(49);
    });

    test('updates the selected form value without reloading the same month', async () => {
        const postMessage = vi.fn().mockResolvedValue({ existingDates: [] });
        setWebviewApi(postMessage);
        document.body.innerHTML = calendarMarkup();
        initializeCalendar();
        await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

        document.querySelector<HTMLButtonElement>('[data-date="2024-01-20"]')?.click();

        expect(document.querySelector<HTMLInputElement>('#daily-notes-selected-date')?.value).toBe('2024-01-20');
        expect(postMessage).toHaveBeenCalledOnce();
    });

    test('keeps arrow-key navigation working after a date is clicked', async () => {
        setWebviewApi(vi.fn().mockResolvedValue({ existingDates: [] }));
        document.body.innerHTML = calendarMarkup();
        initializeCalendar();
        await vi.waitFor(() => expect(document.querySelector('[data-date="2024-01-20"]')).not.toBeNull());

        document.querySelector<HTMLButtonElement>('[data-date="2024-01-20"]')?.click();

        // The grid is rebuilt on every render, so focus must land on the new button.
        expect(document.activeElement).toBe(document.querySelector('[data-date="2024-01-20"]'));

        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(document.querySelector<HTMLInputElement>('#daily-notes-selected-date')?.value).toBe('2024-01-21');
        expect(document.activeElement).toBe(document.querySelector('[data-date="2024-01-21"]'));
    });

    test('browsing months leaves the selection and the form value alone', async () => {
        const postMessage = vi.fn().mockResolvedValue({ existingDates: [] });
        setWebviewApi(postMessage);
        document.body.innerHTML = calendarMarkup();
        initializeCalendar();
        await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

        document.querySelector<HTMLButtonElement>('[data-calendar-next]')?.click();

        expect(document.querySelector('[data-calendar-heading]')?.textContent).toBe('February 2024');
        expect(document.querySelector<HTMLInputElement>('#daily-notes-selected-date')?.value).toBe('2024-01-15');
        // The grid changed, so markers for the new month must be requested.
        expect(postMessage).toHaveBeenCalledTimes(2);
    });

    test('keeps the grid tabbable when the selection is outside the visible month', async () => {
        setWebviewApi(vi.fn().mockResolvedValue({ existingDates: [] }));
        document.body.innerHTML = calendarMarkup();
        initializeCalendar();
        await vi.waitFor(() => expect(document.querySelector('[data-date="2024-01-15"]')).not.toBeNull());

        document.querySelector<HTMLButtonElement>('[data-calendar-next]')?.click();

        const tabbable = [...document.querySelectorAll<HTMLButtonElement>('[data-date]')].filter(
            (button) => button.tabIndex === 0
        );
        expect(tabbable.map((button) => button.dataset.date)).toEqual(['2024-02-01']);
    });

    test('returning to the selected month restores it as the tabbable cell', async () => {
        setWebviewApi(vi.fn().mockResolvedValue({ existingDates: [] }));
        document.body.innerHTML = calendarMarkup();
        initializeCalendar();
        await vi.waitFor(() => expect(document.querySelector('[data-date="2024-01-15"]')).not.toBeNull());

        document.querySelector<HTMLButtonElement>('[data-calendar-next]')?.click();
        document.querySelector<HTMLButtonElement>('[data-calendar-previous]')?.click();

        expect(document.querySelector<HTMLButtonElement>('[data-date="2024-01-15"]')?.tabIndex).toBe(0);
        expect(document.querySelector<HTMLInputElement>('#daily-notes-selected-date')?.value).toBe('2024-01-15');
    });

    test('arrow keys move from the focused cell after browsing to another month', async () => {
        setWebviewApi(vi.fn().mockResolvedValue({ existingDates: [] }));
        document.body.innerHTML = calendarMarkup();
        initializeCalendar();
        await vi.waitFor(() => expect(document.querySelector('[data-date="2024-01-15"]')).not.toBeNull());

        document.querySelector<HTMLButtonElement>('[data-calendar-next]')?.click();
        const anchor = document.querySelector<HTMLButtonElement>('[data-date="2024-02-01"]');
        anchor?.focus();
        anchor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        // Not 2024-01-16, which is what moving relative to the stale selection would give.
        expect(document.querySelector<HTMLInputElement>('#daily-notes-selected-date')?.value).toBe('2024-02-02');
    });

    test('keeps dates selectable when marker loading fails', async () => {
        setWebviewApi(vi.fn().mockRejectedValue(new Error('query failed')));
        document.body.innerHTML = calendarMarkup('monday');
        initializeCalendar();

        await vi.waitFor(() => {
            expect(document.querySelector('[data-calendar-status]')?.textContent).toBe(
                'Could not load existing-note markers.'
            );
        });
        expect(document.querySelector<HTMLButtonElement>('[data-date="2024-01-22"]')?.disabled).toBe(false);
    });
});
