/**
 * Read-through cache whose entries expire after a fixed time.
 *
 * Entries hold the in-flight promise rather than the resolved value, so callers
 * arriving while a load is still running share it instead of issuing a duplicate
 * request. A rejected load is evicted so the next caller retries rather than
 * being served the failure for the rest of the interval.
 */
export class ExpiringCache<T> {
    private readonly entries = new Map<string, { value: Promise<T>; expiresAt: number }>();

    public constructor(private readonly ttlMs: number) {}

    public fetch(key: string, load: () => Promise<T>): Promise<T> {
        const cached = this.entries.get(key);
        if (cached && cached.expiresAt > Date.now()) return cached.value;

        const value = load().catch((error: unknown) => {
            // Only evict this attempt: the entry may already have been replaced
            // by a later load, or cleared outright by a write.
            if (this.entries.get(key)?.value === value) this.entries.delete(key);
            throw error;
        });
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
    }

    public clear(): void {
        this.entries.clear();
    }
}
