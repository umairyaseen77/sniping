import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { trace, context, SpanStatusCode, Span } from '@opentelemetry/api';
import { config } from '../config';

let sdk: NodeSDK | null = null;

export function initializeTracing(): void {
  if (!config.otel.tracesEnabled) {
    return;
  }

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: config.otel.serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: '2.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.env,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${config.otel.endpoint}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource,
    spanProcessor: new BatchSpanProcessor(traceExporter) as any,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Disable fs instrumentation to reduce noise
        },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}

// Helper to create a traced function
export function traced(name: string) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = function (this: any, ...args: any[]) {
      return tracedFunction(name, originalMethod.bind(this))(...args);
    };
    
    return descriptor;
  };
}

// Internal traced function implementation
function tracedFunction<T extends (...args: any[]) => any>(
  name: string,
  fn: T
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    const tracer = trace.getTracer(config.otel.serviceName);
    const span = tracer.startSpan(name);
    
    return context.with(trace.setSpan(context.active(), span), () => {
      try {
        const result = fn(...args);
        
        if (result instanceof Promise) {
          return result
            .then((res) => {
              span.setStatus({ code: SpanStatusCode.OK });
              return res;
            })
            .catch((err) => {
              span.recordException(err);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err.message,
              });
              throw err;
            })
            .finally(() => {
              span.end();
            }) as ReturnType<T>;
        }
        
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (err: any) {
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });
        span.end();
        throw err;
      }
    });
  }) as T;
}

// Helper to add attributes to the current span
export function addSpanAttributes(attributes: Record<string, any>): void {
  const span = trace.getActiveSpan();
  if (span) {
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        span.setAttribute(key, value);
      }
    });
  }
}

// Helper to create child spans
export function createChildSpan(name: string): Span {
  const tracer = trace.getTracer(config.otel.serviceName);
  return tracer.startSpan(name);
} 