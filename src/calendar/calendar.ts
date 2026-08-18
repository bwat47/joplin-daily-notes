import type { QueryExistingDatesResponse, WeekStart } from '../types';

declare const webviewApi: {
    postMessage(message: unknown): Promise<unknown>;
};

declare global {
    interface Window {
        dailyNotesCalendarObserver?: MutationObserver;
    }
}

const ENGLISH_MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

const WEEKDAY_LABELS: Record<WeekStart, string[]> = {
    sunday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function toCalendarIsoDate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseCalendarIsoDate(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Invalid date: ${value}`);

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (toCalendarIsoDate(date) !== value) throw new Error(`Invalid date: ${value}`);
    return date;
}

export function calendarGridDates(year: number, monthIndex: number, weekStart: WeekStart): Date[] {
    const firstOfMonth = new Date(year, monthIndex, 1);
    const firstWeekday = firstOfMonth.getDay();
    const leadingDays = weekStart === 'monday' ? (firstWeekday + 6) % 7 : firstWeekday;
    const firstCell = new Date(year, monthIndex, 1 - leadingDays);

    return Array.from(
        { length: 42 },
        (_, index) => new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate() + index)
    );
}

function isExistingDatesResponse(value: unknown): value is QueryExistingDatesResponse {
    return Boolean(
        value &&
        typeof value === 'object' &&
        Array.isArray((value as Partial<QueryExistingDatesResponse>).existingDates)
    );
}

function initializeCalendar(): void {
    const root = document.querySelector<HTMLElement>('[data-daily-notes-calendar]');
    if (!root || root.dataset.initialized === 'true') return;

    const grid = root.querySelector<HTMLElement>('[data-calendar-grid]');
    const heading = root.querySelector<HTMLElement>('[data-calendar-heading]');
    const status = root.querySelector<HTMLElement>('[data-calendar-status]');
    const selectedInput = document.querySelector<HTMLInputElement>('#daily-notes-selected-date');
    const previousButton = root.querySelector<HTMLButtonElement>('[data-calendar-previous]');
    const nextButton = root.querySelector<HTMLButtonElement>('[data-calendar-next]');
    if (!grid || !heading || !status || !selectedInput || !previousButton || !nextButton) return;
    root.dataset.initialized = 'true';

    const calendarGrid = grid;
    const calendarHeading = heading;

    const weekStart: WeekStart = root.dataset.weekStart === 'monday' ? 'monday' : 'sunday';
    let selectedDate = parseCalendarIsoDate(root.dataset.selectedDate ?? toCalendarIsoDate(new Date()));
    let visibleDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    let existingDates = new Set<string>();
    let requestSequence = 0;

    const updateExistingDates = async (dates: Date[]): Promise<void> => {
        const requestId = ++requestSequence;
        status.textContent = 'Checking for existing notes…';
        status.classList.remove('calendar-status--error');

        try {
            const response = await webviewApi.postMessage({
                type: 'queryExistingDates',
                dates: dates.map(toCalendarIsoDate),
            });
            if (requestId !== requestSequence) return;
            if (!isExistingDatesResponse(response)) throw new Error('Invalid response');
            existingDates = new Set(response.existingDates);
            status.textContent = '';
            renderGrid(false);
        } catch {
            if (requestId !== requestSequence) return;
            existingDates = new Set();
            status.textContent = 'Could not load existing-note markers.';
            status.classList.add('calendar-status--error');
            renderGrid(false);
        }
    };

    const selectDate = (date: Date, focusAfterRender = false): void => {
        const monthChanged =
            date.getFullYear() !== visibleDate.getFullYear() || date.getMonth() !== visibleDate.getMonth();
        selectedDate = date;
        visibleDate = new Date(date.getFullYear(), date.getMonth(), 1);
        selectedInput.value = toCalendarIsoDate(date);
        renderGrid(monthChanged, focusAfterRender);
    };

    // Month navigation moves the visible grid only. The selection is what the
    // dialog's Open button acts on, so browsing months must not silently
    // reassign it to the same day of a month the user never chose.
    const showMonth = (offset: number): void => {
        visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth() + offset, 1);
        renderGrid(true);
    };

    const handleDateKeydown = (event: KeyboardEvent): void => {
        const offsets: Partial<Record<string, number>> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -7,
            ArrowDown: 7,
        };
        const offset = offsets[event.key];
        if (offset === undefined) return;
        event.preventDefault();

        // Move relative to the cell that has focus: after browsing months it is
        // the visible month's anchor rather than the selected date.
        const originIsoDate = (event.target as HTMLElement | null)?.dataset?.date;
        const origin = originIsoDate ? parseCalendarIsoDate(originIsoDate) : selectedDate;
        selectDate(new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + offset), true);
    };

    function renderGrid(loadMarkers: boolean, focusSelected = false): void {
        const dates = calendarGridDates(visibleDate.getFullYear(), visibleDate.getMonth(), weekStart);
        const isoDates = dates.map(toCalendarIsoDate);
        const selectedIsoDate = toCalendarIsoDate(selectedDate);
        const todayIsoDate = toCalendarIsoDate(new Date());
        // Exactly one cell is tabbable. It is normally the selection, but after
        // browsing to another month the selection is not on the grid at all, and
        // without a fallback anchor the whole calendar drops out of the tab order.
        const anchorIsoDate = isoDates.includes(selectedIsoDate)
            ? selectedIsoDate
            : isoDates[dates.findIndex((date) => date.getMonth() === visibleDate.getMonth())];
        // Every render replaces the date buttons, which would otherwise drop focus
        // to <body> and break arrow-key navigation. Restore it when it was ours.
        const restoreFocus = focusSelected || calendarGrid.contains(document.activeElement);

        calendarHeading.textContent = `${ENGLISH_MONTHS[visibleDate.getMonth()]} ${visibleDate.getFullYear()}`;
        calendarGrid.replaceChildren();

        for (const label of WEEKDAY_LABELS[weekStart]) {
            const weekday = document.createElement('div');
            weekday.className = 'calendar-weekday';
            weekday.textContent = label;
            calendarGrid.append(weekday);
        }

        for (const date of dates) {
            const isoDate = toCalendarIsoDate(date);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'calendar-date';
            button.dataset.date = isoDate;
            button.textContent = String(date.getDate());
            button.tabIndex = isoDate === anchorIsoDate ? 0 : -1;
            button.setAttribute(
                'aria-label',
                date.toLocaleDateString('en-US', { dateStyle: 'full' }) +
                    (existingDates.has(isoDate) ? ', daily note exists' : '')
            );

            button.classList.toggle('calendar-date--outside', date.getMonth() !== visibleDate.getMonth());
            button.classList.toggle('calendar-date--today', isoDate === todayIsoDate);
            button.classList.toggle('calendar-date--selected', isoDate === selectedIsoDate);
            button.classList.toggle('calendar-date--existing', existingDates.has(isoDate));
            button.setAttribute('aria-current', isoDate === selectedIsoDate ? 'date' : 'false');

            const marker = document.createElement('span');
            marker.className = 'calendar-date__marker';
            marker.setAttribute('aria-hidden', 'true');
            button.append(marker);

            button.addEventListener('click', () => selectDate(date, true));
            calendarGrid.append(button);
        }

        if (restoreFocus) {
            calendarGrid.querySelector<HTMLButtonElement>(`[data-date="${anchorIsoDate}"]`)?.focus();
        }
        if (loadMarkers) void updateExistingDates(dates);
    }

    calendarGrid.addEventListener('keydown', handleDateKeydown);
    previousButton.addEventListener('click', () => showMonth(-1));
    nextButton.addEventListener('click', () => showMonth(1));
    selectedInput.value = toCalendarIsoDate(selectedDate);
    renderGrid(true);
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initializeCalendar);
    initializeCalendar();

    if (!window.dailyNotesCalendarObserver) {
        window.dailyNotesCalendarObserver = new MutationObserver(initializeCalendar);
        window.dailyNotesCalendarObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

export default initializeCalendar;
