import { describe, expect, test } from "bun:test";
import { parseAllocation } from "../src/btg/investments/position.js";
import { ParseError } from "../src/core/errors.js";
import allocation from "./fixtures/investments/allocation.json" with { type: "json" };

const clone = () => JSON.parse(JSON.stringify(allocation));

describe("allocation (consolidated portfolio)", () => {
  const parsed = parseAllocation(allocation);

  test("classes and totals in cents, no identity warnings", () => {
    expect(parsed.totalCents).toBe(350050);
    expect(parsed.positionDate).toBe("2026-01-15");
    expect(parsed.classes.map((c) => [c.id, c.positionCount, c.valueCents])).toEqual([
      ["RV", 2, 150000],
      ["RF", 1, 150000],
      ["CRY", 1, 50050],
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  test("walks each class tree and labels the kind", () => {
    expect(parsed.positions.map((p) => p.kind)).toEqual(["etf", "etf", "renda_fixa", "cripto"]);
  });

  test("equity: invested, gain and yield on invested", () => {
    const etf = parsed.positions[0];
    expect(etf?.name).toBe("ETFA11");
    expect(etf?.description).toBe("ETF EXEMPLO A");
    expect(etf?.productId).toBe("BRETFAXXX001");
    expect(etf?.grossValueCents).toBe(100000);
    expect(etf?.investedCents).toBe(90000);
    expect(etf?.gainCents).toBe(10000);
    expect(etf?.yieldPercent).toBe(11.1111);
    expect(etf?.marketPrice).toBe(100);
  });

  test("fixed income: invested is totalInitialInvestment, never applicationValue; yield is computed", () => {
    const rf = parsed.positions[2];
    expect(rf?.investedCents).toBe(140000);
    expect(rf?.netValueCents).toBe(148000);
    expect(rf?.gainCents).toBe(10000);
    expect(rf?.yieldPercent).toBe(7.1429); // 100 / 1400, not the contracted 13.25
    expect(rf?.indexer).toBe("110,00% CDI");
    expect(rf?.issuer).toBe("BANCO EXEMPLO");
    expect(rf?.maturityDate).toBe("2028-05-02");
    expect(rf?.marketPrice).toBe(1500);
    expect(rf?.incomeTaxCents).toBe(1500);
  });

  test("crypto: market price from asset.value (not the previous close), unit price unrounded", () => {
    const btc = parsed.positions[3];
    expect(btc?.name).toBe("BTC");
    expect(btc?.description).toBe("Bitcoin");
    expect(btc?.marketPrice).toBe(500000);
    expect(btc?.quantity).toBe(0.001);
    expect(btc?.investedCents).toBe(40000);
    expect(btc?.yieldPercent).toBe(25);
  });

  test("a class whose positions do not add up beyond tolerance is warned", () => {
    const broken = clone();
    broken.summary[0].positionValue = 2000;
    expect(parseAllocation(broken).warnings[0]).toContain("Renda Variável");
  });

  test("an unknown future class still yields positions", () => {
    const future = clone();
    future.summary.push({
      id: "PREV",
      name: "Previdência",
      positionValue: 10,
      assets: { _type: "market", pensionFunds: [{ name: "PLANO EXEMPLO", grossValue: 10, investedValue: 8 }] },
    });
    future.totalAmmount = 3510.5;
    const result = parseAllocation(future);
    const pension = result.positions.find((p) => p.assetClassId === "PREV");
    expect(pension?.name).toBe("PLANO EXEMPLO");
    expect(pension?.kind).toBe("pensionFunds");
    expect(pension?.gainCents).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  test("missing summary[] is a ParseError", () => {
    expect(() => parseAllocation({ totalAmmount: 1 })).toThrow(ParseError);
  });
});
