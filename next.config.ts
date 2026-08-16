import type { NextConfig } from "next";

import { publicEnvironment } from "./src/lib/config/runtime";

// Import-time evaluation fails development, build, and server startup predictably.
void publicEnvironment;

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
