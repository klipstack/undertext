// Rules from CLAUDE.md that code can check. Reads this checkout's source; writes nothing.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Every module a file pulls in: `import`, `export … from`, and `import()`. */
const dependencies = (path) =>
  [...readFileSync(join(root, path), "utf8").matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);

describe("how the editor is built", () => {
  it("keeps the file format free of the editor: format.ts uses only the Markdown parser", () => {
    expect([...new Set(dependencies("src/editor/format.ts"))]).toEqual(["@lezer/markdown"]);
  });

});

describe("the prose library", () => {
  const files = readdirSync(join(root, "src"), { recursive: true })
    .map((path) => `src/${path}`)
    .filter((path) => /\.tsx?$/.test(path));
  const inside = (path) => path.startsWith("src/prose/");

  it("imports nothing from outside src/prose: no editor, no network, no packages", () => {
    const outside = files
      .filter((path) => inside(path) && !path.endsWith(".test.ts"))
      .flatMap((path) => dependencies(path).map((dep) => [path, dep]))
      .filter(([, dep]) => !/^\.\/[\w.]+$/.test(dep));
    expect(outside).toEqual([]);
  });

  it("is reached from outside only through src/prose/index.ts", () => {
    const reaching = files
      .filter((path) => !inside(path))
      .flatMap((path) => dependencies(path).map((dep) => [path, dep]))
      .filter(([, dep]) => /(?:^|\/)prose\//.test(dep));
    expect(reaching).toEqual([]);
  });
});
