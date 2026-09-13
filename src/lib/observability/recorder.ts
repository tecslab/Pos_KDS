import { SafeOperationalTelemetryRecorder } from "../../application/observability";
import { StructuredConsoleTelemetrySink } from "../../infrastructure/observability/structured-console-telemetry-sink";
import { SystemMonotonicClock } from "../../infrastructure/observability/system-monotonic-clock";

export const operationalTelemetry = new SafeOperationalTelemetryRecorder(
  new StructuredConsoleTelemetrySink(),
);

export const operationalTelemetryClock = new SystemMonotonicClock();
