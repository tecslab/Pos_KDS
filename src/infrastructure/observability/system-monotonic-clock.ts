import type { MonotonicClock } from "../../application";

export class SystemMonotonicClock implements MonotonicClock {
  now(): number {
    return globalThis.performance.now();
  }
}
