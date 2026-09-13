import { publicEnvironment } from "./lib/config/runtime";
import { installClientTelemetry } from "./lib/observability/client";

// Import-time evaluation validates browser-visible configuration before hydration.
void publicEnvironment;
installClientTelemetry();
