import { ExpiringCache } from './expiringCache';

describe('ExpiringCache', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test('loads once and serves the cached value until the entry expires', async () => {
        const load = vi.fn().mockResolvedValue('value');
        const cache = new ExpiringCache<string>(30_000);

        await expect(cache.fetch('key', load)).resolves.toBe('value');
        vi.advanceTimersByTime(29_000);
        await expect(cache.fetch('key', load)).resolves.toBe('value');
        expect(load).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(2_000);
        await expect(cache.fetch('key', load)).resolves.toBe('value');
        expect(load).toHaveBeenCalledTimes(2);
    });

    test('keys are independent', async () => {
        const cache = new ExpiringCache<string>(30_000);

        await expect(cache.fetch('a', async () => 'first')).resolves.toBe('first');
        await expect(cache.fetch('b', async () => 'second')).resolves.toBe('second');
        await expect(cache.fetch('a', async () => 'ignored')).resolves.toBe('first');
    });

    test('concurrent callers share one in-flight load', async () => {
        const load = vi.fn().mockResolvedValue('value');
        const cache = new ExpiringCache<string>(30_000);

        await Promise.all([cache.fetch('key', load), cache.fetch('key', load), cache.fetch('key', load)]);

        expect(load).toHaveBeenCalledOnce();
    });

    test('a failed load is evicted so the next caller retries', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('value');
        const cache = new ExpiringCache<string>(30_000);

        await expect(cache.fetch('key', load)).rejects.toThrow('boom');
        await expect(cache.fetch('key', load)).resolves.toBe('value');
        expect(load).toHaveBeenCalledTimes(2);
    });

    test('clear drops entries that have not expired', async () => {
        const load = vi.fn().mockResolvedValue('value');
        const cache = new ExpiringCache<string>(30_000);

        await cache.fetch('key', load);
        cache.clear();
        await cache.fetch('key', load);

        expect(load).toHaveBeenCalledTimes(2);
    });

    test('a load rejecting after a clear does not evict the replacement entry', async () => {
        const cache = new ExpiringCache<string>(30_000);
        const pending: { reject?: (error: Error) => void } = {};
        const first = cache.fetch('key', () => {
            return new Promise<string>((_resolve, reject) => {
                pending.reject = reject;
            });
        });

        cache.clear();
        const replacement = vi.fn().mockResolvedValue('fresh');
        await expect(cache.fetch('key', replacement)).resolves.toBe('fresh');

        pending.reject?.(new Error('late failure'));
        await expect(first).rejects.toThrow('late failure');
        await expect(cache.fetch('key', replacement)).resolves.toBe('fresh');
        expect(replacement).toHaveBeenCalledOnce();
    });
});
