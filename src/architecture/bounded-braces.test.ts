// @vitest-environment node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const braces = require("braces");
const safeError = /nesting exceeds the safe limit/;
const deep = (open: string, close: string) => open.repeat(4900) + "a,b" + close.repeat(4900);

describe("bounded tooling brace processing", () => {
  it("installs the patched source for every micromatch consumer", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const entries = Object.entries(lock.packages).filter(([key]) => key.endsWith("/braces"));
    expect(entries.length).toBeGreaterThan(0);
    for (const [, entry] of entries) {
      expect(entry).toMatchObject({ resolved: "vendor/bounded-braces", link: true });
    }
    expect(require("braces/package.json").name).toBe("@house-finance-tracker/bounded-braces");
    expect(require("micromatch").braceExpand("{a,b}")).toEqual(["a", "b"]);
  });

  for (const [label, pattern] of [
    ["brace", deep("{", "}")],
    ["paren", deep("(", ")")],
    ["mixed", "{(".repeat(2400) + "a,b" + ")}".repeat(2400)],
    ["unclosed", "{".repeat(4900) + "a,b"],
  ]) {
    for (const method of ["parse", "compile", "expand", "stringify"] as const) {
      it(`rejects excessive ${label} nesting through ${method}`, () => {
        expect(() => braces[method](pattern, { maxDepth: Infinity, maxLength: Infinity }))
          .toThrowError(safeError);
      });
    }
  }

  for (const method of ["compile", "expand", "stringify"] as const) {
    it(`guards external ASTs through both public and direct ${method} APIs`, () => {
      const makeAst = () => {
        const root = { type: "root", nodes: [] as unknown[] };
        let current = root;
        for (let i = 0; i < 12000; i++) {
          const child = { type: "root", nodes: [] as unknown[] };
          current.nodes.push(child);
          current = child;
        }
        current.nodes.push({ type: "text", value: "x" });
        return root;
      };
      const ast = makeAst();
      expect(() => braces[method](ast)).toThrowError(safeError);
      expect(ast).not.toHaveProperty("queue");
      expect(() => require(`braces/lib/${method}`)(makeAst())).toThrowError(safeError);
    });

    it(`rejects cyclic child ASTs in ${method}`, () => {
      const ast = { type: "root", nodes: [] as unknown[] };
      ast.nodes.push(ast);
      expect(() => braces[method](ast)).toThrowError(safeError);
    });
  }

  it("bounds cyclic expansion ancestry and nested flatten arrays", () => {
    const ast = { type: "paren", parent: null as unknown, nodes: [] };
    ast.parent = ast;
    expect(() => braces.expand(ast)).toThrowError(safeError);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => require("braces/lib/utils").flatten(cyclic)).toThrowError(safeError);
  });

  it("preserves ordinary expansion, compilation, options, and nested syntax", () => {
    expect(braces.expand("src/{app,presentation}/**/*.{ts,tsx}")).toEqual([
      "src/app/**/*.ts", "src/app/**/*.tsx", "src/presentation/**/*.ts", "src/presentation/**/*.tsx",
    ]);
    expect(braces.compile("file-{01..03}.{ts,tsx}")).toBe("file-(0[1-3]).(ts|tsx)");
    expect(braces.expand("{a,{b,c}}", { nodupes: true })).toEqual(["a", "b", "c"]);
    expect(braces.expand("{a,a,,b}", { nodupes: true, noempty: true })).toEqual(["a", "b"]);
    expect(braces.stringify(braces.parse("a/{b,c}/d"))).toBe("a/{b,c}/d");
    expect(braces.expand("${a,b}")).toEqual(["${a,b}"]);
    expect(braces.compile("(a/{b,c})")).toBe("(a/(b|c))");
    expect(braces.expand("{a")).toEqual(["{a"]);
    expect(() => braces.expand("{1..1001}")).toThrow(RangeError);
    expect(braces.expand("{1..3}", { rangeLimit: false })).toEqual(["1", "2", "3"]);
    expect(braces.compile("{".repeat(100) + "x" + "}".repeat(100))).toContain("x");
    expect(braces(["{a,b}", "{c,d}"])).toEqual(["(a|b)", "(c|d)"]);
    expect(braces.expand("{01..05..2}")).toEqual(["01", "03", "05"]);
  });

  it("accepts the maximum safe container depth and rejects the next level", () => {
    // Root at zero, 127 nested containers, and a leaf at depth 128.
    for (const method of ["compile", "expand", "stringify"] as const) {
      expect(() => braces[method]("{".repeat(127) + "x" + "}".repeat(127))).not.toThrow();
      expect(() => braces[method]("{".repeat(128) + "x" + "}".repeat(128))).toThrowError(safeError);
    }
  });

  it("retains escaped, quoted, and bracketed literal braces", () => {
    expect(braces.compile("\\{".repeat(500) + "x")).toBe("{".repeat(500) + "x");
    expect(braces.compile('"' + "{".repeat(500) + '"')).toBe("{".repeat(500));
    expect(braces.compile("[" + "{".repeat(500) + "]")).toBe("[" + "{".repeat(500) + "]");
  });

  it("preserves representative fast-glob matching in the actual dependency tree", () => {
    const glob = require("fast-glob");
    const matches = glob.sync("src/architecture/*.{ts,tsx}", { onlyFiles: true });
    expect(matches).toContain("src/architecture/architecture.test.ts");
    expect(matches).toContain("src/architecture/bounded-braces.test.ts");
    expect(require("micromatch")(matches, "**/{architecture,bounded-braces}.test.ts"))
      .toEqual(expect.arrayContaining([
        "src/architecture/architecture.test.ts", "src/architecture/bounded-braces.test.ts",
      ]));
  });
});
