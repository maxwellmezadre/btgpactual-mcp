import type { Config } from "../config.js";
import { accountBalance, accountStatement } from "./account.js";
import { spendingSummary } from "./analytics.js";
import { authStatus } from "./auth.js";
import { cardsList, invoice, invoiceTransactions } from "./cards.js";
import type { ToolDef } from "./define.js";
import { doctor } from "./doctor.js";
import { exportData } from "./export.js";
import { investmentsPosition, investmentsStatement, openFinanceSummary } from "./investments.js";
import { login } from "./login.js";
import { rawGet } from "./raw.js";
import { sync } from "./sync.js";

// Flat registry shared by the MCP server and the CLI: the two surfaces cannot
// drift, because they resolve tools from this same array. The order here is the
// order clients see.
export const allTools: ToolDef[] = [
  // Session and diagnostics
  authStatus,
  login,
  doctor,
  // Cache
  sync,
  // Checking account
  accountBalance,
  accountStatement,
  // Credit cards
  cardsList,
  invoice,
  invoiceTransactions,
  // Investments and open finance
  investmentsPosition,
  investmentsStatement,
  openFinanceSummary,
  // Analytics
  spendingSummary,
  exportData,
  // Escape hatch
  rawGet,
];

/**
 * Read-only mode: the tools that persist something (session, cache, files) are
 * simply not registered. A structural guarantee, not a runtime check.
 */
export function activeTools(config: Pick<Config, "readOnly">): ToolDef[] {
  return config.readOnly ? allTools.filter((tool) => tool.readOnly) : allTools;
}

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
