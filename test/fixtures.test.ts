import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

// The repository is public: no fixture may carry a real customer's data. The
// pattern checks always run; when real captures exist locally, the real account
// number is also checked against every fixture.

const FIXTURES = join(import.meta.dir, "fixtures");
const CAPTURES = join(import.meta.dir, "..", "task", "captures");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const contents = files(FIXTURES).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("fixtures carry no personal data", () => {
  test("no CPF or CNPJ", () => {
    for (const { path, text } of contents) {
      expect(text, path).not.toMatch(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
      expect(text, path).not.toMatch(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
    }
  });

  test("no session header names with values", () => {
    for (const { path, text } of contents) {
      expect(text, path).not.toMatch(/"(authorization_code|fingerprint|syncid|sessionid)"\s*:\s*"[^"]{8,}"/i);
    }
  });

  const allocation = join(CAPTURES, "investments-allocation-summary.json");
  test.skipIf(!existsSync(allocation))("the real account number appears in no fixture", () => {
    const real = String((JSON.parse(readFileSync(allocation, "utf8")) as { accountNumber?: string }).accountNumber ?? "");
    expect(real.length).toBeGreaterThan(3);
    for (const { path, text } of contents) expect(text.includes(real), path).toBe(false);
  });
});
