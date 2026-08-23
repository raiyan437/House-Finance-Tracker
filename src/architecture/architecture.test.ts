import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

const rules = {
  domain: {
    layers: ["application", "infrastructure", "presentation", "app"],
    packages: ["react", "react-dom", "next", "appwrite", "zod", "idb", "fake-indexeddb"],
  },
  application: {
    layers: ["infrastructure", "presentation", "app"],
    packages: ["react", "react-dom", "next", "appwrite", "idb", "fake-indexeddb"],
  },
  infrastructure: {
    layers: ["presentation", "app"],
    packages: ["appwrite"],
  },
  presentation: {
    layers: ["infrastructure", "app"],
    packages: ["appwrite", "idb", "fake-indexeddb"],
  },
} as const;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }

    const isSourceFile = [".ts", ".tsx"].some((suffix) =>
      entry.name.endsWith(suffix),
    );

    if (isSourceFile && !entry.name.includes(".test.")) {
      files.push(path);
    }
  }

  return files;
}

function importedSpecifiers(source: string): string[] {
  const fromImports = source.matchAll(/from\s+["']([^"']+)["']/g);
  const directImports = source.matchAll(/import\s+["']([^"']+)["']/g);
  const dynamicImports = source.matchAll(/import\s*\(\s*["']([^"']+)["']/g);

  return [...fromImports, ...directImports, ...dynamicImports].map(
    (match) => match[1],
  );
}

function targetLayer(specifier: string, importingFile: string): string {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2).split("/")[0] ?? "";
  }

  if (specifier.startsWith(".")) {
    const target = resolve(dirname(importingFile), specifier);
    return relative(sourceRoot, target).split(/[\\/]/)[0] ?? "";
  }

  return "";
}

describe("source dependency boundaries", () => {
  for (const [layer, rule] of Object.entries(rules)) {
    it(`${layer} does not import forbidden layers or packages`, () => {
      const violations: string[] = [];

      for (const file of sourceFiles(resolve(sourceRoot, layer))) {
        for (const specifier of importedSpecifiers(readFileSync(file, "utf8"))) {
          const importedLayer = targetLayer(specifier, file);
          const packageName = specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0];

          if (rule.layers.includes(importedLayer as never)) {
            violations.push(`${relative(sourceRoot, file)} -> ${specifier}`);
          }

          if (rule.packages.includes(packageName as never)) {
            violations.push(`${relative(sourceRoot, file)} -> ${specifier}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }

  it("domain and application do not access browser persistence APIs", () => {
    const violations = ["domain", "application"].flatMap((layer) =>
      sourceFiles(resolve(sourceRoot, layer)).flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return /\b(indexedDB|IDBDatabase|IDBTransaction|IDBObjectStore|Blob)\b/.test(source)
          ? [relative(sourceRoot, file)]
          : [];
      }),
    );

    expect(violations).toEqual([]);
  });

  it("server App Router modules do not import browser infrastructure", () => {
    const violations: string[] = [];

    for (const file of sourceFiles(resolve(sourceRoot, "app"))) {
      const source = readFileSync(file, "utf8");
      const isClientModule = /^\s*["']use client["'];/m.test(source);
      if (isClientModule) continue;

      for (const specifier of importedSpecifiers(source)) {
        if (targetLayer(specifier, file) === "infrastructure") {
          violations.push(`${relative(sourceRoot, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("only the approved client composition root imports infrastructure from App Router code", () => {
    const allowedCompositionRoot = "app/_providers/local-application-runtime.client.tsx";
    const violations: string[] = [];

    for (const file of sourceFiles(resolve(sourceRoot, "app"))) {
      for (const specifier of importedSpecifiers(readFileSync(file, "utf8"))) {
        if (targetLayer(specifier, file) !== "infrastructure") continue;

        const importingPath = relative(sourceRoot, file).replaceAll("\\", "/");
        if (importingPath !== allowedCompositionRoot) {
          violations.push(`${importingPath} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("presentation does not import application repository paths", () => {
    const violations = sourceFiles(resolve(sourceRoot, "presentation")).flatMap(
      (file) =>
        importedSpecifiers(readFileSync(file, "utf8"))
          .filter((specifier) => specifier.includes("application/repositories"))
          .map((specifier) => `${relative(sourceRoot, file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("the React runtime context exposes no persistence or infrastructure objects", () => {
    const contextPath = resolve(sourceRoot, "presentation/runtime/application-runtime-context.tsx");
    const source = readFileSync(contextPath, "utf8");

    expect(source).not.toMatch(/LocalDevelopmentRuntime|IndexedDb|IDBDatabase|repositories|atomicPersistence/);
  });

  it("does not expose privileged receipt retention through normal client actions or development tools", () => {
    const publicClientSources = [
      "presentation/runtime/application-runtime-context.tsx",
      "app/_providers/local-application-runtime.client.tsx",
      "presentation/devtools/development-tools.tsx",
    ].map((path) => readFileSync(resolve(sourceRoot, path), "utf8")).join("\n");

    expect(publicClientSources).not.toMatch(
      /ReceiptRetentionService|findEligibleAvailableReceipts|removeContentIfPresent|markRetentionExpiredConditionally|purgeReceipts/i,
    );
  });

  it("route pages stay server components", () => {
    const violations = sourceFiles(resolve(sourceRoot, "app"))
      .filter((file) => file.endsWith("page.tsx"))
      .filter((file) => /^\s*["']use client["'];/m.test(readFileSync(file, "utf8")))
      .map((file) => relative(sourceRoot, file));

    expect(violations).toEqual([]);
  });

  it("development environment branching is isolated to the composition root", () => {
    const allowedPath = "app/_providers/local-application-runtime.client.tsx";
    const violations = ["app", "presentation"].flatMap((layer) =>
      sourceFiles(resolve(sourceRoot, layer)).flatMap((file) => {
        const importingPath = relative(sourceRoot, file).replaceAll("\\", "/");
        const source = readFileSync(file, "utf8");
        return source.includes("process.env.NODE_ENV") && importingPath !== allowedPath
          ? [importingPath]
          : [];
      }),
    );

    expect(violations).toEqual([]);
  });

  it("keeps Recharts out of aggregation and limits it to the approved chart boundary", () => {
    const imports = sourceFiles(sourceRoot).flatMap((file) =>
      importedSpecifiers(readFileSync(file, "utf8"))
        .filter((specifier) => specifier === "recharts")
        .map(() => relative(sourceRoot, file).replaceAll("\\", "/")),
    );

    // The chart boundary is a pair: a lazy-loading wrapper plus the lazily
    // imported Recharts implementation, keeping the library out of the
    // initial Dashboard/Report route graphs.
    expect(imports).toEqual([
      "presentation/analytics/analytics-charts-recharts.client.tsx",
    ]);
    const chartWrapper = readFileSync(
      resolve(sourceRoot, "presentation/analytics/analytics-charts.client.tsx"),
      "utf8",
    );
    expect(chartWrapper).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("\.\/analytics-charts-recharts\.client"\)/);
  });

  it("does not introduce persisted Dashboard or report aggregates", () => {
    const persistenceSource = sourceFiles(resolve(sourceRoot, "infrastructure"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(persistenceSource).not.toMatch(
      /DashboardPageView|MonthlyReportPageView|dailySpending|paymentMix|monthComparison|settlementHealth/,
    );
  });

  it("keeps raw Expense replacement and deletion outside the application repository contract", () => {
    const repositoryContract = readFileSync(
      resolve(sourceRoot, "application/repositories/index.ts"),
      "utf8",
    );

    const expenseRepository = repositoryContract.match(
      /export interface ExpenseRepository\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(expenseRepository).toBeDefined();
    expect(expenseRepository).not.toMatch(
      /\bcreate\s*\(|\breplace\s*\(|\bmarkDeleted\s*\(/,
    );
  });

  it("keeps Expense month aggregation free of instant and timezone conversion", () => {
    const expenseAnalytics = [
      "application/analytics/monthly-analytics.ts",
      "application/analytics/analytics-page.ts",
    ].map((path) => readFileSync(resolve(sourceRoot, path), "utf8")).join("\n");

    expect(expenseAnalytics).not.toMatch(/Date\.UTC|toISOString|new Date\s*\(/);
  });
});
