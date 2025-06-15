import pRetry, { AbortError, FailedAttemptError } from 'p-retry';
import { logger } from '../config';
import { addSpanAttributes } from './tracing';

export interface RetryOptions {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  factor?: number;
  randomize?: boolean;
  onFailedAttempt?: (error: FailedAttemptError) => void | Promise<void>;
}

const defaultOptions: RetryOptions = {
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 30000,
  factor: 2,
  randomize: true,
};

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  context?: string
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  
  return pRetry(
    async () => {
      try {
        const result = await fn();
        addSpanAttributes({ 'retry.succeeded': true, 'retry.context': context });
        return result;
      } catch (error: any) {
        addSpanAttributes({ 
          'retry.error': error.message,
          'retry.context': context,
        });
        
        // Check if it's a permanent error that shouldn't be retried
        if (error instanceof PermanentError) {
          throw new AbortError(error.message);
        }
        
        // Check for specific HTTP status codes that shouldn't be retried
        if (error.response?.status) {
          const status = error.response.status;
          
          // Don't retry client errors (except 429)
          if (status >= 400 && status < 500 && status !== 429) {
            logger.warn({ status, context }, 'Non-retryable client error');
            throw new AbortError(`HTTP ${status}: ${error.message}`);
          }
          
          // Handle rate limiting
          if (status === 429) {
            const retryAfter = error.response.headers?.['retry-after'];
            if (retryAfter) {
              const delay = parseInt(retryAfter, 10) * 1000;
              logger.info({ delay, context }, 'Rate limited, waiting before retry');
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        throw error;
      }
    },
    {
      ...opts,
      onFailedAttempt: async (error) => {
        logger.warn({
          attemptNumber: error.attemptNumber,
          retriesLeft: error.retriesLeft,
          error: error.message,
          context,
        }, 'Retry attempt failed');
        
        addSpanAttributes({
          'retry.attempt': error.attemptNumber,
          'retry.retries_left': error.retriesLeft,
        });
        
        if (opts.onFailedAttempt) {
          await opts.onFailedAttempt(error);
        }
      },
    }
  );
}

// Helper function for retrying with custom abort logic
export async function retryWithAbort<T>(
  fn: () => Promise<T>,
  shouldAbort: (error: any) => boolean,
  options: RetryOptions = {},
  context?: string
): Promise<T> {
  return retry(
    async () => {
      try {
        return await fn();
      } catch (error: any) {
        if (shouldAbort(error)) {
          throw new PermanentError(`Aborted: ${error.message}`);
        }
        throw error;
      }
    },
    options,
    context
  );
}

// Helper function for retrying network requests with specific handling
export async function retryNetworkRequest<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  context?: string
): Promise<T> {
  return retry(
    fn,
    {
      ...options,
      retries: options.retries ?? 5,
      minTimeout: options.minTimeout ?? 2000,
      maxTimeout: options.maxTimeout ?? 60000,
    },
    context
  );
}

// Exponential backoff helper
export function exponentialBackoff(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000,
  jitter: boolean = true
): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  
  if (jitter) {
    // Add random jitter (±25% of the delay)
    const jitterAmount = delay * 0.25;
    return delay + (Math.random() * 2 - 1) * jitterAmount;
  }
  
  return delay;
}

// Simple delay helper
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
} 