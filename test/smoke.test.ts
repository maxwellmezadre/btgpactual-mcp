import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };

// The cheapest possible proof the toolchain is wired: the package metadata is
// what the entry points embed as the advertised version.
describe("smoke", () => {
  test("package identity", () => {
    expect(pkg.name).toBe("@maxwellmezadre/btgpactual-mcp");
    expect(pkg.bin).toHaveProperty("btgpactual");
    expect(pkg.bin).toHaveProperty("btgpactual-mcp");
  });
});
