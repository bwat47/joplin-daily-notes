import joplin from 'api';
import { MenuItemLocation, ToastType, ToolbarButtonLocation } from 'api/types';
import type { CalendarDialog } from './calendarDialog';
import type { DailyNotesService } from './dailyNotesService';
import { toMessage } from './errors';
import { logger } from './logger';

const COMMAND_IDS = {
    openToday: 'dailyNotes.openToday',
    openCalendar: 'dailyNotes.openCalendar',
} as const;

async function runCommand(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        logger.error('Command failed.', error);
        await joplin.views.dialogs.showToast({
            message: `Daily Notes: ${toMessage(error)}`,
            type: ToastType.Error,
            duration: 6000,
        });
    }
}

export async function registerCommands(
    dailyNotes: DailyNotesService,
    calendar: CalendarDialog,
    isMobile: boolean
): Promise<void> {
    await joplin.commands.register({
        name: COMMAND_IDS.openToday,
        label: "Open today's daily note",
        iconName: 'fas fa-calendar-day',
        execute: async () =>
            runCommand(async () => {
                await dailyNotes.openDate(new Date());
            }),
    });

    await joplin.commands.register({
        name: COMMAND_IDS.openCalendar,
        label: 'Open daily note calendar',
        iconName: 'fas fa-calendar-alt',
        execute: async () => runCommand(async () => calendar.open()),
    });

    if (isMobile) {
        await joplin.views.toolbarButtons.create(
            'dailyNotes.openToday.mobile',
            COMMAND_IDS.openToday,
            ToolbarButtonLocation.NoteToolbar
        );
        await joplin.views.toolbarButtons.create(
            'dailyNotes.openCalendar.mobile',
            COMMAND_IDS.openCalendar,
            ToolbarButtonLocation.NoteToolbar
        );
        return;
    }

    await joplin.views.menus.create(
        'dailyNotes.menu',
        'Daily Notes',
        [
            {
                commandName: COMMAND_IDS.openToday,
                accelerator: 'CmdOrCtrl+Alt+D',
            },
            {
                commandName: COMMAND_IDS.openCalendar,
                accelerator: 'CmdOrCtrl+Alt+O',
            },
        ],
        MenuItemLocation.Tools
    );
}
