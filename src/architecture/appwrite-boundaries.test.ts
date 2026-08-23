import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

describe("Appwrite infrastructure containment", () => {
  it("confines the Appwrite SDK to the Appwrite adapter module", () => {
    const violations = sourceFiles(SRC)
      .map((file) => ({ file: relative(ROOT, file).replaceAll("\\", "/"), source: read(file) }))
      .filter(({ file, source }) => /from ["']node-appwrite["']/.test(source) && !file.startsWith("src/infrastructure/appwrite/"))
      .map(({ file }) => file);
    expect(violations).toEqual([]);
  });

  it("keeps secret environment names inside the appwrite config module", () => {
    const violations = sourceFiles(SRC)
      .map((file) => ({ file: relative(ROOT, file).replaceAll("\\", "/"), source: read(file) }))
      .filter(
        ({ file, source }) =>
          /APPWRITE_(RUNTIME_API_KEY|BOOTSTRAP_API_KEY)/.test(source) &&
          !file.startsWith("src/infrastructure/appwrite/") &&
          !file.includes("appwrite-boundaries.test"),
      )
      .map(({ file }) => file);
    expect(violations).toEqual([]);
  });

  it("prevents presentation and application layers from importing the production adapter", () => {
    const violations = sourceFiles(join(SRC, "presentation"))
      .concat(sourceFiles(join(SRC, "application")))
      .concat(sourceFiles(join(SRC, "domain")))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
      .filter((file) => /@\/infrastructure\/appwrite/.test(read(join(ROOT, file))));
    expect(violations).toEqual([]);
  });

  it("does not wire the production adapter into the client runtime composition yet", () => {
    const violations = sourceFiles(join(SRC, "infrastructure"))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
      .filter((file) => !file.startsWith("src/infrastructure/appwrite/"))
      .filter((file) => !file.endsWith("appwrite-boundaries.test.ts"))
      .filter((file) => read(join(ROOT, file)).includes("infrastructure/appwrite"));
    expect(violations).toEqual([]);
  });
});
