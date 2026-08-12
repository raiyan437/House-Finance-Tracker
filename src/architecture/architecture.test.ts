import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

const rules = {
  domain: {
    layers: ["application", "infrastructure", "presentation", "app"],
    packages: ["react", "react-dom", "next", "appwrite", "zod"],
  },
  application: {
    layers: ["infrastructure", "presentation", "app"],
    packages: ["react", "react-dom", "next", "appwrite"],
  },
  infrastructure: {
    layers: ["presentation", "app"],
    packages: ["appwrite"],
  },
  presentation: {
    layers: ["infrastructure", "app"],
    packages: ["appwrite"],
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
});
