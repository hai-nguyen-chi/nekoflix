import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion: string;
  /** vd http://localhost:4318/v1/traces. Bỏ trống -> tắt tracing */
  otlpEndpoint?: string;
}

/**
 * PHẢI gọi TRƯỚC khi import bất cứ module nào dùng mongoose/http/nats.
 *
 * Auto-instrumentation của OpenTelemetry hoạt động bằng cách vá module lúc
 * `require`. Nếu AppModule được import trước, mongoose đã nằm trong cache của
 * Node và không còn bị vá nữa — trace sẽ thiếu hẳn tầng database mà không
 * báo lỗi gì.
 *
 * Vì vậy `createService()` nhận `moduleFactory` (dynamic import) thay vì
 * nhận thẳng module: để tuần tự luôn là telemetry trước, module sau.
 */
export function startTelemetry(opts: TelemetryOptions): void {
  if (sdk) return;
  if (!opts.otlpEndpoint) return;

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      [ATTR_SERVICE_VERSION]: opts.serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({ url: opts.otlpEndpoint }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Ồn và không có giá trị
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          // Health check mỗi 5 giây sẽ làm ngập Jaeger
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? '';
            return url.startsWith('/health') || url.startsWith('/metrics');
          },
        },
      }),
    ],
  });

  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // shutdown lỗi không được chặn việc thoát process
  } finally {
    sdk = undefined;
  }
}
