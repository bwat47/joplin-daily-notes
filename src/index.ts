import joplin from 'api';
import { ToastType } from 'api/types';
import { CalendarDialog, type JoplinDialogApi } from './calendarDialog';
import { registerCommands } from './commands';
import { DailyNotesService } from './dailyNotesService';
import { JoplinRepository, type JoplinDataApi } from './joplinRepository';
import { logger } from './logger';
import { readSettings, registerSettings } from './settings';

joplin.plugins.register({
    onStart: async () => {
        await registerSettings();

        const versionInfo = await joplin.versionInfo();
        const isMobile = versionInfo.platform === 'mobile';
        const repository = new JoplinRepository(joplin.data as unknown as JoplinDataApi);
        const dailyNotes = new DailyNotesService(repository, {
            readSettings,
            isMobile,
            openNote: async (noteId: string) => {
                await joplin.commands.execute('openNote', noteId);
            },
            focusEditor: async () => {
                await joplin.commands.execute('editor.focus');
            },
            showWarning: async (message: string) => {
                await joplin.views.dialogs.showToast({
                    message,
                    type: ToastType.Error,
                    duration: 6000,
                });
            },
        });
        // Adapter rather than a cast: the calendar's message channel lives on the
        // panels API while everything else is on dialogs.
        const dialogApi: JoplinDialogApi = {
            create: (id) => joplin.views.dialogs.create(id),
            addScript: (handle, scriptPath) => joplin.views.dialogs.addScript(handle, scriptPath),
            setButtons: (handle, buttons) => joplin.views.dialogs.setButtons(handle, buttons),
            setHtml: (handle, html) => joplin.views.dialogs.setHtml(handle, html),
            open: (handle) => joplin.views.dialogs.open(handle),
            onMessage: (handle, handler) => joplin.views.panels.onMessage(handle, handler),
        };
        const calendar = new CalendarDialog(dialogApi, dailyNotes, readSettings);

        await calendar.initialize();
        await registerCommands(dailyNotes, calendar, isMobile);
        logger.info('Plugin started.');
    },
});
