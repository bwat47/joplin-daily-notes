import { renderTemplate } from './template';

describe('renderTemplate', () => {
    const context = {
        date: new Date(2024, 0, 7),
        creationTime: new Date(2024, 0, 7, 9, 5),
        title: '2024-01-07',
        rolledTodos: '',
    };

    test('expands the shorthand variables', () => {
        expect(renderTemplate('{{date}}|{{time}}|{{title}}', context)).toBe('2024-01-07|09:05|2024-01-07');
    });

    test('expands date and time namespaces with their own token sets', () => {
        const template = ['{{date:dddd, MMMM D}}', '{{date:YYYY}}', '{{time:h:mm A}}', '{{ date:[Week] WW }}'].join(
            '|'
        );

        expect(renderTemplate(template, context)).toBe('Sunday, January 7|2024|9:05 AM|Week 01');
    });

    test('reads the two clocks separately', () => {
        // The date is the day the note belongs to, so it stays midnight even
        // though the note is created later; only the time namespace advances.
        const output = renderTemplate('{{date:YYYY-MM-DD}} {{time:HH:mm}}', {
            date: new Date(2024, 0, 7),
            creationTime: new Date(2024, 2, 30, 22, 45),
            title: '2024-01-07',
            rolledTodos: '',
        });

        expect(output).toBe('2024-01-07 22:45');
    });

    test('rejects a time token in the date namespace and a date token in the time namespace', () => {
        const warnings: string[] = [];
        const output = renderTemplate('{{date:HH}} {{time:YYYY}}', context, (message) => warnings.push(message));

        expect(output).toBe('{{date:HH}} {{time:YYYY}}');
        expect(warnings).toHaveLength(2);
    });

    test.each(['{{unknown}}', '{{year}}', '{{monthName}}', '{{weekNum}}', '{{now:HH}}', '{{date:}}'])(
        'leaves %s unchanged and warns',
        (template) => {
            const warnings: string[] = [];

            expect(renderTemplate(template, context, (message) => warnings.push(message))).toBe(template);
            expect(warnings).toHaveLength(1);
        }
    );
});
