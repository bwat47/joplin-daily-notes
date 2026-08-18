import { renderTemplate } from './template';

describe('renderTemplate', () => {
    const context = {
        date: new Date(2024, 0, 7),
        creationTime: new Date(2024, 0, 7, 9, 5),
        title: '2024-01-07',
    };

    test('expands every supported variable', () => {
        const template = [
            '{{date}}',
            '{{date:dddd, MMMM D}}',
            '{{time}}',
            '{{title}}',
            '{{year}}',
            '{{month}}',
            '{{monthName}}',
            '{{day}}',
            '{{weekdayName}}',
            '{{weekNum}}',
        ].join('|');

        expect(renderTemplate(template, context)).toBe(
            '2024-01-07|Sunday, January 7|09:05|2024-01-07|2024|01|January|07|Sunday|01'
        );
    });

    test('leaves unknown and invalid custom variables unchanged and warns', () => {
        const warnings: string[] = [];
        const output = renderTemplate('{{unknown}} {{date:HH}}', context, (message) => warnings.push(message));

        expect(output).toBe('{{unknown}} {{date:HH}}');
        expect(warnings).toHaveLength(2);
    });
});
