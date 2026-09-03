/**
 * Thrown by services for failures that repeating cannot fix (4xx other than
 * 429). The queue worker lets these through instead of retrying.
 */
export class NonRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NonRetryableError";
  }
}
