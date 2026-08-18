import { dateTemplateValues, formatDate } from './dateFormat';
import { toMessage } from './errors';

export interface TemplateContext {
    date: Date;
    creationTime: Date;
    title: string;
}

export type TemplateWarningHandler = (message: string) => void;

function formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function renderTemplate(
    template: string,
    context: TemplateContext,
    onWarning: TemplateWarningHandler = () => undefined
): string {
    const values = {
        ...dateTemplateValues(context.date),
        time: formatTime(context.creationTime),
        title: context.title,
    };

    return template.replace(/{{([^{}]*)}}/g, (original, rawVariable: string) => {
        const variable = rawVariable.trim();

        if (variable.startsWith('date:')) {
            const customFormat = variable.slice('date:'.length).trim();
            try {
                return formatDate(context.date, customFormat);
            } catch (error) {
                onWarning(`Could not expand ${original}: ${toMessage(error)}`);
                return original;
            }
        }

        if (Object.prototype.hasOwnProperty.call(values, variable)) {
            return values[variable as keyof typeof values];
        }

        onWarning(`Unknown template variable ${original}; leaving it unchanged.`);
        return original;
    });
}
