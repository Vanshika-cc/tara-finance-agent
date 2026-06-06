import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

/**
 * query_funds: look up fund NAV data and compute period returns.
 * Formula for period return:
 *   return_pct = ((nav_end - nav_start) / nav_start) * 100
 * We pick the closest available NAV date (<=) for start and end.
 */
export const queryFundsTool = createTool({
  id: "query_funds",
  description: `Look up fund NAV history and compute period returns for one or all funds.
Use this for questions about fund performance, ranking funds by return, or checking what a fund was worth on a date.
Period return formula: ((NAV_end - NAV_start) / NAV_start) * 100`,
  inputSchema: z.object({
    fund_name: z.string().optional().describe("Fund name (partial match). Omit to get all funds."),
    fund_id: z.string().optional().describe("Fund ID (exact). Use instead of fund_name if known."),
    date_from: z.string().optional().describe("Start date for period return, YYYY-MM-DD"),
    date_to: z.string().optional().describe("End date for period return, YYYY-MM-DD. Defaults to latest available."),
    mode: z
      .enum(["nav_on_date", "period_return", "list_funds", "rank_by_return"])
      .default("list_funds")
      .describe(
        "nav_on_date: get NAV closest to date_from. period_return: return % from date_from to date_to. rank_by_return: rank all funds by return in the window."
      ),
  }),

  execute: async ({ context }) => {
    const { fund_name, fund_id, date_from, date_to, mode } = context;

    try {
      if (mode === "list_funds") {
        const res = await pool.query(
          `SELECT DISTINCT id, name, category FROM funds ORDER BY name`
        );
        return { result: res.rows };
      }

      // Helper: get closest NAV <= date for a fund
      async function getNav(fid: string, date: string) {
        const r = await pool.query(
          `SELECT nav_date, nav_value FROM funds WHERE id = $1 AND nav_date <= $2 ORDER BY nav_date DESC LIMIT 1`,
          [fid, date]
        );
        return r.rows[0] || null;
      }

      // Resolve fund(s)
      let fundFilter = "";
      const filterParams: any[] = [];
      if (fund_id) {
        fundFilter = `WHERE id = $1`;
        filterParams.push(fund_id);
      } else if (fund_name) {
        fundFilter = `WHERE name ILIKE $1`;
        filterParams.push(`%${fund_name}%`);
      }

      const fundsRes = await pool.query(
        `SELECT DISTINCT id, name, category FROM funds ${fundFilter}`,
        filterParams
      );

      if (fundsRes.rows.length === 0) {
        return { error: "No funds found matching the query" };
      }

      if (mode === "nav_on_date") {
        const results = [];
        for (const fund of fundsRes.rows) {
          const nav = await getNav(fund.id, date_from || new Date().toISOString().split("T")[0]);
          results.push({ fund_id: fund.id, fund_name: fund.name, ...nav });
        }
        return { result: results };
      }

      if (mode === "period_return" || mode === "rank_by_return") {
        const endDate = date_to || (await pool.query(
          `SELECT MAX(nav_date) as max_date FROM funds`
        )).rows[0].max_date;

        const startDate = date_from;
        if (!startDate) return { error: "date_from is required for period_return" };

        const results = [];
        for (const fund of fundsRes.rows) {
          const navStart = await getNav(fund.id, startDate);
          const navEnd = await getNav(fund.id, endDate);
          if (!navStart || !navEnd) {
            results.push({ fund_id: fund.id, fund_name: fund.name, error: "Insufficient NAV data" });
            continue;
          }
          const returnPct = ((navEnd.nav_value - navStart.nav_value) / navStart.nav_value) * 100;
          results.push({
            fund_id: fund.id,
            fund_name: fund.name,
            nav_start: parseFloat(navStart.nav_value),
            nav_start_date: navStart.nav_date,
            nav_end: parseFloat(navEnd.nav_value),
            nav_end_date: navEnd.nav_date,
            period_return_pct: Math.round(returnPct * 100) / 100,
          });
        }

        if (mode === "rank_by_return") {
          results.sort((a: any, b: any) => (b.period_return_pct ?? -Infinity) - (a.period_return_pct ?? -Infinity));
          if (results.length >= 2) {
            const valid = results.filter((r: any) => r.period_return_pct != null);
            const spread = valid.length >= 2
              ? Math.round((valid[0].period_return_pct - valid[valid.length - 1].period_return_pct) * 100) / 100
              : null;
            return { result: results, best: results[0], worst: results[results.length - 1], spread_pct: spread };
          }
        }

        return { result: results };
      }

      return { error: "Unknown mode" };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
