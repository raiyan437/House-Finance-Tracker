import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The Next.js "server-only" guard package is not a real dependency;
      // tests exercise server modules directly in Node.
      "server-only": fileURLToPath(new URL("./vitest.server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Leave CPU headroom for the OS and dev tooling; full-parallelism starves
    // jsdom/fake-indexeddb suites into timeout flakes on this machine.
    maxWorkers: "50%",
  },
});
