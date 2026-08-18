/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * `catch` binds `unknown`, so casting to `Error` risks rendering
 * "undefined" in a toast when a non-Error value is thrown.
 */
export function toMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    return String(error);
}
