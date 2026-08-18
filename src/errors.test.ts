import { toMessage } from './errors';

describe('toMessage', () => {
    test('uses the message of a real Error', () => {
        expect(toMessage(new Error('boom'))).toBe('boom');
    });

    test.each([
        ['a thrown string', 'plain failure', 'plain failure'],
        ['an Error without a message', new Error(''), 'Error'],
        ['a thrown object', { code: 7 }, '[object Object]'],
        ['undefined', undefined, 'undefined'],
    ])('renders %s without producing "undefined" from a bad cast', (_label, thrown, expected) => {
        expect(toMessage(thrown)).toBe(expected);
    });
});
