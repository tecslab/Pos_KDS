import { publicEnvironment } from "./lib/config/runtime";

// Import-time evaluation validates browser-visible configuration before hydration.
void publicEnvironment;
