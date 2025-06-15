import { EventEmitter } from 'events';
import { logger } from '../config';
import { Gauge } from 'prom-client';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  monitoringPeriod?: number;
  timeout?: number;
  volumeThreshold?: number;
}

// Global circuit breaker metrics
const circuitBreakerGauge = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Current state of circuit breaker (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
});

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: Date;
  private nextAttempt?: Date;
  private readonly name: string;
  
  private readonly options: Required<CircuitBreakerOptions> = {
    failureThreshold: 5,      // Number of failures before opening
    resetTimeout: 60000,      // Time before trying again (ms)
    monitoringPeriod: 10000,  // Window for counting failures
    timeout: 30000,           // Request timeout
    volumeThreshold: 10,      // Minimum requests before opening
  };

  constructor(name: string, options?: CircuitBreakerOptions) {
    super();
    this.name = name;
    this.options = { ...this.options, ...options };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.halfOpen();
      } else {
        throw new Error(`Circuit breaker is OPEN for ${this.name}`);
      }
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Circuit breaker timeout')), this.options.timeout)
      );

      const result = await Promise.race([fn(), timeoutPromise]);
      
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.successCount++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      logger.info({ service: this.name }, 'Circuit breaker closing after successful test');
      this.close();
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();
    
    logger.warn({
      service: this.name,
      failureCount: this.failureCount,
      state: this.state,
    }, 'Circuit breaker failure recorded');

    if (this.state === CircuitState.HALF_OPEN) {
      logger.error({ service: this.name }, 'Circuit breaker opening after failed test');
      this.open();
    } else if (this.shouldOpen()) {
      logger.error({ service: this.name }, 'Circuit breaker opening due to failure threshold');
      this.open();
    }
  }

  private shouldOpen(): boolean {
    return (
      this.failureCount >= this.options.failureThreshold &&
      this.getTotalRequests() >= this.options.volumeThreshold
    );
  }

  private shouldAttemptReset(): boolean {
    return this.nextAttempt !== undefined && new Date() >= this.nextAttempt;
  }

  private getTotalRequests(): number {
    return this.failureCount + this.successCount;
  }

  private open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = new Date(Date.now() + this.options.resetTimeout);
    this.emit('open', this.name);
    this.updateMetrics();
  }

  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = undefined;
    this.emit('close', this.name);
    this.updateMetrics();
  }

  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.emit('halfOpen', this.name);
    this.updateMetrics();
  }

  private updateMetrics(): void {
    const stateValue = {
      [CircuitState.CLOSED]: 0,
      [CircuitState.OPEN]: 1,
      [CircuitState.HALF_OPEN]: 2,
    }[this.state];

    circuitBreakerGauge.labels({ service: this.name }).set(stateValue);
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
    };
  }
}

// Factory for creating circuit breakers
const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  name: string,
  options?: CircuitBreakerOptions
): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker(name, options));
  }
  return circuitBreakers.get(name)!;
}

// Decorator for methods
export function withCircuitBreaker(name: string, options?: CircuitBreakerOptions) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (this: any, ...args: any[]) {
      const circuitBreaker = getCircuitBreaker(name, options);
      return circuitBreaker.execute(() => originalMethod.apply(this, args));
    };
    
    return descriptor;
  };
} 