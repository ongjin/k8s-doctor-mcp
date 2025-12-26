/**
 * Retry utilities with exponential backoff
 *
 * @author zerry
 */

export interface RetryOptions {
    /** Maximum number of retry attempts */
    maxAttempts?: number;
    /** Initial delay in milliseconds */
    initialDelay?: number;
    /** Maximum delay in milliseconds */
    maxDelay?: number;
    /** Backoff multiplier */
    backoffMultiplier?: number;
    /** Should retry on this error? */
    shouldRetry?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    shouldRetry: (error: any) => {
        // Retry on network errors, timeouts, and 5xx errors
        if (error.code === 'ECONNREFUSED') return true;
        if (error.code === 'ETIMEDOUT') return true;
        if (error.code === 'ENOTFOUND') return true;
        if (error.statusCode && error.statusCode >= 500) return true;

        // Don't retry on client errors (4xx)
        if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) return false;

        // Retry on unknown errors
        return true;
    },
};

/**
 * Execute function with retry logic and exponential backoff
 *
 * @param fn Function to execute
 * @param options Retry options
 * @returns Result of the function
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: any;
    let delay = opts.initialDelay;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Don't retry if it's the last attempt
            if (attempt === opts.maxAttempts) {
                break;
            }

            // Don't retry if error is not retryable
            if (!opts.shouldRetry(error)) {
                console.error(`[Retry] Non-retryable error on attempt ${attempt}:`, error.message);
                throw error;
            }

            console.error(
                `[Retry] Attempt ${attempt}/${opts.maxAttempts} failed: ${error.message}. ` +
                `Retrying in ${delay}ms...`
            );

            // Wait before retrying
            await sleep(delay);

            // Calculate next delay with exponential backoff
            delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
        }
    }

    console.error(`[Retry] All ${opts.maxAttempts} attempts failed`);
    throw lastError;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
