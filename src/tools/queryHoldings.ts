import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

/**
 * query_holdings: compute the user's realised return on their holdings.
 * Formula for realised return per holding:
 *   current_value = units * current_nav
 *   purchase_cost = units * purchase_nav
 *   realised_return_pct = ((current_value - purchase_cost) / purchase_cost) * 100
 *   realised_return_inr = current_value - purchase_cost
 * "Current NAV" = latest available NAV for the fund in the funds table.
 */
export const queryHoldingsTool = createTool({
  id: "query_holdings",
  description: `Query the user's fund holdings and compute realised returns.
Realised return = (current_value - purchase_cost) / purchase_cost * 100, where current_value = units × latest NAV.
Use this for questions about portfolio worth, profit/loss, or comparing returns across the user's holdings.
This is different from a fund's period return — it accounts for how many units the user owns and when they bought.`,
  inputSchema: z.object({
    fund_name: z.string().optional().describe("Filter by fund name (partial match). Omit for all holdings."),
    fund_id: z.string().optional().describe("Filter by fund ID (exact)."),
    mode: z
      .enum(["portfolio_summary", "per_holding", "best_performer"])
      .default("per_holding")
      .describe(
        "portfolio_summary: total worth and total profit. per_holding: breakdown per fund. best_performer: which holding has best realised return."
      ),
  }),

  execute: async ({ context }) => {
    const { fund_name, fund_id, mode } = context;

    try {
      // Build filter
      let holdingFilter = "";
      const filterParams: any[] = [];
      if (fund_id) {
        holdingFilter = `WHERE h.fund_id = $1`;
        filterParams.push(fund_id);
      } else if (fund_name) {
        holdingFilter = `WHERE h.fund_name ILIKE $1`;
        filterParams.push(`%${fund_name}%`);
      }

      // Get holdings with latest NAV joined
      const res = await pool.query(
        `SELECT
           h.id,
           h.fund_id,
           h.fund_name,
           h.units,
           h.purchase_date,
           h.purchase_nav,
           f.nav_value as current_nav,
           f.nav_date as current_nav_date
         FROM holdings h
         JOIN LATERAL (
           SELECT nav_value, nav_date
           FROM funds
           WHERE id = h.fund_id
           ORDER BY nav_date DESC
           LIMIT 1
         ) f ON true
         ${holdingFilter}`,
        filterParams
      );

      if (res.rows.length === 0) {
        return { error: "No holdings found" };
      }

      const holdings = res.rows.map((row) => {
        const units = parseFloat(row.units);
        const purchaseNav = parseFloat(row.purchase_nav);
        const currentNav = parseFloat(row.current_nav);
        const purchaseCost = units * purchaseNav;
        const currentValue = units * currentNav;
        const returnInr = currentValue - purchaseCost;
        const returnPct = ((currentValue - purchaseCost) / purchaseCost) * 100;
        return {
          fund_id: row.fund_id,
          fund_name: row.fund_name,
          units,
          purchase_date: row.purchase_date,
          purchase_nav: purchaseNav,
          current_nav: currentNav,
          current_nav_date: row.current_nav_date,
          purchase_cost_inr: Math.round(purchaseCost * 100) / 100,
          current_value_inr: Math.round(currentValue * 100) / 100,
          realised_return_inr: Math.round(returnInr * 100) / 100,
          realised_return_pct: Math.round(returnPct * 100) / 100,
        };
      });

      if (mode === "portfolio_summary") {
        const totalCost = holdings.reduce((s, h) => s + h.purchase_cost_inr, 0);
        const totalValue = holdings.reduce((s, h) => s + h.current_value_inr, 0);
        const totalReturn = totalValue - totalCost;
        const totalReturnPct = (totalReturn / totalCost) * 100;
        return {
          result: {
            total_holdings: holdings.length,
            total_purchase_cost_inr: Math.round(totalCost * 100) / 100,
            total_current_value_inr: Math.round(totalValue * 100) / 100,
            total_return_inr: Math.round(totalReturn * 100) / 100,
            total_return_pct: Math.round(totalReturnPct * 100) / 100,
            holdings,
          },
        };
      }

      if (mode === "best_performer") {
        const best = holdings.reduce((a, b) =>
          a.realised_return_pct > b.realised_return_pct ? a : b
        );
        return { result: best };
      }

      return { result: holdings };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
