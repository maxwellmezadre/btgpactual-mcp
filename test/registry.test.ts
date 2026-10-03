import { describe, expect, test } from "bun:test";
import { activeTools, allTools } from "../src/tools/registry.js";

describe("tool registry", () => {
  test("15 tools, unique snake_case names without a btg_ prefix", () => {
    const names = allTools.map((t) => t.name);
    expect(names).toHaveLength(15);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(name.startsWith("btg_")).toBe(false);
    }
  });

  test("every description is substantial and every input is an object schema", () => {
    for (const tool of allTools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
      expect((tool.input as { type?: string }).type, tool.name).toBe("object");
    }
  });

  test("read-only mode drops exactly the tools that write", () => {
    const readOnly = activeTools({ readOnly: true }).map((t) => t.name);
    expect(readOnly).toHaveLength(12);
    expect(allTools.filter((t) => !readOnly.includes(t.name)).map((t) => t.name)).toEqual(["login", "sync", "export"]);
  });
});
