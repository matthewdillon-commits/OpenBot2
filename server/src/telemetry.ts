/**
 * OpenTelemetry traces for the API and the worker.
 *
 * Spans are created with the SDK, not a comment. When `OTEL_EXPORTER_OTLP_ENDPOINT`
 * is set, they leave this process over OTLP HTTP to the collector — replica B
 * does the same; there is no in-process trace Map to fan to a browser.
 * Without an endpoint the SDK still records spans (a no-export processor) so
 * a missing collector does not pretend tracing is off.
 */
import { SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const TRACER_NAME = "limitlessai";

class DiscardExporter implements SpanExporter {
  export(
    _spans: ReadableSpan[],
    resultCallback: (result: { code: number }) => void,
  ): void {
    resultCallback({ code: 0 });
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

let started = false;

export function startTracing(
  serviceName: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (started) return;
  started = true;
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const exporter: SpanExporter = endpoint
    ? new OTLPTraceExporter({
        url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
      })
    : new DiscardExporter();
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();
}

export function tracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
