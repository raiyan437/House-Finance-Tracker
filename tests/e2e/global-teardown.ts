import { rmSync } from "node:fs";
import { resolve } from "node:path";

export default function globalTeardown(): void {
  rmSync(resolve(process.cwd(), "test-results"), { recursive: true, force: true });
}
