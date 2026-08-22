import "server-only";

import { parseServerEnvironment } from "./server-environment";

export const serverEnvironment = parseServerEnvironment({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
});
