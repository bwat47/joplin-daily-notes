import { formatDate, formatTime, toIsoDate } from './dateFormat';
import { toMessage } from './errors';

export interface TemplateContext {
    date: Date;
    creationTime: Date;
    title: string;
    /** Todos carried from the previous daily note. Empty when rollover is off or found nothing. */
    rolledTodos: string;
}

export type TemplateWarningHandler = (message: string) => void;

const DEFAULT_TIME_FORMAT = 'HH:mm';

/**
 * Expands `{{...}}` variables in a template body.
 *
 * The vocabulary deliberately uses the same Day.js formatting-token model as
 * the date format setting, so there is one syntax to learn rather than a
 * parallel table of named variables. Separate date and time dialects reflect
 * the two clocks: `date:` formats the day the note belongs to, `time:` the moment
 * it is being created. `{{date}}`,
 * `{{time}}` and `{{title}}` are shorthands for the common cases; `{{title}}`
 * has no token form because it depends on the configured date format.
 *
 * `{{todos}}` is bare for the same reason: it carries content rather than a
 * formatted date, so there is nothing for a token to describe.
 *
 * A single pass over the template means an expansion that produces `{{` can
 * never be re-expanded.
 */
export function renderTemplate(
    template: string,
    context: TemplateContext,
    onWarning: TemplateWarningHandler = () => undefined
): string {
    return template.replace(/{{([^{}]*)}}/g, (original, rawVariable: string) => {
        const variable = rawVariable.trim();

        if (variable === 'title') return context.title;
        if (variable === 'todos') return context.rolledTodos;
        if (variable === 'date') return toIsoDate(context.date);
        if (variable === 'time') return formatTime(context.creationTime, DEFAULT_TIME_FORMAT);

        // First colon only, so a time format may itself contain colons.
        const separatorIndex = variable.indexOf(':');
        const namespace = separatorIndex > 0 ? variable.slice(0, separatorIndex).trim() : '';
        const customFormat = variable.slice(separatorIndex + 1).trim();

        if (namespace === 'date' || namespace === 'time') {
            try {
                return namespace === 'date'
                    ? formatDate(context.date, customFormat)
                    : formatTime(context.creationTime, customFormat);
            } catch (error) {
                onWarning(`Could not expand ${original}: ${toMessage(error)}`);
                return original;
            }
        }

        onWarning(`Unknown template variable ${original}; leaving it unchanged.`);
        return original;
    });
}
