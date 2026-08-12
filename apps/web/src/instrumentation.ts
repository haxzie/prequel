import { validateEnv } from "@prequel/env";

// Runs once when the Next.js server boots — a bad environment fails startup
// rather than the first request.
export function register() {
  validateEnv();
}
