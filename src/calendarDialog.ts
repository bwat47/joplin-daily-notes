import type { ButtonSpec, DialogResult, ViewHandle } from 'api/types';
import { toIsoDate } from './dateFormat';
import type { DailyNotesService } from './dailyNotesService';
import { isQueryExistingDatesMessage, type SettingsReader } from './types';

/**
 * The Joplin view surface the calendar needs, as a port.
 *
 * `onMessage` comes from the panels API because dialogs expose none of their
 * own; Joplin routes dialog webview messages through it using the same handle.
 * Only type-only imports remain from `api`, so this module has no runtime
 * dependency on the Joplin global.
 */
export interface JoplinDialogApi {
    create(id: string): Promise<ViewHandle>;
    addScript(handle: ViewHandle, scriptPath: string): Promise<void>;
    setButtons(handle: ViewHandle, buttons: ButtonSpec[]): Promise<unknown>;
    setHtml(handle: ViewHandle, html: string): Promise<unknown>;
    open(handle: ViewHandle): Promise<DialogResult | null>;
    onMessage(handle: ViewHandle, handler: (message: unknown) => Promise<unknown>): Promise<void>;
}

export class CalendarDialog {
    private handle: Promise<ViewHandle> | null = null;
    private isOpen = false;

    public constructor(
        private readonly dialogs: JoplinDialogApi,
        private readonly dailyNotes: DailyNotesService,
        private readonly readSettings: SettingsReader
    ) {}

    public async initialize(): Promise<void> {
        await this.ensureHandle();
    }

    /**
     * Creates the dialog once and shares it with every caller.
     *
     * The handle only exists after several awaits, so caching the resolved value
     * would let a second caller pass the "already created?" check before the
     * first finished, creating a duplicate view and registering a second
     * onMessage handler. Caching the promise makes concurrent callers share one
     * dialog. A failed attempt is discarded so a later open can retry.
     */
    private ensureHandle(): Promise<ViewHandle> {
        this.handle ??= this.createHandle().catch((error: unknown) => {
            this.handle = null;
            throw error;
        });
        return this.handle;
    }

    private async createHandle(): Promise<ViewHandle> {
        const handle = await this.dialogs.create('daily-notes-calendar-dialog');
        await this.dialogs.addScript(handle, './calendar/calendar.css');
        await this.dialogs.addScript(handle, './calendar/calendar.js');
        await this.dialogs.setButtons(handle, [
            { id: 'confirm', title: 'Open' },
            { id: 'cancel', title: 'Cancel' },
        ]);
        await this.dialogs.onMessage(handle, async (message: unknown) => {
            if (!isQueryExistingDatesMessage(message)) throw new Error('Unknown calendar message.');
            return { existingDates: await this.dailyNotes.findExistingDates(message.dates) };
        });
        return handle;
    }

    public async open(): Promise<void> {
        // Joplin resolves a second open() of a dialog that is already on screen
        // with null instead of a result, which surfaced as a "Cannot read
        // properties of null" toast. The calendar is already in front of the
        // user, so a repeat command has nothing to do. The flag is set before
        // the first await so a repeat cannot slip through while the dialog is
        // still being prepared.
        if (this.isOpen) return;
        this.isOpen = true;

        try {
            const result = await this.showDialog();
            if (result?.id !== 'confirm') return;

            const selectedDate = result.formData?.calendar?.date;
            if (typeof selectedDate !== 'string') throw new Error('The calendar did not return a selected date.');
            await this.dailyNotes.openIsoDate(selectedDate);
        } finally {
            this.isOpen = false;
        }
    }

    /** Renders the calendar for today and waits for the user to dismiss it. */
    private async showDialog(): Promise<DialogResult | null> {
        const handle = await this.ensureHandle();
        const settings = await this.readSettings();
        const today = toIsoDate(new Date());
        await this.dialogs.setHtml(
            handle,
            `<form name="calendar">
                <div class="daily-notes-calendar" data-daily-notes-calendar data-selected-date="${today}" data-week-start="${settings.weekStart}">
                    <header class="calendar-header">
                        <button type="button" class="calendar-navigation" data-calendar-previous aria-label="Previous month">&#x2039;</button>
                        <h1 class="calendar-heading" data-calendar-heading></h1>
                        <button type="button" class="calendar-navigation" data-calendar-next aria-label="Next month">&#x203A;</button>
                    </header>
                    <div class="calendar-grid" data-calendar-grid role="grid" aria-label="Daily notes calendar"></div>
                    <p class="calendar-status" data-calendar-status aria-live="polite"></p>
                </div>
                <input id="daily-notes-selected-date" name="date" type="hidden" value="${today}">
            </form>`
        );

        // Declared as DialogResult, but Joplin can really resolve null here.
        return this.dialogs.open(handle);
    }
}
