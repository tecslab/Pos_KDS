import type {
  OperationalTelemetryRecord,
  OperationalTelemetrySink,
} from "../../application";

export type StructuredTelemetryConsole = Pick<
  Console,
  "error" | "info" | "warn"
>;

/** Writes one JSON object per event without adding ambient or caller context. */
export class StructuredConsoleTelemetrySink implements OperationalTelemetrySink {
  constructor(private readonly output: StructuredTelemetryConsole = console) {}

  write(record: OperationalTelemetryRecord): void {
    const serialized = JSON.stringify(record);

    if (record.level === "error") {
      this.output.error(serialized);
    } else if (record.level === "warning") {
      this.output.warn(serialized);
    } else {
      this.output.info(serialized);
    }
  }
}
