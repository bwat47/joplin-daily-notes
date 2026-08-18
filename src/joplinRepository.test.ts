import { AmbiguousPathError, JoplinRepository, type JoplinDataApi } from './joplinRepository';
import type { DailyNoteTarget } from './types';

function createDataApi(): JoplinDataApi {
    return {
        get: vi.fn(),
        post: vi.fn(),
    };
}

describe('JoplinRepository', () => {
    test('creates each missing notebook with the correct parent', async () => {
        const data = createDataApi();
        vi.mocked(data.get).mockResolvedValue({ items: [], has_more: false });
        vi.mocked(data.post)
            .mockResolvedValueOnce({ id: 'root', title: 'Daily Notes', parent_id: '' })
            .mockResolvedValueOnce({ id: 'year', title: '2024', parent_id: 'root' });
        const repository = new JoplinRepository(data);

        await expect(repository.ensureFolderPath(['Daily Notes', '2024'])).resolves.toMatchObject({
            id: 'year',
        });
        expect(data.post).toHaveBeenNthCalledWith(1, ['folders'], null, {
            title: 'Daily Notes',
            parent_id: '',
        });
        expect(data.post).toHaveBeenNthCalledWith(2, ['folders'], null, {
            title: '2024',
            parent_id: 'root',
        });
    });

    test('reuses nested notebooks from a paginated flat folder response', async () => {
        const data = createDataApi();
        vi.mocked(data.get)
            .mockResolvedValueOnce({
                items: [{ id: 'root', title: 'Daily Notes', parent_id: '' }],
                has_more: true,
            })
            .mockResolvedValueOnce({
                items: [
                    { id: 'year', title: '2026', parent_id: 'root' },
                    { id: 'month', title: 'August', parent_id: 'year' },
                ],
                has_more: false,
            });
        const repository = new JoplinRepository(data);

        await expect(repository.ensureFolderPath(['Daily Notes', '2026', 'August'])).resolves.toMatchObject({
            id: 'month',
        });
        expect(data.get).toHaveBeenCalledTimes(2);
        expect(data.post).not.toHaveBeenCalled();
    });

    test('rejects ambiguous notebook paths', async () => {
        const data = createDataApi();
        vi.mocked(data.get).mockResolvedValue({
            items: [
                { id: 'one', title: 'Daily Notes', parent_id: '' },
                { id: 'two', title: 'Daily Notes', parent_id: '' },
            ],
            has_more: false,
        });

        await expect(new JoplinRepository(data).ensureFolderPath(['Daily Notes'])).rejects.toThrow(AmbiguousPathError);
    });

    test('paginates notes and selects the earliest exact-title duplicate', async () => {
        const data = createDataApi();
        vi.mocked(data.get)
            .mockResolvedValueOnce({
                items: [{ id: 'other', parent_id: 'folder', title: 'Other', user_created_time: 1 }],
                has_more: true,
            })
            .mockResolvedValueOnce({
                items: [
                    { id: 'later', parent_id: 'folder', title: '2024-01-01', user_created_time: 20 },
                    { id: 'earlier', parent_id: 'folder', title: '2024-01-01', user_created_time: 10 },
                ],
                has_more: false,
            });

        await expect(new JoplinRepository(data).findCanonicalNote('folder', '2024-01-01')).resolves.toMatchObject({
            id: 'earlier',
        });
        expect(data.get).toHaveBeenCalledTimes(2);
    });

    test('groups highlight lookups by leaf notebook without creating folders', async () => {
        const data = createDataApi();
        vi.mocked(data.get)
            .mockResolvedValueOnce({
                items: [
                    { id: 'root', title: 'Daily Notes', parent_id: '' },
                    { id: 'year', title: '2024', parent_id: 'root' },
                ],
                has_more: false,
            })
            .mockResolvedValueOnce({
                items: [{ id: 'note', parent_id: 'year', title: '01-01', user_created_time: 1 }],
                has_more: false,
            });
        const targets: DailyNoteTarget[] = [
            { isoDate: '2024-01-01', folderSegments: ['2024'], title: '01-01' },
            { isoDate: '2024-01-02', folderSegments: ['2024'], title: '01-02' },
        ];

        await expect(new JoplinRepository(data).findExistingDates('Daily Notes', targets)).resolves.toEqual([
            '2024-01-01',
        ]);
        expect(data.get).toHaveBeenCalledTimes(2);
        expect(data.post).not.toHaveBeenCalled();
    });

    test('stops paginating instead of looping forever when has_more never clears', async () => {
        const data = createDataApi();
        vi.mocked(data.get).mockResolvedValue({ items: [{ id: 'folder' }], has_more: true });

        await expect(new JoplinRepository(data).ensureFolderPath(['Daily Notes'])).rejects.toThrow(
            /more than \d+ pages of folders/
        );
    });

    describe('highlight caching', () => {
        const folderPage = {
            items: [
                { id: 'root', title: 'Daily Notes', parent_id: '' },
                { id: 'year', title: '2024', parent_id: 'root' },
            ],
            has_more: false,
        };
        const notePage = {
            items: [{ id: 'note', parent_id: 'year', title: '01-01', user_created_time: 1 }],
            has_more: false,
        };
        const targets: DailyNoteTarget[] = [{ isoDate: '2024-01-01', folderSegments: ['2024'], title: '01-01' }];

        function createCollection(): JoplinDataApi {
            const data = createDataApi();
            vi.mocked(data.get).mockImplementation(async (path) =>
                path[0] === 'folders' && path.length === 1 ? folderPage : notePage
            );
            return data;
        }

        test('repeated month lookups reuse the cached listings', async () => {
            const data = createCollection();
            const repository = new JoplinRepository(data);

            await repository.findExistingDates('Daily Notes', targets);
            await repository.findExistingDates('Daily Notes', targets);
            await repository.findExistingDates('Daily Notes', targets);

            // One folder listing plus one note listing, not three of each.
            expect(data.get).toHaveBeenCalledTimes(2);
        });

        test('cached listings expire', async () => {
            vi.useFakeTimers();
            try {
                const data = createCollection();
                const repository = new JoplinRepository(data);

                await repository.findExistingDates('Daily Notes', targets);
                vi.advanceTimersByTime(31_000);
                await repository.findExistingDates('Daily Notes', targets);

                expect(data.get).toHaveBeenCalledTimes(4);
            } finally {
                vi.useRealTimers();
            }
        });

        test('creating a note invalidates the cache so the new date is highlighted', async () => {
            const data = createCollection();
            vi.mocked(data.post).mockResolvedValue({ id: 'new', parent_id: 'year', title: '01-02' });
            const repository = new JoplinRepository(data);

            await repository.findExistingDates('Daily Notes', targets);
            await repository.createNote('year', '01-02', '');
            await repository.findExistingDates('Daily Notes', targets);

            expect(data.get).toHaveBeenCalledTimes(4);
        });

        test('the open-or-create path always reads live, so a stale miss cannot duplicate a note', async () => {
            const data = createCollection();
            const repository = new JoplinRepository(data);

            await repository.findExistingDates('Daily Notes', targets);
            const before = vi.mocked(data.get).mock.calls.length;
            await repository.findCanonicalNote('year', '01-01');
            await repository.ensureFolderPath(['Daily Notes', '2024']);

            expect(vi.mocked(data.get).mock.calls.length).toBe(before + 2);
        });
    });

    test('creates notes and reads templates', async () => {
        const data = createDataApi();
        vi.mocked(data.post).mockResolvedValue({ id: 'note', parent_id: 'folder', title: 'Today' });
        vi.mocked(data.get).mockResolvedValue({ body: '# Template' });
        const repository = new JoplinRepository(data);

        await expect(repository.createNote('folder', 'Today', 'Body')).resolves.toMatchObject({ id: 'note' });
        await expect(repository.getTemplateBody('template')).resolves.toBe('# Template');
    });
});
