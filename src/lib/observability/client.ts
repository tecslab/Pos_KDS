"use client";

import { classifyTelemetryError } from "../../application";

import { operationalTelemetry } from "./recorder";

let installed = false;

export function installClientTelemetry(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    operationalTelemetry.record({
      event: "exception.unexpected",
      boundary: "client",
      errorClass: classifyTelemetryError(event.error),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    operationalTelemetry.record({
      event: "exception.unexpected",
      boundary: "client",
      errorClass: classifyTelemetryError(event.reason),
    });
  });
}
