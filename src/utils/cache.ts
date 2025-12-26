/**
 * Simple in-memory cache with TTL
 *
 * @author zerry
 */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

/**
 * Simple memory cache with TTL support
 */
export class MemoryCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private defaultTTL: number;

    /**
     * @param defaultTTL Default time-to-live in milliseconds (default: 30 seconds)
     */
    constructor(defaultTTL: number = 30000) {
        this.defaultTTL = defaultTTL;
    }

    /**
     * Get value from cache
     *
     * @param key Cache key
     * @returns Cached value or undefined if not found or expired
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            return undefined;
        }

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.value;
    }

    /**
     * Set value in cache
     *
     * @param key Cache key
     * @param value Value to cache
     * @param ttl Time-to-live in milliseconds (optional, uses default if not provided)
     */
    set(key: string, value: T, ttl?: number): void {
        const expiresAt = Date.now() + (ttl ?? this.defaultTTL);
        this.cache.set(key, { value, expiresAt });
    }

    /**
     * Delete value from cache
     *
     * @param key Cache key
     */
    delete(key: string): void {
        this.cache.delete(key);
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache size
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Clean up expired entries
     */
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
            }
        }
    }
}

/**
 * Get or compute cached value
 *
 * @param cache Cache instance
 * @param key Cache key
 * @param computeFn Function to compute value if not cached
 * @param ttl Optional TTL override
 * @returns Cached or computed value
 */
export async function getOrCompute<T>(
    cache: MemoryCache<T>,
    key: string,
    computeFn: () => Promise<T>,
    ttl?: number
): Promise<T> {
    // Try to get from cache first
    const cached = cache.get(key);
    if (cached !== undefined) {
        return cached;
    }

    // Compute value
    const value = await computeFn();

    // Cache it
    cache.set(key, value, ttl);

    return value;
}
