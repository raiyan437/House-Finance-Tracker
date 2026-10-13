import { rmSync } from "node:fs";
import { resolve } from "node:path";

export default function globalTeardown(): void {
  // CI uploads traces/screenshots after Playwright exits, including failed retries.
  if (process.env.CI) return;
  rmSync(resolve(process.cwd(), "test-results"), { recursive: true, force: true });
}
